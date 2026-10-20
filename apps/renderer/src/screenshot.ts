/**
 * Playwright 截图 — 800×480 固定画布（docs/06 §1 §3）。
 *
 * 关键约束：
 * - viewport 固定 800×480、deviceScaleFactor=1；
 * - 截图前必须 `document.fonts.ready`（docs/06 §3），否则中文可能以兜底字体吐 tofu；
 * - 禁动画：额外注入 prefers-reduced-motion，避免任何过渡影响帧确定性（B02）；
 * - 只加载本地 HTML 字符串，不走网络（离线确定性）。
 */

import { chromium, type Browser, type Page } from "playwright-core";
import { FRAME_HEIGHT, FRAME_WIDTH, type RawImage } from "@kidboard/screen-template";

export class ScreenshotError extends Error {}

/** 极简 PNG 解码器注入点：由调用方提供（保持本模块不绑定 PNG 库） */
export interface ScreenshotOptions {
  /** 传给 chromium.launch 的额外参数（容器中需要 --no-sandbox） */
  launchArgs?: string[];
  /** 显式指定可执行文件（离线/固定版本部署时使用） */
  executablePath?: string;
  /** 每页等待字体的额外超时（ms） */
  fontTimeoutMs?: number;
}

export interface RenderedPng {
  /** PNG 原始字节 */
  png: Buffer;
  /** 页面是否已确认字体加载完成 */
  fontsReady: boolean;
}

/** 启动浏览器；调用方负责 close */
export async function launchBrowser(
  opts: ScreenshotOptions = {},
): Promise<Browser> {
  const args = opts.launchArgs ?? [];
  return chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", ...args],
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
  });
}

/**
 * 用给定 HTML 渲染并截图。
 *
 * `waitForFonts`：等待 document.fonts.ready 且 status === 'loaded'。
 * 字体加载失败会抛错（不静默产出缺字帧）。
 */
export async function screenshotHtml(
  browser: Browser,
  html: string,
  opts: ScreenshotOptions = {},
): Promise<RenderedPng> {
  const context = await browser.newContext({
    viewport: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  let page: Page | null = null;
  try {
    page = await context.newPage();
    // 阻止一切外部请求：渲染必须是离线的、确定的
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("about:") || url.startsWith("data:")) return route.continue();
      return route.abort();
    });
    await page.setContent(html, { waitUntil: "load" });

    const fontsReady = await page.evaluate(async (timeout) => {
      await document.fonts.ready;
      return Promise.race([
        Promise.resolve(document.fonts.status === "loaded"),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout)),
      ]);
    }, opts.fontTimeoutMs ?? 5000);

    if (!fontsReady) {
      throw new ScreenshotError(
        "document.fonts.ready did not settle to 'loaded' — refusing to emit a frame that may contain tofu glyphs",
      );
    }

    // 布局稳定性：确认画布确实是 800×480，且没有滚动尺寸
    const metrics = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
      };
    });
    if (metrics.scrollWidth !== FRAME_WIDTH || metrics.scrollHeight !== FRAME_HEIGHT) {
      throw new ScreenshotError(
        `rendered document is ${metrics.scrollWidth}x${metrics.scrollHeight}, expected ${FRAME_WIDTH}x${FRAME_HEIGHT}`,
      );
    }

    const png = await page.screenshot({ type: "png", animations: "disabled" });
    return { png: Buffer.from(png), fontsReady: true };
  } finally {
    if (page) await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 便捷入口：启动浏览器 → 渲染 → 关闭。
 * 单次任务场景用；批量渲染应复用 launchBrowser。
 */
export async function renderHtmlToPng(
  html: string,
  opts: ScreenshotOptions = {},
): Promise<Buffer> {
  const browser = await launchBrowser(opts);
  try {
    const { png } = await screenshotHtml(browser, html, opts);
    return png;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 由 RawImage 校验尺寸（供 PNG 解码后立即使用） */
export function assertRawImageSize(img: RawImage): void {
  if (img.width !== FRAME_WIDTH || img.height !== FRAME_HEIGHT) {
    throw new ScreenshotError(
      `screenshot must be ${FRAME_WIDTH}x${FRAME_HEIGHT}, got ${img.width}x${img.height}`,
    );
  }
}
