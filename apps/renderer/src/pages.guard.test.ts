/**
 * D-018 附加页守卫（真实 Chromium）：极端内容不溢出、帧 48,000 字节、时钟区留白。
 */

import { afterAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { binarizeToFrame, CLOCK_SLOT } from "@kidboard/screen-template";
import { allFixtures } from "@kidboard/screen-template/fixtures";
import { FOCUS_SLOT, PAGE_COUNT, PAGE_ORDER, type PointsPageVM, type WeekPageVM } from "@kidboard/screen-template/pages";
import { decodePngToRawImage } from "./png";
import { renderExtraPageHtml } from "./renderPages";
import { launchBrowser, screenshotHtml } from "./screenshot";

let browser: Browser | undefined;
try {
  browser = await launchBrowser({ launchArgs: ["--no-sandbox"] });
} catch (err) {
  console.warn(`[pages guard SKIPPED] Chromium unavailable: ${err instanceof Error ? err.message : String(err)}`);
}
afterAll(async () => {
  if (browser) await browser.close().catch(() => {});
});

const LONG = "超级长的课程名字测试一下省略号";
const fullWeek: WeekPageVM = {
  days: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, i) => ({
    label,
    dateLabel: `12/${20 + i}`,
    isToday: i === 2,
    entries: Array.from({ length: 11 }, (_, k) => ({ time: `${String(8 + k).padStart(2, "0")}:20`, title: `${LONG}${k}` })),
  })),
};
const emptyWeek: WeekPageVM = { days: fullWeek.days.map((d) => ({ ...d, entries: [] })) };
// 短课名一行显示：14 条全部短名 / 长短交替
const shortWeek: WeekPageVM = { days: fullWeek.days.map((d) => ({ ...d, entries: Array.from({ length: 14 }, (_, k) => ({ time: "08:20", title: k % 2 ? "放学" : "语文" })) })) };
const mixedWeek: WeekPageVM = { days: fullWeek.days.map((d) => ({ ...d, entries: Array.from({ length: 12 }, (_, k) => ({ time: "08:20", title: k % 2 ? "体育与健康" : "数学" })) })) };
const fullPoints: PointsPageVM = {
  balance: 99999,
  weekEarned: 9999,
  available: 9999,
  rewards: Array.from({ length: 4 }, (_, i) => ({ title: `乐高机械组超级跑车豪华版${i}`, cost: 100000 })),
  recent: Array.from({ length: 4 }, () => ({ dateLabel: "12/31", reason: "完成任务：练习钢琴三十分钟并录视频发给老师", delta: -10000 })),
};
const emptyPoints: PointsPageVM = { balance: 0, weekEarned: 0, rewards: [], recent: [] };
const base = Object.values(allFixtures)[0]!;

const cases: [string, Parameters<typeof renderExtraPageHtml>][] = [
  ["week-full", ["week", base, { week: fullWeek }, 1, PAGE_COUNT]],
  ["week-empty", ["week", base, { week: emptyWeek }, 1, PAGE_COUNT]],
  ["week-short", ["week", base, { week: shortWeek }, 1, PAGE_COUNT]],
  ["week-mixed", ["week", base, { week: mixedWeek }, 1, PAGE_COUNT]],
  ["points-full", ["points", base, { points: fullPoints }, 2, PAGE_COUNT]],
  ["points-empty", ["points", base, { points: emptyPoints }, 2, PAGE_COUNT]],
  ["focus-busy", ["focus", base, { focus: { minutes: 90, points: 50, dailyCap: 10, todayCount: 10, todayMinutes: 900 } }, 3, PAGE_COUNT]],
  ["focus-none", ["focus", base, { focus: { minutes: 25, points: 0, dailyCap: 0, todayCount: 0, todayMinutes: 0 } }, 3, PAGE_COUNT]],
];

describe.skipIf(!browser)("D-018 附加页渲染守卫", () => {
  it("PAGE_ORDER 与总页数一致", () => {
    expect(PAGE_COUNT).toBe(PAGE_ORDER.length + 1);
  });

  it.each(cases)("%s：内容不溢出页面主体与按键栏", async (_name, args) => {
    const page = await browser!.newPage({ viewport: { width: 800, height: 480 }, deviceScaleFactor: 1 });
    try {
      await page.setContent(renderExtraPageHtml(...args), { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const m = await page.evaluate(() => {
        const body = document.querySelector(".page-body") as HTMLElement;
        const keys = document.querySelector(".keys") as HTMLElement;
        const head = document.querySelector(".head") as HTMLElement;
        return {
          bodyOverflow: body.scrollHeight > body.clientHeight + 1,
          keysTop: keys.getBoundingClientRect().top,
          headBottom: head.getBoundingClientRect().bottom,
        };
      });
      expect(m.bodyOverflow).toBe(false);
      expect(m.headBottom).toBeLessThanOrEqual(55);
      expect(m.keysTop).toBeGreaterThanOrEqual(428);
    } finally {
      await page.close();
    }
  });

  it.each(cases.filter(([n]) => n.startsWith("focus")))("%s：倒计时区全白（设备绘制）", async (_name, args) => {
    const { png } = await screenshotHtml(browser!, renderExtraPageHtml(...args));
    const frame = binarizeToFrame(decodePngToRawImage(png));
    let black = 0;
    for (let y = FOCUS_SLOT.y; y < FOCUS_SLOT.y + FOCUS_SLOT.height; y++)
      for (let x = FOCUS_SLOT.x; x < FOCUS_SLOT.x + FOCUS_SLOT.width; x++)
        if ((frame[y * 100 + (x >> 3)]! & (0x80 >> (x & 7))) === 0) black++;
    expect(black).toBe(0);
  });

  it.each(cases)("%s：48,000 字节帧，时钟区全白", async (_name, args) => {
    const { png } = await screenshotHtml(browser!, renderExtraPageHtml(...args));
    const frame = binarizeToFrame(decodePngToRawImage(png));
    expect(frame.length).toBe(48_000);
    let black = 0;
    for (let y = CLOCK_SLOT.y; y < CLOCK_SLOT.y + CLOCK_SLOT.height; y++)
      for (let x = CLOCK_SLOT.x; x < CLOCK_SLOT.x + CLOCK_SLOT.width; x++)
        if ((frame[y * 100 + (x >> 3)]! & (0x80 >> (x & 7))) === 0) black++;
    expect(black).toBe(0);
  });
});

describe("D-018 课表按行高排版", () => {
  it("小满周二 9 条（7 短 2 长）全部放得下；14 条短名放 13 条留\"另 N 节\"", async () => {
    const { weekEntriesThatFit } = await import("./renderPages");
    const tue = ["数学", "美术", "语文", "体育与健康", "放学", "活动", "道德与法治", "放学", "武术"];
    expect(weekEntriesThatFit(tue)).toBe(9);
    expect(weekEntriesThatFit(Array(14).fill("语文"))).toBe(12);
    expect(weekEntriesThatFit(Array(8).fill("体育与健康"))).toBe(8);
    expect(weekEntriesThatFit(Array(9).fill("体育与健康"))).toBe(7);
  });
});
