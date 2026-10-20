/**
 * 某日任务 API — PRD F05 / docs/10 Phase 1。
 * GET /api/v1/children/[childId]/tasks?date=YYYY-MM-DD
 *     不传 date 默认 child timezone 的今天；读取前自动物化（幂等）。
 * POST { title, occurrenceDate?, description?, estimatedMinutes?, priority?, category?, points? }
 *     guardian+；未传 estimatedMinutes 时不再默认 20 分钟。
 */

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { taskOccurrences } from "@kidboard/db/schema";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { materializeDay } from "@kidboard/db/materialize";
import { todayFor, isValidDate } from "@/lib/dates";
import { bumpContentVersion } from "@/lib/content-version";
import { taskCreateSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date") ?? todayFor(child.timezone);
    if (!isValidDate(dateParam)) {
      throw new ApiError(400, "validation", "date must be YYYY-MM-DD");
    }
    // 读取前物化（幂等，不重复生成）
    const inserted = await materializeDay(childId, dateParam);
    if (inserted > 0) {
      await bumpContentVersion(childId);
    }
    const rows = await db
      .select()
      .from(taskOccurrences)
      .where(
        and(
          eq(taskOccurrences.childId, childId),
          eq(taskOccurrences.occurrenceDate, dateParam),
        ),
      )
      .orderBy(asc(taskOccurrences.sortOrder), asc(taskOccurrences.createdAt));
    return NextResponse.json({ date: dateParam, tasks: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = taskCreateSchema.parse(await req.json());
    const occurrenceDate = body.occurrenceDate ?? todayFor(child.timezone);
    if (!isValidDate(occurrenceDate)) {
      throw new ApiError(400, "validation", "occurrenceDate must be YYYY-MM-DD");
    }

    const existing = await db
      .select({ sortOrder: taskOccurrences.sortOrder })
      .from(taskOccurrences)
      .where(
        and(
          eq(taskOccurrences.childId, childId),
          eq(taskOccurrences.occurrenceDate, occurrenceDate),
        ),
      )
      .orderBy(asc(taskOccurrences.sortOrder));
    const nextSortOrder = existing.length > 0 ? (existing[existing.length - 1]?.sortOrder ?? 0) + 1 : 0;

    const [created] = await db
      .insert(taskOccurrences)
      .values({
        childId,
        occurrenceDate,
        title: body.title,
        description: body.description ?? null,
        estimatedMinutes: body.estimatedMinutes ?? null,
        priority: body.priority,
        category: body.category ?? null,
        points: body.points,
        sortOrder: nextSortOrder,
        status: "pending",
      })
      .returning();

    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ task: created, contentVersion }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
