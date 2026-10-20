/**
 * Zod schemas — 边界输入统一校验。
 * API 请求体 schema 与 openapi.yaml / docs/04 对齐。
 */

import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(255);
export const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60),
  familyName: z.string().trim().min(1).max(60).default("我的家"),
  /** D-012 带邀请码注册：加入对方家庭而不新建家庭 */
  inviteCode: z.string().trim().min(6).max(20).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const childCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(30),
  timezone: z
    .string()
    .trim()
    .refine((v) => isValidTimezone(v), "Must be a valid IANA timezone")
    .default("Asia/Shanghai"),
});

export const childUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(30).optional(),
  timezone: z
    .string()
    .trim()
    .refine((v) => isValidTimezone(v), "Must be a valid IANA timezone")
    .optional(),
  /** D-012 档案扩展（childProfileSchema 定义在下方，lazy 引用） */
  profile: z.lazy(() => childProfileSchema).optional(),
  /** D-013 明日预览开始时间 HH:MM（null = 关闭） */
  previewFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  /** D-019 专注计时 */
  focusMinutes: z.number().int().min(5).max(90).optional(),
  focusPoints: z.number().int().min(0).max(50).optional(),
  focusDailyCap: z.number().int().min(0).max(10).optional(),
});

/** PRD F06: 最多建议 60 个中文字符；超长必须提示，不能静默截断 */
export const MESSAGE_MAX_CHARS = 60;
export const messageSchema = z.object({
  messageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  body: z.string().trim().min(1).max(MESSAGE_MAX_CHARS),
});

export const weekdaySchema = z.number().int().min(1).max(7);
export const minuteSchema = z.number().int().min(0).max(1439);
export const endMinuteSchema = z.number().int().min(1).max(1440);

export const scheduleItemSchema = z
  .object({
    weekday: weekdaySchema,
    startMinute: minuteSchema,
    endMinute: endMinuteSchema,
    title: z.string().trim().min(1).max(60),
    category: z.string().trim().max(30).nullish(),
    location: z.string().trim().max(60).nullish(),
    note: z.string().trim().max(120).nullish(),
    /** D-013 需准备的物品（明日预览底部汇总） */
    prepare: z.string().trim().max(60).nullish(),
    sortOrder: z.number().int().min(0).max(999).default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => v.endMinute > v.startMinute, {
    message: "endMinute must be > startMinute",
    path: ["endMinute"],
  });

export const scheduleItemUpdateSchema = z.object({
  weekday: weekdaySchema.optional(),
  startMinute: minuteSchema.optional(),
  endMinute: endMinuteSchema.optional(),
  title: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().max(30).nullish(),
  location: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(120).nullish(),
  prepare: z.string().trim().max(60).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

export const overrideSchema = z
  .object({
    overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    action: z.enum(["add", "replace", "cancel"]),
    targetScheduleItemId: z.string().uuid().nullish(),
    startMinute: minuteSchema.nullish(),
    endMinute: endMinuteSchema.nullish(),
    title: z.string().trim().min(1).max(60).nullish(),
    category: z.string().trim().max(30).nullish(),
    note: z.string().trim().max(120).nullish(),
    prepare: z.string().trim().max(60).nullish(),
  })
  .refine(
    (v) =>
      v.action === "add" ? true : v.targetScheduleItemId != null,
    { message: "replace/cancel requires targetScheduleItemId", path: ["targetScheduleItemId"] },
  )
  .refine(
    (v) => (v.action === "add" ? v.startMinute != null && v.endMinute != null && v.endMinute > v.startMinute && v.title != null : true),
    { message: "add requires title/startMinute/endMinute (end>start)" },
  );

/** 重复规则 — docs/04 §6 结构化 JSONB */
export const recurrenceSchema = z.object({
  type: z.enum(["once", "daily", "weekly"]),
  /** weekly 必填: 1=Mon..7=Sun; PRD F05 至少支持工作日 */
  weekdays: z.array(weekdaySchema).max(7).nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
}).refine(
  (v) => (v.type === "weekly" ? (v.weekdays?.length ?? 0) > 0 : true),
  { message: "weekly recurrence requires weekdays", path: ["weekdays"] },
).refine(
  (v) => (v.endDate != null ? v.endDate >= v.startDate : true),
  { message: "endDate must be >= startDate" },
);

/** D-012 任务分类与分值 */
export const TASK_CATEGORIES = ["学习", "运动", "生活", "亲子", "兴趣"] as const;
export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const taskPointsSchema = z.number().int().min(0).max(1000);

export const taskTemplateSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullish(),
  recurrence: recurrenceSchema,
  estimatedMinutes: z.number().int().min(1).max(480).nullish(),
  priority: z.number().int().min(0).max(9).default(0),
  category: taskCategorySchema.nullish(),
  points: taskPointsSchema.default(0),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const taskTemplateUpdateSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).nullish(),
  recurrence: recurrenceSchema.optional(),
  estimatedMinutes: z.number().int().min(1).max(480).nullish(),
  priority: z.number().int().min(0).max(9).optional(),
  category: taskCategorySchema.nullish(),
  points: taskPointsSchema.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: "at least one field" },
);

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(60),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().trim().max(200).nullish(),
  estimatedMinutes: z.number().int().min(1).max(480).nullish(),
  priority: z.number().int().min(0).max(9).default(0),
  category: taskCategorySchema.nullish(),
  points: taskPointsSchema.default(0),
});

