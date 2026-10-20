/* eslint-disable no-console */
/**
 * 构建后处理：为 `dist/**\/*.js` 中的相对导入补上 `.js` 扩展名。
 *
 * 背景（真实缺陷）：
 * 本仓库 `packages/tsconfig` 用 `moduleResolution: "Bundler"` —— 这是 Next.js 侧的
 * 正确选择，但它允许**无扩展名**的相对导入。renderer 编译成 `dist/` 后由
 * `node dist/main.js` 启动，而 Node 的 ESM 解析器**要求**相对导入带扩展名，
 * 否则报 `ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/screenshot'`。
 *
 * 这个缺陷能同时骗过：`tsc --noEmit`（类型对）、vitest（走 bundler 语义）、
 * `tsc -p tsconfig.build.json`（产物语法合法）、`docker build`（只编译不启动）。
 * 唯一暴露点是**真正把容器跑起来**。因此这里做一次显式后处理，而不是把
 * 整个 workspace 切到 `NodeNext`（那会让 `@kidboard/*` 以 TS 源码形式的
 * 跨包导入全面报 TS2835，波及 web/Next 侧，代价远大于收益）。
 *
 * 用法：pnpm --filter @kidboard/renderer build（build 脚本已链接本步骤）
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "apps", "renderer", "dist");

/** 相对导入/导出语句中的模块说明符 */
const RELATIVE_SPECIFIER =
  /(\bfrom\s+|\bimport\s*\(\s*|\bexport\s+\*\s+from\s+)(["'])(\.\.?\/[^"']*)\2/g;

/** 已有的显式扩展名不重复添加 */
const HAS_EXTENSION = /\.[cm]?js$|\.[cm]?js\?|\.[jt]sx?$|\.json$/;

function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function patchFile(file) {
  const original = readFileSync(file, "utf8");
  let changed = 0;

  const patched = original.replace(
    RELATIVE_SPECIFIER,
    (match, keyword, quote, spec) => {
      if (HAS_EXTENSION.test(spec)) return match;
      // 目录索引导入（./foo/）按 Node ESM 需显式 /index.js 才能解析；
      // 本项目未使用该形式，遇到时明确报错而不是产出坏产物。
      if (spec.endsWith("/")) {
        throw new Error(
          `${file}: 不支持目录索引导入 "${spec}"，请改为显式文件路径`,
        );
      }
      changed++;
      return `${keyword}${quote}${spec}.js${quote}`;
    },
  );

  if (changed > 0) writeFileSync(file, patched, "utf8");
  return changed;
}

function main() {
  let files;
  try {
    files = collectJsFiles(distDir);
  } catch {
    console.error(`[fix-esm-ext] dist 目录不存在：${distDir}，请先执行 tsc 构建`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`[fix-esm-ext] dist 目录为空：${distDir}`);
    process.exit(1);
  }

  let total = 0;
  for (const f of files) total += patchFile(f);
  console.log(
    `[fix-esm-ext] 已处理 ${files.length} 个产物文件，补全 ${total} 处相对导入扩展名`,
  );
}

main();
