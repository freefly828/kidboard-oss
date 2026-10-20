/**
 * 家长立即提醒 / 定时提醒（D-017）— Web（发送、管理）、renderer（定时触发、过期清除）、
 * sync 路由（下发蜂鸣、缩短同步间隔）与屏幕取数共用。
 */

import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "./index";
import { alerts, deviceCommands, devices, reminders } from "./schema";

/** 横幅在屏幕上停留时长（定时提醒固定用它；立即提醒缺省值，D-027 起家长可在发送时另选） */
export const ALERT_SHOW_MS = 30 * 60 * 1000;
/** 定时提醒的触发窗口：到点后 5 分钟内（renderer 停机/重启时补发，超过则跳过） */
export const REMINDER_FIRE_WINDOW_MIN = 5;
/** 蜂鸣命令超过此时长未被设备取走则作废（不在半小时后突然响） */
export const BEEP_COMMAND_TTL_MS = 10 * 60 * 1000;
export const ALERT_TEXT_MAX = 40;

export type AlertKind = "instant" | "reminder";

export interface ActiveAlert {
  id: string;
  kind: AlertKind;
  text: string;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 纯函数：定时提醒此刻是否该触发（到点后 REMINDER_FIRE_WINDOW_MIN 分钟内，且当天在所选星期内） */
export function reminderDue(
  r: { remindAt: string; weekdays: number[]; active: boolean },
  localHHMM: string,
  isoWeekday: number,
): boolean {
  if (!r.active || !r.weekdays.includes(isoWeekday)) return false;
  const diff = hhmmToMinutes(localHHMM) - hhmmToMinutes(r.remindAt);
  return diff >= 0 && diff < REMINDER_FIRE_WINDOW_MIN;
}

/**
 * 纯函数：距离今天下一个定时提醒还有多少秒（localSeconds = 孩子时区当天已过秒数）；
 * 今天没有了返回 null。sync 路由据此缩短设备下次同步间隔，让蜂鸣与横幅准时。
 */
export function secondsUntilNextReminder(
  list: { remindAt: string; weekdays: number[]; active: boolean }[],
  localSeconds: number,
  isoWeekday: number,
): number | null {
  let best: number | null = null;
  for (const r of list) {
    if (!r.active || !r.weekdays.includes(isoWeekday)) continue;
    const delta = hhmmToMinutes(r.remindAt) * 60 - localSeconds;
    if (delta > 0 && (best === null || delta < best)) best = delta;
  }
  return best;
}

/** 屏幕取数：当前显示中的最新提醒横幅 */
export async function activeAlertFor(childId: string, now = new Date()): Promise<ActiveAlert | null> {
  const row = (
    await db
      .select({ id: alerts.id, kind: alerts.kind, text: alerts.text })
      .from(alerts)
      .where(and(eq(alerts.childId, childId), gt(alerts.showUntil, now), lte(alerts.createdAt, now)))
      .orderBy(desc(alerts.createdAt))
      .limit(1)
  )[0];
  return row ? { id: row.id, kind: row.kind as AlertKind, text: row.text } : null;
}

/** 给孩子绑定的每台设备排一条蜂鸣命令（关联提醒，设备取走即视为送达） */
export async function queueBeep(childId: string, alertId: string, beeps: number): Promise<number> {
  const devs = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.childId, childId), isNull(devices.revokedAt)));
  if (devs.length === 0) return 0;
  await db.insert(deviceCommands).values(
    devs.map((d) => ({
      deviceId: d.id,
      type: "beep",
      payload: { alertId, beeps },
      expiresAt: new Date(Date.now() + BEEP_COMMAND_TTL_MS),
    })),
  );
  return devs.length;
}

/** 孩子的定时提醒（sync 路由计算下次同步间隔用） */
export async function remindersOf(childId: string) {
  return db
    .select({ remindAt: reminders.remindAt, weekdays: reminders.weekdays, active: reminders.active })
    .from(reminders)
    .where(eq(reminders.childId, childId));
}

/** 孩子时区的当前日期、HH:MM、ISO 星期与当天已过秒数 */
export function localClock(timezone: string, now: Date): { date: string; hhmm: string; isoWeekday: number; seconds: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return {
    date,
    hhmm: `${get("hour")}:${get("minute")}`,
    isoWeekday,
    seconds: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  };
}

/** D-021 睡眠时段的同步间隔（秒）：协议允许的最大值 */
export const SLEEP_SYNC_SECONDS = 300;

/**
 * 纯函数：本地时间是否处在睡眠时段 [bedTime, wakeTime)（可跨午夜，如 21:00~07:00）。
 * 任一为空或两者相同 → 不启用。
 */
export function inSleepWindow(localHHMM: string, bedTime: string | null | undefined, wakeTime: string | null | undefined): boolean {
  const ok = (t: string | null | undefined): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!ok(bedTime) || !ok(wakeTime) || bedTime === wakeTime) return false;
  return bedTime < wakeTime
    ? localHHMM >= bedTime && localHHMM < wakeTime
    : localHHMM >= bedTime || localHHMM < wakeTime;
}
