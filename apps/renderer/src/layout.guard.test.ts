/**
 * 布局越界守卫（真实 Chromium 测量）。
 *
 * 为什么需要显式检查：
 * 分区使用 `overflow: hidden`，内容超出时 Chromium 会**静默裁掉**而不报错，
 * 截图看起来"正常"，实际任务行/留言已被切掉或压到相邻分区。
 * 这里直接测量每个分区的 scrollHeight/clientHeight 与子元素实际底边。
 *
 * 对应冻结布局 docs/02 §3：头部 0-54 / 双栏 55-352 / 留言 353-429 / 按键栏 430-479。
 */

import { afterAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { allFixtures } from "@kidboard/screen-template/fixtures";
import { renderScreenHtml } from "./renderPage";
import { launchBrowser } from "./screenshot";

let browser: Browser | undefined;
try {
  browser = await launchBrowser({ launchArgs: ["--no-sandbox"] });
} catch (err) {
  console.warn(
    `[layout guard SKIPPED] Chromium unavailable: ${err instanceof Error ? err.message : String(err)}`,
  );
}
const enabled = Boolean(browser);

afterAll(async () => {
  if (browser) await browser.close().catch(() => {});
});

interface SectionMetrics {
  title: string;
  scrollHeight: number;
  clientHeight: number;
  overflow: boolean;
  /** 最后一个子元素的实际底边（相对分区顶部） */
  lastChildBottom: number;
}

describe.skipIf(!enabled)("布局越界守卫：8 套 fixture 的分区内容必须完全容纳", () => {
  it.each(Object.entries(allFixtures))(
    "fixture %s：双栏/留言/头部均无内容溢出",
    async (name, vm) => {
      const context = await browser!.newContext({
        viewport: { width: 800, height: 480 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      try {
        await page.setContent(renderScreenHtml(vm), { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });

        const metrics = await page.evaluate(() => {
          function measure(el: Element | null, title: string) {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const children = Array.from(el.children) as HTMLElement[];
            const interactive = children.filter(
              (c) => !c.classList.contains("col-title"),
            );
            let lastChildBottom = 0;
            for (const c of interactive) {
              lastChildBottom = Math.max(
                lastChildBottom,
                c.getBoundingClientRect().bottom - r.top,
              );
            }
            return {
              title,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              overflow: el.scrollHeight > el.clientHeight + 1,
              lastChildBottom,
            };
          }
          const cols = Array.from(document.querySelectorAll(".col"));
          return {
            left: measure(cols[0] ?? null, "今日安排"),
            right: measure(cols[1] ?? null, "今日任务"),
            message: measure(document.querySelector(".message"), "留言"),
            head: measure(document.querySelector(".head"), "头部"),
            keys: measure(document.querySelector(".keys"), "按键栏"),
            docHeight: document.documentElement.scrollHeight,
            docWidth: document.documentElement.scrollWidth,
          };
        });

        // 画布必须严格 800×480
        expect(metrics.docHeight, `${name}: doc height`).toBe(480);
        expect(metrics.docWidth, `${name}: doc width`).toBe(800);

        const sections: [string, SectionMetrics | null][] = [
          ["今日安排", metrics.left as SectionMetrics | null],
          ["今日任务", metrics.right as SectionMetrics | null],
          ["留言", metrics.message as SectionMetrics | null],
          ["头部", metrics.head as SectionMetrics | null],
          ["按键栏", metrics.keys as SectionMetrics | null],
        ];
        for (const [title, m] of sections) {
          expect(m, `${name}: section ${title} should exist`).not.toBeNull();
          expect(
            m!.overflow,
            `${name}: ${title} 内容溢出分区（scrollHeight=${m!.scrollHeight} > clientHeight=${m!.clientHeight}，最后一个子元素底边=${m!.lastChildBottom}）`,
          ).toBe(false);
        }
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    },
  );

  it("任务满（6 条）时最后一行仍在任务分区内", async () => {
    const context = await browser!.newContext({
      viewport: { width: 800, height: 480 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.setContent(renderScreenHtml(allFixtures.fullTasks!), { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const r = await page.evaluate(() => {
        const col = document.querySelectorAll(".col")[1] as HTMLElement;
        const tasks = Array.from(col.querySelectorAll(".task")) as HTMLElement[];
        const colRect = col.getBoundingClientRect();
        const last = tasks[tasks.length - 1]!;
        // 留言区的位置（用于确认任务行没有压过去）
        const msg = document.querySelector(".message")!.getBoundingClientRect();
        return {
          taskCount: tasks.length,
          lastBottomRelToCol: last.getBoundingClientRect().bottom - colRect.top,
          colClientHeight: col.clientHeight,
          colScrollHeight: col.scrollHeight,
          lastBottomAbs: last.getBoundingClientRect().bottom,
          msgTopAbs: msg.top,
        };
      });
      expect(r.taskCount).toBe(6);
      expect(r.colScrollHeight).toBeLessThanOrEqual(r.colClientHeight + 1);
      // 最后一行必须在留言区之上
      expect(r.lastBottomAbs).toBeLessThanOrEqual(r.msgTopAbs + 1);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
});
