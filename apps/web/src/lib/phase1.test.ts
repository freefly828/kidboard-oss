/**
 * 纯逻辑单元测试 — 无 DB 依赖（occurrence 规则 + 日期 + 校验 schema）。
 * API 集成测试走 compose 冒烟（见 .cluster 工作台 verify 记录）。
 */

import { describe, expect, it } from "vitest";
import { occursOn, type Recurrence } from "@kidboard/db/materialize";
import { todayFor, isValidDate } from "./dates";
import { messageSchema, scheduleItemSchema } from "./schemas";

describe("recurrence rules (docs/04 §6)", () => {
  const weekly: Recurrence = {
    type: "weekly",
    weekdays: [1, 2, 3, 4, 5],
    startDate: "2026-09-01",
    endDate: null,
  };
  it("weekly 工作日模板：Mon-Fri 生成、周末不生成（A03）", () => {
    // 2026-09-14 是周一, 2026-09-19 是周六
    expect(occursOn(weekly, "2026-09-14")).toBe(true); // Mon
    expect(occursOn(weekly, "2026-09-18")).toBe(true); // Fri
    expect(occursOn(weekly, "2026-09-19")).toBe(false); // Sat
    expect(occursOn(weekly, "2026-09-20")).toBe(false); // Sun
  });
  it("startDate 之前不生成", () => {
    expect(occursOn(weekly, "2026-08-31")).toBe(false);
  });
  it("endDate 之后不生成", () => {
    const bounded: Recurrence = { ...weekly, endDate: "2026-09-10" };
    expect(occursOn(bounded, "2026-09-11")).toBe(false);
    expect(occursOn(bounded, "2026-09-10")).toBe(true);
  });
  it("daily 每天；once 只有一天", () => {
    const daily: Recurrence = { type: "daily", startDate: "2026-09-01", endDate: null };
    expect(occursOn(daily, "2026-09-15")).toBe(true);
    const once: Recurrence = { type: "once", startDate: "2026-09-15" };
    expect(occursOn(once, "2026-09-15")).toBe(true);
    expect(occursOn(once, "2026-09-16")).toBe(false);
  });
});

describe("date utils (docs/03 §7 child timezone)", () => {
  it("todayFor 返回 YYYY-MM-DD", () => {
    expect(todayFor("Asia/Shanghai")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayFor("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("isValidDate", () => {
    expect(isValidDate("2026-09-15")).toBe(true);
    expect(isValidDate("2026-9-15")).toBe(false);
    expect(isValidDate("abc")).toBe(false);
  });
});

describe("zod schemas", () => {
  it("留言超 60 字拒绝（A05: 不静默截断）", () => {
    const long = "a".repeat(61);
    expect(() =>
      messageSchema.parse({ messageDate: "2026-09-15", body: long }),
    ).toThrow();
    const ok = messageSchema.parse({
      messageDate: "2026-09-15",
      body: "今天英语完成后可以看一会儿动画片。",
    });
    expect(ok.body.length).toBeLessThanOrEqual(60);
  });
  it("课程时间 end <= start 拒绝", () => {
    expect(() =>
      scheduleItemSchema.parse({
        weekday: 1,
        startMinute: 500,
        endMinute: 500,
        title: "数学",
        sortOrder: 0,
        active: true,
      }),
    ).toThrow();
    const ok = scheduleItemSchema.parse({
      weekday: 1,
      startMinute: 500,
      endMinute: 550,
      title: "数学",
      sortOrder: 0,
      active: true,
    });
    expect(ok.endMinute).toBe(550);
  });
});
