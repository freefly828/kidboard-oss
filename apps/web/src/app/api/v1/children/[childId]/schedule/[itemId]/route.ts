/**
 * 单条周课程 API — PRD F03（编辑/停用）。
 * PATCH  /api/v1/children/[childId]/schedule/[itemId]（guardian+；bump）
 * DELETE /api/v1/children/[childId]/schedule/[itemId]（guardian+；bump）
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { weeklyScheduleItems } from "@kidboard/db/schema";
import { scheduleItemUpdateSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string; itemId: string }> };

async function getOwnedItem(childId: string, itemId: string) {
  const row = (
    await db
      .select()
      .from(weeklyScheduleItems)
      .where(
        and(
          eq(weeklyScheduleItems.id, itemId),
          eq(weeklyScheduleItems.childId, childId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new ApiError(404, "not_found", "Schedule item not found");
  return row;
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, itemId } = await params;
    await requireChildAccess(childId, "guardian");
    await getOwnedItem(childId, itemId);
    const body = scheduleItemUpdateSchema.parse(await req.json());
    if (
      body.startMinute !== undefined ||
      body.endMinute !== undefined
    ) {
      const start = body.startMinute ?? (await getOwnedItem(childId, itemId)).startMinute;
      const end = body.endMinute ?? (await getOwnedItem(childId, itemId)).endMinute;
      if (end <= start) {
        throw new ApiError(400, "validation", "endMinute must be > startMinute");
      }
    }
    const [item] = await db
      .update(weeklyScheduleItems)
      .set({
        ...(body.weekday !== undefined ? { weekday: body.weekday } : {}),
        ...(body.startMinute !== undefined ? { startMinute: body.startMinute } : {}),
        ...(body.endMinute !== undefined ? { endMinute: body.endMinute } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category ?? null } : {}),
        ...(body.location !== undefined ? { location: body.location ?? null } : {}),
        ...(body.note !== undefined ? { note: body.note ?? null } : {}),
        ...(body.prepare !== undefined ? { prepare: body.prepare ?? null } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(weeklyScheduleItems.id, itemId))
      .returning();
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ item: item!, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, itemId } = await params;
    await requireChildAccess(childId, "guardian");
    await getOwnedItem(childId, itemId);
    await db
      .delete(weeklyScheduleItems)
      .where(eq(weeklyScheduleItems.id, itemId));
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ ok: true, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}
