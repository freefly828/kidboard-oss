import { describe, expect, it } from "vitest";
import { dateIn, needsRollover } from "./dayRollover.js";

describe("dayRollover: 跨天判定按孩子时区", () => {
  it("dateIn 按时区换算日期（UTC 16:30 = 上海次日 00:30）", () => {
    const at = new Date("2026-10-08T16:30:00Z");
    expect(dateIn("Asia/Shanghai", at)).toBe("2026-10-09");
    expect(dateIn("UTC", at)).toBe("2026-10-08");
  });

  it("帧生成于昨天（孩子时区）→ 需要跨天重渲染", () => {
    const frame = new Date("2026-10-08T15:00:00Z"); // 上海 10-08 23:00
    const now = new Date("2026-10-08T16:05:00Z"); // 上海 10-09 00:05
    expect(needsRollover(frame, "Asia/Shanghai", now)).toBe(true);
  });

  it("帧生成于今天 → 不需要", () => {
    const frame = new Date("2026-10-08T16:01:00Z"); // 上海 10-09 00:01
    const now = new Date("2026-10-09T03:00:00Z"); // 上海 10-09 11:00
    expect(needsRollover(frame, "Asia/Shanghai", now)).toBe(false);
  });

  it("同一 UTC 时刻在西半球时区尚未跨天 → 不需要", () => {
    const frame = new Date("2026-10-08T15:00:00Z");
    const now = new Date("2026-10-08T16:05:00Z");
    expect(needsRollover(frame, "America/Los_Angeles", now)).toBe(false);
  });
});

describe("dayRollover: 明日预览边界（D-013，preview_from=19:00，上海）", () => {
  const at = (iso: string) => new Date(iso);
  it("18:50 渲染、19:05 检查 → 进入明日预览需要重渲染", () => {
    expect(needsRollover(at("2026-10-09T10:50:00Z"), "Asia/Shanghai", at("2026-10-09T11:05:00Z"), "19:00")).toBe(true);
  });
  it("19:01 渲染、23:00 检查 → 同属明日预览，不重渲染", () => {
    expect(needsRollover(at("2026-10-09T11:01:00Z"), "Asia/Shanghai", at("2026-10-09T15:00:00Z"), "19:00")).toBe(false);
  });
  it("23:00（明日预览）渲染、次日 00:05 检查 → 切回今天模式需要重渲染", () => {
    expect(needsRollover(at("2026-10-09T15:00:00Z"), "Asia/Shanghai", at("2026-10-09T16:05:00Z"), "19:00")).toBe(true);
  });
  it("关闭明日预览（null）时 19:05 不触发", () => {
    expect(needsRollover(at("2026-10-09T10:50:00Z"), "Asia/Shanghai", at("2026-10-09T11:05:00Z"), null)).toBe(false);
  });
});
