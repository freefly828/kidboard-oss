/**
 * 心愿奖品 API（D-012）— 奖品属于家庭，经孩子上下文访问（复用 requireChildAccess 鉴权）。
 * GET  /api/v1/children/[childId]/rewards?all=1 → { rewards[] }（默认只返回上架中）
 * POST /api/v1/children/[childId]/rewards { title, icon?, cost, stock?, active? }  guardian+
 */

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { rewards } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpFamilyChildren } from "@/lib/content-version";
import { rewardSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const all = new URL(req.url).searchParams.get("all") === "1";
    const rows = await db
      .select()
      .from(rewards)
      .where(all ? eq(rewards.familyId, child.familyId) : and(eq(rewards.familyId, child.familyId), eq(rewards.active, true)))
      .orderBy(asc(rewards.cost), asc(rewards.createdAt));
    return NextResponse.json({ rewards: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = rewardSchema.parse(await req.json());
    const [row] = await db
      .insert(rewards)
      .values({
        familyId: child.familyId,
        title: body.title,
        icon: body.icon ?? null,
        cost: body.cost,
        stock: body.stock ?? null,
        active: body.active,
      })
      .returning();
    await bumpFamilyChildren(child.familyId); // D-018 积分页心愿清单
    return NextResponse.json({ reward: row }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
