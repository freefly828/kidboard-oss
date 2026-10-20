import { describe, expect, it } from "vitest";
import { bottomText, columnText, headerText, keysText } from "./screenText";
import { POEMS, poemOfDay } from "./poems";
import type { ScreenViewModel } from "./types";

const base: ScreenViewModel = { dateLabel: "10月9日 周五", childName: "小测", syncStatus: "synced", schedule: [], tasks: [], message: null };
const poem = { title: "静夜思", author: "李白", text: "床前明月光，疑是地上霜。举头望明月，低头思故乡。" };

describe("screenText（D-013）", () => {
  it("今天模式：标题与按键", () => {
    expect(headerText(base)).toMatchObject({ left: "10月9日 周五", middle: "小测的今天", right: "● 已同步", weather: null });
    expect(columnText(base).scheduleTitle).toBe("今日安排");
    expect(keysText(base)).toEqual(["DONE 完成", "NEXT 下一项", "BACK 返回", "按住 NEXT 翻页"]);
  });
  it("明日预览：标题、按键提示与需准备优先", () => {
    const vm = { ...base, mode: "tomorrow" as const, prepare: ["泳衣", "水彩笔"], message: "早点睡", poem };
    expect(headerText(vm).left).toBe("明天 10月9日 周五");
    expect(headerText(vm).middle).toBe("小测的明天");
    expect(columnText(vm).tasksTitle).toBe("明日任务");
    expect(bottomText(vm)).toEqual({ kind: "prepare", label: "明天需准备：", text: "泳衣、水彩笔" });
    expect(keysText(vm)).toEqual(["明日预览 · 0 点自动切回今天", "按住 NEXT 翻页"]);
  });
  it("底部：留言优先于古诗，无留言显示古诗", () => {
    expect(bottomText({ ...base, message: "加油", poem }).kind).toBe("message");
    expect(bottomText({ ...base, poem })).toMatchObject({ kind: "poem", label: "《静夜思》李白  " });
    expect(bottomText(base).kind).toBe("empty");
  });
  it("天气在顶栏右侧分两行显示（替代同步状态）", () => {
    expect(headerText({ ...base, weather: { summary: "晴 12~22℃", advice: "加件薄外套 · 带伞" } }).weather).toEqual({ summary: "晴 12~22℃", advice: "加件薄外套 · 带伞" });
  });
  it("每日古诗：同一天固定、相邻两天不同，且全文能放进底部两行", () => {
    expect(poemOfDay("2026-10-09")).toEqual(poemOfDay("2026-10-09"));
    expect(poemOfDay("2026-10-09")).not.toEqual(poemOfDay("2026-10-10"));
    for (const p of POEMS) expect(`《${p.title}》${p.author}  ${p.text}`.length, p.title).toBeLessThanOrEqual(66);
  });
});

describe("screenText（D-016 室内温湿度 / 电量）", () => {
  it("室内读数接在天气第 1 行后；无天气时单独显示", () => {
    const withWeather = headerText({ ...base, weather: { summary: "晴 12~22℃", advice: "加件薄外套" }, indoor: { temperatureC: 24, humidityPct: 55 } });
    expect(withWeather.weather).toEqual({ summary: "晴 12~22℃ · 室内 24℃ 55%", advice: "加件薄外套" });
    expect(headerText({ ...base, indoor: { temperatureC: 24, humidityPct: 55 } }).weather).toEqual({ summary: "室内 24℃ 55%", advice: "" });
    expect(headerText(base).weather).toBeNull();
  });

  it("电量低时按键栏最后提示充电（今天与明日预览都显示）", () => {
    expect(keysText({ ...base, lowBattery: true })).toEqual(["DONE 完成", "NEXT 下一项", "BACK 返回", "按住 NEXT 翻页", "电量低 请充电"]);
    expect(keysText({ ...base, mode: "tomorrow", lowBattery: true }).at(-1)).toBe("电量低 请充电");
  });
});

describe("screenText（D-017 提醒横幅）", () => {
  it("提醒横幅优先于留言、需准备物品与古诗", () => {
    const vm = { ...base, message: "加油", mode: "tomorrow" as const, prepare: ["泳衣"], alert: { kind: "instant" as const, text: "回家吃饭啦" } };
    expect(bottomText(vm)).toEqual({ kind: "alert", label: "家长提醒：", text: "回家吃饭啦" });
    expect(bottomText({ ...base, alert: { kind: "reminder", text: "该出门了" } }).label).toBe("提醒：");
    expect(bottomText({ ...base, message: "加油", alert: { kind: "instant", text: "  " } }).kind).toBe("message");
  });
});
