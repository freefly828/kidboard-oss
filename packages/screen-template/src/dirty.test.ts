/**
 * Dirty area + refresh mode 测试（docs/06 §7 §8）。
 */

import { describe, expect, it } from "vitest";
import { binarizeToFrame, BYTES_PER_ROW, type RawImage } from "./frame";
import { computeDirtyArea, DirtyAreaError, recommendRefreshMode } from "./dirty";
import { FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "./types";

function blank(): RawImage {
  const data = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  data.fill(255);
  return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, data };
}

function blackRect(img: RawImage, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * SCREEN_WIDTH + x) * 4;
      img.data[p] = 0;
      img.data[p + 1] = 0;
      img.data[p + 2] = 0;
    }
  }
}

const ZERO = new Uint8Array(FRAME_BYTES);

describe("computeDirtyArea（docs/06 §7）", () => {
  it("完全相同的两帧：0 变化、无 bbox", () => {
    const frame = binarizeToFrame(blank());
    const r = computeDirtyArea(frame, frame);
    expect(r.changedPixels).toBe(0);
    expect(r.changedRatio).toBe(0);
    expect(r.dirtyRect).toBeNull();
  });

  it("单像素变化：bbox 宽高为 8×1 且 x 8 像素对齐", () => {
    const a = binarizeToFrame(blank());
    const imgB = blank();
    blackRect(imgB, 130, 77, 130, 77);
    const b = binarizeToFrame(imgB);
    const r = computeDirtyArea(a, b);
    expect(r.changedPixels).toBe(1);
    expect(r.dirtyRect).toEqual({ x: 128, y: 77, width: 8, height: 1 });
  });

  it("跨字节变化：x 边界扩展到 8 像素边界", () => {
    const a = binarizeToFrame(blank());
    const imgB = blank();
    // 从 x=44 到 x=203 → 对齐后应为 x=40, width=168 (40..207)
    blackRect(imgB, 44, 10, 203, 20);
    const b = binarizeToFrame(imgB);
    const r = computeDirtyArea(a, b);
    expect(r.dirtyRect!.x).toBe(40);
    expect(r.dirtyRect!.x % 8).toBe(0);
    expect(r.dirtyRect!.width % 8).toBe(0);
    expect(r.dirtyRect!.x + r.dirtyRect!.width).toBe(208);
    expect(r.dirtyRect!.y).toBe(10);
    expect(r.dirtyRect!.height).toBe(11);
  });

  it("右上角小区域：changedRatio 为变化像素/全画布（5 位小数）", () => {
    const a = binarizeToFrame(blank());
    const imgB = blank();
    blackRect(imgB, 400, 200, 415, 215); // 16×16 = 256 像素
    const b = binarizeToFrame(imgB);
    const r = computeDirtyArea(a, b);
    expect(r.changedPixels).toBe(256);
    expect(r.changedRatio).toBe(Math.round((256 / 384000) * 100000) / 100000);
    expect(r.changedRatio).toBeLessThan(0.001);
  });

  it("全画布变化：changedRatio = 1，bbox 覆盖整屏", () => {
    const a = binarizeToFrame(blank());
    const imgB = blank();
    blackRect(imgB, 0, 0, SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1);
    const b = binarizeToFrame(imgB);
    const r = computeDirtyArea(a, b);
    expect(r.changedPixels).toBe(SCREEN_WIDTH * SCREEN_HEIGHT);
    expect(r.changedRatio).toBe(1);
    expect(r.dirtyRect).toEqual({ x: 0, y: 0, width: 800, height: 480 });
  });

  it("计算结果与参数顺序无关（交换律）", () => {
    const imgA = blank();
    blackRect(imgA, 10, 10, 90, 90);
    const imgB = blank();
    blackRect(imgB, 300, 200, 380, 260);
    const a = binarizeToFrame(imgA);
    const b = binarizeToFrame(imgB);
    expect(computeDirtyArea(a, b)).toEqual(computeDirtyArea(b, a));
  });

  it("长度不符时抛错", () => {
    expect(() => computeDirtyArea(ZERO, new Uint8Array(10))).toThrow(DirtyAreaError);
    expect(() =>
      computeDirtyArea(new Uint8Array(100), new Uint8Array(100)),
    ).toThrow(DirtyAreaError);
  });

  it("统计精度：一行全部变化 = 800 像素", () => {
    const a = binarizeToFrame(blank());
    const imgB = blank();
    blackRect(imgB, 0, 5, SCREEN_WIDTH - 1, 5);
    const b = binarizeToFrame(imgB);
    const r = computeDirtyArea(a, b);
    expect(r.changedPixels).toBe(800);
    expect(r.changedPixels).toBe(BYTES_PER_ROW * 8);
  });
});

describe("recommendRefreshMode（docs/06 §8 决策树）", () => {
  const base = {
    bootFirstFrame: false,
    forceFullRefresh: false,
    hoursSinceFullRefresh: 1,
    partialCount: 0,
    changedRatio: 0.05,
    partialSupported: true,
  };

  it("boot 首帧 → FULL（优先级最高）", () => {
    expect(
      recommendRefreshMode({
        ...base,
        bootFirstFrame: true,
        forceFullRefresh: true,
        hoursSinceFullRefresh: 99,
        partialCount: 99,
      }),
    ).toBe("FULL");
  });

  it("forceFullRefresh → FULL", () => {
    expect(recommendRefreshMode({ ...base, forceFullRefresh: true })).toBe("FULL");
  });

  it("距上次全刷 ≥24h → FULL", () => {
    expect(recommendRefreshMode({ ...base, hoursSinceFullRefresh: 24 })).toBe("FULL");
    expect(
      recommendRefreshMode({ ...base, hoursSinceFullRefresh: 23.9, changedRatio: 0.5 }),
    ).toBe("FAST_FULL");
  });

  it("局刷累计 ≥5 次 → FULL", () => {
    expect(recommendRefreshMode({ ...base, partialCount: 5 })).toBe("FULL");
    expect(recommendRefreshMode({ ...base, partialCount: 4 })).toBe("PARTIAL");
  });

  it("变化比例 ≤0.25 且支持局刷 → PARTIAL", () => {
    expect(recommendRefreshMode({ ...base, changedRatio: 0.25 })).toBe("PARTIAL");
    expect(recommendRefreshMode({ ...base, changedRatio: 0.2501 })).toBe("FAST_FULL");
  });

  it("面板不支持局刷 → 退化为 FAST_FULL，即使变化很小", () => {
    expect(
      recommendRefreshMode({ ...base, changedRatio: 0.01, partialSupported: false }),
    ).toBe("FAST_FULL");
  });

  it("阈值可覆盖", () => {
    expect(
      recommendRefreshMode({ ...base, changedRatio: 0.4, partialAreaMaxRatio: 0.5 }),
    ).toBe("PARTIAL");
    expect(recommendRefreshMode({ ...base, partialCount: 2, partialMaxCount: 2 })).toBe("FULL");
    expect(
      recommendRefreshMode({ ...base, hoursSinceFullRefresh: 6, forceFullAfterHours: 6 }),
    ).toBe("FULL");
  });
});
