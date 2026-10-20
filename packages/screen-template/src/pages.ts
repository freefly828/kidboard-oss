/**
 * 多页翻看（D-018）— 首页之外的附加页：数据结构、组装与文案规则。
 * renderer 把每一页渲染成独立的 48,000 字节帧（page{N}.bin），设备按键翻页时整屏刷新显示。
 * 页序号：0 = 首页（ScreenViewModel），1.. = PAGE_ORDER 中的附加页。
 */

import { applyOverrides, type OverrideRow, type ScheduleRow } from "./assemble";
import type { ScheduleEntry } from "./types";

export type PageKind = "week" | "points" | "focus";

/** 附加页顺序（页号 = 下标 + 1） */
// D-020：积分商城放第 2 页（翻页第一站），激励孩子完成任务
export const PAGE_ORDER: readonly PageKind[] = ["points", "week", "focus"] as const;

/**
 * D-019 专注页倒计时区（帧坐标）：服务端留白，设备用大号数字字库画剩余时间并局部刷新。
 * x 与 width 为 8 的倍数；改动需同步 firmware/main/focus/focus_renderer.h 的 kSlot*。
 */
export const FOCUS_SLOT = { x: 192, y: 96, width: 416, height: 112 } as const;

export interface FocusPageVM {
  minutes: number;
  points: number;
  dailyCap: number;
  todayCount: number;
  todayMinutes: number;
}
/** 含首页的总页数 */
export const PAGE_COUNT = PAGE_ORDER.length + 1;

export interface WeekDay {
  /** "周一" */
  label: string;
  /** "10/6" */
  dateLabel: string;
  isToday: boolean;
  entries: ScheduleEntry[];
}

export interface WeekPageVM {
  days: WeekDay[];
}

export interface PointsReward {
  title: string;
  cost: number;
}

export interface PointsEntry {
  /** "10/9" */
  dateLabel: string;
  reason: string;
  delta: number;
}

export interface PointsPageVM {
  balance: number;
  weekEarned: number;
  /** D-020 还没完成的任务合计可得积分 */
  available?: number;
  rewards: PointsReward[];
  recent: PointsEntry[];
}

/** 每天最多显示的课程数（超出显示"另 N 节"） */
export const WEEK_MAX_ENTRIES = 8;
export const POINTS_MAX_REWARDS = 4;
export const POINTS_MAX_RECENT = 4;

const WEEKDAY_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function md(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** 周一到周日 7 个日期（含 date 所在周） */
export function weekDatesOf(date: string): string[] {
  const d = new Date(`${date}T00:00:00Z`);
  const iso = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (iso - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/** 本周课表：每天的周课 + 当天的临时调整（停课 / 加课 / 调换） */
export function assembleWeekPage(input: {
  schedule: ScheduleRow[];
  overrides: OverrideRow[];
  /** 周一~周日 */
  weekDates: string[];
  today: string;
}): WeekPageVM {
  return {
    days: input.weekDates.map((date, i) => {
      const items = input.schedule
        .filter((s) => s.active && s.weekday === i + 1)
        .map((s) => ({ id: s.id ?? `w-${s.weekday}-${s.startMinute}`, startMinute: s.startMinute, title: s.title }));
      const merged = applyOverrides(
        items,
        input.overrides.filter((o) => o.overrideDate === date),
      ).sort((a, b) => a.startMinute - b.startMinute);
      return {
        label: WEEKDAY_ZH[i]!,
        dateLabel: md(date),
        isToday: date === input.today,
        entries: merged.map((e) => ({ time: hhmm(e.startMinute), title: e.title })),
      };
    }),
  };
}

/** 积分页：心愿按价格从低到高，只取上架的前几个；最近流水倒序 */
export function assemblePointsPage(input: {
  balance: number;
  weekEarned: number;
  available?: number;
  rewards: PointsReward[];
  recent: { date: string; reason: string; delta: number }[];
}): PointsPageVM {
  return {
    balance: input.balance,
    weekEarned: input.weekEarned,
    available: input.available ?? 0,
    rewards: [...input.rewards].sort((a, b) => a.cost - b.cost).slice(0, POINTS_MAX_REWARDS),
    recent: input.recent.slice(0, POINTS_MAX_RECENT).map((r) => ({ dateLabel: md(r.date), reason: r.reason, delta: r.delta })),
  };
}

/** 页面标题（顶栏中间） */
export function pageTitle(kind: PageKind, childName: string): string {
  if (kind === "week") return `${childName}的本周课表`;
  if (kind === "points") return `${childName}的积分商城`;
  return `${childName}的专注时间`;
}

/** D-019 专注页文案 */
export function focusText(f: FocusPageVM): { rule: string; today: string } {
  const capped = f.points > 0 && f.dailyCap > 0;
  return {
    rule: capped
      ? `每次 ${f.minutes} 分钟，完成得 ${f.points} 积分（每天最多 ${f.dailyCap} 次）`
      : `每次 ${f.minutes} 分钟`,
    today: f.todayCount > 0 ? `今天已专注 ${f.todayCount} 次，共 ${f.todayMinutes} 分钟` : "今天还没有专注，按 DONE 开始吧",
  };
}

/** 附加页的按键栏：上一页 / 页码 / 下一页（首页的按键栏见 keysText） */
export function pageKeysText(pageIndex: number, pageCount = PAGE_COUNT, kind?: PageKind): string[] {
  // D-025 翻页循环：最后一页按 NEXT 回首页
  const next = pageIndex >= pageCount - 1 ? "NEXT 回首页" : "NEXT 下一页";
  // D-019 专注页：DONE 开始/暂停，BACK 结束（未开始时为上一页）
  if (kind === "focus") return ["DONE 开始/暂停", "BACK 结束", `第 ${pageIndex + 1}/${pageCount} 页`, next];
  return ["BACK 上一页", `第 ${pageIndex + 1}/${pageCount} 页`, next];
}
