/**
 * 天气与穿衣提醒（D-013）— 数据源：和风天气（QWeather）。
 * - renderer 每小时按家庭城市拉取 3 天预报写入 weather_cache（设备不直连天气服务）；
 * - 屏幕顶栏只读缓存，按"展示日"取当天预报生成一行文字；无缓存/未配置 Key 时不显示。
 * Key 与 API Host 只来自环境变量 QWEATHER_API_KEY / QWEATHER_API_HOST（不入库）。
 */

import { eq } from "drizzle-orm";
import { db } from "./index";
import { families, weatherCache } from "./schema";

export interface FamilyLocation {
  /** 和风 location id，如北京 101010100 */
  id: string;
  name: string;
  lat?: string;
  lon?: string;
}

/** 家庭未设置城市时的默认城市 */
export const DEFAULT_LOCATION: FamilyLocation = { id: "101010100", name: "北京" };

export interface WeatherDay {
  date: string;
  textDay: string;
  textNight: string;
  tempMin: number;
  tempMax: number;
  /** 降水量 mm */
  precip: number;
  windScaleDay: string;
  uvIndex?: number;
}

/** "3-4" → 4；"5" → 5 */
function maxWindScale(scale: string): number {
  const nums = (scale.match(/\d+/g) ?? []).map(Number);
  return nums.length ? Math.max(...nums) : 0;
}

/** 根据温度、降水、风力生成穿衣/出行提醒（纯函数） */
export function adviceOf(d: WeatherDay): string[] {
  const out: string[] = [];
  const avg = (d.tempMin + d.tempMax) / 2;
  if (avg >= 28) out.push("短袖防晒");
  else if (avg >= 22) out.push("短袖薄衫");
  else if (avg >= 15) out.push("加件薄外套");
  else if (avg >= 8) out.push("穿外套毛衣");
  else if (avg >= 0) out.push("穿厚外套");
  else out.push("羽绒服手套");
  const wet = `${d.textDay}${d.textNight}`;
  if (/雪/.test(wet)) out.push("路滑注意保暖");
  else if (/雨/.test(wet) || d.precip >= 0.5) out.push("带伞");
  if (d.tempMax - d.tempMin >= 10) out.push("早晚温差大");
  if (maxWindScale(d.windScaleDay) >= 5) out.push("风大");
  return out;
}

/** 顶栏天气区宽约 380px：第 2 行提醒 16px，中文约 16px、数字/符号/空格约 9px，留余量 */
const ADVICE_MAX_PX = 360;

export function estimateWidthPx(text: string, cjkPx = 16, asciiPx = 9): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) <= 0xff ? asciiPx : cjkPx;
  return w;
}

/** 顶栏两行天气：第 1 行"多云 13~25℃"，第 2 行"加件薄外套 · 早晚温差大"（按重要性放入，放不下的丢弃） */
export interface WeatherBrief {
  summary: string;
  advice: string;
}

export function weatherBriefOf(d: WeatherDay): WeatherBrief {
  let advice = "";
  for (const a of adviceOf(d)) {
    const next = advice ? `${advice} · ${a}` : a;
    if (estimateWidthPx(next) > ADVICE_MAX_PX) break;
    advice = next;
  }
  return { summary: `${d.textDay} ${d.tempMin}~${d.tempMax}℃`, advice };
}

/** 单行文本（设置页预览、变化检测用） */
export function weatherLineOf(d: WeatherDay): string {
  const b = weatherBriefOf(d);
  return b.advice ? `${b.summary} · ${b.advice}` : b.summary;
}

export async function familyLocation(familyId: string): Promise<FamilyLocation> {
  const row = (await db.select({ location: families.location }).from(families).where(eq(families.id, familyId)).limit(1))[0];
  const loc = row?.location as FamilyLocation | null | undefined;
  return loc?.id ? loc : DEFAULT_LOCATION;
}

async function weatherDayFor(familyId: string, date: string): Promise<WeatherDay | null> {
  const loc = await familyLocation(familyId);
  const row = (await db.select().from(weatherCache).where(eq(weatherCache.locationId, loc.id)).limit(1))[0];
  const days = (row?.data as { daily?: WeatherDay[] } | undefined)?.daily ?? [];
  const day = days.find((d) => d.date === date);
  return day ?? null;
}

/** 读取缓存中某家庭某天的两行天气；无缓存返回 null */
export async function weatherBriefFor(familyId: string, date: string): Promise<WeatherBrief | null> {
  const day = await weatherDayFor(familyId, date);
  return day ? weatherBriefOf(day) : null;
}

/** 读取缓存中某家庭某天的单行天气；无缓存返回 null */
export async function weatherLineFor(familyId: string, date: string): Promise<string | null> {
  const day = await weatherDayFor(familyId, date);
  return day ? weatherLineOf(day) : null;
}

/* ---------------- 和风天气 API（服务端） ---------------- */

export interface QWeatherConfig {
  key: string;
  host: string;
}

export function qweatherConfig(env: Record<string, string | undefined> = process.env): QWeatherConfig | null {
  const key = env.QWEATHER_API_KEY?.trim();
  const host = env.QWEATHER_API_HOST?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return key && host ? { key, host } : null;
}

async function qweatherGet(cfg: QWeatherConfig, path: string, params: Record<string, string>): Promise<unknown> {
  const url = `https://${cfg.host}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { "X-QW-Api-Key": cfg.key }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`QWeather HTTP ${res.status} ${path}`);
  const body = (await res.json()) as { code?: string };
  if (body.code !== "200") throw new Error(`QWeather code ${body.code} ${path}`);
  return body;
}

/** 3 天逐日预报 */
export async function fetchForecast3d(cfg: QWeatherConfig, locationId: string): Promise<WeatherDay[]> {
  const body = (await qweatherGet(cfg, "/v7/weather/3d", { location: locationId })) as {
    daily: { fxDate: string; textDay: string; textNight: string; tempMin: string; tempMax: string; precip: string; windScaleDay: string; uvIndex?: string }[];
  };
  return body.daily.map((d) => ({
    date: d.fxDate,
    textDay: d.textDay,
    textNight: d.textNight,
    tempMin: Number(d.tempMin),
    tempMax: Number(d.tempMax),
    precip: Number(d.precip) || 0,
    windScaleDay: d.windScaleDay,
    uvIndex: d.uvIndex ? Number(d.uvIndex) : undefined,
  }));
}

/** 城市搜索（设置页选择城市） */
export async function searchCity(cfg: QWeatherConfig, query: string): Promise<(FamilyLocation & { adm1: string; adm2: string })[]> {
  const body = (await qweatherGet(cfg, "/geo/v2/city/lookup", { location: query, number: "10", range: "cn" })) as {
    location?: { id: string; name: string; lat: string; lon: string; adm1: string; adm2: string }[];
  };
  return (body.location ?? []).map((l) => ({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, adm1: l.adm1, adm2: l.adm2 }));
}

/** 拉取并写入缓存；返回新数据 */
export async function refreshWeather(cfg: QWeatherConfig, locationId: string): Promise<WeatherDay[]> {
  const daily = await fetchForecast3d(cfg, locationId);
  await db
    .insert(weatherCache)
    .values({ locationId, data: { daily }, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: weatherCache.locationId, set: { data: { daily }, fetchedAt: new Date() } });
  return daily;
}
