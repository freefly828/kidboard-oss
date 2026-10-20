/**
 * 家庭成员管理（D-012）。
 * PATCH  /api/v1/family/members/[userId] { role }  owner
 * DELETE /api/v1/family/members/[userId]           owner 移除他人；任何成员可移除自己（退出家庭）
 * 家庭至少保留一位 owner。
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { familyMembers } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireCurrentFamily } from "@/lib/family";
import { memberRoleSchema } from "@/lib/schemas";

type Params = { params: Promise<{ userId: string }> };

type Executor = Pick<typeof db, "select">;

async function getMember(tx: Executor, familyId: string, userId: string) {
  const row = (
    await tx
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw new ApiError(404, "not_found", "Member not found");
  return row;
}

async function assertNotLastOwner(tx: Executor, familyId: string) {
  const owners = await tx
    .select({ userId: familyMembers.userId })
    .from(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.role, "owner")));
  if (owners.length <= 1) throw new ApiError(409, "last_owner", "家庭至少需要保留一位管理员（owner）");
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { userId } = await params;
    const { family } = await requireCurrentFamily("owner");
    const body = memberRoleSchema.parse(await req.json());
    await db.transaction(async (tx) => {
      const member = await getMember(tx, family.id, userId);
      if (member.role === "owner" && body.role !== "owner") await assertNotLastOwner(tx, family.id);
      await tx
        .update(familyMembers)
        .set({ role: body.role })
        .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.userId, userId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { userId } = await params;
    const { user, role, family } = await requireCurrentFamily();
    const isSelf = userId === user.id;
    if (!isSelf && role !== "owner") throw new ApiError(403, "forbidden", "Requires owner role");
    await db.transaction(async (tx) => {
      const member = await getMember(tx, family.id, userId);
      if (member.role === "owner") await assertNotLastOwner(tx, family.id);
      await tx
        .delete(familyMembers)
        .where(and(eq(familyMembers.familyId, family.id), eq(familyMembers.userId, userId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
