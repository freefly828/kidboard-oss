import { describe, expect, it } from "vitest";
import { inSleepWindow, localClock, reminderDue, secondsUntilNextReminder } from "@kidboard/db/alerts";

const weekday = { remindAt: "07:20", weekdays: [1, 2, 3, 4, 5], active: true };

describe("D-017 定时提醒触发规则", () => {
  it("到点后 5 分钟内触发；之前、之后、非所选星期、已暂停都不触发", () => {
    expect(reminderDue(weekday, "07:20", 1)).toBe(true);
    expect(reminderDue(weekday, "07:24", 5)).toBe(true);
    expect(reminderDue(weekday, "07:19", 1)).toBe(false);
    expect(reminderDue(weekday, "07:25", 1)).toBe(false);
    expect(reminderDue(weekday, "07:20", 6)).toBe(false);
    expect(reminderDue({ ...weekday, active: false }, "07:20", 1)).toBe(false);
  });

  it("距离今天下一个提醒的秒数（用于缩短设备同步间隔）", () => {
    const list = [weekday, { remindAt: "21:00", weekdays: [1, 2, 3, 4, 5, 6, 7], active: true }];
    expect(secondsUntilNextReminder(list, 7 * 3600 + 19 * 60 + 30, 1)).toBe(30);
    expect(secondsUntilNextReminder(list, 8 * 3600, 1)).toBe(13 * 3600);
    expect(secondsUntilNextReminder(list, 8 * 3600, 6)).toBe(13 * 3600);
    expect(secondsUntilNextReminder(list, 22 * 3600, 1)).toBeNull();
  });

  it("孩子时区的本地时钟", () => {
    const c = localClock("Asia/Shanghai", new Date("2026-10-09T23:20:05Z"));
    expect(c).toEqual({ date: "2026-10-10", hhmm: "07:20", isoWeekday: 6, seconds: 7 * 3600 + 20 * 60 + 5 });
  });
});

describe("D-021 睡眠时段", () => {
  it("跨午夜 21:00~07:00", () => {
    expect(inSleepWindow("21:00", "21:00", "07:00")).toBe(true);
    expect(inSleepWindow("23:59", "21:00", "07:00")).toBe(true);
    expect(inSleepWindow("06:59", "21:00", "07:00")).toBe(true);
    expect(inSleepWindow("07:00", "21:00", "07:00")).toBe(false);
    expect(inSleepWindow("20:59", "21:00", "07:00")).toBe(false);
  });
  it("不跨午夜（午睡 13:00~14:00）与未设置", () => {
    expect(inSleepWindow("13:30", "13:00", "14:00")).toBe(true);
    expect(inSleepWindow("14:00", "13:00", "14:00")).toBe(false);
    expect(inSleepWindow("22:00", null, "07:00")).toBe(false);
    expect(inSleepWindow("22:00", "21:00", "21:00")).toBe(false);
    expect(inSleepWindow("22:00", "9:00", "07:00")).toBe(false);
  });
});
