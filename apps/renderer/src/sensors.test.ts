import { describe, expect, it } from "vitest";
import { indoorNeedsRerender, indoorOf, type IndoorShown } from "@kidboard/db/sensors";

const at = (iso: string) => new Date(iso);
const shown = (t: number | null, h: number | null, low = false, iso = "2026-10-10T08:00:00Z"): IndoorShown => ({ t, h, low, at: iso });

describe("D-016 室内读数显示规则", () => {
  it("校准后取整；缺读数返回 null", () => {
    expect(indoorOf(26.4, 55.6, -2)).toEqual({ temperatureC: 24, humidityPct: 56 });
    expect(indoorOf(null, 50, 0)).toBeNull();
    expect(indoorOf(Number.NaN, 50, 0)).toBeNull();
  });

  it("首次出现读数或低电立即重渲染", () => {
    expect(indoorNeedsRerender(null, shown(24, 55), at("2026-10-10T08:00:00Z"))).toBe(true);
    expect(indoorNeedsRerender(null, shown(null, null, false), at("2026-10-10T08:00:00Z"))).toBe(false);
    expect(indoorNeedsRerender(shown(24, 55, false), shown(24, 55, true), at("2026-10-10T08:01:00Z"))).toBe(true);
  });

  it("温湿度变化 30 分钟内不重渲染，之后重渲染；同档湿度不算变化", () => {
    const prev = shown(24, 55);
    expect(indoorNeedsRerender(prev, shown(25, 55), at("2026-10-10T08:10:00Z"))).toBe(false);
    expect(indoorNeedsRerender(prev, shown(25, 55), at("2026-10-10T08:30:00Z"))).toBe(true);
    expect(indoorNeedsRerender(prev, shown(24, 57), at("2026-10-10T09:00:00Z"))).toBe(false);
    expect(indoorNeedsRerender(prev, shown(24, 61), at("2026-10-10T09:00:00Z"))).toBe(true);
  });
});
