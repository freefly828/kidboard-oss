/**
 * Render job 队列集成测试（真实 PostgreSQL）— 验证 docs/03 §5 全部规则。
 *
 * 覆盖：
 * - FOR UPDATE SKIP LOCKED 抢占（并发下不重复领取）
 * - 2 分钟锁超时后崩溃遗留 job 可被重新领取
 * - 同一 child 连续变更合并 → 旧 job 标记 superseded
 * - 最多重试 3 次，之后进入终态 failed
 * - available_at 退避
 *
 * 需要 DATABASE_URL 指向已应用 schema 的库；未设置时整组跳过（不伪装 PASS）。
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@kidboard/db";
import {
  claimNextJob,
  getJob,
  isJobStale,
  LOCK_TIMEOUT_MS,
  markJobFailed,
  markJobSucceeded,
  markJobSuperseded,
  MAX_ATTEMPTS,
  supersedeStaleJobs,
  workerId,
} from "../src/jobs";
import { parkForeignJobs } from "../src/helpers/parkForeignJobs";

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = Boolean(DATABASE_URL) && /test|kidboard/.test(DATABASE_URL ?? "");

if (!enabled) {
  console.warn(
    "[jobs integration tests SKIPPED] set DATABASE_URL to a migrated kidboard database to run them",
  );
}

const d = describe.skipIf(!enabled);

d("render job 队列（docs/03 §5）", () => {
  let familyId: string;
  const createdFamilyIds: string[] = [];
  let childId: string;
  let otherChildId: string;
  let restoreForeignJobs: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    // 每个用例用独立家庭，避免相互污染
    const f = await client`
      INSERT INTO families (name) VALUES (${`jobs-test-${Date.now()}-${Math.random()}`})
      RETURNING id
    `;
    familyId = String(f[0]!.id);
    createdFamilyIds.push(familyId);
    const c1 = await client`
      INSERT INTO children (family_id, display_name) VALUES (${familyId}, '队列测试娃1') RETURNING id
    `;
    const c2 = await client`
      INSERT INTO children (family_id, display_name) VALUES (${familyId}, '队列测试娃2') RETURNING id
    `;
    childId = String(c1[0]!.id);
    otherChildId = String(c2[0]!.id);
    // 共享测试库可能残留其它可抢占 job（含之前用例的家庭），先停放，保证断言只针对本用例
    restoreForeignJobs = await parkForeignJobs(client, [childId, otherChildId]);
  });

  afterEach(async () => {
    await restoreForeignJobs?.();
    restoreForeignJobs = undefined;
  });

  afterAll(async () => {
    if (createdFamilyIds.length > 0) {
      await client`DELETE FROM families WHERE id = ANY(${createdFamilyIds}::uuid[])`.catch(() => {});
    }
  });

  async function enqueue(cid: string, contentVersion: number, availableAt?: Date) {
    // postgres-js 不接受裸 Date 作为参数，需显式传 ISO 字符串
    const at = (availableAt ?? new Date()).toISOString();
    const rows = await client`
      INSERT INTO render_jobs (child_id, requested_content_version, available_at)
      VALUES (${cid}, ${contentVersion}, ${at}::timestamptz)
      RETURNING id
    `;
    return String(rows[0]!.id);
  }

  it("抢占后状态变 running、attempts+1、locked_by 写入 worker", async () => {
    const jobId = await enqueue(childId, 1);
    const claimed = await claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.attempts).toBe(1);

    const job = await getJob(jobId);
    expect(job!.status).toBe("running");
    expect(job!.attempts).toBe(1);

    const row = await client`SELECT locked_by, locked_at FROM render_jobs WHERE id = ${jobId}`;
    expect(String(row[0]!.locked_by)).toBe(workerId());
    expect(row[0]!.locked_at).not.toBeNull();
  });

  it("未到 available_at 的 job 不被抢占", async () => {
    await enqueue(childId, 1, new Date(Date.now() + 60_000));
    const claimed = await claimNextJob();
    expect(claimed).toBeNull();
  });

  it("并发抢占同一 job 只会成功一次（SKIP LOCKED）", async () => {
    // 清掉当前测试 family 之外的无关 job，避免干扰
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);

    const results = await Promise.all([
      claimNextJob(),
      claimNextJob(),
      claimNextJob(),
      claimNextJob(),
    ]);
    const claimedIds = results.filter((r) => r !== null).map((r) => r!.id);
    // 只有一个 worker 拿到该 job；其余返回 null（或极小概率抢到别的库内 job）
    expect(claimedIds.filter((id) => id === jobId).length).toBe(1);

    const job = await getJob(jobId);
    expect(job!.attempts).toBe(1); // 只被领取一次
  });

  it("崩溃遗留：锁超过 2 分钟后可被重新领取（attempts 继续累加）", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);
    await claimNextJob();

    // 伪造 3 分钟前加的锁（超过 LOCK_TIMEOUT_MS）
    const stale = new Date(Date.now() - LOCK_TIMEOUT_MS - 60_000).toISOString();
    await client`UPDATE render_jobs SET locked_at = ${stale}::timestamptz WHERE id = ${jobId}`;

    const reclaimed = await claimNextJob();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(jobId);
    expect(reclaimed!.attempts).toBe(2);
  });

  it("锁未超时的 running job 不被重新领取", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    await enqueue(childId, 1);
    await claimNextJob();
    const again = await claimNextJob();
    expect(again).toBeNull();
  });

  it("合并：同一 child 旧版本 job 被标记 superseded", async () => {
    const oldJob = await enqueue(childId, 5);
    const newJob = await enqueue(childId, 7);

    const supersededCount = await supersedeStaleJobs(childId, 7);
    expect(supersededCount).toBe(1);
    expect((await getJob(oldJob))!.status).toBe("superseded");
    expect((await getJob(newJob))!.status).toBe("queued");
  });

  it("合并不误杀：相同 content_version 的 queued job 保留", async () => {
    const a = await enqueue(childId, 7);
    const b = await enqueue(childId, 7);
    const n = await supersedeStaleJobs(childId, 7);
    expect(n).toBe(0);
    expect((await getJob(a))!.status).toBe("queued");
    expect((await getJob(b))!.status).toBe("queued");
  });

  it("stale 判定：存在更新的 queued job 时返回 true", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    // 明确时间顺序：old 更早可领取，new 稍晚
    const oldJob = await enqueue(childId, 5, new Date(Date.now() - 10_000));
    await enqueue(childId, 6, new Date(Date.now() - 5_000));
    const claimedOld = await claimNextJob();
    expect(claimedOld!.id).toBe(oldJob);
    expect(await isJobStale(childId, 5)).toBe(true);
    expect(await isJobStale(childId, 6)).toBe(false);
  });

  it("stale 判定按 child 隔离：其他 child 的 job 不影响", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    await enqueue(childId, 5);
    await enqueue(otherChildId, 99);
    expect(await isJobStale(childId, 5)).toBe(false);
  });

  it(`重试：第 1、2 次失败退回 queued，第 ${MAX_ATTEMPTS} 次进入终态 failed`, async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);

    // attempt 1
    await claimNextJob();
    let r = await markJobFailed(jobId, "chromium crashed");
    expect(r.willRetry).toBe(true);
    let job = await getJob(jobId);
    expect(job!.status).toBe("queued");
    expect(job!.lastError).toBe("chromium crashed");

    // 退避后立即可领取（把 available_at 拉回现在模拟时间前进）
    await client`UPDATE render_jobs SET available_at = now() WHERE id = ${jobId}`;

    // attempt 2
    await claimNextJob();
    r = await markJobFailed(jobId, "chromium crashed again");
    expect(r.willRetry).toBe(true);
    await client`UPDATE render_jobs SET available_at = now() WHERE id = ${jobId}`;

    // attempt 3 → 终态
    await claimNextJob();
    r = await markJobFailed(jobId, "final failure");
    expect(r.willRetry).toBe(false);
    job = await getJob(jobId);
    expect(job!.status).toBe("failed");
    expect(job!.attempts).toBe(3);
    expect(job!.lastError).toBe("final failure");
  });

  it("退避：失败后 available_at 落在未来（指数退避）", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);
    await claimNextJob();
    await markJobFailed(jobId, "boom");
    const row = await client`SELECT available_at, now() AS n FROM render_jobs WHERE id = ${jobId}`;
    expect(new Date(String(row[0]!.available_at)).getTime()).toBeGreaterThan(
      new Date(String(row[0]!.n)).getTime(),
    );
  });

  it("终态 failed 的 job 不会被再次抢占", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);
    await client`UPDATE render_jobs SET status = 'failed', attempts = 3 WHERE id = ${jobId}`;
    expect(await claimNextJob()).toBeNull();
  });

  it("succeeded 后不再被抢占，且 cleared last_error", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);
    await claimNextJob();
    await markJobFailed(jobId, "transient"); // 制造 last_error
    await client`UPDATE render_jobs SET available_at = now() WHERE id = ${jobId}`;
    await claimNextJob();
    await markJobSucceeded(jobId, 1);
    const job = await getJob(jobId);
    expect(job!.status).toBe("succeeded");
    expect(job!.lastError).toBeNull();
    expect(await claimNextJob()).toBeNull();
  });

  it("superseded job 不会被抢占", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const jobId = await enqueue(childId, 1);
    await markJobSuperseded(jobId);
    expect(await claimNextJob()).toBeNull();
  });

  it("多个 child 的 job 按 available_at/created_at 顺序处理", async () => {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE status IN ('queued','running') AND child_id IN (${childId}, ${otherChildId})`;
    const first = await enqueue(childId, 1, new Date(Date.now() - 10_000));
    const second = await enqueue(otherChildId, 1, new Date(Date.now() - 5_000));
    expect((await claimNextJob())!.id).toBe(first);
    expect((await claimNextJob())!.id).toBe(second);
  });
});
