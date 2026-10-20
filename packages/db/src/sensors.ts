/**
 * 设备传感器（D-016）— 室内温湿度与电池电量的显示规则（纯函数 + 读取），
 * sync 路由（决定是否重渲染）与屏幕取数共用。
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { devices } from "./schema";

/** 读数超过此时长视为过期（设备离线后不再显示室内温湿度） */
export const SENSOR_STALE_MS = 30 * 60 * 1000;
/** 室内读数变化后最快多久重渲染一次（避免温湿度小幅波动频繁刷屏） */
export const INDOOR_RERENDER_MIN_MS = 30 * 60 * 1000;
/** 电量 ≤ 此值在屏幕按键栏提示充电，后台提醒 */
export const LOW_BATTERY_PERCENT = 15;
/**
 * 锂电池合理电压下限（mV）：低于此值设备早已关机，只可能是测量异常（真机 2026-10-11 充电中报 2566 mV），
 * 这类读数一律当作"没有电量数据"，不提示电量低。
 */
export const BATTERY_MIN_PLAUSIBLE_MV = 3000;

export function batteryReadingPlausible(mv: number | null | undefined): boolean {
  return typeof mv === "number" && mv >= BATTERY_MIN_PLAUSIBLE_MV && mv <= 4500;
}

/** 后台铃铛提醒阈值（比屏幕提示早一些） */
export const BATTERY_NOTICE_PERCENT = 20;

export interface IndoorReading {
  /** 已校准、取整的温度 ℃ */
  temperatureC: number;
  /** 取整的相对湿度 % */
  humidityPct: number;
}

export interface IndoorShown {
  t: number | null;
  h: number | null;
  low: boolean;
  at: string;
}

/** 屏幕显示用的室内读数（温度加校准后取整，湿度取整） */
export function indoorOf(
  temperatureC: number | null,
  humidityPct: number | null,
  offset: number,
): IndoorReading | null {
  if (temperatureC === null || humidityPct === null || !Number.isFinite(temperatureC) || !Number.isFinite(humidityPct)) return null;
  return { temperatureC: Math.round(temperatureC + offset), humidityPct: Math.round(humidityPct) };
}

/**
 * 是否需要重渲染：低电状态变化立即；温度变化 ≥1℃ 或湿度跨 5% 档位且距上次 ≥30 分钟；
 * 首次出现读数立即。
 */
export function indoorNeedsRerender(prev: IndoorShown | null, next: IndoorShown, now: Date): boolean {
  if (!prev) return next.t !== null || next.low;
  if (prev.low !== next.low) return true;
  if ((prev.t === null) !== (next.t === null)) return true;
  if (next.t === null || prev.t === null) return false;
  const changed = prev.t !== next.t || Math.floor((prev.h ?? 0) / 5) !== Math.floor((next.h ?? 0) / 5);
  return changed && now.getTime() - new Date(prev.at).getTime() >= INDOOR_RERENDER_MIN_MS;
}

/** 孩子绑定设备的最新传感器状态（屏幕取数用） */
export async function sensorStateFor(childId: string, now = new Date()): Promise<{ indoor: IndoorReading | null; lowBattery: boolean }> {
  const row = (
    await db
      .select({
        temperatureC: devices.temperatureC,
        humidityPct: devices.humidityPct,
        temperatureOffset: devices.temperatureOffset,
        batteryPercent: devices.batteryPercent,
        batteryMv: devices.batteryMv,
        sensorAt: devices.sensorAt,
      })
      .from(devices)
      .where(and(eq(devices.childId, childId), isNull(devices.revokedAt)))
      .orderBy(desc(devices.sensorAt))
      .limit(1)
  )[0];
  if (!row?.sensorAt || now.getTime() - row.sensorAt.getTime() > SENSOR_STALE_MS) return { indoor: null, lowBattery: false };
  return {
    indoor: indoorOf(row.temperatureC, row.humidityPct, row.temperatureOffset ?? 0),
    lowBattery: batteryReadingPlausible(row.batteryMv) && row.batteryPercent !== null && row.batteryPercent <= LOW_BATTERY_PERCENT,
  };
}
