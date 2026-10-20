/**
 * 多页翻看（D-018）的附加页 HTML：本周课表、积分与心愿。
 * 与首页共用 screenCss() 与 headHtml()（头部、时钟留白、按键栏完全一致），
 * 中间区域合并为一整块（55-429），按键栏显示上一页 / 页码 / 下一页。
 */

import {
  FOCUS_SLOT,
  focusText,
  headerText,
  pageKeysText,
  pageTitle,
  type FocusPageVM,
  type PageKind,
  type PointsPageVM,
  type ScreenViewModel,
  type WeekPageVM,
} from "@kidboard/screen-template";
import { escapeHtml, headHtml, screenCss } from "./renderPage.js";

const PAGE_CSS = `
.screen.page { grid-template-rows: 54px 375px 51px; }
.page-body { overflow: hidden; }
/* --- 本周课表：7 列，今天整列反白 --- */
.week { display: grid; grid-template-columns: repeat(7, 1fr); height: 375px; }
.day { border-right: 2px solid #000; overflow: hidden; }
.day:last-child { border-right: none; }
.day-head { height: 44px; border-bottom: 2px solid #000; text-align: center; font-weight: 800; font-size: 19px; line-height: 20px; padding-top: 2px; }
.day-head .d { font-size: 15px; font-weight: 700; }
.day.today .day-head { background: #000; color: #fff; }
/* 长课名两行（时间 + 名称），短课名（≤3 字）一行；高度与 WEEK_ROW_* 常量一致 */
.entry { height: 39px; padding: 2px 6px 0; overflow: hidden; }
.entry .t { font-size: 13px; font-weight: 700; line-height: 15px; }
.entry .n { font-size: 17px; line-height: 21px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry.one { height: 25px; padding-top: 2px; display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
.entry.one .t { flex: none; }
.day.today .entry .n { font-weight: 700; }
.more { font-size: 14px; padding: 2px 6px; font-weight: 700; }
.none { font-size: 15px; padding: 10px 6px; }
/* --- 积分与心愿 --- */
.points { display: grid; grid-template-columns: 280px 1fr; height: 375px; }
.balance { border-right: 2px solid #000; padding: 18px; display: flex; flex-direction: column; }
.balance .plabel { font-size: 20px; font-weight: 700; }
.balance .num { font-size: 96px; font-weight: 800; line-height: 104px; letter-spacing: -2px; }
.balance .wk { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.balance .avail { font-size: 19px; font-weight: 800; background: #000; color: #fff; padding: 2px 8px; margin-bottom: 10px; white-space: nowrap; }
.recent { border-top: 2px solid #000; padding-top: 8px; }
.recent div { font-size: 16px; line-height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wishes { padding: 16px 18px; overflow: hidden; }
.wishes h2 { margin: 0 0 10px; font-size: 22px; font-weight: 800; }
.wish { margin-bottom: 14px; }
.wish .row1 { display: flex; justify-content: space-between; font-size: 20px; line-height: 26px; }
.wish .row1 .title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
.bar { height: 16px; border: 2px solid #000; margin-top: 4px; }
.bar i { display: block; height: 100%; background: #000; }
.wish .hint { font-size: 15px; line-height: 20px; margin-top: 2px; }
/* --- D-019 专注计时：中间留白给设备画倒计时 --- */
/* 用 padding 而非 margin 定位留白区：子元素 margin-top 会穿透容器导致整体下移溢出 */
.focus { height: 375px; text-align: center; padding-top: ${FOCUS_SLOT.y - 54}px; }
.focus-slot { width: ${FOCUS_SLOT.width}px; height: ${FOCUS_SLOT.height}px; margin: 0 auto; }
.focus .how { font-size: 26px; font-weight: 800; margin-top: 22px; }
.focus .rule { font-size: 20px; margin-top: 12px; }
.focus .today { font-size: 22px; font-weight: 700; margin-top: 26px; border-top: 2px solid #000; padding-top: 16px; margin-left: 120px; margin-right: 120px; }
`;

function pageDocument(head: ReturnType<typeof headerText>, body: string, keys: string[]): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>KidBoard</title>
<style>
${screenCss()}${PAGE_CSS}</style>
</head>
<body>
<div class="screen page">
  ${headHtml(head)}
  <div class="page-body">${body}</div>
  <div class="keys">${keys.map((k) => `<span>${escapeHtml(k)}</span>`).join("")}</div>
