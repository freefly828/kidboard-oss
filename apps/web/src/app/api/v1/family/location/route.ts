/**
 * 家庭天气城市（D-013）。
 * GET /api/v1/family/location → { location, isDefault, configured, today, tomorrow }（天气行预览）
 * PUT /api/v1/family/location { id, name, lat?, lon? }  guardian+
 *     保存后立即拉取该城市天气并让本家庭孩子的屏幕重渲染（无需等待每小时刷新）。
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@kidboard/db";
import { children, families } from "@kidboard/db/schema";
import {
  DEFAULT_LOCATION,
  familyLocation,
  qweatherConfig,
  refreshWeather,
  weatherLineFor,
} from "@kidboard/db/weather";
import { addDays, todayFor } from "@/lib/dates";
import { jsonError } from "@/lib/auth-guard";
import { bumpContentVersion } from "@/lib/content-version";
import { requireCurrentFamily } from "@/lib/family";

const locationSchema = z.object({
  id: z.string().trim().regex(/^\d{6,12}$/),
  name: z.string().trim().min(1).max(30),
  lat: z.string().trim().max(20).optional(),
  lon: z.string().trim().max(20).optional(),
});

export async function GET() {
  try {
    const { family } = await requireCurrentFamily();
    const loc = await familyLocation(family.id);
    const today = todayFor("Asia/Shanghai");
    const [t, m] = await Promise.all([weatherLineFor(family.id, today), weatherLineFor(family.id, addDays(today, 1))]);
    return NextResponse.json({
      location: loc,
      isDefault: loc.id === DEFAULT_LOCATION.id && !(await hasExplicitLocation(family.id)),
      configured: qweatherConfig() !== null,
      today: t,
      tomorrow: m,
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function hasExplicitLocation(familyId: string): Promise<boolean> {
  const row = (await db.select({ location: families.location }).from(families).where(eq(families.id, familyId)).limit(1))[0];
  return Boolean(row?.location);
}

export async function PUT(req: Request) {
  try {
    const { family } = await requireCurrentFamily("guardian");
    const loc = locationSchema.parse(await req.json());
    await db.update(families).set({ location: loc }).where(eq(families.id, family.id));

    let weatherError: string | null = null;
    const cfg = qweatherConfig();
    if (cfg) {
      try {
        await refreshWeather(cfg, loc.id);
      } catch (err) {
        weatherError = err instanceof Error ? err.message : String(err);
        console.error("qweather refresh failed:", weatherError);
      }
    }
    // 城市变化 → 顶栏天气变化，重渲染本家庭所有孩子的屏幕
    const kids = await db.select({ id: children.id }).from(children).where(eq(children.familyId, family.id));
    for (const k of kids) await bumpContentVersion(k.id);

    return NextResponse.json({ location: loc, weatherUpdated: cfg !== null && weatherError === null, configured: cfg !== null });
  } catch (err) {
    return jsonError(err);
  }
}
