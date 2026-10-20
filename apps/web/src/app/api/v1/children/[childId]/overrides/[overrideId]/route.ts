/**
 * 临时日程单条 API — PRD F04。
 * DELETE /api/v1/children/[childId]/overrides/[overrideId]（guardian+；bump）
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { scheduleOverrides } from "@kidboard/db/schema";
import { jsonError, requireChildAccess, ApiError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string; overrideId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, overrideId } = await params;
    await requireChildAccess(childId, "guardian");
    const deleted = await db
      .delete(scheduleOverrides)
      .where(
        and(
          eq(scheduleOverrides.id, overrideId),
          eq(scheduleOverrides.childId, childId),
        ),
      )
      .returning({ id: scheduleOverrides.id });
    if (deleted.length === 0) {
      throw new ApiError(404, "not_found", "Override not found");
    }
    const contentVersion = await bumpContentVersion(childId);
    return NextResponse.json({ ok: true, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}
