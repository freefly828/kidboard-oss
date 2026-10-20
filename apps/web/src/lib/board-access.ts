/**
 * 看板免登录访问（D-020）：家长给孩子设 4 位数字密码，孩子在平板/手机上输入后
 * 获得只针对这个孩子看板的访问凭证（httpOnly Cookie，180 天）。
 *
 * - 密码只存 scrypt 哈希（随机盐）；连续错 5 次锁定 15 分钟（存库，多实例一致）；
 * - 凭证 = 过期时间 + HMAC(childId, 密码版本, 过期时间)；家长改/清密码时版本 +1，旧凭证全部失效；
 * - 凭证只放行该孩子的看板读取与任务勾选（不能改任务内容、不能访问后台其它接口）。
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { ApiError, requireChildAccess, type Role } from "./auth-guard";

export const BOARD_PIN_MAX_FAILURES = 5;
export const BOARD_PIN_LOCK_MS = 15 * 60 * 1000;
export const BOARD_SESSION_MS = 180 * 24 * 60 * 60 * 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function secret(): string {
  return process.env.SESSION_SECRET || "kidboard-dev-board-secret";
}

export function boardCookieName(childId: string): string {
  return `kb_board_${childId}`;
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pin, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(childId: string, version: number, exp: number): string {
  return createHmac("sha256", secret()).update(`board:${childId}:${version}:${exp}`).digest("hex");
}

export function boardToken(childId: string, version: number, exp: number): string {
  return `${exp}.${sign(childId, version, exp)}`;
}

/** 纯函数：凭证是否有效（未过期、签名匹配当前密码版本） */
export function checkBoardToken(token: string | undefined, childId: string, version: number, now = Date.now()): boolean {
  if (!token) return false;
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now || !mac) return false;
  const expected = Buffer.from(sign(childId, version, exp), "hex");
  const got = Buffer.from(mac, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
}

/** 读孩子行（不鉴权）：看板密码页、密码校验用 */
export async function loadChildForBoard(childId: string) {
  if (!UUID_REGEX.test(childId)) throw new ApiError(404, "not_found", "Child not found");
  const child = (await db.select().from(children).where(eq(children.id, childId)).limit(1))[0];
  if (!child) throw new ApiError(404, "not_found", "Child not found");
  return child;
}

export type BoardRole = Role | "kid";

/**
 * 看板读取 / 勾选任务的鉴权：家长登录（家庭成员）优先；未登录时接受该孩子的看板凭证（role = "kid"）。
 */
export async function requireChildOrBoard(childId: string, minRole: Role = "viewer") {
  try {
    const ctx = await requireChildAccess(childId, minRole);
    return { child: ctx.child, role: ctx.role as BoardRole, user: ctx.user as { id: string } | null };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const child = await loadChildForBoard(childId);
    if (!child.boardPinHash) throw err;
    const jar = await cookies();
    if (!checkBoardToken(jar.get(boardCookieName(childId))?.value, childId, child.boardPinVersion)) throw err;
    return { child, role: "kid" as BoardRole, user: null };
  }
}
