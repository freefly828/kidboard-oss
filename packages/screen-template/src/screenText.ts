/**
 * 屏幕文案规则（D-013）— Screen.tsx（Web 预览）与 renderer 的 renderPage.ts（墨水屏帧）
 * 共用，保证两处显示的文字完全一致；模板只负责排版。
 */

import type { ScreenViewModel } from "./types";

/**
 * D-015 设备时钟区（帧坐标，像素）：服务端画面在此区域必须保持全白，
 * 设备用自带数字字库在这里画 "HH:MM" 并按分钟局部刷新。x 与 width 为 8 的倍数（按字节对齐）。
 * 改动需同步 firmware/main/clock/clock_renderer.h 的 kClockSlot*（决策 D-015）。
 */
export const CLOCK_SLOT = { x: 16, y: 8, width: 104, height: 38 } as const;
/**
 * D-022 首页任务行几何（帧坐标）：第 i 行（0 起）占 y = y + i*rowHeight 的整行。
 * 墨水屏帧不再画"当前选中"框，由设备按自己的焦点在该行画 3px 黑框并局部刷新；
 * 改动需同步 firmware/main/tasks/focus_box.h。renderer 守卫测试校验实际排版与此一致。
 */
export const TASK_ROWS = { x: 418, y: 112, width: 364, rowHeight: 37, maxRows: 6 } as const;
/**
 * D-023 任务勾选框（相对任务行左上角）：21×21，黑框 2px。按 DONE 时设备先在本地把这一格涂黑打勾
 * （局部刷新，约半秒），不用等服务端重渲染；改动需同步 firmware/main/tasks/focus_box.h。
 */
export const TASK_CHECK = { dx: 32, dy: 8, size: 21 } as const;

/** 头部左侧为时钟预留的占位宽度（头部左内边距 18px 起算，含与日期之间的间距） */
export const CLOCK_SLOT_RESERVE_PX = 112;

const SYNC_LABEL: Record<ScreenViewModel["syncStatus"], string> = {
  synced: "● 已同步",
  pending_sync: "● 待同步",
  rendering: "● 生成中",
  offline: "● 离线",
};

export interface HeaderText {
  left: string;
  middle: string;
  /** 右侧：无天气时显示同步状态 */
  right: string;
  /** 右侧两行天气（有则替代同步状态） */
  weather: { summary: string; advice: string } | null;
}

export function headerText(vm: ScreenViewModel): HeaderText {
  const tomorrow = vm.mode === "tomorrow";
  // D-016 室内温湿度接在天气第 1 行后；没有天气时单独显示
  const indoor = vm.indoor ? `室内 ${vm.indoor.temperatureC}℃ ${vm.indoor.humidityPct}%` : null;
  const weather = vm.weather?.summary
    ? { summary: indoor ? `${vm.weather.summary} · ${indoor}` : vm.weather.summary, advice: vm.weather.advice ?? "" }
    : indoor
      ? { summary: indoor, advice: "" }
      : null;
  return {
    left: tomorrow ? `明天 ${vm.dateLabel}` : vm.dateLabel,
    middle: `${vm.childName}的${tomorrow ? "明天" : "今天"}`,
    right: SYNC_LABEL[vm.syncStatus],
    weather,
  };
}

export function columnText(vm: ScreenViewModel) {
  const tomorrow = vm.mode === "tomorrow";
  return {
    scheduleTitle: tomorrow ? "明日安排" : "今日安排",
    tasksTitle: tomorrow ? "明日任务" : "今日任务",
    scheduleEmpty: tomorrow ? "— 明天没有安排 —" : "— 今天没有安排 —",
    tasksEmpty: tomorrow ? "— 明天没有任务 —" : "— 今天没有任务 —",
  };
}

export type BottomKind = "alert" | "prepare" | "message" | "poem" | "empty";

export interface BottomText {
  kind: BottomKind;
  /** 粗体前缀，如"家长留言：" */
  label: string;
  text: string;
}

/**
 * 底部区优先级：提醒横幅（D-017）→ 明日预览且有需准备物品 → 需准备；家长留言 → 留言；每日古诗 → 古诗；否则空提示。
 */
export function bottomText(vm: ScreenViewModel): BottomText {
  // D-017 提醒横幅最优先（显示 30 分钟后自动恢复下面的内容）
  if (vm.alert && vm.alert.text.trim()) {
    return { kind: "alert", label: vm.alert.kind === "instant" ? "家长提醒：" : "提醒：", text: vm.alert.text };
  }
  if (vm.mode === "tomorrow" && vm.prepare && vm.prepare.length > 0) {
    return { kind: "prepare", label: "明天需准备：", text: vm.prepare.join("、") };
  }
  if (vm.message !== null && vm.message.trim()) {
    return { kind: "message", label: "家长留言：", text: vm.message };
  }
  if (vm.poem) {
    return { kind: "poem", label: `《${vm.poem.title}》${vm.poem.author}  `, text: vm.poem.text };
  }
  return { kind: "empty", label: "", text: vm.mode === "tomorrow" ? "（明天没有需要准备的物品）" : "（今天还没有留言）" };
}

/** 按键栏：明日预览时按键不操作任务（设备 interactiveTasks 为空），提示何时切回 */
export function keysText(vm: ScreenViewModel): string[] {
  // D-016 电量低时在按键栏最后提示充电
  const battery = vm.lowBattery ? ["电量低 请充电"] : [];
  // D-018 按住 NEXT（1 秒以上）翻到附加页
  if (vm.mode === "tomorrow") return ["明日预览 · 0 点自动切回今天", "按住 NEXT 翻页", ...battery];
  return ["DONE 完成", "NEXT 下一项", "BACK 返回", "按住 NEXT 翻页", ...battery];
}
