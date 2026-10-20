/**
 * 渲染管线单元测试（不需要 DB）。
 *
 * 覆盖：
 * - B01/B03：真实 Chromium 渲染 8 套 fixture，PNG 必须 800×480、frame.bin 必须 48,000 bytes、无 tofu
 * - B02：同一 VM 连续渲染 10 次 SHA-256 完全一致
 * - 渲染页内容合规：无 script / 无远程字体 / 无网络图片 / 无动画
 *
 * 这些是**真实**渲染（不做 mock），因此依赖本机/容器内可用的 Chromium。
 * Chromium 不可用时跳过并打印明确原因，而不是伪装成 PASS。
 */

import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import type { ScreenViewModel } from "@kidboard/screen-template";
import {
  assertFrameSize,
  binarizeToFrame,
  CLOCK_SLOT,
  FRAME_BYTES,
  TASK_ROWS,
  TASK_CHECK,
  FRAME_HEIGHT,
  FRAME_WIDTH,
} from "@kidboard/screen-template";
import { allFixtures } from "@kidboard/screen-template/fixtures";
import { decodePngToRawImage } from "../src/png";
import { escapeHtml, renderScreenHtml } from "../src/renderPage";
import { launchBrowser, ScreenshotError, screenshotHtml } from "../src/screenshot";
import { encodePng, encodeRgbPng } from "./helpers/encodePng";

/**
 * 检测 Chromium 是否可用（不下载）。不可用时整个 suite 跳过。
 * 注意：不用 try/catch 吞掉真实渲染错误，只探测可启动性。
 */
