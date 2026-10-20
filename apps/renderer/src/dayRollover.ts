/**
 * 跨天切换（day rollover）— 每个孩子时区的"今天"变化后，屏幕必须换成新一天的
 * 日期、课表与任务。此前只有家长改数据才触发渲染，过了午夜屏幕仍停在昨天。
 *
 * D-013 起"显示计划"有两个边界：0 点（换天）与 preview_from（默认 19:00 进入明日预览）。
 * 判定：孩子已有 active frame，且最近一次 render job 时的显示计划（模式+日期）与现在不同，
 * 且没有排队/进行中的 render job → 物化今天的重复任务（task_templates → task_occurrences），
 * content_version+1 并创建 render job（与 Web 侧 bumpContentVersion 同语义）。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { materializeDay } from "@kidboard/db/materialize";
import { children, renderJobs, screenFrames } from "@kidboard/db/schema";
import { displayKey, displayPlan } from "@kidboard/db/screen-input";

/** 给定时刻在某时区的日期 YYYY-MM-DD */
export function dateIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * 纯函数：最近一次渲染请求是否发生在"今天"之前（需要跨天重渲染）。
 * 用 render job 而非 frame 时间：内容未变时 renderer 复用旧帧，frame 时间不会更新，
 * 会导致每分钟重复触发。
 */
export function needsRollover(
  lastRenderRequestedAt: Date,
  timezone: string,
  now: Date,
  previewFrom: string | null = null,
): boolean {
  return displayKey(lastRenderRequestedAt, timezone, previewFrom) !== displayKey(now, timezone, previewFrom);
}

export interface RolloverResult {
  checked: number;
  rolled: string[];
}

export async function runDayRollover(now = new Date()): Promise<RolloverResult> {
  const rows = await db
    .select({
      childId: children.id,
      timezone: children.timezone,
      previewFrom: children.previewFrom,
      lastJobAt: sql<Date>`(select max(${renderJobs.createdAt}) from ${renderJobs} where ${renderJobs.childId} = ${children.id})`.mapWith((v) => new Date(v as string)),
    })
    .from(children)
    .innerJoin(
      screenFrames,
      and(eq(screenFrames.childId, children.id), eq(screenFrames.isActive, true)),
    );

  const due = rows.filter((r) => needsRollover(r.lastJobAt, r.timezone, now, r.previewFrom));
  if (due.length === 0) return { checked: rows.length, rolled: [] };

  // 已有排队/进行中的渲染任务时不重复入队（它会按当前日期渲染）
  const busy = new Set(
    (
      await db
        .select({ childId: renderJobs.childId })
        .from(renderJobs)
        .where(
          and(
            inArray(renderJobs.childId, due.map((r) => r.childId)),
            inArray(renderJobs.status, ["queued", "running"]),
          ),
        )
    ).map((r) => r.childId),
  );

  const rolled: string[] = [];
  for (const r of due) {
    if (busy.has(r.childId)) continue;
    // 物化「展示日」的重复任务（明日预览时为明天）
    await materializeDay(r.childId, displayPlan(now, r.timezone, r.previewFrom).date);
    await enqueueRender(r.childId);
    rolled.push(r.childId);
  }
  return { checked: rows.length, rolled };
}

/** content_version+1 并创建 render job（与 Web 侧 bumpContentVersion 同语义；天气刷新也复用） */
export async function enqueueRender(childId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(children)
      .set({ contentVersion: sql`${children.contentVersion} + 1`, updatedAt: new Date() })
      .where(eq(children.id, childId))
      .returning({ contentVersion: children.contentVersion });
    const v = updated[0]?.contentVersion;
    if (v === undefined) return;
    await tx.insert(renderJobs).values({ childId, requestedContentVersion: v });
  });
}
