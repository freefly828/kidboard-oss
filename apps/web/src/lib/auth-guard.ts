/**
 * API 权限守卫 — 所有 family-scoped 路由共用。
 * docs/08 §2: 所有 family scoped 查询必须包含 membership authorization，
 * 禁止只凭资源 UUID 访问。
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser, getFamilyRole } from "./session";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";

export type Role = "owner" | "guardian" | "viewer";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  // 边界输入校验失败统一 400（边界输入统一 Zod parse）
  if (err instanceof ZodError) {
    const detail = err.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { error: { code: "validation", message: detail } },
      { status: 400 },
    );
  }
  console.error("unexpected api error:", err);
  return NextResponse.json(
    { error: { code: "internal", message: "Internal server error" } },
    { status: 500 },
  );
}

/** 要求已登录；返回会话用户 */
export async function requireUser(req?: Request) {
  let tokenOverride: string | undefined;
  if (req) {
    const cookieHeader = req.headers.get("cookie") || req.headers.get("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/kidboard_session=([^;]+)/);
      if (match) tokenOverride = match[1];
    }
  }
  const user = await getSessionUser(tokenOverride);
  if (!user) {
    throw new ApiError(401, "unauthorized", "Login required");
  }
  return user;
}

/** 要求对 family 有 membership；viewer 视为只读（写路由用 requireEditor） */
export async function requireFamily(
  familyId: string,
  minRole: Role = "viewer",
) {
  const user = await requireUser();
  const role = await getFamilyRole(user.id, familyId);
  if (!role) {
    throw new ApiError(403, "forbidden", "No membership in this family");
  }
  const rank: Record<Role, number> = { viewer: 0, guardian: 1, owner: 2 };
  if (rank[role] < rank[minRole]) {
    throw new ApiError(403, "forbidden", `Requires ${minRole} role`);
  }
  return { user, role, familyId };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 要求 child 归属当前用户的家庭。
 * 返回 child 行（含 familyId/timezone/contentVersion），供业务路由复用。
 */
export async function requireChildAccess(childId: string, minRole: Role = "viewer") {
  if (!UUID_REGEX.test(childId)) {
    throw new ApiError(404, "not_found", "Child not found (invalid ID format)");
  }
  const child = (
    await db.select().from(children).where(eq(children.id, childId)).limit(1)
  )[0];
  if (!child) {
    throw new ApiError(404, "not_found", "Child not found");
  }
  const ctx = await requireFamily(child.familyId, minRole);
  return { ...ctx, child };
}

/**
 * 确认 child 属于指定 family（防止跨家庭 childId 注入）。
 */
export async function assertChildInFamily(childId: string, familyId: string) {
  if (!UUID_REGEX.test(childId) || !UUID_REGEX.test(familyId)) {
    throw new ApiError(404, "not_found", "Child not in family");
  }
  const row = (
    await db
      .select({ id: children.id })
      .from(children)
      .where(and(eq(children.id, childId), eq(children.familyId, familyId)))
      .limit(1)
  )[0];
  if (!row) {
    throw new ApiError(404, "not_found", "Child not found in this family");
  }
}
