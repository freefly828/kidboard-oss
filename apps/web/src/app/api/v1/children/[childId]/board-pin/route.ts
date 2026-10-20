/**
 * 看板密码管理（D-020，家长）。
 * GET /api/v1/children/[childId]/board-pin → { enabled }
 * PUT 同路径 { pin: "1234" | null }  guardian+ → 设置或清除；密码版本 +1，已登录的看板全部需要重新输入
 */

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { hashPin, isValidPin } from "@/lib/board-access";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    return NextResponse.json({ enabled: Boolean(child.boardPinHash) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
    if (body.pin !== null && !isValidPin(body.pin)) throw new ApiError(400, "invalid_pin", "密码必须是 4 位数字");
    await db
      .update(children)
      .set({
        boardPinHash: body.pin === null ? null : hashPin(body.pin as string),
        boardPinVersion: sql`${children.boardPinVersion} + 1`,
        boardPinFailures: 0,
        boardPinLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(children.id, child.id));
    return NextResponse.json({ enabled: body.pin !== null });
  } catch (err) {
    return jsonError(err);
  }
}
