/**
 * 积分账本 API（D-012）。
 * GET  /api/v1/children/[childId]/points?limit=50 → { balance, earnedThisWeek, ledger[] }
 *      viewer+。本周 = 孩子时区的周一 00:00 起（按日期比较）。
 * POST /api/v1/children/[childId]/points { delta, reason }
 *      guardian+；家长手动奖惩；扣分不允许把余额扣成负数。
 */

import { NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger, users } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { manualPointsSchema } from "@/lib/schemas";
import { getBalance } from "@/lib/points";
import { mondayOf, todayFor } from "@/lib/dates";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
    const weekStart = mondayOf(todayFor(child.timezone));

    const [balance, weekRows, ledger] = await Promise.all([
      getBalance(child.id),
      db
        .select({ total: sql<string | null>`sum(${pointLedger.delta})` })
        .from(pointLedger)
        .where(
          and(
            eq(pointLedger.childId, child.id),
            gt(pointLedger.delta, 0),
            sql`(${pointLedger.createdAt} AT TIME ZONE ${child.timezone})::date >= ${weekStart}::date`,
          ),
        ),
      db
        .select({
          id: pointLedger.id,
          delta: pointLedger.delta,
          kind: pointLedger.kind,
          reason: pointLedger.reason,
          createdAt: pointLedger.createdAt,
          createdByName: users.displayName,
        })
        .from(pointLedger)
        .leftJoin(users, eq(users.id, pointLedger.createdBy))
        .where(eq(pointLedger.childId, child.id))
        .orderBy(desc(pointLedger.createdAt))
        .limit(limit),
    ]);

    return NextResponse.json({
      balance,
      earnedThisWeek: Number(weekRows[0]?.total ?? 0),
      ledger,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child, user } = await requireChildAccess(childId, "guardian");
    const body = manualPointsSchema.parse(await req.json());

    const result = await db.transaction(async (tx) => {
      if (body.delta < 0) {
        const balance = await getBalance(child.id, tx);
        if (balance + body.delta < 0) {
          throw new ApiError(400, "insufficient_points", `积分不足：当前 ${balance} 分`);
        }
      }
      const [row] = await tx
        .insert(pointLedger)
        .values({ childId: child.id, delta: body.delta, kind: "manual", reason: body.reason, createdBy: user.id })
        .returning();
      return { entry: row!, balance: await getBalance(child.id, tx) };
    });
    await bumpContentVersion(child.id); // D-018 积分页
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