export const taskOccurrenceUpdateSchema = z
  .object({
    status: z.enum(["pending", "completed", "skipped"]).optional(),
    title: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(200).nullish(),
    estimatedMinutes: z.number().int().min(1).max(480).nullish(),
    priority: z.number().int().min(0).max(9).optional(),
    category: taskCategorySchema.nullish(),
    points: taskPointsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field" });

/** D-012 积分 / 奖品 / 兑换 / 家庭 / 儿童档案 */
export const manualPointsSchema = z.object({
  delta: z.number().int().min(-10000).max(10000).refine((v) => v !== 0, "delta must not be 0"),
  reason: z.string().trim().min(1).max(60),
});

export const rewardSchema = z.object({
  title: z.string().trim().min(1).max(40),
  icon: z.string().trim().max(8).nullish(),
  cost: z.number().int().min(1).max(100000),
  stock: z.number().int().min(0).max(100000).nullish(),
  active: z.boolean().default(true),
});

export const rewardUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(40).optional(),
    icon: z.string().trim().max(8).nullish(),
    cost: z.number().int().min(1).max(100000).optional(),
    stock: z.number().int().min(0).max(100000).nullish(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field" });

export const redemptionCreateSchema = z.object({ rewardId: z.string().uuid() });
export const redemptionDecisionSchema = z.object({ status: z.enum(["fulfilled", "rejected"]) });

export const familyUpdateSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const invitationCreateSchema = z.object({ role: z.enum(["guardian", "viewer"]).default("guardian") });
export const joinFamilySchema = z.object({ code: z.string().trim().min(6).max(20) });
export const memberRoleSchema = z.object({ role: z.enum(["owner", "guardian", "viewer"]) });
export const profileUpdateSchema = z.object({ displayName: z.string().trim().min(1).max(60) });
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const childProfileSchema = z.object({
  gender: z.enum(["boy", "girl"]).nullish(),
  birthYear: z.number().int().min(2000).max(2100).nullish(),
  grade: z.string().trim().max(20).nullish(),
  interests: z.array(z.string().trim().min(1).max(12)).max(8).nullish(),
  wakeTime: hhmm.nullish(),
  bedTime: hhmm.nullish(),
  encouragementStyle: z.string().trim().max(60).nullish(),
  wishGoal: z.string().trim().max(60).nullish(),
});
export type ChildProfile = z.infer<typeof childProfileSchema>;

export const deviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  // 与 db/schema.sql 的 CHECK (sync_interval_seconds BETWEEN 15 AND 300) 一致
  syncIntervalSeconds: z.number().int().min(15).max(300).optional(),
  // D-016 温度校准（℃）
  temperatureOffset: z.number().min(-10).max(10).optional(),
});

function isValidTimezone(v: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Device API 模式 — docs/05 与 api/openapi.yaml 契约 */
export const devicePairInitSchema = z.object({
  hardwareId: z.string().trim().min(1).max(64),
  deviceNonce: z.string().trim().min(1).max(128),
  firmwareVersion: z.string().trim().min(1).max(32),
});

export const pairingClaimSchema = z.object({
  code: z.string().trim().regex(/^[0-9]{6}$/, "Must be a 6-digit numeric code"),
  childId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(40),
});

export const deviceSyncRequestSchema = z.object({
  firmwareVersion: z.string().trim().min(1).max(32),
  frameVersion: z.number().int().min(0),
  lastRefreshMode: z.enum(["full", "fast_full", "partial"]).nullish(),
  lastRefreshAt: z.string().datetime().nullish(),
  partialRefreshCount: z.number().int().min(0),
  rssi: z.number().int(),
  uptimeSeconds: z.number().int().min(0),
  freeHeap: z.number().int().min(0).optional(),
  resetReason: z.string().nullish(),
  // D-016 可选传感器读数
  temperatureC: z.number().min(-40).max(125).optional(),
  humidityPct: z.number().min(0).max(100).optional(),
  batteryMv: z.number().int().min(0).max(6000).optional(),
  batteryPercent: z.number().int().min(0).max(100).optional(),
});

// D-017 家长立即提醒 / 定时提醒
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:MM");
export const alertCreateSchema = z.object({
  text: z.string().trim().min(1).max(40),
  beep: z.boolean().optional(),
  /** D-027 横幅显示时长（分钟），缺省 30 */
  minutes: z.number().int().min(1).max(720).optional(),
});
export const reminderCreateSchema = z.object({
  remindAt: HHMM,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  text: z.string().trim().min(1).max(40),
  beep: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const reminderUpdateSchema = reminderCreateSchema.partial();

// D-019 设备上报专注完成
export const deviceFocusCompleteSchema = z.object({
  eventId: z.string().uuid(),
  minutes: z.number().int().min(1).max(180),
  occurredAt: z.string().datetime().nullish(),
});

export const deviceTaskCompleteSchema = z.object({
  eventId: z.string().uuid(),
  frameVersion: z.number().int(),
  taskOccurrenceId: z.string().uuid(),
  occurredAt: z.string().datetime().nullish(),
});

