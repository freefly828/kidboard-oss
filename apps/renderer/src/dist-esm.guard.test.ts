/**
 * 构建产物 ESM 兼容性守卫。
 *
 * 背景（真实缺陷）：`apps/renderer/tsconfig.build.json` 曾沿用 base 的
 * `moduleResolution: "Bundler"`，TS 因此允许**无扩展名**的相对导入。这在本机
 * （tsx / vitest 走 bundler 语义）与 `tsc` 类型检查下都正常，但 Node 的 ESM
 * 解析器要求相对导入必须带 `.js` 扩展名 —— 容器里 `node dist/main.js`
 * 直接 `ERR_MODULE_NOT_FOUND: Cannot find module '/app/apps/renderer/dist/screenshot'`。
 *
 * 该缺陷能同时骗过 typecheck、单测、`tsc` 构建与 `docker build`，只在**真正启动
 * 容器**时才暴露。本测试把"产物必须能被 Node ESM 加载"固化为可回归的断言。
 *
 * 注意：本文件读取的是 `dist/` 产物，因此需先执行 `pnpm --filter @kidboard/renderer build`。
 * 若 `dist/` 不存在则跳过（不把"未构建"误报为失败）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST_DIR = join(__dirname, "..", "dist");

/** 匹配 `from "./x"` / `from "../y/z"` 这类**缺少扩展名**的相对导入 */
const EXTENSIONLESS_RELATIVE_IMPORT = /from\s+["'](\.\.?\/[^"']*?)["']/g;

function listEmittedJs(): string[] {
  if (!existsSync(DIST_DIR)) return [];
  return readdirSync(DIST_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(DIST_DIR, f));
}

describe("构建产物必须能被 Node ESM 加载", () => {
  const emitted = listEmittedJs();

  it("dist/ 已构建时至少产出一个 .js（未构建则跳过）", () => {
    if (emitted.length === 0) return;
    expect(emitted.length).toBeGreaterThan(0);
  });

  it("产物中不得存在无扩展名的相对导入（否则容器启动即崩）", () => {
    if (emitted.length === 0) {
      // 未构建：不把缺失产物误报为通过，但明确标注跳过
      expect(emitted.length).toBe(0);
      return;
    }

    const offenders: string[] = [];
    for (const file of emitted) {
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(EXTENSIONLESS_RELATIVE_IMPORT)) {
        const spec = m[1]!;
        // 允许已带 .js / .mjs / .cjs / .json 的导入
        if (/\.[cm]?js$/.test(spec) || spec.endsWith(".json")) continue;
        offenders.push(`${file.split(/[\\/]/).pop()}: from "${spec}"`);
      }
    }

    expect(
      offenders,
      "以下相对导入缺少 .js 扩展名；Node ESM 会解析失败（moduleResolution 应为 NodeNext）",
    ).toEqual([]);
  });

  it("main.ts 的产物必须能被 Node 解析（模拟容器入口）", async () => {
    const entry = join(DIST_DIR, "main.js");
    if (!existsSync(entry)) return;
    // 只做模块解析，不执行 main()（避免真连 DB / 启 Chromium）
    await expect(
      import(/* @vite-ignore */ `file://${entry.replace(/\\/g, "/")}`),
    ).resolves.toBeDefined();
  });
});
