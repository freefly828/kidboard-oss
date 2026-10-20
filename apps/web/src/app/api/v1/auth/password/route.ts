/**
 * 修改密码（D-012 设置页）。
 * POST /api/v1/auth/password { currentPassword, newPassword }
 *      校验旧密码；成功后注销该用户的其他会话（保留当前会话）。
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@kidboard/db";
import { users } from "@kidboard/db/schema";
import { ApiError, jsonError, requireUser } from "@/lib/auth-guard";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordChangeSchema } from "@/lib/schemas";
import { SESSION_COOKIE, sessionTable } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = passwordChangeSchema.parse(await req.json());
    const row = (await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1))[0];
    if (!row || !(await verifyPassword(body.currentPassword, row.hash))) {
      throw new ApiError(400, "wrong_password", "当前密码不正确");
    }
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));

    const currentToken = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    await db
      .delete(sessionTable)
      .where(and(eq(sessionTable.userId, user.id), ne(sessionTable.token, currentToken)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
