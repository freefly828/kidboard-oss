/**
 * 多页翻看（D-018）的取数：本周课表与积分页。返回原始行，组装在 @kidboard/screen-template/pages。
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { children, focusSessions, pointLedger, rewards, scheduleOverrides, taskOccurrences, weeklyScheduleItems } from "./schema";

/** 本周（weekDates = 周一~周日）的周课与临时调整 */
export async function loadWeekRows(childId: string, weekDates: string[]) {
  const [schedule, overrides] = await Promise.all([
    db.select().from(weeklyScheduleItems).where(eq(weeklyScheduleItems.childId, childId)),
    db
      .select()
      .from(scheduleOverrides)
      .where(
        and(
          eq(scheduleOverrides.childId, childId),
          inArray(scheduleOverrides.overrideDate, weekDates),
        ),
      ),
  ]);
  return {
    schedule: schedule.map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      title: r.title,
      active: r.active,
    })),
    overrides: overrides.map((r) => ({
      overrideDate: r.overrideDate,
      action: r.action as "add" | "replace" | "cancel",
      targetScheduleItemId: r.targetScheduleItemId,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      title: r.title,
    })),
  };
}

/** 积分页：余额、本周（孩子时区周一 0 点起）获得、上架心愿、最近流水 */
export async function loadPointsSummary(
  child: { id: string; familyId: string; timezone: string },
  weekStart: string,
  displayDate?: string,
  recentLimit = 4,
) {
  const weekStartTs = sql`(${weekStart}::timestamp AT TIME ZONE ${child.timezone})`;
  const [balanceRow, weekRow, rewardRows, recentRows, availRow] = await Promise.all([
    db.select({ v: sql<number>`coalesce(sum(${pointLedger.delta}), 0)`.mapWith(Number) }).from(pointLedger).where(eq(pointLedger.childId, child.id)),
    db
      .select({ v: sql<number>`coalesce(sum(${pointLedger.delta}), 0)`.mapWith(Number) })
      .from(pointLedger)
      .where(and(eq(pointLedger.childId, child.id), sql`${pointLedger.delta} > 0`, gte(pointLedger.createdAt, weekStartTs))),
    db
      .select({ title: rewards.title, cost: rewards.cost })
      .from(rewards)
      .where(and(eq(rewards.familyId, child.familyId), eq(rewards.active, true))),
    db
      .select({
        date: sql<string>`to_char(${pointLedger.createdAt} AT TIME ZONE ${child.timezone}, 'YYYY-MM-DD')`,
        reason: pointLedger.reason,
        delta: pointLedger.delta,
      })
      .from(pointLedger)
      .where(eq(pointLedger.childId, child.id))
      .orderBy(desc(pointLedger.createdAt))
      .limit(recentLimit),
    // D-020 展示日还没完成的任务合计可得积分
    displayDate
      ? db
          .select({ v: sql<number>`coalesce(sum(${taskOccurrences.points}), 0)`.mapWith(Number) })
          .from(taskOccurrences)
          .where(and(eq(taskOccurrences.childId, child.id), eq(taskOccurrences.occurrenceDate, displayDate), eq(taskOccurrences.status, "pending")))
      : Promise.resolve([{ v: 0 }]),
  ]);
  return {
    balance: balanceRow[0]?.v ?? 0,
    weekEarned: weekRow[0]?.v ?? 0,
    rewards: rewardRows,
    recent: recentRows,
    available: availRow[0]?.v ?? 0,
  };
}

/** D-019 专注页：配置 + 今天（孩子时区）完成的次数与分钟数（来自设备上报的 focus_complete 事件） */
export async function loadFocusSummary(child: { id: string; timezone: string }) {
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${child.timezone}) AT TIME ZONE ${child.timezone})`;
  const [cfg, today] = await Promise.all([
    db
      .select({ minutes: children.focusMinutes, points: children.focusPoints, dailyCap: children.focusDailyCap })
      .from(children)
      .where(eq(children.id, child.id))
      .limit(1),
    // D-024 设备与 H5 看板的专注统一记在 focus_sessions（完成时间在今天）
    db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        minutes: sql<number>`coalesce(sum(${focusSessions.minutes}), 0)`.mapWith(Number),
      })
      .from(focusSessions)
      .where(and(eq(focusSessions.childId, child.id), gte(focusSessions.completedAt, todayStart))),
  ]);
  return {
    minutes: cfg[0]?.minutes ?? 25,
    points: cfg[0]?.points ?? 5,
    dailyCap: cfg[0]?.dailyCap ?? 3,
    todayCount: today[0]?.count ?? 0,
    todayMinutes: today[0]?.minutes ?? 0,
  };
}
