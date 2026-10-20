/**
 * 帧编码测试 — B01（尺寸）+ 位序黄金值（docs/06 §5）。
 * 这些断言锁定冻结契约，任何回归必须在此失败。
 */

import { describe, expect, it } from "vitest";
import {
  assertFrameSize,
  binarizeToFrame,
  BYTES_PER_ROW,
  decodeFrameToGray,
  DEFAULT_THRESHOLD,
  FrameEncodeError,
  type RawImage,
} from "./frame";
import { FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "./types";

function fullWhite(): RawImage {
  const data = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  data.fill(255);
  return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, data };
}

/** 把 (x,y) 设为纯黑 */
function setBlack(img: RawImage, x: number, y: number): void {
  const p = (y * SCREEN_WIDTH + x) * 4;
  img.data[p] = 0;
  img.data[p + 1] = 0;
  img.data[p + 2] = 0;
  img.data[p + 3] = 255; // alpha 不参与 luma，但保持不透明
}

describe("B01 尺寸（冻结契约 docs/06 §1）", () => {
  it("常量与契约一致", () => {
    expect(SCREEN_WIDTH).toBe(800);
    expect(SCREEN_HEIGHT).toBe(480);
    expect(BYTES_PER_ROW).toBe(100);
    expect(FRAME_BYTES).toBe(48_000);
  });

  it("全白图输出恰好 48,000 bytes", () => {
    const frame = binarizeToFrame(fullWhite());
    expect(frame.length).toBe(48_000);
    assertFrameSize(frame);
  });

  it("全白图每个 bit 均为 1（白=1）", () => {
    const frame = binarizeToFrame(fullWhite());
    expect(frame.every((b) => b === 0xff)).toBe(true);
  });

  it("全黑图每个 bit 均为 0（黑=0）", () => {
    const img = fullWhite();
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) setBlack(img, x, y);
    }
    const frame = binarizeToFrame(img);
    expect(frame.length).toBe(48_000);
    expect(frame.every((b) => b === 0x00)).toBe(true);
  });

  it("尺寸不符时抛错而不是静默产出错长度", () => {
    expect(() =>
      binarizeToFrame({ width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) }),
    ).toThrow(FrameEncodeError);
    expect(() => assertFrameSize(new Uint8Array(47_999))).toThrow(FrameEncodeError);
  });
});

describe("位序黄金值（冻结契约 docs/06 §5）", () => {
  it("(0,0) 单像素黑 → byte0 = 0b0111_1111 (bit7 是最左像素)", () => {
    const img = fullWhite();
    setBlack(img, 0, 0);
    const frame = binarizeToFrame(img);
    expect(frame[0]).toBe(0b0111_1111);
    // 行内其余 byte 保持全白
    for (let i = 1; i < BYTES_PER_ROW; i++) expect(frame[i]).toBe(0xff);
    // 第 1 行未受影响
    expect(frame[BYTES_PER_ROW]).toBe(0xff);
  });

  it("(7,0) 单像素黑 → byte0 = 0b1111_1110 (bit0 是第 8 个像素)", () => {
    const img = fullWhite();
    setBlack(img, 7, 0);
    const frame = binarizeToFrame(img);
    expect(frame[0]).toBe(0b1111_1110);
  });

  it("(8,0) 单像素黑 → 落在 byte1 的 bit7", () => {
    const img = fullWhite();
    setBlack(img, 8, 0);
    const frame = binarizeToFrame(img);
    expect(frame[0]).toBe(0xff);
    expect(frame[1]).toBe(0b0111_1111);
  });

  it("(0,1) 单像素黑 → 落在第 2 行首 byte（row-major）", () => {
    const img = fullWhite();
    setBlack(img, 0, 1);
    const frame = binarizeToFrame(img);
    expect(frame[0]).toBe(0xff);
    expect(frame[BYTES_PER_ROW]).toBe(0b0111_1111);
    expect(frame[BYTES_PER_ROW * 2]).toBe(0xff);
  });

  it("最后一像素 (799,479) 落在最后一个 byte 的 bit0", () => {
    const img = fullWhite();
    setBlack(img, 799, 479);
    const frame = binarizeToFrame(img);
    expect(frame[47_999]).toBe(0b1111_1110);
    expect(frame[47_998]).toBe(0xff);
  });

  it("全黑/全白两帧逐字节互补（0xff ^ 0x00），确认位值语义 1=白 / 0=黑", () => {
    const white = binarizeToFrame(fullWhite());
    const blackImg = fullWhite();
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) setBlack(blackImg, x, y);
    }
    const black = binarizeToFrame(blackImg);
    let differingBytes = 0;
    for (let i = 0; i < FRAME_BYTES; i++) {
      if (white[i] !== black[i]) differingBytes++;
    }
    // 每个 byte 都不相同，且逐字节互补
    expect(differingBytes).toBe(FRAME_BYTES);
    for (let i = 0; i < FRAME_BYTES; i++) {
      expect(white[i]! ^ black[i]!).toBe(0xff);
    }
  });
});

