/**
 * 单条任务 occurrence API — PRD F05/F11（Web 侧完成/跳过/编辑）。
 * PATCH  /api/v1/children/[childId]/tasks/[occurrenceId]
 *        { status?, title?, description?, estimatedMinutes?, priority?, category?, points? }
 *        guardian+；完成状态与积分流水同事务同步（D-012）；内容变化 → bump。
 * DELETE 同路径：删除任务并撤销其积分奖励。
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger, taskOccurrences } from "@kidboard/db/schema";
import { taskOccurrenceUpdateSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { requireChildOrBoard } from "@/lib/board-access";
import { bumpContentVersion } from "@/lib/content-version";
import { syncTaskAward } from "@/lib/points";

type Params = { params: Promise<{ childId: string; occurrenceId: string }> };

async function findTask(childId: string, occurrenceId: string) {
  const row = (
    await db
      .select()
      .from(taskOccurrences)
      .where(and(eq(taskOccurrences.id, occurrenceId), eq(taskOccurrences.childId, childId)))
      .limit(1)
  )[0];
  if (!row) throw new ApiError(404, "not_found", "Task occurrence not found");
  return row;
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, occurrenceId } = await params;
    // D-020 孩子用看板密码登录时只能勾选完成 / 取消完成，不能改任务内容
    const { user, role } = await requireChildOrBoard(childId, "guardian");
    const body = taskOccurrenceUpdateSchema.parse(await req.json());
    if (role === "kid" && Object.keys(body).some((k) => k !== "status")) {
      throw new ApiError(403, "forbidden", "看板只能勾选任务完成");
    }
    const existing = await findTask(childId, occurrenceId);

    const result = await db.transaction(async (tx) => {
      const statusChanged = body.status !== undefined && body.status !== existing.status;
      const [task] = await tx
        .update(taskOccurrences)
        .set({
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(statusChanged ? { completedAt: body.status === "completed" ? new Date() : null } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.points !== undefined ? { points: body.points } : {}),
          updatedAt: new Date(),
        })
        .where(eq(taskOccurrences.id, occurrenceId))
        .returning();
      await syncTaskAward(tx, task!, user?.id ?? null);
      const contentVersion = await bumpContentVersion(childId, tx);
      return { task: task!, contentVersion };
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, occurrenceId } = await params;
    await requireChildAccess(childId, "guardian");
    await findTask(childId, occurrenceId);
    const contentVersion = await db.transaction(async (tx) => {
      await tx
        .delete(pointLedger)
        .where(and(eq(pointLedger.taskOccurrenceId, occurrenceId), eq(pointLedger.kind, "task")));
      await tx.delete(taskOccurrences).where(eq(taskOccurrences.id, occurrenceId));
      return bumpContentVersion(childId, tx);
    });
    return NextResponse.json({ ok: true, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}
