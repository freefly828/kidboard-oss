/**
 * 留言 API — PRD F06。
 * GET  /api/v1/children/[childId]/message?date=YYYY-MM-DD（默认今天）
 * PUT  /api/v1/children/[childId]/message { messageDate, body }
 *      guardian+；每天 0~1 条 active 主留言（uq_active_message_per_day）。
 *      超过 60 字返回 400 提示，不静默截断（PRD F06 硬性要求）。
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { messages } from "@kidboard/db/schema";
import { messageSchema, MESSAGE_MAX_CHARS } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { todayFor, isValidDate } from "@/lib/dates";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? todayFor(child.timezone);
    if (!isValidDate(date)) {
      throw new ApiError(400, "validation", "date must be YYYY-MM-DD");
    }
    const row = (
      await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.childId, childId),
            eq(messages.messageDate, date),
            eq(messages.active, true),
          ),
        )
        .limit(1)
    )[0];
    return NextResponse.json({ date, message: row ?? null });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { user, child } = await requireChildAccess(childId, "guardian");
    const raw = await req.json();
    if (!raw.messageDate) {
      raw.messageDate = todayFor(child.timezone);
    }
    const body = messageSchema.parse(raw);
    // zod max(60) 已拦截;再显式返回友好错误（不静默截断）
    if (body.body.length > MESSAGE_MAX_CHARS) {
      throw new ApiError(
        400,
        "message_too_long",
        `留言最多 ${MESSAGE_MAX_CHARS} 个字符（当前 ${body.body.length}）`,
      );
    }
    const saved = await db.transaction(async (tx) => {
      // 同日已有 active → 更新；否则插入（唯一索引兜底并发）
      const existing = (
        await tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.childId, childId),
              eq(messages.messageDate, body.messageDate),
              eq(messages.active, true),
            ),
          )
          .limit(1)
      )[0];
      if (existing) {
        const [row] = await tx
          .update(messages)
          .set({ body: body.body, updatedAt: new Date() })
          .where(eq(messages.id, existing.id))
          .returning();
        return row!;
      }
      const [row] = await tx
        .insert(messages)
        .values({
          childId,
          messageDate: body.messageDate,
          body: body.body,
          createdBy: user.id,
        })
        .returning();
      return row!;
    });
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ message: saved, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, ctx: Params) {
  return PUT(req, ctx);
}

/**
 * DELETE /api/v1/children/[childId]/message?date=YYYY-MM-DD（默认今天）
 * guardian+；撤下当天留言（active=false，保留历史），屏幕留言区变空 → bump。
 */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const date = new URL(req.url).searchParams.get("date") ?? todayFor(child.timezone);
    if (!isValidDate(date)) {
      throw new ApiError(400, "validation", "date must be YYYY-MM-DD");
    }
    const rows = await db
      .update(messages)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(messages.childId, childId), eq(messages.messageDate, date), eq(messages.active, true)))
      .returning({ id: messages.id });
    const contentVersion = rows.length > 0 ? await bumpContentVersion(childId) : Number(child.contentVersion);
    return NextResponse.json({ ok: true, removed: rows.length, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}
