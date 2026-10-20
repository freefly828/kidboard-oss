/**
 * 设备上报专注计时完成（D-019）— 幂等（eventId UUID），按孩子配置发积分（每天有上限）。
 * POST /api/v1/device/events/focus-complete { eventId, minutes, occurredAt? }
 * D-024：记录与发积分统一走 lib/focus（focus_sessions），device_events 保留作审计。
 */

import { NextResponse } from "next/server";
import { db } from "@kidboard/db";
import { deviceEvents } from "@kidboard/db/schema";
import { deviceFocusCompleteSchema } from "@/lib/schemas";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireDevice } from "@/lib/device-token";
import { recordDeviceFocus } from "@/lib/focus";

export async function POST(req: Request) {
  try {
    const dev = await requireDevice(req);
    if (!dev.childId) throw new ApiError(403, "device_not_paired", "Device is not paired to any child");
    const body = deviceFocusCompleteSchema.parse(await req.json());
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();

    await db
      .insert(deviceEvents)
      .values({ deviceId: dev.id, eventId: body.eventId, type: "focus_complete", payload: { minutes: body.minutes }, occurredAt })
      .onConflictDoNothing();

    const r = await recordDeviceFocus({ childId: dev.childId, deviceId: dev.id, eventId: body.eventId, minutes: body.minutes, occurredAt });
    return NextResponse.json({ status: "ok", applied: !r.idempotent, idempotent: r.idempotent, awarded: r.awarded });
  } catch (err) {
    return jsonError(err);
  }
}
