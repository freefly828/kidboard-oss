/**
 * POST /api/v1/auth/register
 * 注册即创建 user + family + owner membership（V1 最小闭环）。
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { users, families, familyMembers } from "@kidboard/db/schema";
import { registerSchema } from "@/lib/schemas";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { jsonError, ApiError } from "@/lib/auth-guard";
import { acceptInvitation } from "@/lib/family";

export async function POST(req: Request) {
  try {
    const body = registerSchema.parse(await req.json());
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (existing.length > 0) {
      throw new ApiError(409, "email_taken", "Email already registered");
    }
    const passwordHash = await hashPassword(body.password);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: body.email,
          passwordHash,
          displayName: body.displayName,
        })
        .returning();
      // D-012：带邀请码 → 加入对方家庭（邀请码无效则整个注册回滚）；否则新建家庭并成为 owner
      if (body.inviteCode) {
        const familyId = await acceptInvitation(tx, body.inviteCode, user!.id);
        const [family] = await tx.select().from(families).where(eq(families.id, familyId)).limit(1);
        return { family, user };
      }
      const [family] = await tx
        .insert(families)
        .values({ name: body.familyName })
        .returning();
      await tx
        .insert(familyMembers)
        .values({ familyId: family!.id, userId: user!.id, role: "owner" });
      return { family, user };
    });
    const token = await createSession(created.user!.id);
    const res = NextResponse.json(
      {
        user: {
          id: created.user!.id,
          email: created.user!.email,
          displayName: created.user!.displayName,
        },
        family: { id: created.family!.id, name: created.family!.name },
      },
      { status: 201 },
    );
    res.cookies.set("kidboard_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
