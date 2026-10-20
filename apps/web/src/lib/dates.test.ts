import { describe, expect, it } from "vitest";
import { utcOffsetMinutes } from "./dates";

describe("utcOffsetMinutes（D-015 设备时钟时区偏移）", () => {
  it("固定偏移时区", () => {
    expect(utcOffsetMinutes("Asia/Shanghai", new Date("2026-10-09T17:56:26.878Z"))).toBe(480);
    expect(utcOffsetMinutes("Asia/Kolkata", new Date("2026-10-09T00:00:00Z"))).toBe(330);
    expect(utcOffsetMinutes("UTC", new Date("2026-10-09T12:00:00Z"))).toBe(0);
  });

  it("夏令时随日期变化", () => {
    expect(utcOffsetMinutes("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(utcOffsetMinutes("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe(-300);
  });
});
