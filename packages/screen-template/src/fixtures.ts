/**
 * 8 套 fixture — docs/06 §10 快照测试要求的固定场景。
 * Phase 3 renderer 的 visual regression 以这些为基线。
 */

import type { ScreenViewModel } from "./types";
import { POEMS } from "./poems";

const base: ScreenViewModel = {
  dateLabel: "9月16日 周三",
  childName: "小冒烟",
  syncStatus: "synced",
  schedule: [],
  tasks: [],
  message: null,
};

/** 1. 空白日程 */
export const emptyDay: ScreenViewModel = { ...base };

/** 2. 日程满（5 条） */
export const fullSchedule: ScreenViewModel = {
  ...base,
  schedule: [
    { time: "08:20", title: "到校" },
    { time: "09:10", title: "数学" },
    { time: "10:20", title: "体育" },
    { time: "13:30", title: "英语" },
    { time: "15:00", title: "放学" },
  ],
};

/** 3. 任务满（6 条） */
export const fullTasks: ScreenViewModel = {
  ...base,
  schedule: [{ time: "08:20", title: "到校" }],
  tasks: [
    { focused: true, status: "pending", title: "晨读", estimate: "15分钟", points: 5 },
    { focused: false, status: "pending", title: "整理书包" },
    { focused: false, status: "pending", title: "英语听力", estimate: "15分钟" },
    { focused: false, status: "pending", title: "阅读", estimate: "20分钟" },
    { focused: false, status: "pending", title: "口算练习" },
    { focused: false, status: "pending", title: "收拾玩具" },
  ],
};

/** 4. 全部完成 */
export const allCompleted: ScreenViewModel = {
  ...base,
  tasks: [
    { focused: false, status: "completed", title: "晨读" },
    { focused: false, status: "completed", title: "整理书包" },
    { focused: false, status: "completed", title: "英语听力" },
    { focused: false, status: "completed", title: "阅读" },
  ],
  message: "今天全部完成，太棒了！",
};

/** 5. 超长中文（接近 60 字上限） */
export const longChinese: ScreenViewModel = {
  ...base,
  schedule: [{ time: "09:10", title: "语文课代表要收作业请提前准备好" }],
  tasks: [
    { focused: false, status: "pending", title: "完成课后练习册第十二页到第十四页的所有题目" },
  ],
  message:
    "今天放学后先写作业再下楼玩，写完作业可以看二十分钟动画片，记得保护眼睛不要揉眼睛。",
};

/** 6. 英文/数字混排 */
export const mixedContent: ScreenViewModel = {
  ...base,
  schedule: [
    { time: "08:00", title: "School Bus No.37" },
    { time: "09:10", title: "Math - Chapter 5" },
  ],
  tasks: [
    { focused: true, status: "pending", title: "Read English 20 min" },
    { focused: false, status: "pending", title: "口算 100 题" },
    { focused: false, status: "completed", title: "ABC vocabulary" },
  ],
  message: "Math homework due Friday 9/18, don't forget!",
};

/** 7. 离线状态（含底部小型提示，不覆盖主内容） */
export const offlineState: ScreenViewModel = {
  ...base,
  syncStatus: "offline",
  schedule: [{ time: "08:20", title: "到校" }],
  tasks: [{ focused: true, status: "pending", title: "晨读" }],
  message: "已显示最近内容",
  offlineNotice: "云端暂不可用 · 已显示最近内容",
};

/** 8. 大字体边界（焦点任务 + 最长合理文本） */
export const largeFontEdge: ScreenViewModel = {
  ...base,
  schedule: [
    { time: "23:59", title: "最晚睡觉时间到点检查" },
  ],
  tasks: [
    {
      focused: true,
      status: "pending",
      title: "练习乒乓球反手拧拉动作三十分钟",
      estimate: "30分钟",
      points: 100,
    },
  ],
  message: "记得喝水，运动完擦汗换衣服别着凉。",
};

/** 9. D-013 天气 + 最长的古诗 + 任务满：顶栏与底部最拥挤的组合 */
export const weatherAndPoem: ScreenViewModel = {
  ...fullTasks,
  weather: { summary: "雷阵雨转中雨 -10~4℃", advice: "羽绒服手套 · 路滑注意保暖 · 早晚温差大 · 风大" },
  // D-016 最长组合：天气 + 室内读数（两位负温度）+ 电量低
  indoor: { temperatureC: -12, humidityPct: 100 },
  lowBattery: true,
  // D-017 最长提醒横幅（40 字上限）
  alert: { kind: "instant", text: "回家吃饭啦！今天有你最爱吃的红烧排骨，洗完手就来餐桌前坐好，别忘了帮妈妈摆碗筷哦" },
  poem: [...POEMS].sort((a, b) => `${b.title}${b.author}${b.text}`.length - `${a.title}${a.author}${a.text}`.length)[0]!,
};

/** 10. D-013 明日预览 + 8 件需准备物品 + 天气 */
export const tomorrowPrepare: ScreenViewModel = {
  ...mixedContent,
  mode: "tomorrow",
  dateLabel: "9月17日 周四",
  tasks: mixedContent.tasks.map((t) => ({ ...t, focused: false })),
  weather: { summary: "多云 14~26℃", advice: "加件薄外套 · 早晚温差大" },
  prepare: ["泳衣", "泳镜", "毛巾", "水彩笔", "调色盘", "跳绳", "数学练习册", "家长签字的通知单"],
};

export const allFixtures: Record<string, ScreenViewModel> = {
  emptyDay,
  fullSchedule,
  fullTasks,
  allCompleted,
  longChinese,
  mixedContent,
  offlineState,
  largeFontEdge,
  weatherAndPoem,
  tomorrowPrepare,
};
