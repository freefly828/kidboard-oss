/**
 * 天气城市搜索（D-013）— 代理和风天气 GeoAPI（Key 只在服务端）。
 * GET /api/v1/family/location/search?q=杭州 → { configured, results[] }
 */

import { NextResponse } from "next/server";
import { qweatherConfig, searchCity } from "@kidboard/db/weather";
import { ApiError, jsonError, requireUser } from "@/lib/auth-guard";

export async function GET(req: Request) {
  try {
    await requireUser();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 1 || q.length > 30) throw new ApiError(400, "validation", "请输入城市名称");
    const cfg = qweatherConfig();
    if (!cfg) return NextResponse.json({ configured: false, results: [] });
    try {
      return NextResponse.json({ configured: true, results: await searchCity(cfg, q) });
    } catch (err) {
      console.error("qweather city search failed:", err instanceof Error ? err.message : err);
      throw new ApiError(502, "weather_unavailable", "天气服务暂时不可用，请稍后再试");
    }
  } catch (err) {
    return jsonError(err);
  }
}
