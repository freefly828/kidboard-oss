// KidBoard 数据库 schema — Drizzle ORM 实现。
// 契约真相源: db/schema.sql (V1 冻结基线)。
// 本文件必须与其保持结构一致; 若需变更先走 Decision 流程。
// compose 验收时用 information_schema 核对表数量与关键列。

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  real,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** helper: 统一 NOT NULL timestamptz 默认 now() */
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** D-013 所在城市 { id, name, lat, lon }（和风天气 location）；null = 默认城市 */
  location: jsonb("location"),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
});

export const familyMembers = pgTable(
  "family_members",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'owner' | 'guardian' | 'viewer'
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.userId] })],
);

export const children = pgTable("children", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  screenLayout: text("screen_layout").notNull().default("default_800x480"),
  contentVersion: bigint("content_version", { mode: "number" })
    .notNull()
    .default(0),
  /** D-012 儿童档案扩展：性别/出生年/年级/兴趣/作息/鼓励风格/心愿（应用层 zod 校验） */
  profile: jsonb("profile").notNull().default({}),
  /** D-013 明日预览开始时间 HH:MM（孩子时区）；null = 关闭 */
  previewFrom: text("preview_from").default("19:00"),
  // D-019 专注计时：每次分钟数、完成积分、每天最多计分次数
  focusMinutes: integer("focus_minutes").notNull().default(25),
  focusPoints: integer("focus_points").notNull().default(5),
  focusDailyCap: integer("focus_daily_cap").notNull().default(3),
  // D-020 看板 4 位数字密码（scrypt 哈希）、版本、连续错误次数、锁定截止
  boardPinHash: text("board_pin_hash"),
  boardPinVersion: integer("board_pin_version").notNull().default(0),
  boardPinFailures: integer("board_pin_failures").notNull().default(0),
  boardPinLockedUntil: timestamp("board_pin_locked_until", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const weeklyScheduleItems = pgTable("weekly_schedule_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 1..7
  startMinute: integer("start_minute").notNull(), // 0..1439
  endMinute: integer("end_minute").notNull(), // 1..1440 且 > start
  title: text("title").notNull(),
  category: text("category"),
  location: text("location"),
  note: text("note"),
  /** D-013 需准备的物品（明日预览汇总） */
  prepare: text("prepare"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const scheduleOverrides = pgTable("schedule_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  overrideDate: date("override_date").notNull(),
  action: text("action").notNull(), // 'add' | 'replace' | 'cancel'
  targetScheduleItemId: uuid("target_schedule_item_id").references(
    () => weeklyScheduleItems.id,
    { onDelete: "set null" },
  ),
  startMinute: integer("start_minute"),
  endMinute: integer("end_minute"),
  title: text("title"),
  category: text("category"),
  note: text("note"),
  /** D-013 需准备的物品（明日预览汇总） */
  prepare: text("prepare"),
  createdAt: createdAt(),
});

export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  /** 重复规则 jsonb — V1 约定见 docs/04_数据模型.md */
  recurrence: jsonb("recurrence").notNull(),
  estimatedMinutes: integer("estimated_minutes"),
  priority: smallint("priority").notNull().default(0),
  /** D-012 学习/运动/生活/亲子/兴趣 */
  category: text("category"),
  /** D-012 完成可得积分 */
  points: integer("points").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskOccurrences = pgTable(
  "task_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    sourceTemplateId: uuid("source_template_id").references(
      () => taskTemplates.id,
      { onDelete: "set null" },
    ),
    sourceKey: text("source_key"),
    occurrenceDate: date("occurrence_date").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    estimatedMinutes: integer("estimated_minutes"),
    priority: smallint("priority").notNull().default(0),
    category: text("category"),
    points: integer("points").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** 'pending' | 'completed' | 'skipped' */
    status: text("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 对应 db/schema.sql 的 uq_task_materialize 部分唯一索引
    uniqueIndex("uq_task_materialize")
      .on(t.childId, t.occurrenceDate, t.sourceTemplateId, t.sourceKey)
      .where(sql`source_template_id IS NOT NULL`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    messageDate: date("message_date").notNull(),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_active_message_per_day")
      .on(t.childId, t.messageDate)
      .where(sql`active = true`),
  ],
);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  hardwareId: text("hardware_id").notNull().unique(),
  familyId: uuid("family_id").references(() => families.id, {
    onDelete: "set null",
  }),
  childId: uuid("child_id").references(() => children.id, {
    onDelete: "set null",
  }),
  name: text("name"),
  deviceTokenHash: text("device_token_hash"),
  firmwareVersion: text("firmware_version"),
  reportedFrameVersion: bigint("reported_frame_version", {
    mode: "number",
  })
    .notNull()
    .default(0),
  rssi: integer("rssi"),
  freeHeap: integer("free_heap"),
  uptimeSeconds: bigint("uptime_seconds", { mode: "number" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
  lastRefreshAt: timestamp("last_refresh_at", {
    withTimezone: true,
    mode: "date",
  }),
  lastRefreshMode: text("last_refresh_mode"),
  partialRefreshCount: integer("partial_refresh_count").notNull().default(0),
  syncIntervalSeconds: integer("sync_interval_seconds").notNull().default(30),
  desiredFullRefresh: boolean("desired_full_refresh").notNull().default(false),
  // D-016 传感器
  batteryMv: integer("battery_mv"),
  batteryPercent: integer("battery_percent"),
  temperatureC: real("temperature_c"),
  humidityPct: real("humidity_pct"),
  sensorAt: timestamp("sensor_at", { withTimezone: true, mode: "date" }),
  temperatureOffset: real("temperature_offset").notNull().default(0),
  indoorShown: jsonb("indoor_shown"),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pairingRequests = pgTable("pairing_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  hardwareId: text("hardware_id").notNull(),
  deviceNonce: text("device_nonce").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
    .notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  claimedBy: uuid("claimed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  deviceId: uuid("device_id").references(() => devices.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export const screenFrames = pgTable(
  "screen_frames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    frameVersion: bigint("frame_version", { mode: "number" }).notNull(),
    contentVersion: bigint("content_version", { mode: "number" }).notNull(),
    width: integer("width").notNull().default(800),
    height: integer("height").notNull().default(480),
    bytes: integer("bytes").notNull().default(48000),
    sha256: char("sha256", { length: 64 }).notNull(),
    previewPath: text("preview_path").notNull(),
    framePath: text("frame_path").notNull(),
    changedRatio: numeric("changed_ratio", { precision: 6, scale: 5 }),
    dirtyRect: jsonb("dirty_rect"),
    isActive: boolean("is_active").notNull().default(false),
    /** D-018 附加页 [{index, sha256, bytes}] */
    pages: jsonb("pages").notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    unique("uq_screen_frames_child_version").on(t.childId, t.frameVersion),
    uniqueIndex("uq_active_frame_per_child")
      .on(t.childId)
      .where(sql`is_active = true`),
  ],
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    requestedContentVersion: bigint("requested_content_version", {
      mode: "number",
    }).notNull(),
    /** 'queued' | 'running' | 'succeeded' | 'failed' | 'superseded' */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("ix_render_jobs_claim").on(t.status, t.availableAt, t.createdAt),
  ],
);

export const deviceEvents = pgTable(
  "device_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    eventId: uuid("event_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_device_event_idempotency")
      .on(t.deviceId, t.eventId)
      .where(sql`event_id IS NOT NULL`),
  ],
);

export const deviceCommands = pgTable("device_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  /** 'force_full_refresh' | 'reboot' | 'beep'（D-017） */
  type: text("type").notNull(),
  /** 'pending' | 'sent' | 'acked' | 'expired' */
  status: text("status").notNull().default("pending"),
  /** D-017 beep: { alertId, beeps } */
  payload: jsonb("payload").notNull().default({}),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  ackedAt: timestamp("acked_at", { withTimezone: true, mode: "date" }),
});

// ===== D-012（2026-10-09）积分 / 心愿商城 / 家庭邀请 =====

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  icon: text("icon"),
  cost: integer("cost").notNull(),
  /** null = 不限库存 */
  stock: integer("stock"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rewardRedemptions = pgTable("reward_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  childId: uuid("child_id")
    .notNull()
    .references(() => children.id, { onDelete: "cascade" }),
  rewardId: uuid("reward_id").references(() => rewards.id, { onDelete: "set null" }),
  rewardTitle: text("reward_title").notNull(),
  cost: integer("cost").notNull(),
  /** 'pending' | 'fulfilled' | 'rejected' */
  status: text("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
});

export const pointLedger = pgTable(
  "point_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** 'task' | 'manual' | 'redeem' | 'refund' */
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    taskOccurrenceId: uuid("task_occurrence_id").references(() => taskOccurrences.id, {
      onDelete: "set null",
    }),
    redemptionId: uuid("redemption_id").references(() => rewardRedemptions.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_point_ledger_task").on(t.taskOccurrenceId).where(sql`kind = 'task'`),
    index("ix_point_ledger_child_time").on(t.childId, t.createdAt),
  ],
);

export const familyInvitations = pgTable("family_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  /** 'guardian' | 'viewer' */
  role: text("role").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});

// ===== D-013（2026-10-09）明日预览 / 每日古诗 / 天气 =====

export const weatherCache = pgTable("weather_cache", {
  /** 和风天气 location id */
  locationId: text("location_id").primaryKey(),
  /** 3 天预报（原始 daily 数组的精简字段） */
  data: jsonb("data").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/* ===== D-017 家长立即提醒 / 定时提醒 ===== */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    /** "HH:MM"（孩子时区） */
    remindAt: text("remind_at").notNull(),
    /** ISO 星期 1~7 */
    weekdays: smallint("weekdays").array().notNull(),
    text: text("text").notNull(),
    beep: boolean("beep").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ix_reminders_child").on(t.childId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    /** 'instant' | 'reminder' */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "set null" }),
    fireDate: date("fire_date", { mode: "string" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    showUntil: timestamp("show_until", { withTimezone: true, mode: "date" }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("ix_alerts_child_until").on(t.childId, t.showUntil)],
);

/* ===== D-024 专注记录 ===== */
export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    childId: uuid("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    /** 'device' | 'board' */
    source: text("source").notNull(),
    eventId: uuid("event_id"),
    minutes: integer("minutes").notNull(),
    awarded: integer("awarded").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("ix_focus_sessions_child_done").on(t.childId, t.completedAt)],
);
