/**
 * 单个心愿奖品（D-012）。
 * PATCH  /api/v1/children/[childId]/rewards/[rewardId] { title?, icon?, cost?, stock?, active? }  guardian+
 * DELETE 同路径  guardian+；已有兑换记录保留奖品名快照（reward_id 置空）。
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { rewards } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpFamilyChildren } from "@/lib/content-version";
import { rewardUpdateSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string; rewardId: string }> };

async function findReward(familyId: string, rewardId: string) {
  const row = (
    await db.select().from(rewards).where(and(eq(rewards.id, rewardId), eq(rewards.familyId, familyId))).limit(1)
  )[0];
  if (!row) throw new ApiError(404, "not_found", "Reward not found");
  return row;
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, rewardId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = rewardUpdateSchema.parse(await req.json());
    await findReward(child.familyId, rewardId);
    const [row] = await db
      .update(rewards)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(rewards.id, rewardId))
      .returning();
    await bumpFamilyChildren(child.familyId); // D-018 积分页心愿清单
    return NextResponse.json({ reward: row });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, rewardId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    await findReward(child.familyId, rewardId);
    await db.delete(rewards).where(eq(rewards.id, rewardId));
    await bumpFamilyChildren(child.familyId); // D-018 积分页心愿清单
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
