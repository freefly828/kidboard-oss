/**
 * 生成设备数字点阵字库（D-015 时钟 / D-019 专注倒计时）→ firmware/main/clock/*_font.h
 *
 * 用渲染服务同一套字体（Noto Sans CJK SC Bold）在 Chromium canvas 里画出 "0123456789:"，
 * 阈值二值化后输出 C 头文件，让设备画的时钟与服务端画面字体一致。
 *
 * 在 renderer 容器内运行（容器里有字体与 Chromium）：
 *   docker cp apps/renderer/scripts/gen-clock-font.mjs infra-renderer-1:/app/apps/renderer/gen-clock-font.mjs
 *   docker exec infra-renderer-1 node gen-clock-font.mjs 36 clockfont > firmware/main/clock/clock_font.h
 *   docker exec infra-renderer-1 node gen-clock-font.mjs 120 focusfont > firmware/main/clock/focus_font.h
 */

import { chromium } from "playwright-core";

const FONT_PX = Number(process.argv[2] ?? 36);
const NS = process.argv[3] ?? "clockfont";
const FONT = `700 ${FONT_PX}px "Noto Sans CJK SC","Source Han Sans SC",sans-serif`;
const CHARS = "0123456789:";

const browser = await chromium.launch({
  args: (process.env.CHROMIUM_ARGS ?? "--no-sandbox").split(",").filter(Boolean),
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");

const glyphs = await page.evaluate(
  async ({ FONT, CHARS }) => {
    await document.fonts.load(FONT);
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.font = FONT;
    // 数字等宽：取最宽数字的前进宽度，避免时间变化时整体左右抖动
    const digitAdvance = Math.ceil(Math.max(...[..."0123456789"].map((d) => ctx.measureText(d).width)));
    const out = [];
    for (const ch of CHARS) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#000";
      ctx.textBaseline = "alphabetic";
      const adv = ch === ":" ? Math.ceil(ctx.measureText(ch).width) : digitAdvance;
      const w = ctx.measureText(ch).width;
      ctx.fillText(ch, Math.round((adv - w) / 2) + 10, 200);
      const img = ctx.getImageData(10, 0, adv, 300).data;
      const rows = [];
      for (let y = 0; y < 300; y++) {
        const row = [];
        for (let x = 0; x < adv; x++) row.push(img[(y * adv + x) * 4] < 128 ? 1 : 0);
        rows.push(row);
      }
      out.push({ ch, adv, rows });
    }
    return out;
  },
  { FONT, CHARS },
);
await browser.close();

// 所有字形共用同一垂直范围（保持基线一致）
let top = 300;
let bottom = -1;
for (const g of glyphs) {
  g.rows.forEach((r, y) => {
    if (r.some(Boolean)) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  });
}
const height = bottom - top + 1;

const lines = [];
lines.push(`// 由 apps/renderer/scripts/gen-clock-font.mjs ${FONT_PX} ${NS} 生成，请勿手改（设备数字字库）`);
lines.push(`// 字体 ${FONT}；1 = 墨（黑），行优先，每行 ceil(width/8) 字节，MSB 在左`);
lines.push("#pragma once");
lines.push("#include <cstdint>");
lines.push("");
lines.push("namespace kidboard {");
lines.push(`namespace ${NS} {`);
lines.push("");
lines.push(`constexpr int kHeight = ${height};`);
lines.push("");
lines.push("struct Glyph {");
lines.push("    char ch;");
lines.push("    uint8_t width;");
lines.push("    const uint8_t* bits;");
lines.push("};");
lines.push("");
for (const [i, g] of glyphs.entries()) {
  const bpr = Math.ceil(g.adv / 8);
  const bytes = [];
  for (let y = top; y <= bottom; y++) {
    const r = g.rows[y];
    for (let b = 0; b < bpr; b++) {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        const x = b * 8 + k;
        if (x < g.adv && r[x]) v |= 0x80 >> k;
      }
      bytes.push(`0x${v.toString(16).padStart(2, "0")}`);
    }
  }
  lines.push(`// '${g.ch}' ${g.adv}x${height}`);
  lines.push(`inline constexpr uint8_t kBits${i}[] = {`);
  for (let j = 0; j < bytes.length; j += 12) lines.push(`    ${bytes.slice(j, j + 12).join(", ")},`);
  lines.push("};");
}
lines.push("");
lines.push("inline constexpr Glyph kGlyphs[] = {");
for (const [i, g] of glyphs.entries()) lines.push(`    {'${g.ch}', ${g.adv}, kBits${i}},`);
lines.push("};");
lines.push("");
lines.push(`} // namespace ${NS}`);
lines.push("} // namespace kidboard");
process.stdout.write(lines.join("\n") + "\n");
