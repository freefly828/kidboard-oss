/**
 * 定时提醒（D-017）。
 * GET  /api/v1/children/[childId]/reminders → { reminders[] }（按时间排序）
 * POST /api/v1/children/[childId]/reminders { remindAt "HH:MM", weekdays[1..7], text, beep?, active? }  guardian+
 * 到点由 renderer 触发：屏幕底部显示横幅 30 分钟，设备蜂鸣 3 声（孩子时区）。
 */

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { reminders } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { reminderCreateSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string }> };

const MAX_REMINDERS = 20;

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const rows = await db.select().from(reminders).where(eq(reminders.childId, child.id)).orderBy(asc(reminders.remindAt));
    return NextResponse.json({ reminders: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = reminderCreateSchema.parse(await req.json());
    const count = (await db.select({ id: reminders.id }).from(reminders).where(eq(reminders.childId, child.id))).length;
    if (count >= MAX_REMINDERS) {
      return NextResponse.json({ error: { code: "limit", message: `最多 ${MAX_REMINDERS} 条定时提醒` } }, { status: 400 });
    }
    const [row] = await db
      .insert(reminders)
      .values({
        childId: child.id,
        remindAt: body.remindAt,
        weekdays: [...new Set(body.weekdays)].sort(),
        text: body.text,
        beep: body.beep ?? true,
        active: body.active ?? true,
      })
      .returning();
    return NextResponse.json({ reminder: row }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
