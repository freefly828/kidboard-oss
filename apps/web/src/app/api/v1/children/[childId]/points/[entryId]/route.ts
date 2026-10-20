/**
 * 撤销家长手动奖惩（D-026）：只允许撤销 10 分钟内的 manual 记录，用于"常用扣分"点错时撤回。
 * DELETE /api/v1/children/[childId]/points/[entryId]  guardian+
 */

import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { getBalance } from "@/lib/points";

type Params = { params: Promise<{ childId: string; entryId: string }> };

const UNDO_WINDOW_MINUTES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, entryId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    if (!UUID.test(entryId)) throw new ApiError(404, "not_found", "Entry not found");

    const result = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(pointLedger)
        .where(
          and(
            eq(pointLedger.id, entryId),
            eq(pointLedger.childId, child.id),
            eq(pointLedger.kind, "manual"),
            gte(pointLedger.createdAt, sql`now() - make_interval(mins => ${UNDO_WINDOW_MINUTES})`),
          ),
        )
        .returning({ id: pointLedger.id, delta: pointLedger.delta });
      if (deleted.length === 0) {
        throw new ApiError(409, "cannot_undo", `只能撤销 ${UNDO_WINDOW_MINUTES} 分钟内的手动奖惩`);
      }
      // 撤销奖励可能让余额变负（期间已兑换），此时不允许
      const balance = await getBalance(child.id, tx);
      if (balance < 0) throw new ApiError(409, "insufficient_points", "积分已被使用，无法撤销这条奖励");
      return { deleted: deleted[0], balance };
    });
    await bumpContentVersion(child.id);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
