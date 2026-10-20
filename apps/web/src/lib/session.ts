/**
 * Session — 服务端 DB 存储 + HttpOnly/SameSite cookie。
 * docs/08: Session 使用 HttpOnly + Secure + SameSite cookie。
 * Secure 标志按 NODE_ENV=production 启用（本地 http 开发关闭）。
 * CSRF: SameSite=Lax + 同源策略（docs/08 §2 允许的 framework 推荐防护）。
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { pgTable, uuid, timestamp, text } from "drizzle-orm/pg-core";
import { db } from "@kidboard/db";
import { users, familyMembers, families } from "@kidboard/db/schema";

export const SESSION_COOKIE = "kidboard_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/**
 * sessions 表 — 应用层新增（不在冻结 schema.sql 15 张业务表内）。
 * 由 drizzle migration 0001 引入;verify:parity 只比对 schema.sql 中
 * 已有的 15 张业务表,新增应用层表不受冻结契约限制。
 */
export const sessionTable = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
    .notNull(),
});

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionTable).values({ token, userId, expiresAt });
  // 顺手清理过期会话（简单 delete；量级小无需限流）
  await db.delete(sessionTable).where(lt(sessionTable.expiresAt, new Date()));
  try {
    const jar = await cookies();
    const isSecure =
      process.env.COOKIE_SECURE === "true" ||
      (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  } catch {
    // 允许在非 Next request store 环境运行（例如单元测试或冒烟桥接）
  }
  return token;
}

export async function getSessionUser(tokenOverride?: string): Promise<SessionUser | null> {
  let token: string | undefined = tokenOverride;
  if (!token) {
    try {
      const jar = await cookies();
      token = jar.get(SESSION_COOKIE)?.value;
    } catch {
      // 允许在非 Next request store 环境运行
    }
  }
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessionTable)
    .innerJoin(users, eq(users.id, sessionTable.userId))
    .where(
      and(eq(sessionTable.token, token), gt(sessionTable.expiresAt, new Date())),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessionTable).where(eq(sessionTable.token, token));
  }
  jar.delete(SESSION_COOKIE);
}

/** 家庭成员角色获取；无成员关系返回 null */
export async function getFamilyRole(
  userId: string,
  familyId: string,
): Promise<"owner" | "guardian" | "viewer" | null> {
  const rows = await db
    .select({ role: familyMembers.role })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.userId, userId),
        eq(familyMembers.familyId, familyId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  if (role === "owner" || role === "guardian" || role === "viewer") return role;
  return null;
}

/** 用户可访问的家庭（取第一个，V1 UI 单家庭切换） */
export async function getPrimaryFamily(userId: string): Promise<{
  id: string;
  name: string;
  role: "owner" | "guardian" | "viewer";
} | null> {
  const rows = await db
    .select({ id: families.id, name: families.name, role: familyMembers.role })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(eq(familyMembers.userId, userId))
    // 多家庭时确定性选择：优先有孩子的家庭（注册自带的空家庭不抢占用邀请码加入的家庭），
    // 其次自己是 owner 的家庭，再其次最早加入的
    .orderBy(
      sql`CASE WHEN EXISTS (SELECT 1 FROM children c WHERE c.family_id = ${families.id}) THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${familyMembers.role} = 'owner' THEN 0 ELSE 1 END`,
      asc(familyMembers.createdAt),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.role !== "owner" && row.role !== "guardian" && row.role !== "viewer") {
    return null;
  }
  return { id: row.id, name: row.name, role: row.role };
}
