/**
 * 提醒调度（D-017）：renderer 主循环每 15 秒运行一次。
 * 1. 定时提醒到点 → 建提醒横幅（同一提醒每天一次）、排蜂鸣命令、重渲染；
 * 2. 横幅过期 → 标记已清除并重渲染，让屏幕去掉横幅。
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@kidboard/db";
import { ALERT_SHOW_MS, localClock, queueBeep, reminderDue } from "@kidboard/db/alerts";
import { alerts, children, reminders } from "@kidboard/db/schema";
import { enqueueRender } from "./dayRollover.js";

export interface AlertSweepResult {
  fired: string[];
  cleared: number;
}

export async function runAlertSweep(now = new Date()): Promise<AlertSweepResult> {
  const fired: string[] = [];
  const rows = await db
    .select({
      id: reminders.id,
      childId: reminders.childId,
      remindAt: reminders.remindAt,
      weekdays: reminders.weekdays,
      text: reminders.text,
      beep: reminders.beep,
      active: reminders.active,
      timezone: children.timezone,
    })
    .from(reminders)
    .innerJoin(children, eq(children.id, reminders.childId))
    .where(eq(reminders.active, true));

  for (const r of rows) {
    const local = localClock(r.timezone, now);
    if (!reminderDue({ remindAt: r.remindAt, weekdays: r.weekdays, active: r.active }, local.hhmm, local.isoWeekday)) continue;
    const inserted = await db
      .insert(alerts)
      .values({
        childId: r.childId,
        kind: "reminder",
        text: r.text,
        reminderId: r.id,
        fireDate: local.date,
        createdAt: now,
        showUntil: new Date(now.getTime() + ALERT_SHOW_MS),
      })
      .onConflictDoNothing()
      .returning({ id: alerts.id });
    const alertId = inserted[0]?.id;
    if (!alertId) continue; // 今天已触发过
    if (r.beep) await queueBeep(r.childId, alertId, 3);
    await enqueueRender(r.childId);
    fired.push(r.id);
  }

  const expired = await db
    .update(alerts)
    .set({ clearedAt: now })
    .where(and(lte(alerts.showUntil, now), isNull(alerts.clearedAt)))
    .returning({ childId: alerts.childId });
  for (const childId of new Set(expired.map((e) => e.childId))) {
    await enqueueRender(childId);
  }
  return { fired, cleared: expired.length };
}
