import { describe, expect, it } from "vitest";
import { adviceOf, estimateWidthPx, weatherBriefOf, weatherLineOf, type WeatherDay } from "@kidboard/db/weather";

const day = (p: Partial<WeatherDay>): WeatherDay => ({
  date: "2026-10-09",
  textDay: "晴",
  textNight: "晴",
  tempMin: 15,
  tempMax: 22,
  precip: 0,
  windScaleDay: "1-3",
  ...p,
});

describe("天气与穿衣提醒（D-013）", () => {
  it("按平均温度给穿衣建议", () => {
    expect(adviceOf(day({ tempMin: 26, tempMax: 33 }))[0]).toBe("短袖防晒");
    expect(adviceOf(day({ tempMin: 13, tempMax: 25 }))[0]).toBe("加件薄外套");
    expect(adviceOf(day({ tempMin: -8, tempMax: 2 }))[0]).toBe("羽绒服手套");
  });
  it("下雨带伞、下雪防滑、温差大、风大", () => {
    expect(adviceOf(day({ textDay: "小雨" }))).toContain("带伞");
    expect(adviceOf(day({ textDay: "阴", precip: 1.2 }))).toContain("带伞");
    expect(adviceOf(day({ textNight: "小雪", tempMin: -3, tempMax: 2 }))).toContain("路滑注意保暖");
    expect(adviceOf(day({ tempMin: 10, tempMax: 24 }))).toContain("早晚温差大");
    expect(adviceOf(day({ windScaleDay: "5-6" }))).toContain("风大");
    expect(adviceOf(day({}))).toEqual(["加件薄外套"]);
  });
  it("两行天气：第 1 行天气温度，第 2 行提醒按重要性放入且不超出宽度", () => {
    const b = weatherBriefOf(day({ textDay: "雷阵雨转中雨", tempMin: -10, tempMax: 4, windScaleDay: "6-7", textNight: "小雪" }));
    expect(b.summary).toBe("雷阵雨转中雨 -10~4℃");
    // 极端组合超出 360px 预算时，丢弃最不重要的"风大"
    expect(b.advice).toBe("羽绒服手套 · 路滑注意保暖 · 早晚温差大");
    expect(estimateWidthPx(b.advice)).toBeLessThanOrEqual(360);
    expect(weatherBriefOf(day({ textDay: "多云", tempMin: 13, tempMax: 25 }))).toEqual({ summary: "多云 13~25℃", advice: "加件薄外套 · 早晚温差大" });
    expect(weatherLineOf(day({ textDay: "多云", tempMin: 13, tempMax: 25 }))).toBe("多云 13~25℃ · 加件薄外套 · 早晚温差大");
  });
});
