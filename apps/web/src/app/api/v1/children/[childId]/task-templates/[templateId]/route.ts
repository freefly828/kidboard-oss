/**
 * 单个任务模板 API — PRD F05。
 * PATCH  更新（guardian+；重物化今天 → 可能 bump）
 * DELETE 删除（guardian+；只影响未来物化，不改已有 occurrence；仍 bump 以反映模板列表变化）
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { taskTemplates } from "@kidboard/db/schema";
import { taskTemplateUpdateSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string; templateId: string }> };

async function getOwned(childId: string, templateId: string) {
  const row = (
    await db
      .select()
      .from(taskTemplates)
      .where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.childId, childId)))
      .limit(1)
  )[0];
  if (!row) throw new ApiError(404, "not_found", "Template not found");
  return row;
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, templateId } = await params;
    await requireChildAccess(childId, "guardian");
    await getOwned(childId, templateId);
    const body = taskTemplateUpdateSchema.parse(await req.json());
    const [tpl] = await db
      .update(taskTemplates)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description ?? null }
          : {}),
        ...(body.recurrence !== undefined ? { recurrence: body.recurrence } : {}),
        ...(body.estimatedMinutes !== undefined
          ? { estimatedMinutes: body.estimatedMinutes ?? null }
          : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.category !== undefined ? { category: body.category ?? null } : {}),
        ...(body.points !== undefined ? { points: body.points } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(taskTemplates.id, templateId))
      .returning();
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ template: tpl!, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, templateId } = await params;
    await requireChildAccess(childId, "guardian");
    await getOwned(childId, templateId);
    await db.delete(taskTemplates).where(eq(taskTemplates.id, templateId));
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ ok: true, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}
