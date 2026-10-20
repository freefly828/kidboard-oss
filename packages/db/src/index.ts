// @kidboard/db — 统一导出 drizzle 实例与 schema。
// 应用代码从 "@kidboard/db" 导入 { db, schema }。

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schemaNamespace from "./schema";

export * from "./schema";
export const schema = schemaNamespace;

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://kidboard:kidboard@localhost:5432/kidboard";

/** 原生 postgres 客户端（需要底层 SQL 时使用） */
export const client = postgres(connectionString, { max: 10 });

/** drizzle 实例 */
export const db = drizzle(client, { schema: schemaNamespace });
