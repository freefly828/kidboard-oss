/**
 * GET   /api/v1/auth/me  返回当前会话用户 + 主家庭（PWA 启动自举）。
 * PATCH /api/v1/auth/me { displayName }  修改自己的显示名（D-012 设置页）。
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { users } from "@kidboard/db/schema";
import { profileUpdateSchema } from "@/lib/schemas";
import { getSessionUser, getPrimaryFamily } from "@/lib/session";
import { jsonError, requireUser } from "@/lib/auth-guard";

export async function GET() {
  try {
    const user = await requireUser();
    const family = await getPrimaryFamily(user.id);
    return NextResponse.json({ user, family });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = profileUpdateSchema.parse(await req.json());
    const [row] = await db
      .update(users)
      .set({ displayName: body.displayName })
      .where(eq(users.id, user.id))
      .returning({ id: users.id, email: users.email, displayName: users.displayName });
    return NextResponse.json({ user: row });
  } catch (err) {
    return jsonError(err);
  }
}

export { getSessionUser };
