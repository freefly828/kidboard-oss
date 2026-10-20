/**
 * 屏幕渲染页 — Playwright 加载的独立 HTML（不是 Next 页面）。
 *
 * 为什么是独立 HTML：
 * - Phase 2 已确认 Turbopack 不允许 route handler 导入 react-dom/server；
 * - renderer 是独立 worker 进程，不应依赖 Next dev server 在线；
 * - docs/06 §2 要求模板产物不含 CSS animation / 远程字体 / 网络图片 / script。
 *
 * 本文件产出的 HTML 使用与 packages/screen-template/src/Screen.tsx 完全一致的
 * 布局常量与视觉规则（docs/02 §3 分区、2px 黑实线、焦点任务 >+黑框、纯 CSS 勾选框）。
 * 布局变更必须同时改这两处，由 renderer 的 B 组视觉回归测试守护。
 *
 * 约定：不引入任何 <script>、<link>、@font-face、@import、<img>。
 */

import { bottomText, columnText, headerText, keysText, type ScreenViewModel, type TaskEntry, CLOCK_SLOT, CLOCK_SLOT_RESERVE_PX } from "@kidboard/screen-template";

/** docs/02 §3 分区高度（与 Screen.tsx 的 gridTemplateRows 一致）
 *  头部 0-54 / 双栏 55-352 / 留言 353-429 / 按键栏 430-479
 *  54 + 298 + 77 + 51 = 480，必须精确填满画布，否则底部会留白。 */
export const LAYOUT_ROWS = ["54px", "298px", "77px", "51px"] as const;

/** 部署镜像内固定的可再发行中文字体（docs/06 §3），系统兜底 */
export const FONT_STACK =
  '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",Arial,sans-serif';

/** HTML 文本转义（防 VM 内容破坏文档结构） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function checkIcon(done: boolean): string {
  return `<span class="check"${done ? ' data-done="1"' : ""}>${done ? "✓" : ""}</span>`;
}

function taskRow(t: TaskEntry): string {
  // D-022 焦点框由设备按实体按键的当前选择自行绘制（局部刷新），帧里不画，避免与设备焦点不一致
  const cls = "task";
  const marker = '<span class="focus-spacer"> </span>';
  const estimate = t.estimate ? `<span class="estimate">${escapeHtml(t.estimate)}</span>` : "";
  // D-020 积分徽标：黑框"+5"，已完成为黑底白字（表示已经拿到）
  const pts = t.points ? `<span class="pts${t.status === "completed" ? " got" : ""}">+${t.points}</span>` : "";
  return (
    `<div class="${cls}">${marker}${checkIcon(t.status === "completed")}` +
    `<span class="label">${escapeHtml(t.title)}</span>${pts}${estimate}</div>`
  );
}

/** 整套画面 CSS（首页与 D-018 附加页共用，保证头部、按键栏完全一致） */
export function screenCss(): string {
  return `/* docs/06 §2：固定 800x480 容器，无动画、无远程字体、无网络图片 */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 800px; height: 480px; overflow: hidden; background: #fff; color: #000; }
body {
  font-family: ${FONT_STACK};
  -webkit-font-smoothing: none;
  font-synthesis: none;
  text-rendering: geometricPrecision;
}
.screen {
  position: relative;
  width: 800px; height: 480px;
  background: #fff; color: #000;
  display: grid;
  grid-template-rows: ${LAYOUT_ROWS.join(" ")};
}
/* --- 头部 0-54 --- */
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; border-bottom: 2px solid #000;
  font-size: 22px; font-weight: 700;
}
/* D-015：左侧为设备时钟留白（CLOCK_SLOT），服务端不在此绘制任何内容 */
.left { display: flex; align-items: center; }
.clock-slot { flex: none; width: ${CLOCK_SLOT_RESERVE_PX}px; height: ${CLOCK_SLOT.height}px; }
/* --- 双栏 55-352 --- */
.body { display: grid; grid-template-columns: 1fr 1fr; }
.col { padding: 14px 18px; overflow: hidden; }
.col-left { border-right: 2px solid #000; }
/* 行高写死 32px：任务行位置（TASK_ROWS，设备画焦点框用）不随字体变化 */
.col-title { font-size: 24px; font-weight: 800; margin-bottom: 12px; line-height: 32px; height: 32px; }
/* 左栏行高必须与右栏 .task 一致地取整数像素：
 * line-height:1.7 × 22px = 37.4px → 实际 37.390625px 的小数高度会让后续所有元素
 * 落在非整数 y 上，栅格化时整行规则线出现 1px 抖动，进而把 dirty_rect 放大到整屏宽。
 * 显式 height + line-height 取整后，左右两栏共享同一垂直节奏。 */
.row {
  height: 37px; box-sizing: border-box;
  font-size: 22px; line-height: 37px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.row.compact { font-size: 18px; }
.schedule-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(5, 37px);
  grid-auto-flow: column;
  column-gap: 10px;
}
.row.empty { color: #000; }
.time { font-weight: 700; }
/* --- 任务行 ---
 * 每行高度固定 37px（6 行 = 222px，控制在 298px 分区内不溢出）。
 * 22px 字号 + 1.6 行高 = 35.2px，留 1.8px 余量给黑框与基线。
 */
.task {
  height: 37px; box-sizing: border-box;
  font-size: 22px; line-height: 33px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border: 3px solid transparent; padding: 0 9px;
  display: flex; align-items: center;
}
.task.focused { font-weight: 700; border-color: #000; padding: 0 6px; }
.focus-mark { font-weight: 800; margin-right: 6px; }
/* 定宽：勾选框位置固定（TASK_CHECK，设备本地打勾用），不随字体的空格宽度变化 */
.focus-spacer { display: inline-block; width: 6px; margin-right: 14px; flex: none; }
.check {
  display: inline-block; width: 21px; height: 21px;
  border: 2px solid #000; line-height: 18px; text-align: center;
  font-size: 16px; font-weight: 700; margin-right: 8px;
  vertical-align: -3px; background: #fff; color: #fff; flex: 0 0 auto;
}
.check[data-done="1"] { background: #000; }
.label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.estimate { font-size: 18px; margin-left: 8px; }
.pts { flex: none; font-size: 18px; font-weight: 800; line-height: 22px; border: 2px solid #000; padding: 0 5px; margin-left: 8px; }
.pts.got { background: #000; color: #fff; }
/* --- 留言 353-429 ---
 * 分区 77px = 2px 上边框 + 2×10px padding + 2×27.5px 行高 → 恰好容纳 2 行。
 * docs/06 §9 要求留言 ≤2 行；line-height 必须 ≤1.25 才不会顶出分区。
 */
.message { border-top: 2px solid #000; padding: 10px 18px; font-size: 22px; line-height: 1.25; overflow: hidden; }
.msg-label { font-weight: 800; }
/* D-017 提醒横幅：黑底白字，孩子一眼能看到 */
.message.alert { background: #000; color: #fff; font-weight: 700; }
.msg-empty { font-size: 18px; }
.poem { font-size: 20px; }
.nowrap { white-space: nowrap; }
/* 两行天气：18px + 16px，行高 22 + 20 = 42px，容纳在 52px 头部内 */
.weather { display: flex; flex-direction: column; align-items: flex-end; max-width: 380px; overflow: hidden; }
.weather .w1 { font-size: 18px; line-height: 22px; white-space: nowrap; }
.weather .w2 { font-size: 16px; line-height: 20px; font-weight: 400; white-space: nowrap; }
/* --- 按键栏 430-479 --- */
.keys {
  border-top: 2px solid #000; display: flex; align-items: center; justify-content: space-around;
  font-size: 18px; font-weight: 700;
}
/* --- 离线提示（不覆盖主内容）--- */
.offline {
  position: absolute; right: 12px; bottom: 54px;
  border: 2px solid #000; background: #fff; padding: 2px 10px;
  font-size: 16px; font-weight: 700;
}
`;
}

