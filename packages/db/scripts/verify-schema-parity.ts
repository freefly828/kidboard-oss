/**
 * Schema 一致性校验：db/schema.sql（契约真相源） vs packages/db/src/schema.ts（Drizzle 实现）。
 * 用法: pnpm --filter @kidboard/db verify:parity
 * 退出码 0 = 每张表的列名集合完全一致; 1 = 存在差异（差异明细打印到 stdout）。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/schema";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const sqlPath = join(repoRoot, "db", "schema.sql");

/** 解析 schema.sql 中每张 CREATE TABLE 的列名（跳过表级约束行） */
function parseSqlColumns(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const tableRe = /CREATE TABLE (\w+)\s*\(([\s\S]*?)\);/g;
  const constraintPrefix =
    /^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|EXCLUDE|LIKE)\b/i;

  for (const match of sql.matchAll(tableRe)) {
    const tableName = match[1]!;
    const body = match[2]!;
    // 按括号深度 0 处的逗号切分列/约束定义
    const entries: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of body) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        entries.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) entries.push(current.trim());

    const columns = entries
      .filter((e) => !constraintPrefix.test(e))
      .map((e) => e.split(/[\s(]/)[0]!)
      .filter((w) => w.length > 0);
    tables.set(tableName, columns);
  }
  return tables;
}

function drizzleTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      const name = getTableName(value);
      const cols = Object.values(getTableColumns(value)).map((c) => c.name);
      tables.set(name, [...cols].sort());
    }
  }
  return tables;
}

const sqlTables = parseSqlColumns(readFileSync(sqlPath, "utf8"));
const ormTables = drizzleTables();

let failed = false;
const sqlNames = [...sqlTables.keys()].sort();
const ormNames = [...ormTables.keys()].sort();

if (sqlNames.join(",") !== ormNames.join(",")) {
  failed = true;
  const onlySql = sqlNames.filter((n) => !ormTables.has(n));
  const onlyOrm = ormNames.filter((n) => !sqlTables.has(n));
  if (onlySql.length) console.error("tables only in schema.sql:", onlySql);
  if (onlyOrm.length) console.error("tables only in drizzle schema:", onlyOrm);
}

for (const name of sqlNames) {
  const sqlCols = [...(sqlTables.get(name) ?? [])].sort();
  const ormCols = ormTables.get(name) ?? [];
  const missing = sqlCols.filter((c) => !ormCols.includes(c));
  const extra = ormCols.filter((c) => !sqlCols.includes(c));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`[${name}] mismatch:`);
    if (missing.length) console.error("  missing in drizzle:", missing);
    if (extra.length) console.error("  extra in drizzle:", extra);
  }
}

if (failed) {
  console.error("schema parity: FAILED");
  process.exit(1);
}
console.warn(
  `schema parity: OK — ${sqlNames.length} tables, column names identical between db/schema.sql and drizzle schema`,
);
