/**
 * POST /api/v1/auth/login
 * 邮箱+密码登录（PRD F01）。V1 内存限速：失败 5 次锁 15 分钟。
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { users } from "@kidboard/db/schema";
import { loginSchema } from "@/lib/schemas";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { jsonError, ApiError } from "@/lib/auth-guard";

/** 进程内登录限速（单实例部署足够；换多实例时上 DB/redis） */
const attempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function checkRateLimit(key: string) {
  const entry = attempts.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    throw new ApiError(
      429,
      "rate_limited",
      "Too many failed attempts. Try again later.",
    );
  }
}

function recordFailure(key: string) {
  const entry = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    checkRateLimit(body.email);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    const user = rows[0];
    const ok =
      user !== undefined && (await verifyPassword(body.password, user.passwordHash));
    if (!ok) {
      recordFailure(body.email);
      // 统一错误信息，不暴露"用户不存在"
      throw new ApiError(401, "invalid_credentials", "Invalid email or password");
    }
    attempts.delete(body.email);
    await createSession(user.id);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
