/**
 * 孩子绑定设备的真实状态 — 家长后台"设备管理"页。
 * GET /api/v1/children/[childId]/devices → { latestFrameVersion, devices[] }
 *     viewer+；只读。数据全部来自设备 sync 上报（devices 表）与 device_events，
 *     不提供设备未上报的指标（电量、存储等）。
 */

import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@kidboard/db";
import { deviceEvents, devices, screenFrames, taskOccurrences } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { inSleepWindow, localClock, SLEEP_SYNC_SECONDS } from "@kidboard/db/alerts";

type Params = { params: Promise<{ childId: string }> };

const EVENTS_PER_DEVICE = 20;

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);

    const [deviceRows, activeFrame] = await Promise.all([
      db
        .select()
        .from(devices)
        .where(and(eq(devices.childId, child.id), isNull(devices.revokedAt)))
        .orderBy(desc(devices.createdAt)),
      db
        .select({ frameVersion: screenFrames.frameVersion })
        .from(screenFrames)
        .where(and(eq(screenFrames.childId, child.id), eq(screenFrames.isActive, true)))
        .limit(1),
    ]);

    const now = Date.now();
    // D-021 睡眠时段设备每 5 分钟才同步一次；刚过起床时间的最后一次同步也可能是 5 分钟前
    const prof = (child.profile ?? {}) as { bedTime?: string | null; wakeTime?: string | null };
    const sleeping = [0, SLEEP_SYNC_SECONDS].some((ago) =>
      inSleepWindow(localClock(child.timezone, new Date(now - ago * 1000)).hhmm, prof.bedTime, prof.wakeTime),
    );
    const result = await Promise.all(
      deviceRows.map(async (d) => {
        const events = await db
          .select()
          .from(deviceEvents)
          .where(eq(deviceEvents.deviceId, d.id))
          .orderBy(desc(deviceEvents.receivedAt))
          .limit(EVENTS_PER_DEVICE);

        // task_complete 事件补上任务标题，便于家长阅读
        const taskIds = events
          .map((e) => (e.payload as { taskOccurrenceId?: string }).taskOccurrenceId)
          .filter((id): id is string => typeof id === "string");
        const titles = new Map<string, string>();
        if (taskIds.length > 0) {
          const rows = await db
            .select({ id: taskOccurrences.id, title: taskOccurrences.title })
            .from(taskOccurrences)
            .where(inArray(taskOccurrences.id, taskIds));
          for (const r of rows) titles.set(r.id, r.title);
        }

        // 超过 3 个同步周期（至少 90 秒）未上报视为离线；睡眠时段按 5 分钟周期算
        const interval = sleeping ? Math.max(d.syncIntervalSeconds, SLEEP_SYNC_SECONDS) : d.syncIntervalSeconds;
        const staleMs = Math.max(90, interval * 3) * 1000;
        const online = d.lastSeenAt !== null && now - d.lastSeenAt.getTime() <= staleMs;

        return {
          id: d.id,
          name: d.name,
          hardwareId: d.hardwareId,
          firmwareVersion: d.firmwareVersion,
          reportedFrameVersion: Number(d.reportedFrameVersion),
          rssi: d.rssi,
          freeHeap: d.freeHeap,
          uptimeSeconds: d.uptimeSeconds === null ? null : Number(d.uptimeSeconds),
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          lastRefreshAt: d.lastRefreshAt?.toISOString() ?? null,
          lastRefreshMode: d.lastRefreshMode,
          syncIntervalSeconds: d.syncIntervalSeconds,
          // D-016 传感器（读数超过 30 分钟视为过期）
          batteryPercent: d.batteryPercent,
          batteryMv: d.batteryMv,
          temperatureC:
            d.temperatureC === null ? null : Math.round((d.temperatureC + (d.temperatureOffset ?? 0)) * 10) / 10,
          humidityPct: d.humidityPct === null ? null : Math.round(d.humidityPct),
          temperatureOffset: d.temperatureOffset ?? 0,
          sensorAt: d.sensorAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
          online,
          events: events.map((e) => {
            const taskId = (e.payload as { taskOccurrenceId?: string }).taskOccurrenceId;
            return {
              id: e.id,
              type: e.type,
              taskTitle: taskId ? (titles.get(taskId) ?? null) : null,
              occurredAt: e.occurredAt?.toISOString() ?? null,
              receivedAt: e.receivedAt.toISOString(),
            };
          }),
        };
      }),
    );

    return NextResponse.json(
      {
        latestFrameVersion: activeFrame[0] ? Number(activeFrame[0].frameVersion) : null,
        devices: result,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}
