/**
 * 周课程表 API — PRD F03。
 * GET  /api/v1/children/[childId]/schedule?weekday=1..7（可选过滤）
 * POST /api/v1/children/[childId]/schedule（guardian+；bump content_version）
 */

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { weeklyScheduleItems } from "@kidboard/db/schema";
import { scheduleItemSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    await requireChildAccess(childId);
    const url = new URL(req.url);
    const weekdayParam = url.searchParams.get("weekday");
    const where =
      weekdayParam !== null
        ? and(
            eq(weeklyScheduleItems.childId, childId),
            eq(weeklyScheduleItems.weekday, Number(weekdayParam)),
          )
        : eq(weeklyScheduleItems.childId, childId);
    const rows = await db
      .select()
      .from(weeklyScheduleItems)
      .where(where)
      .orderBy(asc(weeklyScheduleItems.weekday), asc(weeklyScheduleItems.startMinute));
    return NextResponse.json({ items: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    await requireChildAccess(childId, "guardian");
    const body = scheduleItemSchema.parse(await req.json());
    const [item] = await db
      .insert(weeklyScheduleItems)
      .values({
        childId,
        weekday: body.weekday,
        startMinute: body.startMinute,
        endMinute: body.endMinute,
        title: body.title,
        category: body.category ?? null,
        location: body.location ?? null,
        note: body.note ?? null,
        prepare: body.prepare ?? null,
        sortOrder: body.sortOrder,
        active: body.active,
      })
      .returning();
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ item: item!, contentVersion }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("endMinute")) {
      return NextResponse.json(
        { error: { code: "validation", message: err.message } },
        { status: 400 },
      );
    }
    return jsonError(err);
  }
}

export { ApiError };
