/**
 * 临时日程 API — PRD F04。
 * GET  /api/v1/children/[childId]/overrides?from=&to=（可选区间过滤）
 * POST /api/v1/children/[childId]/overrides（guardian+；bump）
 */

import { NextResponse } from "next/server";
import { and, eq, gte, lte, asc } from "drizzle-orm";
import { db } from "@kidboard/db";
import { scheduleOverrides, weeklyScheduleItems } from "@kidboard/db/schema";
import { overrideSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    await requireChildAccess(childId);
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const conds = [eq(scheduleOverrides.childId, childId)];
    if (from !== null && DATE_RE.test(from)) {
      conds.push(gte(scheduleOverrides.overrideDate, from));
    }
    if (to !== null && DATE_RE.test(to)) {
      conds.push(lte(scheduleOverrides.overrideDate, to));
    }
    const rows = await db
      .select()
      .from(scheduleOverrides)
      .where(and(...conds))
      .orderBy(asc(scheduleOverrides.overrideDate));
    return NextResponse.json({ overrides: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    await requireChildAccess(childId, "guardian");
    const body = overrideSchema.parse(await req.json());
    // replace/cancel 必须指向本儿童的周课程项
    if (body.targetScheduleItemId != null) {
      const target = (
        await db
          .select({ id: weeklyScheduleItems.id })
          .from(weeklyScheduleItems)
          .where(
            and(
              eq(weeklyScheduleItems.id, body.targetScheduleItemId),
              eq(weeklyScheduleItems.childId, childId),
            ),
          )
          .limit(1)
      )[0];
      if (!target) {
        throw new ApiError(
          404,
          "not_found",
          "targetScheduleItemId not found for this child",
        );
      }
    }
    const [override] = await db
      .insert(scheduleOverrides)
      .values({
        childId,
        overrideDate: body.overrideDate,
        action: body.action,
        targetScheduleItemId: body.targetScheduleItemId ?? null,
        startMinute: body.startMinute ?? null,
        endMinute: body.endMinute ?? null,
        title: body.title ?? null,
        category: body.category ?? null,
        note: body.note ?? null,
        prepare: body.prepare ?? null,
      })
      .returning();
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json(
      { override: override!, contentVersion },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
