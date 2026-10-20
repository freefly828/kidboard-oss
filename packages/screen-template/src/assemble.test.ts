import { describe, expect, it } from "vitest";
import { assembleViewModel, applyOverrides } from "./assemble";
import { allFixtures } from "./fixtures";
import { clampViewModel, MAX_SCHEDULE_ITEMS, MAX_TASK_ITEMS } from "./types";

describe("assemble: 容量与截断（docs/06 §9）", () => {
  it("日程超 10 条截断", () => {
    const vm = assembleViewModel({
      dateLabel: "9月16日 周三",
      childName: "测试",
      isoWeekday: 3,
      today: "2026-09-16",
      schedule: Array.from({ length: 15 }, (_, i) => ({
        weekday: 3,
        startMinute: 480 + i * 30,
        endMinute: 510 + i * 30,
        title: `课程${i + 1}`,
        active: true,
      })),
      overrides: [],
      tasks: [],
      message: null,
    });
    expect(vm.schedule.length).toBe(MAX_SCHEDULE_ITEMS);
  });

  it("任务超 6 条截断且焦点=第一条 pending", () => {
    const vm = assembleViewModel({
      dateLabel: "x",
      childName: "x",
      isoWeekday: 3,
      today: "2026-09-16",
      schedule: [],
      overrides: [],
      tasks: Array.from({ length: 9 }, (_, i) => ({
        status: "pending" as const,
        title: `任务${i + 1}`,
        sortOrder: i,
        estimatedMinutes: null,
      })),
      message: null,
    });
    expect(vm.tasks.length).toBe(MAX_TASK_ITEMS);
    expect(vm.tasks[0]?.focused).toBe(true);
    expect(vm.tasks[1]?.focused).toBe(false);
  });

  it("全部完成时无焦点任务", () => {
    const vm = assembleViewModel({
      dateLabel: "x",
      childName: "x",
      isoWeekday: 3,
      today: "2026-09-16",
      schedule: [],
      overrides: [],
      tasks: [
        { status: "completed", title: "a", sortOrder: 0, estimatedMinutes: null },
      ],
      message: null,
    });
    expect(vm.tasks.every((t) => !t.focused)).toBe(true);
  });
});

describe("assemble: override 应用（PRD F04）", () => {
  const base = [{ id: "w-3-500", startMinute: 500, title: "数学" }];

  it("cancel 移除", () => {
    const out = applyOverrides(base, [
      { overrideDate: "2026-09-16", action: "cancel", targetScheduleItemId: "w-3-500", startMinute: null, endMinute: null, title: null },
    ]);
    expect(out.length).toBe(0);
  });

  it("replace 改时间", () => {
    const out = applyOverrides(base, [
      { overrideDate: "2026-09-16", action: "replace", targetScheduleItemId: "w-3-500", startMinute: 560, endMinute: 610, title: null },
    ]);
    expect(out[0]?.startMinute).toBe(560);
    expect(out[0]?.title).toBe("数学");
  });

  it("add 追加并按时间排序", () => {
    const vm = assembleViewModel({
      dateLabel: "x",
      childName: "x",
      isoWeekday: 3,
      today: "2026-09-16",
      schedule: [{ weekday: 3, startMinute: 500, endMinute: 550, title: "数学", active: true }],
      overrides: [{ overrideDate: "2026-09-16", action: "add", targetScheduleItemId: null, startMinute: 300, endMinute: 350, title: "晨会" }],
      tasks: [],
      message: null,
    });
    expect(vm.schedule[0]?.title).toBe("晨会"); // 300 < 500
    expect(vm.schedule[1]?.title).toBe("数学");
  });

  it("非今日 weekday 不显示（A03）", () => {
    const vm = assembleViewModel({
      dateLabel: "x",
      childName: "x",
      isoWeekday: 3,
      today: "2026-09-16",
      schedule: [
        { weekday: 4, startMinute: 500, endMinute: 550, title: "周四课", active: true },
        { weekday: 3, startMinute: 510, endMinute: 560, title: "周三课", active: true },
        { weekday: 3, startMinute: 520, endMinute: 570, title: "停用课", active: false },
      ],
      overrides: [],
      tasks: [],
      message: null,
    });
    expect(vm.schedule.length).toBe(1);
    expect(vm.schedule[0]?.title).toBe("周三课");
  });
});

describe("fixtures 完整性（docs/06 §10 八套快照）", () => {
  it("8 套基线 + D-013 两套（天气/古诗、明日预览）且 key 稳定", () => {
    expect(Object.keys(allFixtures).sort()).toEqual([
      "allCompleted",
      "emptyDay",
      "fullSchedule",
      "fullTasks",
      "largeFontEdge",
      "longChinese",
      "mixedContent",
      "offlineState",
      "tomorrowPrepare",
      "weatherAndPoem",
    ]);
  });

  it("全部 fixture 都满足容量上限", () => {
    for (const [name, vm] of Object.entries(allFixtures)) {
      const clamped = clampViewModel(vm);
      expect(clamped.schedule.length, `${name} schedule`).toBeLessThanOrEqual(MAX_SCHEDULE_ITEMS);
      expect(clamped.tasks.length, `${name} tasks`).toBeLessThanOrEqual(MAX_TASK_ITEMS);
      if (clamped.message !== null) {
        expect(clamped.message.length, `${name} message`).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("assemble: 任务 id 透传（Web/H5 端回写用）", () => {
  const base = {
    dateLabel: "x",
    childName: "x",
    isoWeekday: 3,
    today: "2026-09-16",
    schedule: [],
    overrides: [],
    message: null,
  };

  it("有 id 时按排序后的顺序透传", () => {
    const vm = assembleViewModel({
      ...base,
      tasks: [
        { id: "b", status: "pending", title: "后", sortOrder: 2, estimatedMinutes: null },
        { id: "a", status: "completed", title: "前", sortOrder: 1, estimatedMinutes: null },
      ],
    });
    expect(vm.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("无 id 时不产生 id 键（renderer 侧 VM 结构不变）", () => {
    const vm = assembleViewModel({
      ...base,
      tasks: [{ status: "pending", title: "t", sortOrder: 0, estimatedMinutes: null }],
    });
    expect("id" in vm.tasks[0]!).toBe(false);
  });
});
