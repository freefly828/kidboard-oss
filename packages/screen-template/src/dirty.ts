/**
 * Dirty Area 计算 + Refresh mode 推荐（docs/06 §7 §8）。
 *
 * 纯函数，输入两帧 48,000 byte 的 frame.bin，输出可写入 screen_frames.changed_ratio
 * 与 screen_frames.dirty_rect 的结果。
 *
 * 契约要点：
 * - bbox x 坐标必须扩展到 8 像素边界（因为帧以字节为单位做局刷）；
 * - refresh mode 决策树见 docs/06 §8，最终选择由固件 policy 决定，renderer 只给推荐值。
 */

import { BYTES_PER_ROW } from "./frame";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./types";

/** 与 screen_frames.dirty_rect (jsonb) 对齐的矩形；x1/y1 为闭区间 */
export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DirtyAreaResult {
  /** 发生变化的像素数 */
  changedPixels: number;
  /** 变化像素占全画布比例（0..1，6 位小数以内，匹配 numeric(6,5)） */
  changedRatio: number;
  /** 变化区域的 8 像素对齐包围盒；无变化时为 null */
  dirtyRect: DirtyRect | null;
}

export class DirtyAreaError extends Error {}

function assertSameLength(a: Uint8Array, b: Uint8Array): void {
  if (a.length !== b.length) {
    throw new DirtyAreaError(
      `frames must have equal length, got ${a.length} and ${b.length}`,
    );
  }
  if (a.length !== SCREEN_HEIGHT * BYTES_PER_ROW) {
    throw new DirtyAreaError(
      `frames must be ${SCREEN_HEIGHT * BYTES_PER_ROW} bytes, got ${a.length}`,
    );
  }
}

/**
 * 计算新旧帧差异。本函数与顺序无关（XOR 交换律）。
 *
 * changed_ratio 精度收敛到 5 位小数（numeric(6,5)：最大 9.99999），
 * 以保证 10 次渲染结果可稳定比较（B02）。
 */
export function computeDirtyArea(
  previous: Uint8Array,
  current: Uint8Array,
): DirtyAreaResult {
  assertSameLength(previous, current);

  let changedPixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const base = y * BYTES_PER_ROW;
    for (let xByte = 0; xByte < BYTES_PER_ROW; xByte++) {
      const diff = previous[base + xByte]! ^ current[base + xByte]!;
      if (diff === 0) continue;

      // 逐 bit 统计（popcount），同时把 x 范围收窄到真实变化像素
      let bits = diff;
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits); // 最低置位的位序号 0..7
        bits &= bits - 1;
        changedPixels++;
        const x = xByte * 8 + (7 - bit);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const totalPixels = SCREEN_WIDTH * SCREEN_HEIGHT;
  const changedRatio =
    Math.round((changedPixels / totalPixels) * 100000) / 100000;

  if (changedPixels === 0) {
    return { changedPixels: 0, changedRatio: 0, dirtyRect: null };
  }

  // x 扩展到 8 像素边界（docs/06 §7）
  const alignedMinX = Math.floor(minX / 8) * 8;
  const alignedMaxX = Math.min(
    SCREEN_WIDTH - 1,
    (Math.floor(maxX / 8) + 1) * 8 - 1,
  );

  return {
    changedPixels,
    changedRatio,
    dirtyRect: {
      x: alignedMinX,
      y: minY,
      width: alignedMaxX - alignedMinX + 1,
      height: maxY - minY + 1,
    },
  };
}

// --- Refresh mode 推荐（docs/06 §8） ---

export type RefreshMode = "FULL" | "PARTIAL" | "FAST_FULL";

export interface RefreshPolicyInput {
  /** 设备是否首次上电显示（boot 首帧） */
  bootFirstFrame: boolean;
  /** 服务端/用户强制全刷 */
  forceFullRefresh: boolean;
  /** 距离上次全刷的小时数 */
  hoursSinceFullRefresh: number;
  /** 上次全刷后累计的局刷次数 */
  partialCount: number;
  /** 本帧相对上一帧的变化比例 */
  changedRatio: number;
  /** 面板是否支持局刷 */
  partialSupported: boolean;
  /** 阈值：超过则不再走局刷（docs/06 §8 默认 0.25） */
  partialAreaMaxRatio?: number;
  /** 阈值：局刷累计次数上限（docs/06 §8 默认 5） */
  partialMaxCount?: number;
  /** 阈值：强制全刷周期（docs/06 §8 默认 24 小时） */
  forceFullAfterHours?: number;
}

/**
 * docs/06 §8 决策树，逐条对应：
 * boot_first_frame → FULL；forceFullRefresh → FULL；>=24h → FULL；
 * partial_count >= 5 → FULL；changed_ratio <= 0.25 且支持局刷 → PARTIAL；否则 FAST_FULL。
 */
export function recommendRefreshMode(input: RefreshPolicyInput): RefreshMode {
  const {
    bootFirstFrame,
    forceFullRefresh,
    hoursSinceFullRefresh,
    partialCount,
    changedRatio,
    partialSupported,
    partialAreaMaxRatio = 0.25,
    partialMaxCount = 5,
    forceFullAfterHours = 24,
  } = input;

  if (bootFirstFrame) return "FULL";
  if (forceFullRefresh) return "FULL";
  if (hoursSinceFullRefresh >= forceFullAfterHours) return "FULL";
  if (partialCount >= partialMaxCount) return "FULL";
  if (changedRatio <= partialAreaMaxRatio && partialSupported) return "PARTIAL";
  return "FAST_FULL";
}
