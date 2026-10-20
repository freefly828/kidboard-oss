/**
 * 兑换申请（D-012）。
 * GET  /api/v1/children/[childId]/redemptions?status=pending → { redemptions[] }  viewer+
 * POST /api/v1/children/[childId]/redemptions { rewardId }  guardian+
 *      校验上架、库存、余额；同事务：建 pending 兑换、扣积分（kind=redeem）、库存 -1。
 */

import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger, rewardRedemptions, rewards, users } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { redemptionCreateSchema } from "@/lib/schemas";
import { getBalance } from "@/lib/points";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const status = new URL(req.url).searchParams.get("status");
    const rows = await db
      .select({
        id: rewardRedemptions.id,
        rewardId: rewardRedemptions.rewardId,
        rewardTitle: rewardRedemptions.rewardTitle,
        icon: rewards.icon,
        cost: rewardRedemptions.cost,
        status: rewardRedemptions.status,
        createdAt: rewardRedemptions.createdAt,
        decidedAt: rewardRedemptions.decidedAt,
        requestedByName: users.displayName,
      })
      .from(rewardRedemptions)
      .leftJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
      .leftJoin(users, eq(users.id, rewardRedemptions.requestedBy))
      .where(
        status
          ? and(eq(rewardRedemptions.childId, child.id), eq(rewardRedemptions.status, status))
          : eq(rewardRedemptions.childId, child.id),
      )
      .orderBy(desc(rewardRedemptions.createdAt))
      .limit(100);
    return NextResponse.json({ redemptions: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child, user } = await requireChildAccess(childId, "guardian");
    const body = redemptionCreateSchema.parse(await req.json());

    const result = await db.transaction(async (tx) => {
      const reward = (
        await tx
          .select()
          .from(rewards)
          .where(and(eq(rewards.id, body.rewardId), eq(rewards.familyId, child.familyId)))
          .for("update")
          .limit(1)
      )[0];
      if (!reward || !reward.active) throw new ApiError(404, "not_found", "奖品不存在或已下架");
      if (reward.stock !== null && reward.stock <= 0) throw new ApiError(409, "out_of_stock", "奖品库存不足");

      const balance = await getBalance(child.id, tx);
      if (balance < reward.cost) {
        throw new ApiError(400, "insufficient_points", `积分不足：需要 ${reward.cost} 分，当前 ${balance} 分`);
      }

      const [redemption] = await tx
        .insert(rewardRedemptions)
        .values({
          childId: child.id,
          rewardId: reward.id,
          rewardTitle: reward.title,
          cost: reward.cost,
          status: "pending",
          requestedBy: user.id,
        })
        .returning();
      await tx.insert(pointLedger).values({
        childId: child.id,
        delta: -reward.cost,
        kind: "redeem",
        reason: `兑换「${reward.title}」`,
        redemptionId: redemption!.id,
        createdBy: user.id,
      });
      if (reward.stock !== null) {
        await tx
          .update(rewards)
          .set({ stock: sql`${rewards.stock} - 1`, updatedAt: new Date() })
          .where(eq(rewards.id, reward.id));
      }
      return { redemption: redemption!, balance: balance - reward.cost };
    });
    await bumpContentVersion(child.id); // D-018 积分页
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
