/**
 * 撤销邀请码（D-012）。
 * DELETE /api/v1/family/invitations/[invitationId]  owner
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { familyInvitations } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireCurrentFamily } from "@/lib/family";

type Params = { params: Promise<{ invitationId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { invitationId } = await params;
    const { family } = await requireCurrentFamily("owner");
    const rows = await db
      .update(familyInvitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(familyInvitations.id, invitationId), eq(familyInvitations.familyId, family.id)))
      .returning({ id: familyInvitations.id });
    if (rows.length === 0) throw new ApiError(404, "not_found", "Invitation not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
