/**
 * 帧编码 — 二值化 + 1-bit 打包（冻结契约，docs/06 §4 §5）。
 *
 * 契约要点（不得修改）：
 * - 画布 800×480，每行 800/8 = 100 bytes，总 payload 恰好 48,000 bytes；
 * - 二值化固定阈值（默认 160）→ 黑 = 0 / 白 = 1；
 * - 按行、MSB first 打包：byte 0 = 第 0 行 x=0..7，bit7 对应最左像素；
 * - V1 不使用 Floyd-Steinberg dithering（文字 UI 需要边缘稳定）。
 *
 * 本模块是纯函数，放在 screen-template 包内，供 renderer 复用（避免 renderer
 * 反向依赖 @kidboard/db 之外的私有实现）；不依赖 PNG 解析库，输入为 RGBA 像素。
 */

import { FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "./types";

/** 行字节数 = 800 / 8 = 100 */
export const BYTES_PER_ROW = SCREEN_WIDTH / 8;

/** 默认二值化阈值（docs/06 §4） */
export const DEFAULT_THRESHOLD = 160;

/**
 * ITU-R BT.601 luma 系数的整数形式（299/587/114，总和 1000）。
 * 用整数避免浮点在不同平台/CPU 上的舍入差异 —— B02 要求同 VM 渲染 10 次
 * SHA-256 完全一致，因此管线中不允许出现不确定的浮点运算。
 */
const LUMA_R = 299;
const LUMA_G = 587;
const LUMA_B = 114;

export class FrameEncodeError extends Error {}

export interface RawImage {
  width: number;
  height: number;
  /** RGBA，长度必须为 width*height*4 */
  data: Uint8Array;
}

/**
 * 灰阶 + 阈值二值化 + MSB first 打包。
 *
 * 灰度按 luma 计算；`gray < threshold` 记为黑(0)，否则白(1)。
 */
export function binarizeToFrame(
  img: RawImage,
  threshold: number = DEFAULT_THRESHOLD,
): Uint8Array {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new FrameEncodeError(
      `threshold must be an integer in 0..255, got ${threshold}`,
    );
  }
  if (img.width !== SCREEN_WIDTH || img.height !== SCREEN_HEIGHT) {
    throw new FrameEncodeError(
      `image must be ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, got ${img.width}x${img.height}`,
    );
  }
  const expected = SCREEN_WIDTH * SCREEN_HEIGHT * 4;
  if (img.data.length !== expected) {
    throw new FrameEncodeError(
      `RGBA data must be ${expected} bytes, got ${img.data.length}`,
    );
  }

  const out = new Uint8Array(FRAME_BYTES);
  const { data } = img;

  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const rowBase = y * SCREEN_WIDTH * 4;
    const outBase = y * BYTES_PER_ROW;
    for (let xByte = 0; xByte < BYTES_PER_ROW; xByte++) {
      let byte = 0;
      for (let bit = 7; bit >= 0; bit--) {
        const x = xByte * 8 + (7 - bit); // bit7 → 最左像素
        const p = rowBase + x * 4;
        const luma =
          (LUMA_R * data[p]! + LUMA_G * data[p + 1]! + LUMA_B * data[p + 2]!) /
          1000;
        // 黑 = 0, 白 = 1；仅当严格小于阈值才算黑
        const white = luma < threshold ? 0 : 1;
        byte = (byte << 1) | white;
      }
      out[outBase + xByte] = byte;
    }
  }

  return out;
}

/** 断言冻结尺寸：48,000 bytes */
export function assertFrameSize(bytes: Uint8Array): void {
  if (bytes.length !== FRAME_BYTES) {
    throw new FrameEncodeError(
      `frame.bin must be exactly ${FRAME_BYTES} bytes, got ${bytes.length}`,
    );
  }
}

/**
 * 解码回灰阶矩阵 —— 仅供测试与 preview 诊断使用，不参与生产帧生成。
 * 返回 0(黑) / 255(白) 的 800×480 灰度数组。
 */
export function decodeFrameToGray(frame: Uint8Array): Uint8Array {
  assertFrameSize(frame);
  const out = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const rowBase = y * BYTES_PER_ROW;
    const outBase = y * SCREEN_WIDTH;
    for (let xByte = 0; xByte < BYTES_PER_ROW; xByte++) {
      const byte = frame[rowBase + xByte]!;
      for (let bit = 7; bit >= 0; bit--) {
        const x = xByte * 8 + (7 - bit);
        const white = (byte >> bit) & 1;
        out[outBase + x] = white ? 255 : 0;
      }
    }
  }
  return out;
}
