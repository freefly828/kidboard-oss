/**
 * 家长立即提醒（D-017）。
 * GET  /api/v1/children/[childId]/alerts → { alerts[] }（最近 20 条，含送达/显示状态）
 * POST /api/v1/children/[childId]/alerts { text, beep?, minutes? }  guardian+
 *      → 屏幕底部显示提醒横幅 minutes 分钟（缺省 30，D-027）；设备下次同步时蜂鸣 3 声（横幅渲染好后才下发，二者同时到达）
 */

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { ALERT_SHOW_MS, queueBeep } from "@kidboard/db/alerts";
import { alerts, users } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { alertCreateSchema } from "@/lib/schemas";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const now = Date.now();
    const rows = await db
      .select({
        id: alerts.id,
        kind: alerts.kind,
        text: alerts.text,
        createdAt: alerts.createdAt,
        showUntil: alerts.showUntil,
        deliveredAt: alerts.deliveredAt,
        createdByName: users.displayName,
      })
      .from(alerts)
      .leftJoin(users, eq(users.id, alerts.createdBy))
      .where(eq(alerts.childId, child.id))
      .orderBy(desc(alerts.createdAt))
      .limit(20);
    return NextResponse.json({
      alerts: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        showUntil: r.showUntil.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        showing: r.showUntil.getTime() > now,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child, user } = await requireChildAccess(childId, "guardian");
    const body = alertCreateSchema.parse(await req.json());
    const now = new Date();
    const [row] = await db
      .insert(alerts)
      .values({
        childId: child.id,
        kind: "instant",
        text: body.text,
        createdBy: user.id,
        createdAt: now,
        showUntil: new Date(now.getTime() + (body.minutes ? body.minutes * 60_000 : ALERT_SHOW_MS)),
      })
      .returning({ id: alerts.id });
    await bumpContentVersion(child.id);
    const devicesQueued = body.beep === false ? 0 : await queueBeep(child.id, row!.id, 3);
    return NextResponse.json({ alert: { id: row!.id }, devicesQueued }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
