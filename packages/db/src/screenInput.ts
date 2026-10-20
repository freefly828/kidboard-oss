/**
 * 屏幕数据加载（D-013）— renderer（墨水屏帧）与 Web（预览 / H5 看板 / screen API）共用，
 * 保证各端内容一致。返回结构与 @kidboard/screen-template 的 AssembleInput 同构（本包不依赖模板包）。
 *
 * 显示计划：孩子时区当前时间 ≥ preview_from（默认 19:00）时进入"明日预览"，展示明天的
 * 课程、任务与需准备物品；0 点后回到"今天"。preview_from 为 null 表示关闭明日预览。
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "./index";
import { materializeDay } from "./materialize";
import { messages, scheduleOverrides, taskOccurrences, weeklyScheduleItems } from "./schema";
import { weatherBriefFor } from "./weather";
import { sensorStateFor } from "./sensors";
import { activeAlertFor } from "./alerts";

const WEEKDAY_ZH = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export type DisplayMode = "today" | "tomorrow";

export interface DisplayPlan {
  mode: DisplayMode;
  /** 屏幕展示的日期（明日预览时为明天） */
  date: string;
  /** 孩子时区的今天 */
  today: string;
  isoWeekday: number;
}

function partsIn(timezone: string, at: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}` };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

/** 纯函数：给定时刻该显示今天还是明天 */
export function displayPlan(now: Date, timezone: string, previewFrom: string | null): DisplayPlan {
  const { date: today, hhmm } = partsIn(timezone, now);
  const tomorrow = previewFrom !== null && /^\d{2}:\d{2}$/.test(previewFrom) && hhmm >= previewFrom;
  const date = tomorrow ? addDays(today, 1) : today;
  return { mode: tomorrow ? "tomorrow" : "today", date, today, isoWeekday: isoWeekdayOf(date) };
}

/** 显示计划的标识：两个时刻的标识不同即需要重新渲染（跨 0 点或跨预览开始时间） */
export function displayKey(at: Date, timezone: string, previewFrom: string | null): string {
  const p = displayPlan(at, timezone, previewFrom);
  return `${p.mode}:${p.date}`;
}

/** "9月16日 周三"（与历史帧文案一致） */
export function dateLabelOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日 ${WEEKDAY_ZH[isoWeekdayOf(date)]}`;
}

/** 把"泳衣、水彩笔 跳绳"拆成去重列表 */
export function splitPrepare(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const item of (v ?? "").split(/[、,，;；\s]+/)) {
      const t = item.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export interface ScreenChild {
  id: string;
  displayName: string;
  timezone: string;
  previewFrom: string | null;
  familyId: string;
}

export async function loadScreenInput(child: ScreenChild, now = new Date()) {
  const plan = displayPlan(now, child.timezone, child.previewFrom);
  // 明日预览需要明天的重复任务实例；今天的也确保已生成（幂等）
  await materializeDay(child.id, plan.date);

  const [scheduleRows, overrideRows, taskRows, messageRows, weather, sensors, alert] = await Promise.all([
    db.select().from(weeklyScheduleItems).where(eq(weeklyScheduleItems.childId, child.id)),
    db
      .select()
      .from(scheduleOverrides)
      .where(and(eq(scheduleOverrides.childId, child.id), eq(scheduleOverrides.overrideDate, plan.date))),
    db
      .select()
      .from(taskOccurrences)
      .where(and(eq(taskOccurrences.childId, child.id), eq(taskOccurrences.occurrenceDate, plan.date)))
      .orderBy(asc(taskOccurrences.sortOrder)),
    // 留言按"今天"取：晚间预览时仍显示家长今天写的话
    db
      .select()
      .from(messages)
      .where(and(eq(messages.childId, child.id), eq(messages.messageDate, plan.today), eq(messages.active, true)))
      .limit(1),
    // 天气按"展示日"取（明日预览显示明天的天气）；读缓存失败不影响其它内容
    weatherBriefFor(child.familyId, plan.date).catch(() => null),
    // D-016 设备上报的室内温湿度与低电状态（读数过期则不显示）
    sensorStateFor(child.id, now).catch(() => ({ indoor: null, lowBattery: false })),
    // D-017 显示中的提醒横幅
    activeAlertFor(child.id, now).catch(() => null),
  ]);

  // 需准备物品：当天（未被停课的）周课程 + 临时加课/调整里填写的 prepare
  const cancelled = new Set(overrideRows.filter((o) => o.action === "cancel").map((o) => o.targetScheduleItemId));
  const dayItems = scheduleRows
    .filter((s) => s.active && s.weekday === plan.isoWeekday && !cancelled.has(s.id))
    .sort((a, b) => a.startMinute - b.startMinute);
  const prepare =
    plan.mode === "tomorrow"
      ? splitPrepare([...dayItems.map((s) => s.prepare), ...overrideRows.filter((o) => o.action !== "cancel").map((o) => o.prepare)])
      : [];

  return {
    plan,
    input: {
      dateLabel: dateLabelOf(plan.date),
      childName: child.displayName,
      isoWeekday: plan.isoWeekday,
      today: plan.date,
      mode: plan.mode,
      prepare,
      weather,
      indoor: sensors.indoor,
      lowBattery: sensors.lowBattery,
      alert: alert ? { kind: alert.kind, text: alert.text } : null,
      schedule: scheduleRows.map((r) => ({
        id: r.id,
        weekday: r.weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        title: r.title,
        active: r.active,
      })),
      overrides: overrideRows.map((r) => ({
        overrideDate: r.overrideDate,
        action: r.action as "add" | "replace" | "cancel",
        targetScheduleItemId: r.targetScheduleItemId,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        title: r.title,
      })),
      tasks: taskRows.map((r) => ({
        id: r.id,
        status: r.status as "pending" | "completed" | "skipped",
        title: r.title,
        sortOrder: r.sortOrder,
        estimatedMinutes: r.estimatedMinutes,
        points: r.points,
      })),
      message: messageRows[0]?.body ?? null,
    },
  };
}
