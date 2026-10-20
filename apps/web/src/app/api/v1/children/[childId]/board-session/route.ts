/**
 * 看板密码登录（D-020，无需家长账号）。
 * POST   /api/v1/children/[childId]/board-session { pin } → 设置该孩子看板的访问凭证（180 天）
 *        错误返回 401 { remaining }；连续错 5 次锁定 15 分钟（429 { retryAfterSeconds }）
 * DELETE 同路径 → 退出（清除凭证）
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import {
  BOARD_PIN_LOCK_MS,
  BOARD_PIN_MAX_FAILURES,
  BOARD_SESSION_MS,
  boardCookieName,
  boardToken,
  cookieSecure,
  isValidPin,
  loadChildForBoard,
  verifyPin,
} from "@/lib/board-access";

type Params = { params: Promise<{ childId: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const child = await loadChildForBoard(childId);
    const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
    if (!child.boardPinHash) throw new ApiError(404, "pin_not_set", "家长还没有设置看板密码");
    const now = Date.now();
    if (child.boardPinLockedUntil && child.boardPinLockedUntil.getTime() > now) {
      const retryAfterSeconds = Math.ceil((child.boardPinLockedUntil.getTime() - now) / 1000);
      return NextResponse.json(
        { error: { code: "locked", message: `输错次数太多，请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后再试` }, retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }
    if (!isValidPin(body.pin) || !verifyPin(body.pin, child.boardPinHash)) {
      const failures = child.boardPinFailures + 1;
      const locked = failures >= BOARD_PIN_MAX_FAILURES;
      await db
        .update(children)
        .set(locked ? { boardPinFailures: 0, boardPinLockedUntil: new Date(now + BOARD_PIN_LOCK_MS) } : { boardPinFailures: failures })
        .where(eq(children.id, child.id));
      return NextResponse.json(
        {
          error: { code: locked ? "locked" : "wrong_pin", message: locked ? "输错次数太多，请 15 分钟后再试" : "密码不对，再试一次" },
          remaining: locked ? 0 : BOARD_PIN_MAX_FAILURES - failures,
        },
        { status: locked ? 429 : 401 },
      );
    }
    await db.update(children).set({ boardPinFailures: 0, boardPinLockedUntil: null }).where(eq(children.id, child.id));
    const exp = now + BOARD_SESSION_MS;
    const res = NextResponse.json({ ok: true, childName: child.displayName });
    res.cookies.set(boardCookieName(child.id), boardToken(child.id, child.boardPinVersion, exp), {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      expires: new Date(exp),
    });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { childId } = await params;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(boardCookieName(childId), "", { path: "/", maxAge: 0 });
  return res;
}
