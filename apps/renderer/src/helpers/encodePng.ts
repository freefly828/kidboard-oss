/**
 * 测试辅助：最小 PNG 编码器（无第三方依赖）。
 *
 * 用于在不启动 Chromium 的情况下构造可预测的 PNG 输入，验证 decodePngToRawImage。
 * 只实现 8-bit RGBA、无过滤（filter type 0）+ zlib 默认压缩，足够测试使用。
 */

import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 把 RGBA 像素编码为 8-bit RGBA PNG */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `rgba length ${rgba.length} does not match ${width}x${height} (expected ${width * height * 4})`,
    );
  }
  return buildPng(width, height, 6, width * 4, (y) =>
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4),
  );
}

/**
 * 把 RGBA 像素编码为 8-bit **RGB** PNG（colorType=2，丢弃 alpha）。
 *
 * 为什么需要它：Chromium 在不透明页面上输出的就是 colorType=2。
 * 而 pngjs 解码后**始终**返回 4 字节/像素的 RGBA，若调用方按源 colorType
 * 去推断步长（3 字节），读出的缓冲区会整体错位——这正是曾经静默产出错误帧的回归点。
 * 因此必须有一个 colorType=2 的用例把这条链路钉死。
 */
export function encodeRgbPng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `rgba length ${rgba.length} does not match ${width}x${height} (expected ${width * height * 4})`,
    );
  }
  return buildPng(width, height, 2, width * 3, (y) => {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) {
      const src = y * width * 4 + x * 4;
      row[x * 3] = rgba[src]!;
      row[x * 3 + 1] = rgba[src + 1]!;
      row[x * 3 + 2] = rgba[src + 2]!;
    }
    return row;
  });
}

function buildPng(
  width: number,
  height: number,
  colorType: number,
  rowBytes: number,
  rowOf: (y: number) => Buffer,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 原始扫描行：每行前加 1 byte filter type (0 = None)
  // 注意：rowBytes 是"每行像素数据字节数"（width × 通道数），不要再乘 width。
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + rowBytes);
    raw[dst] = 0;
    rowOf(y).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
