/**
 * Render job 队列 — 抢占 / 回收 / 合并 / 重试（docs/03 §5）。
 *
 * 规则（不得偏离）：
 * - V1 不部署 Redis，用 PostgreSQL `FOR UPDATE SKIP LOCKED` 抢占；
 * - 同一 child 的连续变更允许合并（superseded）；
 * - job 执行前重新读取最新 content_version；
 * - 若已有更新的 queued/running job，旧 job 直接标记 superseded；
 * - renderer 崩溃后锁超过 2 分钟可被重新领取；
 * - 最多重试 3 次。
 *
 * 实现要点：drizzle-orm/postgres-js 的 `db.execute()` 只返回 rows 数组，
 * 因此统一使用 `client.begin()` 显式事务 + `sql.unsafe()` 拿原始行。
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { Sql } from "postgres";
import { client } from "@kidboard/db";

/** 崩溃后锁超时（docs/03 §5：2 分钟） */
export const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

/** 最大尝试次数（docs/03 §5：3 次） */
export const MAX_ATTEMPTS = 3;

export interface ClaimedJob {
  id: string;
  childId: string;
  requestedContentVersion: number;
  attempts: number;
}

export interface JobRow {
  id: string;
  childId: string;
  status: string;
  attempts: number;
  requestedContentVersion: number;
  lastError: string | null;
}

/** 当前机器/进程标识，写入 render_jobs.locked_by */
export function workerId(): string {
  return `${hostname()}-${process.pid}`;
}

/** 把 job 行转为 ClaimedJob（postgres 返回的 bigint 是字符串） */
function toClaimed(row: Record<string, unknown>): ClaimedJob {
  return {
    id: String(row.id),
    childId: String(row.child_id),
    requestedContentVersion: Number(row.requested_content_version),
    attempts: Number(row.attempts),
  };
}

/**
 * 抢占一个可执行 job。
 *
 * - 可领取：status='queued' AND available_at <= now()
 * - 可回收：status='running' AND locked_at < now() - 2min（崩溃遗留）
 * - 同一 child 只取最早的一个（合并由 supersedeStaleJobs 负责）
 *
 * 返回 null 表示当前无任务。
 */
export async function claimNextJob(
  dbClient: Sql = client,
  worker = workerId(),
): Promise<ClaimedJob | null> {
  const rows = await dbClient.begin(async (tx) => {
    const claimed = await tx`
      UPDATE render_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_at = now(),
             locked_by = ${worker}
       WHERE id = (
         SELECT id FROM render_jobs
          WHERE (status = 'queued' AND available_at <= now())
             OR (status = 'running' AND locked_at < now() - ${`${LOCK_TIMEOUT_MS} milliseconds`}::interval)
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING id, child_id, requested_content_version, attempts
    `;
    return claimed;
  });

  const first = rows[0];
  return first ? toClaimed(first as Record<string, unknown>) : null;
}

/**
 * 合并同一 child 的过期 job：已被更新的 content_version 覆盖的 job 直接标记 superseded。
 *
 * 只处理 queued（running 的由持有锁的 worker 自己判定），
 * 并且只在存在更高 requested_content_version 时才动，避免误杀当前唯一 job。
 * 返回被标记的数量。
 */
export async function supersedeStaleJobs(
  childId: string,
  currentContentVersion: number,
  dbClient: Sql = client,
): Promise<number> {
  const rows = await dbClient`
    UPDATE render_jobs
       SET status = 'superseded',
           finished_at = now()
     WHERE child_id = ${childId}
       AND status = 'queued'
       AND requested_content_version < ${currentContentVersion}
    RETURNING id
  `;
  return rows.length;
}

/**
 * job 完成前检查：本 job 请求的 content_version 是否仍是最新。
 * 若 child 已有更新的 job 在队列中，本 job 视为过期，应标记 superseded 而不产出帧。
 */
export async function isJobStale(
  childId: string,
  jobContentVersion: number,
  dbClient: Sql = client,
): Promise<boolean> {
  const rows = await dbClient`
    SELECT 1
      FROM render_jobs
     WHERE child_id = ${childId}
       AND status IN ('queued', 'running')
       AND requested_content_version > ${jobContentVersion}
     LIMIT 1
  `;
  return rows.length > 0;
}

/** 标记成功 */
export async function markJobSucceeded(
  jobId: string,
  frameVersion: number,
  dbClient: Sql = client,
): Promise<void> {
  await dbClient`
    UPDATE render_jobs
       SET status = 'succeeded',
           finished_at = now(),
           last_error = NULL
     WHERE id = ${jobId}
  `;
  void frameVersion; // frame_version 记录在 screen_frames，job 表不重复存储
}

/**
 * 标记失败。
 *
 * - attempts < MAX_ATTEMPTS → 退回 queued，available_at 指数退避（1s/2s/4s）
 * - attempts >= MAX_ATTEMPTS → 终态 failed
 *
 * 返回是否还会重试。
 */
export async function markJobFailed(
  jobId: string,
  error: string,
  dbClient: Sql = client,
): Promise<{ willRetry: boolean }> {
  const trimmed = error.slice(0, 2000);
  const rows = await dbClient`
    WITH target AS (
      SELECT id, attempts FROM render_jobs WHERE id = ${jobId}
    )
    UPDATE render_jobs j
       SET status = CASE WHEN j.attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
           available_at = CASE
             WHEN j.attempts >= ${MAX_ATTEMPTS} THEN j.available_at
             ELSE now() + make_interval(secs => power(2, j.attempts - 1))
           END,
           locked_at = NULL,
           locked_by = NULL,
           last_error = ${trimmed},
           finished_at = CASE WHEN j.attempts >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END
      FROM target
     WHERE j.id = target.id
    RETURNING j.status
  `;
  const status = (rows[0] as { status?: string } | undefined)?.status;
  return { willRetry: status === "queued" };
}

/** 标记为 superseded（被更新的 job 取代） */
export async function markJobSuperseded(
  jobId: string,
  dbClient: Sql = client,
): Promise<void> {
  await dbClient`
    UPDATE render_jobs
       SET status = 'superseded', finished_at = now()
     WHERE id = ${jobId}
  `;
}

/** 读取 job（测试与诊断用） */
export async function getJob(
  jobId: string,
  dbClient: Sql = client,
): Promise<JobRow | null> {
  const rows = await dbClient`SELECT * FROM render_jobs WHERE id = ${jobId}`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    childId: String(row.child_id),
    status: String(row.status),
    attempts: Number(row.attempts),
    requestedContentVersion: Number(row.requested_content_version),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

/** 供 meta/日志使用的稳定短哈希 */
export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
