/**
 * 修复 pnpm 隔离模式下的 node_modules/.bin 垫片。
 *
 * 场景：受限环境（安全策略拦截批量删除）导致 `pnpm install` 在重建
 * node_modules 时中断，依赖符号链接仍在，但各包的 .bin 目录丢失，
 * 于是 `pnpm -r typecheck` 报 "'tsc' 不是内部或外部命令"。
 *
 * 本脚本按已有符号链接重新生成 .bin 垫片，避免重装整棵依赖树。
 * 用法: node scripts/fix-bin-shims.mjs
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const packages = [
  "packages/db",
  "packages/screen-template",
  "packages/tsconfig",
  "apps/web",
  "apps/renderer",
  "apps/device-simulator",
];

/** 读取某依赖包声明的 bin 入口；返回 { binName: 相对路径 } */
function readBins(depDir) {
  const pkgJson = join(depDir, "package.json");
  if (!existsSync(pkgJson)) return {};
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
  } catch {
    return {};
  }
  if (!pkg.bin) return {};
  if (typeof pkg.bin === "string") {
    return { [pkg.name.replace(/^@[^/]+\//, "")]: pkg.bin };
  }
  return pkg.bin;
}

function writeShim(binDir, name, target) {
  const rel = relative(binDir, target);
  const posixRel = rel.split("\\").join("/");
  const winRel = rel.split("/").join("\\");

  if (process.platform === "win32") {
    writeFileSync(
      join(binDir, `${name}.cmd`),
      `@ECHO off\r\nSETLOCAL\r\nSET "_prog=node"\r\nIF EXIST "%~dp0node.exe" SET "_prog=%~dp0node.exe"\r\n"%_prog%" "%~dp0${winRel}" %*\r\n`,
    );
    writeFileSync(
      join(binDir, `${name}.ps1`),
      `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) { $exe=".exe" }\n$ret=0\n& node "$basedir/${posixRel}" $args\nif ($LASTEXITCODE -is [int]) { exit $LASTEXITCODE }\nexit $ret\n`,
    );
  }
  writeFileSync(
    join(binDir, name),
    `#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/${posixRel}" "$@"\nelse\n  exec node  "$basedir/${posixRel}" "$@"\nfi\n`,
  );
  try {
    chmodSync(join(binDir, name), 0o755);
  } catch {
    /* Windows 上 chmod 可能无效，忽略 */
  }
}

/** 收集 node_modules 下所有直接依赖（含 @scope/*）的目录名 */
function directDeps(nm) {
  const out = [];
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith(".")) continue;
    const full = join(nm, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink() && !st.isDirectory()) continue;
    if (st.isSymbolicLink() && !existsSync(full)) continue;
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(full)) {
        const subFull = join(full, sub);
        if (existsSync(subFull)) out.push(subFull);
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

let created = 0;
for (const pkgDirRel of packages) {
  const nm = join(root, pkgDirRel, "node_modules");
  if (!existsSync(nm)) continue;
  const binDir = join(nm, ".bin");
  mkdirSync(binDir, { recursive: true });

  for (const depDir of directDeps(nm)) {
    const bins = readBins(depDir);
    for (const [binName, binRel] of Object.entries(bins)) {
      const target = join(depDir, binRel);
      if (!existsSync(target)) continue;
      writeShim(binDir, binName, target);
      created++;
    }
  }
  console.warn(`fixed .bin for ${pkgDirRel}`);
}
console.warn(`total shims created: ${created}`);
