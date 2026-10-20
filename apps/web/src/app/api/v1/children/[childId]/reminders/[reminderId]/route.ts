/**
 * 单条定时提醒（D-017）。
 * PATCH  /api/v1/children/[childId]/reminders/[reminderId] { remindAt?, weekdays?, text?, beep?, active? }  guardian+
 * DELETE 同路径  guardian+
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { reminders } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { reminderUpdateSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string; reminderId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, reminderId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = reminderUpdateSchema.parse(await req.json());
    const rows = await db
      .update(reminders)
      .set({
        ...body,
        ...(body.weekdays ? { weekdays: [...new Set(body.weekdays)].sort() } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(reminders.id, reminderId), eq(reminders.childId, child.id)))
      .returning();
    if (rows.length === 0) throw new ApiError(404, "not_found", "Reminder not found");
    return NextResponse.json({ reminder: rows[0] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, reminderId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const rows = await db
      .delete(reminders)
      .where(and(eq(reminders.id, reminderId), eq(reminders.childId, child.id)))
      .returning({ id: reminders.id });
    if (rows.length === 0) throw new ApiError(404, "not_found", "Reminder not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
