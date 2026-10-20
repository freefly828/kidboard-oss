/**
 * 兑换核销 / 驳回（D-012）。
 * PATCH /api/v1/children/[childId]/redemptions/[redemptionId] { status: "fulfilled" | "rejected" }
 *       guardian+；仅 pending 可处理。驳回 → 退回积分（kind=refund）并恢复库存。
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger, rewardRedemptions, rewards } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { redemptionDecisionSchema } from "@/lib/schemas";
import { getBalance } from "@/lib/points";

type Params = { params: Promise<{ childId: string; redemptionId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, redemptionId } = await params;
    const { child, user } = await requireChildAccess(childId, "guardian");
    const body = redemptionDecisionSchema.parse(await req.json());

    const result = await db.transaction(async (tx) => {
      const r = (
        await tx
          .select()
          .from(rewardRedemptions)
          .where(and(eq(rewardRedemptions.id, redemptionId), eq(rewardRedemptions.childId, child.id)))
          .for("update")
          .limit(1)
      )[0];
      if (!r) throw new ApiError(404, "not_found", "Redemption not found");
      if (r.status !== "pending") throw new ApiError(409, "already_decided", "该兑换已处理");

      const [updated] = await tx
        .update(rewardRedemptions)
        .set({ status: body.status, decidedBy: user.id, decidedAt: new Date() })
        .where(eq(rewardRedemptions.id, r.id))
        .returning();

      if (body.status === "rejected") {
        await tx.insert(pointLedger).values({
          childId: child.id,
          delta: r.cost,
          kind: "refund",
          reason: `兑换「${r.rewardTitle}」被驳回，退回积分`,
          redemptionId: r.id,
          createdBy: user.id,
        });
        if (r.rewardId) {
          await tx
            .update(rewards)
            .set({ stock: sql`CASE WHEN ${rewards.stock} IS NULL THEN NULL ELSE ${rewards.stock} + 1 END` })
            .where(eq(rewards.id, r.rewardId));
        }
      }
      return { redemption: updated!, balance: await getBalance(child.id, tx) };
    });
    await bumpContentVersion(child.id); // D-018 积分页
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
