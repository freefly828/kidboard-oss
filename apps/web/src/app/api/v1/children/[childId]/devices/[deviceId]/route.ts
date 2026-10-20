/**
 * 单台设备管理。
 * PATCH  /api/v1/children/[childId]/devices/[deviceId] { name?, syncIntervalSeconds? }  guardian+
 *        同步间隔经下次 sync 响应的 nextSyncSeconds 下发给设备。
 * DELETE 同路径  owner（PRD F08 "解除绑定必须 Owner 操作"）：
 *        撤销 token（revoked_at、清空 token hash 与绑定），设备下次 sync 收到 401；
 *        同一设备重新配对认领时 claim 会清除 revoked_at。
 */

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@kidboard/db";
import { devices } from "@kidboard/db/schema";
import { ApiError, jsonError, requireChildAccess } from "@/lib/auth-guard";
import { deviceUpdateSchema } from "@/lib/schemas";
import { bumpContentVersion } from "@/lib/content-version";

type Params = { params: Promise<{ childId: string; deviceId: string }> };

function deviceOfChild(childId: string, deviceId: string) {
  return and(eq(devices.id, deviceId), eq(devices.childId, childId), isNull(devices.revokedAt));
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { childId, deviceId } = await params;
    await requireChildAccess(childId, "guardian");
    const body = deviceUpdateSchema.parse(await req.json());
    const rows = await db
      .update(devices)
      .set({ ...body, updatedAt: new Date() })
      .where(deviceOfChild(childId, deviceId))
      .returning({ id: devices.id, name: devices.name, syncIntervalSeconds: devices.syncIntervalSeconds });
    if (rows.length === 0) throw new ApiError(404, "not_found", "Device not found");
    // D-016 温度校准变化：立即按新校准重渲染（清掉已显示读数，下次同步按新值比较）
    if (body.temperatureOffset !== undefined) {
      await db.update(devices).set({ indoorShown: null }).where(eq(devices.id, deviceId));
      await bumpContentVersion(childId);
    }
    return NextResponse.json({ device: rows[0] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { childId, deviceId } = await params;
    await requireChildAccess(childId, "owner");
    const rows = await db
      .update(devices)
      .set({ revokedAt: new Date(), deviceTokenHash: null, childId: null, familyId: null, updatedAt: new Date() })
      .where(deviceOfChild(childId, deviceId))
      .returning({ id: devices.id });
    if (rows.length === 0) throw new ApiError(404, "not_found", "Device not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
