import { describe, expect, it } from "vitest";
import { assemblePointsPage, assembleWeekPage, pageKeysText, pageTitle, PAGE_COUNT, weekDatesOf } from "./pages";

describe("D-018 附加页组装", () => {
  it("weekDatesOf：返回所在周的周一到周日", () => {
    expect(weekDatesOf("2026-10-10")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(weekDatesOf("2026-10-05")[0]).toBe("2026-10-05");
    expect(weekDatesOf("2026-10-11")[6]).toBe("2026-10-11");
  });

  it("本周课表：按星期分列、排序，应用当天的停课/加课，标记今天", () => {
    const weekDates = weekDatesOf("2026-10-07");
    const vm = assembleWeekPage({
      schedule: [
        { id: "a", weekday: 3, startMinute: 600, endMinute: 640, title: "数学", active: true },
        { id: "b", weekday: 3, startMinute: 500, endMinute: 540, title: "语文", active: true },
        { id: "c", weekday: 1, startMinute: 500, endMinute: 540, title: "英语", active: true },
        { id: "d", weekday: 2, startMinute: 500, endMinute: 540, title: "停用", active: false },
      ],
      overrides: [
        { overrideDate: "2026-10-05", action: "cancel", targetScheduleItemId: "c", startMinute: null, endMinute: null, title: null },
        { overrideDate: "2026-10-07", action: "add", targetScheduleItemId: null, startMinute: 900, endMinute: 940, title: "游泳", active: true } as never,
      ],
      weekDates,
      today: "2026-10-07",
    });
    expect(vm.days).toHaveLength(7);
    expect(vm.days[0]!.entries).toEqual([]);
    expect(vm.days[1]!.entries).toEqual([]);
    expect(vm.days[2]).toMatchObject({ label: "周三", dateLabel: "10/7", isToday: true });
    expect(vm.days[2]!.entries.map((e) => `${e.time} ${e.title}`)).toEqual(["08:20 语文", "10:00 数学", "15:00 游泳"]);
  });

  it("积分页：心愿按价格升序取前 4，流水取前 4", () => {
    const vm = assemblePointsPage({
      balance: 128,
      weekEarned: 36,
      rewards: [5, 1, 4, 2, 3].map((n) => ({ title: `心愿${n}`, cost: n * 100 })),
      recent: Array.from({ length: 6 }, (_, i) => ({ date: "2026-10-09", reason: `任务${i}`, delta: 5 })),
    });
    expect(vm.rewards.map((r) => r.cost)).toEqual([100, 200, 300, 400]);
    expect(vm.recent).toHaveLength(4);
    expect(vm.recent[0]).toEqual({ dateLabel: "10/9", reason: "任务0", delta: 5 });
  });

  it("页面标题与按键栏", () => {
    expect(pageTitle("week", "小满")).toBe("小满的本周课表");
    expect(pageTitle("points", "小满")).toBe("小满的积分商城");
    expect(pageKeysText(1)).toEqual(["BACK 上一页", `第 2/${PAGE_COUNT} 页`, "NEXT 下一页"]);
    // D-025 最后一页 NEXT 回首页（翻页循环）
    expect(pageKeysText(PAGE_COUNT - 1).at(-1)).toBe("NEXT 回首页");
    expect(pageKeysText(3, 4, "focus")).toEqual(["DONE 开始/暂停", "BACK 结束", "第 4/4 页", "NEXT 回首页"]);
  });
});