describe("阈值二值化（docs/06 §4）", () => {
  it("默认阈值 160", () => {
    expect(DEFAULT_THRESHOLD).toBe(160);
  });

  it("灰度 159 → 黑(0)；160 → 白(1)（严格小于为黑）", () => {
    const img = fullWhite();
    const p = 0;
    img.data[p] = 159;
    img.data[p + 1] = 159;
    img.data[p + 2] = 159;
    expect(binarizeToFrame(img)[0]! & 0b1000_0000).toBe(0);

    const img2 = fullWhite();
    img2.data[p] = 160;
    img2.data[p + 1] = 160;
    img2.data[p + 2] = 160;
    expect(binarizeToFrame(img2)[0]! & 0b1000_0000).toBe(0b1000_0000);
  });

  it("阈值可配置（0～255）；非法阈值抛错", () => {
    const img = fullWhite();
    img.data[0] = 200;
    img.data[1] = 200;
    img.data[2] = 200;
    expect(binarizeToFrame(img, 160)[0]! & 0b1000_0000).toBe(0b1000_0000); // 200 ≥ 160 → 白
    expect(binarizeToFrame(img, 210)[0]! & 0b1000_0000).toBe(0); // 200 < 210 → 黑
    for (const bad of [-1, 256, 1.5, Number.NaN]) {
      expect(() => binarizeToFrame(img, bad)).toThrow(FrameEncodeError);
    }
  });

  it("luma 采用 BT.601 加权（纯蓝比纯红更暗）", () => {
    const red = fullWhite();
    red.data[0] = 255;
    red.data[1] = 0;
    red.data[2] = 0;
    const blue = fullWhite();
    blue.data[0] = 0;
    blue.data[1] = 0;
    blue.data[2] = 255;
    // luma(red)=76.245, luma(blue)=29.07；阈值 50 时红=白、蓝=黑
    expect(binarizeToFrame(red, 50)[0]! & 0b1000_0000).toBe(0b1000_0000);
    expect(binarizeToFrame(blue, 50)[0]! & 0b1000_0000).toBe(0);
  });

  it("alpha 不参与判定（透明像素按 RGB 处理）", () => {
    const img = fullWhite();
    img.data[0] = 0;
    img.data[1] = 0;
    img.data[2] = 0;
    img.data[3] = 0; // 全透明但 RGB 是黑
    expect(binarizeToFrame(img)[0]! & 0b1000_0000).toBe(0);
  });
});

describe("decodeFrameToGray 往返", () => {
  it("打包后解码回灰度，黑白点位置一致", () => {
    const img = fullWhite();
    setBlack(img, 0, 0);
    setBlack(img, 799, 479);
    setBlack(img, 123, 45);
    const gray = decodeFrameToGray(binarizeToFrame(img));
    expect(gray[(0) * SCREEN_WIDTH + 0]).toBe(0);
    expect(gray[479 * SCREEN_WIDTH + 799]).toBe(0);
    expect(gray[45 * SCREEN_WIDTH + 123]).toBe(0);
    expect(gray[45 * SCREEN_WIDTH + 124]).toBe(255);
    expect(gray[0 * SCREEN_WIDTH + 1]).toBe(255);
  });
});

describe("B02 确定性前提（管线内无浮点不确定性）", () => {
  it("同一输入编码 10 次字节完全一致", () => {
    const img = fullWhite();
    setBlack(img, 3, 3);
    setBlack(img, 500, 200);
    const first = binarizeToFrame(img);
    for (let i = 0; i < 10; i++) {
      expect(binarizeToFrame(img)).toEqual(first);
    }
  });
});
