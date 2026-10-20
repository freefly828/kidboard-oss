/**
 * 已登录用户用邀请码加入家庭（D-012）。
 * POST /api/v1/family/join { code } → { familyId }
 */

import { NextResponse } from "next/server";
import { db } from "@kidboard/db";
import { jsonError, requireUser } from "@/lib/auth-guard";
import { acceptInvitation } from "@/lib/family";
import { joinFamilySchema } from "@/lib/schemas";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = joinFamilySchema.parse(await req.json());
    const familyId = await db.transaction((tx) => acceptInvitation(tx, body.code, user.id));
    return NextResponse.json({ familyId });
  } catch (err) {
    return jsonError(err);
  }
}
