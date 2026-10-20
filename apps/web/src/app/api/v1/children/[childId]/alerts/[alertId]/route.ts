/**
 * 撤下提醒横幅（D-017）。
 * DELETE /api/v1/children/[childId]/alerts/[alertId]  guardian+ → 立即从屏幕移除，未送达的蜂鸣作废
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { alerts, deviceCommands } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string; alertId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, alertId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const now = new Date();
    const rows = await db
      .update(alerts)
      .set({ showUntil: now, clearedAt: now })
      .where(and(eq(alerts.id, alertId), eq(alerts.childId, child.id)))
      .returning({ id: alerts.id });
    if (rows.length === 0) throw new ApiError(404, "not_found", "Alert not found");
    await db
      .update(deviceCommands)
      .set({ status: "expired" })
      .where(and(eq(deviceCommands.status, "pending"), sql`${deviceCommands.payload}->>'alertId' = ${alertId}`));
    await bumpContentVersion(child.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