</div>
</body>
</html>`;
}

/** 每天一列的可用高度：页面主体 375 - 表头 44 - 分隔线 2 - 余量 4 */
const WEEK_COLUMN_PX = 325;
const WEEK_ROW_TWO_LINE_PX = 39;
const WEEK_ROW_ONE_LINE_PX = 25;
const WEEK_MORE_PX = 22;

/** 课名不超过 3 个字时与时间排在同一行（列宽约 110px） */
function isShortTitle(title: string): boolean {
  return [...title].length <= 3;
}

/** 按实际行高决定能完整显示几条；放不下时为"另 N 节"留一行 */
export function weekEntriesThatFit(titles: string[]): number {
  const heights = titles.map((t) => (isShortTitle(t) ? WEEK_ROW_ONE_LINE_PX : WEEK_ROW_TWO_LINE_PX));
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= WEEK_COLUMN_PX) return titles.length;
  let used = 0;
  let n = 0;
  for (const h of heights) {
    if (used + h > WEEK_COLUMN_PX - WEEK_MORE_PX) break;
    used += h;
    n++;
  }
  return n;
}

function weekBody(week: WeekPageVM): string {
  return `<div class="week">${week.days
    .map((d) => {
      const shown = d.entries.slice(0, weekEntriesThatFit(d.entries.map((e) => e.title)));
      const more = d.entries.length - shown.length;
      const entries =
        d.entries.length === 0
          ? `<div class="none">— 无课 —</div>`
          : shown
              .map((e) =>
                isShortTitle(e.title)
                  ? `<div class="entry one"><span class="t">${escapeHtml(e.time)}</span><span class="n">${escapeHtml(e.title)}</span></div>`
                  : `<div class="entry"><div class="t">${escapeHtml(e.time)}</div><div class="n">${escapeHtml(e.title)}</div></div>`,
              )
              .join("") + (more > 0 ? `<div class="more">另 ${more} 节</div>` : "");
      return `<div class="day${d.isToday ? " today" : ""}"><div class="day-head">${escapeHtml(d.label)}<br><span class="d">${escapeHtml(d.dateLabel)}</span></div>${entries}</div>`;
    })
    .join("")}</div>`;
}

function pointsBody(p: PointsPageVM): string {
  const recent =
    p.recent.length === 0
      ? `<div>还没有积分记录</div>`
      : p.recent
          .map((r) => `<div>${escapeHtml(r.dateLabel)} ${r.delta > 0 ? "+" : ""}${r.delta} ${escapeHtml(r.reason)}</div>`)
          .join("");
  const wishes =
    p.rewards.length === 0
      ? `<div class="hint" style="font-size:18px">家长还没有上架奖励</div>`
      : p.rewards
          .map((w) => {
            const pct = Math.max(0, Math.min(100, Math.round((p.balance / w.cost) * 100)));
            const hint = p.balance >= w.cost ? "积分够了，可以找爸爸妈妈兑换！" : `还差 ${w.cost - p.balance} 分`;
            return `<div class="wish"><div class="row1"><span class="title">${escapeHtml(w.title)}</span><span>${w.cost} 分</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="hint">${escapeHtml(hint)}</div></div>`;
          })
          .join("");
  return `<div class="points">
  <div class="balance"><span class="plabel">我的积分</span><span class="num">${p.balance}</span><span class="wk">本周 +${p.weekEarned}</span>${p.available ? `<span class="avail">做完任务还能得 +${p.available}</span>` : ""}<div class="recent">${recent}</div></div>
  <div class="wishes"><h2>积分商城</h2>${wishes}</div>
</div>`;
}

function focusBody(f: FocusPageVM): string {
  const t = focusText(f);
  return `<div class="focus"><div class="focus-slot"></div><div class="how">DONE 开始 / 暂停　　BACK 结束</div><div class="rule">${escapeHtml(t.rule)}</div><div class="today">${escapeHtml(t.today)}</div></div>`;
}

export interface PageData {
  week?: WeekPageVM;
  points?: PointsPageVM;
  focus?: FocusPageVM;
}

/** 渲染附加页（pageIndex 从 1 开始；0 为首页，见 renderScreenHtml） */
export function renderExtraPageHtml(kind: PageKind, vm: ScreenViewModel, data: PageData, pageIndex: number, pageCount: number): string {
  const head = { ...headerText(vm), middle: pageTitle(kind, vm.childName) };
  const body =
    kind === "week"
      ? weekBody(data.week ?? { days: [] })
      : kind === "points"
        ? pointsBody(data.points ?? { balance: 0, weekEarned: 0, rewards: [], recent: [] })
        : focusBody(data.focus ?? { minutes: 25, points: 5, dailyCap: 3, todayCount: 0, todayMinutes: 0 });
  return pageDocument(head, body, pageKeysText(pageIndex, pageCount, kind));
}
