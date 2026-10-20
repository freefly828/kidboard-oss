/**
 * 创建家庭邀请码（D-012 / PRD F01）。
 * POST /api/v1/family/invitations { role: "guardian" | "viewer" }  owner
 *      → { invitation, code }；code 只在此返回一次，7 天有效、一次性。
 */

import { NextResponse } from "next/server";
import { db } from "@kidboard/db";
import { familyInvitations } from "@kidboard/db/schema";
import { jsonError } from "@/lib/auth-guard";
import { generateInviteCode, hashInviteCode, INVITE_TTL_DAYS, requireCurrentFamily } from "@/lib/family";
import { invitationCreateSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  try {
    const { user, family } = await requireCurrentFamily("owner");
    const body = invitationCreateSchema.parse(await req.json().catch(() => ({})));
    const code = generateInviteCode();
    const [invitation] = await db
      .insert(familyInvitations)
      .values({
        familyId: family.id,
        codeHash: hashInviteCode(code),
        role: body.role,
        createdBy: user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
      })
      .returning({
        id: familyInvitations.id,
        role: familyInvitations.role,
        expiresAt: familyInvitations.expiresAt,
        createdAt: familyInvitations.createdAt,
      });
    return NextResponse.json({ invitation, code }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
