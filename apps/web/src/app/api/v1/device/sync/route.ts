/**
 * 设备周期同步与期望状态心跳 — docs/05 §3 + openapi.yaml
 * POST /api/v1/device/sync
 */

import { NextResponse } from "next/server";
import { eq, and, asc, inArray, lt, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { alerts, children, deviceCommands, devices, renderJobs, screenFrames, taskOccurrences } from "@kidboard/db/schema";
import { inSleepWindow, localClock, remindersOf, SLEEP_SYNC_SECONDS, secondsUntilNextReminder } from "@kidboard/db/alerts";
import { displayPlan } from "@kidboard/db/screen-input";
import { PAGE_ORDER } from "@kidboard/screen-template/pages";
import { MAX_TASK_ITEMS } from "@kidboard/screen-template";
import { batteryReadingPlausible, indoorNeedsRerender, indoorOf, LOW_BATTERY_PERCENT, type IndoorShown } from "@kidboard/db/sensors";
import { bumpContentVersion } from "@/lib/content-version";
import { deviceSyncRequestSchema } from "@/lib/schemas";
import { jsonError } from "@/lib/auth-guard";
import { utcOffsetMinutes } from "@/lib/dates";
import { requireDevice } from "@/lib/device-token";

interface DirtyRectMeta {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
}

export async function POST(req: Request) {
  try {
    const dev = await requireDevice(req);
    const body = deviceSyncRequestSchema.parse(await req.json());

    const now = new Date();

    // 更新设备遥测上报数据
    await db
      .update(devices)
      .set({
        firmwareVersion: body.firmwareVersion,
        reportedFrameVersion: body.frameVersion,
        rssi: body.rssi,
        freeHeap: body.freeHeap ?? null,
        uptimeSeconds: body.uptimeSeconds,
        // D-016 传感器（未上报的字段保持原值）
        ...(body.temperatureC !== undefined && body.humidityPct !== undefined
          ? { temperatureC: body.temperatureC, humidityPct: body.humidityPct }
          : {}),
        // 不合理的电池读数（测量异常）清空，不当作电量低
        ...(body.batteryMv !== undefined
          ? batteryReadingPlausible(body.batteryMv)
            ? { batteryMv: body.batteryMv, batteryPercent: body.batteryPercent ?? null }
            : { batteryMv: null, batteryPercent: null }
          : {}),
        ...(body.temperatureC !== undefined || body.batteryPercent !== undefined ? { sensorAt: now } : {}),
        lastSeenAt: now,
        lastRefreshAt: body.lastRefreshAt ? new Date(body.lastRefreshAt) : null,
        lastRefreshMode: body.lastRefreshMode ?? null,
        partialRefreshCount: body.partialRefreshCount,
        updatedAt: now,
      })
      .where(eq(devices.id, dev.id));

    // D-016 室内读数 / 低电状态变化 → 重渲染画面（温湿度最多 30 分钟一次，低电变化立即）
    if (dev.childId && (body.temperatureC !== undefined || body.batteryPercent !== undefined)) {
      const row = (
        await db
          .select({
            temperatureC: devices.temperatureC,
            humidityPct: devices.humidityPct,
            temperatureOffset: devices.temperatureOffset,
            batteryPercent: devices.batteryPercent,
            batteryMv: devices.batteryMv,
            indoorShown: devices.indoorShown,
          })
          .from(devices)
          .where(eq(devices.id, dev.id))
          .limit(1)
      )[0];
      if (row) {
        const indoor = indoorOf(row.temperatureC, row.humidityPct, row.temperatureOffset ?? 0);
        const next: IndoorShown = {
          t: indoor?.temperatureC ?? null,
          h: indoor?.humidityPct ?? null,
          low: batteryReadingPlausible(row.batteryMv) && row.batteryPercent !== null && row.batteryPercent <= LOW_BATTERY_PERCENT,
          at: now.toISOString(),
        };
        if (indoorNeedsRerender((row.indoorShown as IndoorShown | null) ?? null, next, now)) {
          await db.update(devices).set({ indoorShown: next }).where(eq(devices.id, dev.id));
          await bumpContentVersion(dev.childId);
        }
      }
    }

    let desiredFrame = null;
    let pages: { index: number; kind: string; sha256: string; bytes: number; url: string }[] = [];
    let interactiveTasks: Array<{ id: string; slot: number; status: "pending" | "completed" | "skipped" }> = [];

    let childTz = "Asia/Shanghai";
    let focus: { minutes: number; points: number } | null = null;
    let sleepWindow: { bedTime: string | null; wakeTime: string | null } = { bedTime: null, wakeTime: null };
    if (dev.childId) {
      // 查取当前儿童时区
      const childRows = await db
        .select({ timezone: children.timezone, previewFrom: children.previewFrom, focusMinutes: children.focusMinutes, focusPoints: children.focusPoints, profile: children.profile })
        .from(children)
        .where(eq(children.id, dev.childId))
        .limit(1);

      const tz = childRows[0]?.timezone || "Asia/Shanghai";
      childTz = tz;
      focus = { minutes: childRows[0]?.focusMinutes ?? 25, points: childRows[0]?.focusPoints ?? 5 };
      const prof = (childRows[0]?.profile ?? {}) as { bedTime?: string | null; wakeTime?: string | null };
      sleepWindow = { bedTime: prof.bedTime ?? null, wakeTime: prof.wakeTime ?? null };
      // D-013：明日预览时屏幕显示的是明天，按键不应操作今天的任务
      const preview = displayPlan(now, tz, childRows[0]?.previewFrom ?? null).mode === "tomorrow";
      const todayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      // 查询 active frame
      const frames = await db
        .select({
          frameVersion: screenFrames.frameVersion,
          width: screenFrames.width,
          height: screenFrames.height,
          bytes: screenFrames.bytes,
          sha256: screenFrames.sha256,
          changedRatio: screenFrames.changedRatio,
          dirtyRect: screenFrames.dirtyRect,
          pages: screenFrames.pages,
        })
        .from(screenFrames)
        .where(and(eq(screenFrames.childId, dev.childId), eq(screenFrames.isActive, true)))
        .limit(1);

      const active = frames[0];
      // D-018 附加页：每次都带上当前 active 帧的页清单，设备按 SHA 下载缺失或变化的页（下载失败下次自动补）
      if (active) {
        pages = ((active.pages as { index: number; sha256: string; bytes: number }[] | null) ?? []).map((p) => ({
          index: p.index,
          // D-019 页类型（设备据此找到专注页）
          kind: PAGE_ORDER[p.index - 1] ?? "unknown",
          sha256: p.sha256,
          bytes: p.bytes,
          url: `/api/v1/device/frames/${active.frameVersion}/pages/${p.index}/bin`,
        }));
      }

      // 仅当服务端 active 帧版本大于设备当前报告版本时，下发新帧（C01: 相同 version 不下载帧）
      if (active && active.frameVersion > body.frameVersion) {
        const dr = active.dirtyRect as DirtyRectMeta | null;
        desiredFrame = {
          version: active.frameVersion,
          width: active.width,
          height: active.height,
          bytes: active.bytes,
          sha256: active.sha256,
          url: `/api/v1/device/frames/${active.frameVersion}/bin`,
          forceFullRefresh: dev.desiredFullRefresh || active.frameVersion === 1,
          changedRatio: Number(active.changedRatio ?? 1),
          dirtyRect: dr
            ? {
                x: dr.x ?? 0,
                y: dr.y ?? 0,
                w: dr.w ?? dr.width ?? 0,
                h: dr.h ?? dr.height ?? 0,
              }
            : null,
        };

        if (dev.desiredFullRefresh) {
          await db
            .update(devices)
            .set({ desiredFullRefresh: false })
            .where(eq(devices.id, dev.id));
        }
      }

      // 今日任务（用于设备按键绑定 slot 0..7）；明日预览期间为空
      const tasks = preview
        ? []
        : await db
        .select({
          id: taskOccurrences.id,
          status: taskOccurrences.status,
          title: taskOccurrences.title,
          sortOrder: taskOccurrences.sortOrder,
        })
        .from(taskOccurrences)
        .where(
          and(
            eq(taskOccurrences.childId, dev.childId),
            eq(taskOccurrences.occurrenceDate, todayStr),
          ),
        )
        .orderBy(asc(taskOccurrences.sortOrder));

      // 与屏幕组装器同一排序（sortOrder → 标题），保证设备默认焦点就是屏上 ">" 那一项
      const ordered = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)).slice(0, MAX_TASK_ITEMS);
      interactiveTasks = ordered.map((t, idx) => ({
        id: t.id,
        slot: idx,
        status: t.status as "pending" | "completed" | "skipped",
      }));
    }

    // 处理待发送命令
    // 待下发命令（D-017）：过期的蜂鸣作废；画面还在重渲染时先不下发蜂鸣，让横幅与铃声同时到达
    await db
      .update(deviceCommands)
      .set({ status: "expired" })
      .where(and(eq(deviceCommands.deviceId, dev.id), eq(deviceCommands.status, "pending"), lt(deviceCommands.expiresAt, now)));
    const pendingCmds = await db
      .select()
      .from(deviceCommands)
      .where(and(eq(deviceCommands.deviceId, dev.id), eq(deviceCommands.status, "pending")));
    let holdBeep = false;
    if (dev.childId && pendingCmds.some((c) => c.type === "beep")) {
      const busy = await db
        .select({ id: renderJobs.id })
        .from(renderJobs)
        .where(and(eq(renderJobs.childId, dev.childId), inArray(renderJobs.status, ["queued", "running"])))
        .limit(1);
      holdBeep = busy.length > 0;
    }
    const sendCmds = holdBeep ? pendingCmds.filter((c) => c.type !== "beep") : pendingCmds;
    if (sendCmds.length > 0) {
      await db
        .update(deviceCommands)
        .set({ status: "sent" })
        .where(inArray(deviceCommands.id, sendCmds.map((c) => c.id)));
      const alertIds = sendCmds
        .map((c) => (c.payload as { alertId?: string } | null)?.alertId)
        .filter((id): id is string => typeof id === "string");
      if (alertIds.length > 0) {
        await db
          .update(alerts)
          .set({ deliveredAt: now })
          .where(and(inArray(alerts.id, alertIds), sql`${alerts.deliveredAt} is null`));
      }
    }

    // D-017 下次同步：有暂缓的蜂鸣 15 秒后再来；定时提醒临近时提前同步（到点 + 20 秒，renderer 每 15 秒检查）
    let nextSyncSeconds = dev.syncIntervalSeconds || 30;
    // D-021 睡眠时段（孩子档案的睡觉~起床时间）：放慢到 5 分钟；提醒与暂缓的蜂鸣仍按下面的规则提前
    const local = localClock(childTz, now);
    if (dev.childId && inSleepWindow(local.hhmm, sleepWindow.bedTime, sleepWindow.wakeTime)) {
      nextSyncSeconds = Math.max(nextSyncSeconds, SLEEP_SYNC_SECONDS);
    }
    if (holdBeep) nextSyncSeconds = 15;
    if (dev.childId) {
      const until = secondsUntilNextReminder(await remindersOf(dev.childId), local.seconds, local.isoWeekday);
      if (until !== null && until + 20 < nextSyncSeconds) nextSyncSeconds = Math.max(15, until + 20);
    }

    // OTA Manifest (docs/05 §7)
    let ota = null;
    const targetOtaVersion = process.env.KIDBOARD_OTA_VERSION;
    if (targetOtaVersion && targetOtaVersion !== body.firmwareVersion) {
      ota = {
        version: targetOtaVersion,
        url: process.env.KIDBOARD_OTA_URL || `/api/v1/device/firmware/${targetOtaVersion}/bin`,
        sha256: process.env.KIDBOARD_OTA_SHA256 || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mandatory: process.env.KIDBOARD_OTA_MANDATORY === "true",
        minBatteryPercent: null,
      };
    }

    const res = NextResponse.json({
      serverTime: now.toISOString(),
      // D-015 设备时钟：孩子时区此刻的 UTC 偏移（分钟，含夏令时）
      utcOffsetMinutes: utcOffsetMinutes(childTz, now),
      nextSyncSeconds,
      desiredFrame,
      pages,
      focus,
      refreshPolicy: {
        partialEnabled: true,
        partialMaxCount: 5,
        forceFullAfterHours: 24,
        partialAreaMaxRatio: 0.25,
      },
      interactiveTasks,
      ota,
      commands: sendCmds.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {} })),
    });


    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
