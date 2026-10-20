/**
 * 留言历史（PRD F06：每天 0~1 条主留言）。
 * GET /api/v1/children/[childId]/messages?days=30 → { today, messages[] }（含今天，按日期倒序）
 */

import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@kidboard/db";
import { messages, users } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { addDays, todayFor } from "@/lib/dates";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30)));
    const today = todayFor(child.timezone);
    const rows = await db
      .select({
        id: messages.id,
        messageDate: messages.messageDate,
        body: messages.body,
        updatedAt: messages.updatedAt,
        createdByName: users.displayName,
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.createdBy))
      .where(
        and(
          eq(messages.childId, child.id),
          eq(messages.active, true),
          gte(messages.messageDate, addDays(today, -(days - 1))),
        ),
      )
      .orderBy(desc(messages.messageDate));
    return NextResponse.json({ today, messages: rows });
  } catch (err) {
    return jsonError(err);
  }
}
