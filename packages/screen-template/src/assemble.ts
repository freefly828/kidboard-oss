/**
 * VM 组装器 — 把业务行数据组装为 ScreenViewModel（纯函数，不依赖 DB/Next）。
 * Web 预览页与 Phase 3 renderer 共用；保证 docs/06 §9 容量上限。
 *
 * 输入结构刻意用"扁平行"（与 drizzle 查询结果同构），避免组装器反向依赖 @kidboard/db。
 */

import {
  clampViewModel,
  MAX_SCHEDULE_ITEMS,
  MAX_TASK_ITEMS,
  type ScheduleEntry,
  type ScreenViewModel,
  type TaskEntry,
  type TaskStatus,
  type DisplayMode,
  type Poem,
  type WeatherBrief,
  type IndoorReading,
  type ScreenAlert,
} from "./types";

export interface ScheduleRow {
  id?: string;
  weekday: number; // 1=Mon..7=Sun
  startMinute: number;
  endMinute: number;
  title: string;
  active: boolean;
}

export interface OverrideRow {
  overrideDate: string; // YYYY-MM-DD
  action: "add" | "replace" | "cancel";
  targetScheduleItemId: string | null;
  startMinute: number | null;
  endMinute: number | null;
  title: string | null;
}

export interface TaskRow {
  id?: string;
  status: TaskStatus;
  title: string;
  sortOrder: number;
  estimatedMinutes: number | null;
  /** D-020 完成可得积分（0 = 不显示） */
  points?: number;
}

export interface AssembleInput {
  dateLabel: string;
  childName: string;
  /** 今天在该 child timezone 的 ISO weekday（1=Mon..7=Sun） */
  isoWeekday: number;
  /** YYYY-MM-DD（child timezone） */
  today: string;
  schedule: ScheduleRow[];
  overrides: OverrideRow[];
  tasks: TaskRow[];
  /** 焦点任务 = 第一条 pending（docs/02 §3 焦点用 > + 黑框） */
  message: string | null;
  syncStatus?: ScreenViewModel["syncStatus"];
  offlineNotice?: string;
  /** D-013 显示模式（默认 today） */
  mode?: DisplayMode;
  /** D-013 明日预览的需准备物品 */
  prepare?: string[];
  /** D-013 顶栏两行天气 */
  weather?: WeatherBrief | null;
  /** D-013 每日古诗 */
  poem?: Poem | null;
  /** D-016 室内温湿度 */
  indoor?: IndoorReading | null;
  /** D-016 电量低 */
  lowBattery?: boolean;
  /** D-017 提醒横幅 */
  alert?: ScreenAlert | null;
}

function minuteToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** 应用 override：cancel 移除对应周课；add 追加；replace 替换时间/标题 */
export function applyOverrides(
  entries: { id: string; startMinute: number; title: string }[],
  overrides: OverrideRow[],
): { id: string; startMinute: number; title: string }[] {
  let out = [...entries];
  for (const o of overrides) {
    if (o.action === "cancel" && o.targetScheduleItemId != null) {
      out = out.filter((e) => e.id !== o.targetScheduleItemId);
    } else if (o.action === "add" && o.startMinute != null && o.title != null) {
      out.push({ id: `override-${o.overrideDate}-${o.startMinute}`, startMinute: o.startMinute, title: o.title });
    } else if (o.action === "replace" && o.targetScheduleItemId != null) {
      out = out.map((e) =>
        e.id === o.targetScheduleItemId
          ? {
              ...e,
              startMinute: o.startMinute ?? e.startMinute,
              title: o.title ?? e.title,
            }
          : e,
      );
    }
  }
  return out;
}

export function assembleViewModel(input: AssembleInput): ScreenViewModel {
  // 周课: 只取今天 weekday 且 active
  const todayItems = input.schedule
    .filter((s) => s.active && s.weekday === input.isoWeekday)
    .map((s) => ({ id: s.id ?? `w-${s.weekday}-${s.startMinute}`, startMinute: s.startMinute, title: s.title }));

  const merged = applyOverrides(todayItems, input.overrides);

  const schedule: ScheduleEntry[] = merged
    .sort((a, b) => a.startMinute - b.startMinute)
    .slice(0, MAX_SCHEDULE_ITEMS)
    .map((e) => ({ time: minuteToHHMM(e.startMinute), title: e.title }));

  // 任务: 排序后截断；焦点 = 第一条 pending
  const sorted = [...input.tasks].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
  let focusAssigned = false;
  const tasks: TaskEntry[] = sorted.slice(0, MAX_TASK_ITEMS).map((t) => {
    // 明日预览不设焦点：设备此时不响应任务按键
    const focused = input.mode !== "tomorrow" && !focusAssigned && t.status === "pending";
    if (focused) focusAssigned = true;
    return {
      ...(t.id !== undefined ? { id: t.id } : {}),
      focused,
      status: t.status,
      title: t.title,
      estimate:
        t.estimatedMinutes != null ? `${t.estimatedMinutes}分钟` : undefined,
      ...(t.points && t.points > 0 ? { points: t.points } : {}),
    };
  });

  return clampViewModel({
    dateLabel: input.dateLabel,
    childName: input.childName,
    syncStatus: input.syncStatus ?? "synced",
    schedule,
    tasks,
    message: input.message,
    offlineNotice: input.offlineNotice,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.prepare && input.prepare.length > 0 ? { prepare: input.prepare } : {}),
    ...(input.weather ? { weather: input.weather } : {}),
    ...(input.poem ? { poem: input.poem } : {}),
    ...(input.indoor ? { indoor: input.indoor } : {}),
    ...(input.lowBattery ? { lowBattery: true } : {}),
    ...(input.alert ? { alert: input.alert } : {}),
  });
}
