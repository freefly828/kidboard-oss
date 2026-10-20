/**
 * 任务模板 API — PRD F05。
 * GET  /api/v1/children/[childId]/task-templates
 * POST /api/v1/children/[childId]/task-templates（guardian+；模板本身不直接上屏，
 *      但新建模板会物化到“今天”→ bump）
 */

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { taskTemplates } from "@kidboard/db/schema";
import { taskTemplateSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { materializeDay } from "@kidboard/db/materialize";
import { todayFor } from "@/lib/dates";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child: _c } = await requireChildAccess(childId);
    const rows = await db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.childId, childId))
      .orderBy(asc(taskTemplates.sortOrder), asc(taskTemplates.createdAt));
    return NextResponse.json({ templates: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = taskTemplateSchema.parse(await req.json());
    const [tpl] = await db
      .insert(taskTemplates)
      .values({
        childId,
        title: body.title,
        description: body.description ?? null,
        recurrence: body.recurrence,
        estimatedMinutes: body.estimatedMinutes ?? null,
        priority: body.priority,
        category: body.category ?? null,
        points: body.points,
        sortOrder: body.sortOrder,
      })
      .returning();
    // 立即物化到今天（若规则命中），屏幕内容可能变化
    const today = todayFor(child.timezone);
    const inserted = await materializeDay(childId, today);
    let contentVersion: number | undefined;
    if (inserted > 0) {
      contentVersion = await bumpContentVersion(childId);
    }
    return NextResponse.json(
      { template: tpl!, materializedToday: inserted, contentVersion },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
