/**
 * PNG → RawImage 解码。
 *
 * 使用 pngjs（纯 JS，无原生编译），因此 Windows 与 alpine 容器行为一致。
 * pngjs 不自带类型声明，类型见同目录 pngjs.d.ts（本地最小子集，不引入 @types 依赖）。
 *
 * 只接受 8-bit RGBA/RGB/灰度 PNG；Chromium 截图固定输出 RGBA。
 */

import { PNG, type PngInstance } from "pngjs";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type RawImage } from "@kidboard/screen-template";

export class PngDecodeError extends Error {}

/**
 * 解码 PNG 为 RGBA RawImage。
 *
 * 只支持 8-bit 色深（Chromium 截图满足）。如果出现 16-bit 会显式报错，
 * 而不是静默截断产生错误的帧。
 *
 * 重要：pngjs 的 `data` **始终是 4 字节/像素的 RGBA**，与源文件的 colorType 无关
 * （见 pngjs/lib/bitmapper.js：RGB(2) 分支也会补 0xff alpha；灰度(0) 分支会三通道复制）。
 * 因此这里必须无条件按 4 字节步长读取，**不能**按 colorType 切换 3/1/2 字节步长——
 * 那样读出来的缓冲区整体错位，会静默产出与真实画面不符的帧。
 */
export function decodePngToRawImage(png: Buffer): RawImage {
  let parsed: PngInstance;
  try {
    parsed = PNG.sync.read(png);
  } catch (err) {
    throw new PngDecodeError(
      `failed to decode PNG: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { width, height, data, depth } = parsed;
  if (depth !== 8) {
    throw new PngDecodeError(`unsupported PNG bit depth ${depth}, expected 8`);
  }
  if (width !== SCREEN_WIDTH || height !== SCREEN_HEIGHT) {
    throw new PngDecodeError(
      `PNG must be ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, got ${width}x${height}`,
    );
  }

  const expected = width * height * 4;
  if (data.length !== expected) {
    throw new PngDecodeError(
      `pngjs returned ${data.length} bytes, expected ${expected} (RGBA ${width}x${height})`,
    );
  }

  return { width, height, data: new Uint8Array(data) };
}
