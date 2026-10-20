/**
 * 专注计时记录与发积分（D-019 / D-024），设备上报与 H5 看板共用。
 * 规则：孩子配置的完成积分；每天（孩子时区）最多计分 focus_daily_cap 次；时长不足 5 分钟不计分。
 */

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, focusSessions, pointLedger } from "@kidboard/db/schema";
import { bumpContentVersion } from "./content-version";

/** 看板计时：完成时实际经过时间至少为时长减去这个余量（秒），防止不计时直接领分 */
export const BOARD_FOCUS_GRACE_S = 15;

async function awardFor(childId: string, minutes: number): Promise<number> {
  const child = (
    await db
      .select({ timezone: children.timezone, focusPoints: children.focusPoints, focusDailyCap: children.focusDailyCap })
      .from(children)
      .where(eq(children.id, childId))
      .limit(1)
  )[0];
  if (!child || child.focusPoints <= 0 || minutes < 5) return 0;
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${child.timezone}) AT TIME ZONE ${child.timezone})`;
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(pointLedger)
    .where(and(eq(pointLedger.childId, childId), eq(pointLedger.kind, "focus"), gte(pointLedger.createdAt, todayStart)));
  if (n >= child.focusDailyCap) return 0;
  await db.insert(pointLedger).values({ childId, delta: child.focusPoints, kind: "focus", reason: `专注 ${minutes} 分钟` });
  return child.focusPoints;
}

/** 设备上报完成（eventId 幂等） */
export async function recordDeviceFocus(input: {
  childId: string;
  deviceId: string;
  eventId: string;
  minutes: number;
  occurredAt: Date;
}): Promise<{ idempotent: boolean; awarded: number }> {
  const inserted = await db
    .insert(focusSessions)
    .values({
      childId: input.childId,
      deviceId: input.deviceId,
      source: "device",
      eventId: input.eventId,
      minutes: input.minutes,
      completedAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: focusSessions.id });
  const row = inserted[0];
  if (!row) return { idempotent: true, awarded: 0 };
  const awarded = await awardFor(input.childId, input.minutes);
  if (awarded) await db.update(focusSessions).set({ awarded }).where(eq(focusSessions.id, row.id));
  await bumpContentVersion(input.childId);
  return { idempotent: false, awarded };
}

/** 看板开始计时：服务器记下开始时间（时长取孩子当前配置） */
export async function startBoardFocus(childId: string): Promise<{ id: string; minutes: number; startedAt: string }> {
  const child = (await db.select({ minutes: children.focusMinutes }).from(children).where(eq(children.id, childId)).limit(1))[0];
  const minutes = child?.minutes ?? 25;
  const now = new Date();
  const [row] = await db
    .insert(focusSessions)
    .values({ childId, source: "board", minutes, startedAt: now })
    .returning({ id: focusSessions.id });
  return { id: row!.id, minutes, startedAt: now.toISOString() };
}

export type BoardFocusResult =
  | { ok: true; awarded: number; alreadyDone: boolean }
  | { ok: false; reason: "not_found" | "too_early"; remainingSeconds?: number };

/** 看板完成计时：校验实际经过时间后发积分（重复提交返回已完成） */
export async function completeBoardFocus(childId: string, sessionId: string, now = new Date()): Promise<BoardFocusResult> {
  const row = (
    await db
      .select()
      .from(focusSessions)
      .where(and(eq(focusSessions.id, sessionId), eq(focusSessions.childId, childId), eq(focusSessions.source, "board"), isNotNull(focusSessions.startedAt)))
      .limit(1)
  )[0];
  if (!row || !row.startedAt) return { ok: false, reason: "not_found" };
  if (row.completedAt) return { ok: true, awarded: row.awarded, alreadyDone: true };
  const elapsed = (now.getTime() - row.startedAt.getTime()) / 1000;
  const required = row.minutes * 60 - BOARD_FOCUS_GRACE_S;
  if (elapsed < required) return { ok: false, reason: "too_early", remainingSeconds: Math.ceil(required - elapsed) };
  // 并发重复提交只有一个能把 completed_at 从空改为有值
  const claimed = await db
    .update(focusSessions)
    .set({ completedAt: now })
    .where(and(eq(focusSessions.id, sessionId), sql`${focusSessions.completedAt} is null`))
    .returning({ id: focusSessions.id });
  if (claimed.length === 0) return { ok: true, awarded: 0, alreadyDone: true };
  const awarded = await awardFor(childId, row.minutes);
  if (awarded) await db.update(focusSessions).set({ awarded }).where(eq(focusSessions.id, sessionId));
  await bumpContentVersion(childId);
  return { ok: true, awarded, alreadyDone: false };
}
