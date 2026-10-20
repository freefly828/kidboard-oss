/**
 * 单儿童 API。
 * GET   /api/v1/children/[childId]
 * PATCH  /api/v1/children/[childId]  更新昵称/时区/档案扩展（guardian+；改名影响屏幕 → bump content_version）
 * DELETE /api/v1/children/[childId]  owner；同时解绑该孩子的设备（撤销 token），其余数据级联删除
 */

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, devices } from "@kidboard/db/schema";
import { childUpdateSchema } from "@/lib/schemas";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    return NextResponse.json({ child });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "guardian");
    const body = childUpdateSchema.parse(await req.json());
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(children)
        .set({
          ...(body.displayName !== undefined
            ? { displayName: body.displayName }
            : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.profile !== undefined ? { profile: body.profile } : {}),
          ...(body.previewFrom !== undefined ? { previewFrom: body.previewFrom } : {}),
          ...(body.focusMinutes !== undefined ? { focusMinutes: body.focusMinutes } : {}),
          ...(body.focusPoints !== undefined ? { focusPoints: body.focusPoints } : {}),
          ...(body.focusDailyCap !== undefined ? { focusDailyCap: body.focusDailyCap } : {}),
          updatedAt: new Date(),
        })
        .where(eq(children.id, child.id))
        .returning();
      return row!;
    });
    // 昵称/时区影响屏幕内容 → 内容版本推进；仅改档案扩展字段（D-012）不重渲染
    const affectsScreen =
      body.displayName !== undefined ||
      body.timezone !== undefined ||
      body.previewFrom !== undefined ||
      body.focusMinutes !== undefined ||
      body.focusPoints !== undefined ||
      body.focusDailyCap !== undefined;
    const contentVersion = affectsScreen ? await bumpContentVersion(child.id) : Number(updated.contentVersion);
    return NextResponse.json({ child: updated, contentVersion });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId, "owner");
    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ revokedAt: new Date(), deviceTokenHash: null, childId: null, familyId: null, updatedAt: new Date() })
        .where(and(eq(devices.childId, child.id), isNull(devices.revokedAt)));
      await tx.delete(children).where(eq(children.id, child.id));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
