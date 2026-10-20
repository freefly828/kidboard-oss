import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@kidboard/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Phase 0 验收: docker compose up 后 health 全绿。
 * 全绿 = web 存活 + 数据库连通。
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {
    web: { ok: true },
  };

  let dbOk = false;
  let dbDetail: string | undefined;
  const start = Date.now();
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    dbDetail = `${Date.now() - start}ms`;
  } catch (err) {
    dbDetail = err instanceof Error ? err.message : String(err);
  }
  checks.database = { ok: dbOk, detail: dbDetail };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      time: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
