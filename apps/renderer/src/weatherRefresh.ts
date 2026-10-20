/**
 * 天气刷新（D-013）— renderer 每小时按家庭城市拉取和风天气 3 天预报写入 weather_cache。
 * 只有当某城市未来两天的顶栏文字发生变化时，才给该城市各家庭的孩子重渲染屏幕，避免每小时无谓刷新墨水屏。
 * 未配置 QWEATHER_API_KEY / QWEATHER_API_HOST 时直接跳过（屏幕不显示天气，其它内容不受影响）。
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, families, screenFrames, weatherCache } from "@kidboard/db/schema";
import {
  DEFAULT_LOCATION,
  qweatherConfig,
  refreshWeather,
  weatherLineOf,
  type FamilyLocation,
  type WeatherDay,
} from "@kidboard/db/weather";
import { enqueueRender } from "./dayRollover.js";

export interface WeatherRefreshResult {
  skipped?: "not_configured";
  locations: number;
  changed: string[];
  rerendered: number;
  errors: string[];
}

/** 未来两天（按缓存中的前两天）顶栏文字，用于判断是否需要重渲染 */
function linesOf(days: WeatherDay[]): string {
  return days
    .slice(0, 2)
    .map((d) => `${d.date}:${weatherLineOf(d)}`)
    .join("|");
}

export async function runWeatherRefresh(): Promise<WeatherRefreshResult> {
  const cfg = qweatherConfig();
  if (!cfg) return { skipped: "not_configured", locations: 0, changed: [], rerendered: 0, errors: [] };

  // 有已渲染屏幕的孩子所在家庭 → 城市
  const rows = await db
    .select({ childId: children.id, location: families.location })
    .from(children)
    .innerJoin(families, eq(families.id, children.familyId))
    .innerJoin(screenFrames, eq(screenFrames.childId, children.id))
    .where(eq(screenFrames.isActive, true));

  const childrenByLocation = new Map<string, string[]>();
  for (const r of rows) {
    const loc = (r.location as FamilyLocation | null)?.id ? (r.location as FamilyLocation) : DEFAULT_LOCATION;
    const list = childrenByLocation.get(loc.id) ?? [];
    list.push(r.childId);
    childrenByLocation.set(loc.id, list);
  }
  const locationIds = [...childrenByLocation.keys()];
  if (locationIds.length === 0) return { locations: 0, changed: [], rerendered: 0, errors: [] };

  const before = new Map(
    (await db.select().from(weatherCache).where(inArray(weatherCache.locationId, locationIds))).map((r) => [
      r.locationId,
      linesOf(((r.data as { daily?: WeatherDay[] }).daily ?? []) as WeatherDay[]),
    ]),
  );

  const result: WeatherRefreshResult = { locations: locationIds.length, changed: [], rerendered: 0, errors: [] };
  for (const id of locationIds) {
    try {
      const daily = await refreshWeather(cfg, id);
      if (linesOf(daily) !== before.get(id)) {
        result.changed.push(id);
        for (const childId of childrenByLocation.get(id) ?? []) {
          await enqueueRender(childId);
          result.rerendered++;
        }
      }
    } catch (err) {
      // 不在日志里输出 Key；错误信息只含 HTTP 状态与路径
      result.errors.push(`${id}: ${String(err instanceof Error ? err.message : err)}`);
    }
  }
  return result;
}
