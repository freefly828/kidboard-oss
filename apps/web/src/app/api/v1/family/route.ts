/**
 * 当前家庭（D-012）。
 * GET   /api/v1/family → { family, myRole, members[], invitations[] }
 *       invitations 仅 owner 可见（未使用、未撤销、未过期）。
 * PATCH /api/v1/family { name }  owner
 */

import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@kidboard/db";
import { families, familyInvitations, familyMembers, users } from "@kidboard/db/schema";
import { jsonError } from "@/lib/auth-guard";
import { requireCurrentFamily } from "@/lib/family";
import { familyUpdateSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const { user, role, family } = await requireCurrentFamily();
    const members = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        role: familyMembers.role,
        joinedAt: familyMembers.createdAt,
      })
      .from(familyMembers)
      .innerJoin(users, eq(users.id, familyMembers.userId))
      .where(eq(familyMembers.familyId, family.id))
      .orderBy(asc(familyMembers.createdAt));

    const invitations =
      role === "owner"
        ? await db
            .select({
              id: familyInvitations.id,
              role: familyInvitations.role,
              expiresAt: familyInvitations.expiresAt,
              createdAt: familyInvitations.createdAt,
            })
            .from(familyInvitations)
            .where(
              and(
                eq(familyInvitations.familyId, family.id),
                isNull(familyInvitations.acceptedAt),
                isNull(familyInvitations.revokedAt),
                gt(familyInvitations.expiresAt, new Date()),
              ),
            )
            .orderBy(desc(familyInvitations.createdAt))
        : [];

    return NextResponse.json({
      family: { id: family.id, name: family.name },
      myRole: role,
      members: members.map((m) => ({ ...m, isMe: m.userId === user.id })),
      invitations,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const { family } = await requireCurrentFamily("owner");
    const body = familyUpdateSchema.parse(await req.json());
    const [row] = await db.update(families).set({ name: body.name }).where(eq(families.id, family.id)).returning();
    return NextResponse.json({ family: { id: row!.id, name: row!.name } });
  } catch (err) {
    return jsonError(err);
  }
}