/** 头部 0-54：左侧时钟留白 + 日期，中间标题，右侧天气/同步状态（D-015/D-018 各页共用） */
export function headHtml(head: ReturnType<typeof headerText>): string {
  return `<div class="head">
    <span class="left"><span class="clock-slot"></span><span class="nowrap">${escapeHtml(head.left)}</span></span>
    <span class="nowrap">${escapeHtml(head.middle)}</span>
    ${head.weather ? `<span class="weather"><span class="w1">${escapeHtml(head.weather.summary)}</span>${head.weather.advice ? `<span class="w2">${escapeHtml(head.weather.advice)}</span>` : ""}</span>` : `<span class="nowrap">${escapeHtml(head.right)}</span>`}
  </div>`;
}

/**
 * 生成整页 HTML。`vm` 已经过 clampViewModel（容量上限由组装器保证）。
 */
export function renderScreenHtml(vm: ScreenViewModel): string {
  // 文案规则与 Screen.tsx 共用（packages/screen-template/src/screenText.ts）
  const head = headerText(vm);
  const cols = columnText(vm);
  const bottom = bottomText(vm);
  const keys = keysText(vm);
  const isCompact = vm.schedule.length > 5;
  const scheduleHtml =
    vm.schedule.length === 0
      ? `<div class="row empty">${escapeHtml(cols.scheduleEmpty)}</div>`
      : isCompact
        ? `<div class="schedule-grid">${vm.schedule
            .slice(0, 10)
            .map(
              (s) =>
                `<div class="row compact"><span class="time">${escapeHtml(s.time)}</span> ${escapeHtml(s.title)}</div>`,
            )
            .join("")}</div>`
        : vm.schedule
            .map(
              (s) =>
                `<div class="row"><span class="time">${escapeHtml(s.time)}</span> ${escapeHtml(s.title)}</div>`,
            )
            .join("");

  const tasksHtml =
    vm.tasks.length === 0
      ? `<div class="row empty">${escapeHtml(cols.tasksEmpty)}</div>`
      : vm.tasks.map(taskRow).join("");

  const messageHtml =
    bottom.kind === "empty"
      ? `<span class="msg-empty">${escapeHtml(bottom.text)}</span>`
      : `<span class="${bottom.kind === "poem" ? "poem" : ""}"><span class="msg-label">${escapeHtml(bottom.label)}</span>${escapeHtml(bottom.text)}</span>`;

  const offlineHtml = vm.offlineNotice
    ? `<div class="offline">${escapeHtml(vm.offlineNotice)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>KidBoard</title>
<style>
${screenCss()}</style>
</head>
<body>
<div class="screen">
  ${headHtml(head)}
  <div class="body">
    <section class="col col-left">
      <div class="col-title">${escapeHtml(cols.scheduleTitle)}</div>
      ${scheduleHtml}
    </section>
    <section class="col">
      <div class="col-title">${escapeHtml(cols.tasksTitle)}</div>
      ${tasksHtml}
    </section>
  </div>
  <div class="message${bottom.kind === "alert" ? " alert" : ""}">${messageHtml}</div>
  <div class="keys">${keys.map((k) => `<span>${escapeHtml(k)}</span>`).join("")}</div>
  ${offlineHtml}
</div>
</body>
</html>`;
}