async function tryLaunch(): Promise<{ ok: true; browser: Browser } | { ok: false; reason: string }> {
  try {
    const browser = await launchBrowser({ launchArgs: ["--no-sandbox"] });
    return { ok: true, browser };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const probe = await tryLaunch();
if (!probe.ok) {
  console.warn(
    `[renderer pipeline tests SKIPPED] Chromium unavailable: ${probe.reason}\n` +
      "Install with: npx playwright-core install chromium (or run inside the renderer container).",
  );
}
const browser: Browser | undefined = probe.ok ? probe.browser : undefined;

afterAll(async () => {
  if (browser) await browser.close().catch(() => {});
});

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** 带类型的 fixture 条目（Object.entries 会退化为 unknown） */
const fixtureEntries: [string, ScreenViewModel][] = Object.entries(allFixtures) as [
  string,
  ScreenViewModel,
][];

/** 按需取 fixture，缺失时立刻暴露（避免非空断言掩盖拼写错误） */
function fixture(name: keyof typeof allFixtures): ScreenViewModel {
  const vm = allFixtures[name];
  if (!vm) throw new Error(`fixture not found: ${String(name)}`);
  return vm;
}

describe.skipIf(!browser)("渲染页内容合规（docs/06 §2）", () => {
  it("8 套 fixture 生成的 HTML 均无 script / 远程字体 / 网络图片 / 动画", () => {
    for (const [name, vm] of fixtureEntries) {
      const html = renderScreenHtml(vm);
      expect(html, `${name}: must not contain <script`).not.toMatch(/<script/i);
      expect(html, `${name}: must not contain remote font`).not.toMatch(/fonts\.googleapis|@import|@font-face/i);
      expect(html, `${name}: must not contain img http`).not.toMatch(/<img[^>]+src=["']https?:/i);
      expect(html, `${name}: must not contain animation`).not.toMatch(/animation\s*:|transition\s*:/i);
      expect(html, `${name}: must not contain event handlers`).not.toMatch(/\son(click|load|error|change|input|submit)=/i);
      expect(html, `${name}: must render 800x480 canvas`).toContain("width: 800px");
      expect(html, `${name}: must render 480 height`).toContain("height: 480px");
    }
  });

  it("HTML 转义：VM 中的尖括号不会破坏文档结构", () => {
    const html = renderScreenHtml({
      dateLabel: "9月16日 周三",
      childName: '<script>alert(1)</script>',
      syncStatus: "synced",
      schedule: [],
      tasks: [],
      message: "<b>粗体</b> & 引号\"'",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("escapeHtml 覆盖 5 个危险字符", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe.skipIf(!browser)("D-022 任务行几何（设备画焦点框）", () => {
  it("fullTasks：每个任务行的位置与 TASK_ROWS 一致", async () => {
    const page = await browser!.newPage({ viewport: { width: 800, height: 480 }, deviceScaleFactor: 1 });
    try {
      await page.setContent(renderScreenHtml(fixture("fullTasks")), { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const rects = await page.evaluate(() =>
        [...document.querySelectorAll(".task")].map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      expect(rects.length).toBeGreaterThan(0);
      rects.forEach((r, i) => {
        expect(r).toEqual({ x: TASK_ROWS.x, y: TASK_ROWS.y + i * TASK_ROWS.rowHeight, w: TASK_ROWS.width, h: TASK_ROWS.rowHeight });
      });
      // D-023 勾选框位置固定（设备本地打勾画在同一位置）
      const checks = await page.evaluate(() =>
        [...document.querySelectorAll(".task .check")].map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      checks.forEach((c, i) => {
        expect(c).toEqual({
          x: TASK_ROWS.x + TASK_CHECK.dx,
          y: TASK_ROWS.y + i * TASK_ROWS.rowHeight + TASK_CHECK.dy,
          w: TASK_CHECK.size,
          h: TASK_CHECK.size,
        });
      });
    } finally {
      await page.close();
    }
  });
});

describe.skipIf(!browser)("D-015 设备时钟区留白（真实 Chromium 渲染）", () => {
  it.each(fixtureEntries)("fixture %s：CLOCK_SLOT 区域全白", async (name, vm) => {
    const { png } = await screenshotHtml(browser!, renderScreenHtml(vm));
    const frame = binarizeToFrame(decodePngToRawImage(png));
    const { x, y, width, height } = CLOCK_SLOT;
    let black = 0;
    for (let yy = y; yy < y + height; yy++) {
      for (let xx = x; xx < x + width; xx++) {
        if ((frame[yy * 100 + (xx >> 3)]! & (0x80 >> (xx & 7))) === 0) black++;
      }
    }
    expect(black, `${name} 时钟区出现 ${black} 个黑点`).toBe(0);
  });
});

describe.skipIf(!browser)("B01 尺寸 + B03 中文字体（真实 Chromium 渲染）", () => {
  it.each(fixtureEntries)(
    "fixture %s: PNG 800×480、frame.bin 48000 bytes、无 tofu/方框",
    async (name, vm) => {
      const { png } = await screenshotHtml(browser!, renderScreenHtml(vm));
      const img = decodePngToRawImage(png);
      expect(img.width, `${name} width`).toBe(800);
      expect(img.height, `${name} height`).toBe(480);

      const frame = binarizeToFrame(img);
      assertFrameSize(frame);
      expect(frame.length, `${name} frame bytes`).toBe(48_000);

      // B03：中文必须真的画出来 —— 全白帧说明文字完全没渲染（字体缺失/tofu 兜底失败）
      const blackPixels = countBlackPixels(frame);
      expect(blackPixels, `${name} 应至少有可见墨点`).toBeGreaterThan(0);
    },
  );

  it("B03：中文标签实际产生墨点（不是空白帧）", async () => {
    const { png } = await screenshotHtml(browser!, renderScreenHtml(fixture("fullTasks")));
    const frame = binarizeToFrame(decodePngToRawImage(png));
    // 头部/分栏标题/按键栏都有中文与线条，黑像素应有相当规模
    expect(countBlackPixels(frame)).toBeGreaterThan(5000);
  });

  it("B03：中文与空白渲染结果不同（字体确实参与了绘制）", async () => {
    const withText = await screenshotHtml(
      browser!,
      renderScreenHtml({ ...fixture("emptyDay"), childName: "小冒烟" }),
    );
    const withoutText = await screenshotHtml(
      browser!,
      renderScreenHtml({ ...fixture("emptyDay"), childName: "" }),
    );
    const a = binarizeToFrame(decodePngToRawImage(withText.png));
    const b = binarizeToFrame(decodePngToRawImage(withoutText.png));
    expect(sha256(a)).not.toBe(sha256(b));
  });

  it("画布尺寸不符时截图阶段抛错（防止错尺寸进入管线）", async () => {
    const badHtml = `<!DOCTYPE html><html><head><style>html,body{margin:0;width:1200px;height:600px;overflow:hidden}</style></head><body><div style="width:1200px;height:600px"></div></body></html>`;
    await expect(screenshotHtml(browser!, badHtml)).rejects.toThrow(ScreenshotError);
  });
});

describe.skipIf(!browser)("B02 确定性（同一 VM 连续渲染 10 次 SHA-256 相同）", () => {
  it.each(["fullTasks", "longChinese", "mixedContent"] as const)(
    "fixture %s: 10 次渲染 frame SHA-256 完全一致",
    async (name) => {
      const html = renderScreenHtml(fixture(name as keyof typeof allFixtures));
      const hashes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const { png } = await screenshotHtml(browser!, html);
        hashes.push(sha256(binarizeToFrame(decodePngToRawImage(png))));
      }
      expect(new Set(hashes).size, `hashes: ${JSON.stringify(hashes)}`).toBe(1);
    },
    120_000,
  );

  it("8 套 fixture 两两 SHA-256 不同（确认基线彼此可区分）", async () => {
    const hashes = new Map<string, string>();
    for (const [name, vm] of fixtureEntries) {
      const { png } = await screenshotHtml(browser!, renderScreenHtml(vm));
      hashes.set(name, sha256(binarizeToFrame(decodePngToRawImage(png))));
    }
    expect(new Set(hashes.values()).size).toBe(hashes.size);
  }, 120_000);
});

describe("PNG 解码（不依赖 Chromium）", () => {
  it("接受 800×480 纯白 PNG，得到全白帧", () => {
    const rgba = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 4);
    rgba.fill(255);
    const png = encodePng(FRAME_WIDTH, FRAME_HEIGHT, rgba);
    const img = decodePngToRawImage(png);
    expect(img.width).toBe(FRAME_WIDTH);
    const frame = binarizeToFrame(img);
    expect(frame.every((b) => b === 0xff)).toBe(true);
  });

  it("尺寸不符的 PNG 抛错", () => {
    const png = encodePng(100, 100, new Uint8Array(100 * 100 * 4));
    expect(() => decodePngToRawImage(png)).toThrow(/must be 800x480/);
  });

  it("非 PNG 数据抛错", () => {
    expect(() => decodePngToRawImage(Buffer.from("not a png"))).toThrow(/failed to decode PNG/);
  });

  it("回归：colorType=2 (RGB) 的 PNG 必须按 4 字节/像素解码，不得按源通道数错位", () => {
    // 构造一个只在特定像素位置有黑色的 RGB 图（Chromium 对不透明页面就是 colorType=2）。
    // 若实现按 3 字节步长读取 pngjs 返回的缓冲区，整幅图会错位——本用例会立刻失败。
    const rgba = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 4);
    rgba.fill(255);
    const blackAt = (x: number, y: number) => {
      const p = (y * FRAME_WIDTH + x) * 4;
      rgba[p] = 0;
      rgba[p + 1] = 0;
      rgba[p + 2] = 0;
    };
    blackAt(0, 0);
    blackAt(7, 0);
    blackAt(100, 149);
    blackAt(560, 300);

    const img = decodePngToRawImage(encodeRgbPng(FRAME_WIDTH, FRAME_HEIGHT, rgba));
    expect(img.data.length).toBe(FRAME_WIDTH * FRAME_HEIGHT * 4);

    const isBlack = (x: number, y: number) => {
      const p = (y * FRAME_WIDTH + x) * 4;
      return img.data[p] === 0 && img.data[p + 1] === 0 && img.data[p + 2] === 0;
    };
    expect(isBlack(0, 0), "RGB 图 (0,0) 应为黑").toBe(true);
    expect(isBlack(7, 0), "RGB 图 (7,0) 应为黑").toBe(true);
    expect(isBlack(100, 149), "RGB 图 (100,149) 应为黑").toBe(true);
    expect(isBlack(560, 300), "RGB 图 (560,300) 应为黑").toBe(true);
    // 反向：未涂黑的点必须保持白（错位会污染这些位置）
    expect(isBlack(101, 149), "相邻点必须仍为白（错位检查）").toBe(false);
    expect(isBlack(100, 150), "下一行同列必须仍为白（错位检查）").toBe(false);

    // 二值化后黑像素数必须恰好等于涂黑的数量（错位会显著改变该数值）
    const frame = binarizeToFrame(img);
    expect(countBlackPixels(frame)).toBe(4);
  });
});

/** 统计帧中的黑像素数（用于判断是否真的有内容被绘制） */
function countBlackPixels(frame: Uint8Array): number {
  let black = 0;
  for (const byte of frame) {
    // 0 = black: 统计值为 0 的 bit
    black += 8 - popcount(byte);
  }
  return black;
}

function popcount(b: number): number {
  let n = 0;
  let v = b;
  while (v) {
    v &= v - 1;
    n++;
  }
  return n;
}

void FRAME_BYTES;
void FRAME_HEIGHT;
