/**
 * ScreenViewModel — 墨水屏首页的数据契约（docs/02 §3 + docs/06 §9）。
 * Web 预览与 Phase 3 renderer 共用同一类型；从 DB 行到 VM 的组装器
 * 由 renderer 侧实现（Phase 3），模板只吃这个结构。
 */

export type TaskStatus = "pending" | "completed" | "skipped";

export interface ScheduleEntry {
  /** "08:20" */
  time: string;
  title: string;
}

export interface TaskEntry {
  /** task_occurrences.id；墨水屏模板不渲染，供 Web/H5 端完成任务时回写 */
  id?: string;
  /** 焦点任务（实体按键当前选中）——用 "> " 前缀 + 黑框，不只靠灰底 */
  focused: boolean;
  status: TaskStatus;
  title: string;
  /** 预计时长显示（"15分钟"），可省 */
  estimate?: string;
  /** D-020 完成可得积分（显示"+5"徽标，激励孩子），可省 */
  points?: number;
}

export type SyncStatus = "synced" | "pending_sync" | "rendering" | "offline";

export interface ScreenViewModel {
  /** D-015 Web 预览专用：时钟区显示的时间（"21:35"）；设备帧不设置，留白由设备绘制 */
  clockText?: string | null;
  /** "9月16日 周三"（child timezone 的今天，由组装器算好） */
  dateLabel: string;
  /** 顶部中间的孩子昵称 */
  childName: string;
  syncStatus: SyncStatus;
  /** docs/06 §9: 首页日程 ≤ 5 条（超出截断，组装器负责） */
  schedule: ScheduleEntry[];
  /** docs/06 §9: 首页任务 ≤ 6 条 */
  tasks: TaskEntry[];
  /** 每天一条主留言；null = 不显示留言区内容（保留分隔线） */
  message: string | null;
  /** 云端异常提示（docs/02 §4: 不覆盖主内容，底部小型提示） */
  offlineNotice?: string;
  /** D-013 显示模式：today = 今天；tomorrow = 晚间明日预览（默认 today） */
  mode?: DisplayMode;
  /** D-013 明日预览：需准备的物品（来自课程 prepare，已去重） */
  prepare?: string[];
  /** D-013 顶栏天气两行（第 1 行天气温度，第 2 行穿衣/带伞提醒）；null/缺省 = 不显示 */
  weather?: WeatherBrief | null;
  /** D-013 每日古诗：无家长留言时显示在底部 */
  poem?: Poem | null;
  /** D-016 设备上报的室内温湿度（已校准取整）；null = 不显示 */
  indoor?: IndoorReading | null;
  /** D-016 设备电量低：按键栏提示充电 */
  lowBattery?: boolean;
  /** D-017 提醒横幅（家长立即提醒 / 定时提醒）：底部黑底白字，优先于留言与古诗 */
  alert?: ScreenAlert | null;
}

export interface ScreenAlert {
  kind: "instant" | "reminder";
  text: string;
}

export interface IndoorReading {
  temperatureC: number;
  humidityPct: number;
}

export type DisplayMode = "today" | "tomorrow";

export interface WeatherBrief {
  /** "多云 13~25℃" */
  summary: string;
  /** "加件薄外套 · 早晚温差大"；可为空串 */
  advice: string;
}

export interface Poem {
  title: string;
  author: string;
  /** 全文（含标点），两行内放下 */
  text: string;
}

/** 需准备物品最多显示条数（底部两行） */
export const MAX_PREPARE_ITEMS = 8;

/** 画布常量 — 冻结契约（docs/06 §1） */
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;
/** 别名：renderer 侧惯用 FRAME_* 命名；与 SCREEN_* 指向同一冻结契约 */
export const FRAME_WIDTH = SCREEN_WIDTH;
export const FRAME_HEIGHT = SCREEN_HEIGHT;
export const FRAME_BYTES = (SCREEN_WIDTH * SCREEN_HEIGHT) / 8; // 48,000

/** 内容容量上限（docs/06 §9，支持双列最多10条） */
export const MAX_SCHEDULE_ITEMS = 10;
export const MAX_TASK_ITEMS = 6;
/** 留言建议 ≤ 60 字符（PRD F06），渲染时最多 2 行 */
export const MESSAGE_MAX_CHARS = 60;

/** 组装器侧截断辅助：保证 VM 永不超容量 */
export function clampViewModel(vm: ScreenViewModel): ScreenViewModel {
  return {
    ...vm,
    schedule: vm.schedule.slice(0, MAX_SCHEDULE_ITEMS),
    tasks: vm.tasks.slice(0, MAX_TASK_ITEMS),
    message:
      vm.message !== null
        ? vm.message.slice(0, MESSAGE_MAX_CHARS)
        : null,
    ...(vm.prepare ? { prepare: vm.prepare.slice(0, MAX_PREPARE_ITEMS) } : {}),
  };
}
