CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_members (
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','guardian','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);

-- children.preview_from、families.location、weekly_schedule_items/schedule_overrides.prepare 由 D-013 新增
-- children.focus_minutes / focus_points / focus_daily_cap 与 point_ledger.kind 'focus' 由 D-019 新增
-- children.board_pin_hash / board_pin_version / board_pin_failures / board_pin_locked_until 由 D-020 新增
-- children.profile、task_templates/task_occurrences 的 category/points 列由 D-012 新增
CREATE TABLE children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  screen_layout text NOT NULL DEFAULT 'default_800x480',
  content_version bigint NOT NULL DEFAULT 0,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_from text DEFAULT '19:00',
  focus_minutes integer NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 5 AND 90),
  focus_points integer NOT NULL DEFAULT 5 CHECK (focus_points BETWEEN 0 AND 50),
  focus_daily_cap integer NOT NULL DEFAULT 3 CHECK (focus_daily_cap BETWEEN 0 AND 10),
  board_pin_hash text,
  board_pin_version integer NOT NULL DEFAULT 0,
  board_pin_failures integer NOT NULL DEFAULT 0,
  board_pin_locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weekly_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute),
  title text NOT NULL,
  category text,
  location text,
  note text,
  prepare text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedule_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('add','replace','cancel')),
  target_schedule_item_id uuid REFERENCES weekly_schedule_items(id) ON DELETE SET NULL,
  start_minute integer,
  end_minute integer,
  title text,
  category text,
  note text,
  prepare text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  recurrence jsonb NOT NULL,
  estimated_minutes integer,
  priority smallint NOT NULL DEFAULT 0,
  category text,
  points integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  source_template_id uuid REFERENCES task_templates(id) ON DELETE SET NULL,
  source_key text,
  occurrence_date date NOT NULL,
  title text NOT NULL,
  description text,
  estimated_minutes integer,
  priority smallint NOT NULL DEFAULT 0,
  category text,
  points integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_task_materialize
  ON task_occurrences(child_id, occurrence_date, source_template_id, source_key)
  WHERE source_template_id IS NOT NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  message_date date NOT NULL,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_active_message_per_day
  ON messages(child_id, message_date)
  WHERE active = true;

-- devices.battery_mv / battery_percent / temperature_c / humidity_pct / sensor_at / temperature_offset / indoor_shown 由 D-016 新增
CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_id text UNIQUE NOT NULL,
  family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  child_id uuid REFERENCES children(id) ON DELETE SET NULL,
  name text,
  device_token_hash text,
  firmware_version text,
  reported_frame_version bigint NOT NULL DEFAULT 0,
  rssi integer,
  free_heap integer,
  uptime_seconds bigint,
  last_seen_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_mode text,
  partial_refresh_count integer NOT NULL DEFAULT 0,
  sync_interval_seconds integer NOT NULL DEFAULT 30 CHECK (sync_interval_seconds BETWEEN 15 AND 300),
  desired_full_refresh boolean NOT NULL DEFAULT false,
  battery_mv integer,
  battery_percent integer,
  temperature_c real,
  humidity_pct real,
  sensor_at timestamptz,
  temperature_offset real NOT NULL DEFAULT 0,
  indoor_shown jsonb,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_id text NOT NULL,
  device_nonce text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- screen_frames.pages 由 D-018 新增：[{index, sha256, bytes}] 附加页（page{index}.bin）
CREATE TABLE screen_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  frame_version bigint NOT NULL,
  content_version bigint NOT NULL,
  width integer NOT NULL DEFAULT 800 CHECK (width = 800),
  height integer NOT NULL DEFAULT 480 CHECK (height = 480),
  bytes integer NOT NULL DEFAULT 48000 CHECK (bytes = 48000),
  sha256 char(64) NOT NULL,
  preview_path text NOT NULL,
  frame_path text NOT NULL,
  changed_ratio numeric(6,5),
  dirty_rect jsonb,
  is_active boolean NOT NULL DEFAULT false,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(child_id, frame_version)
);
CREATE UNIQUE INDEX uq_active_frame_per_child
  ON screen_frames(child_id) WHERE is_active = true;

CREATE TABLE render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  requested_content_version bigint NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX ix_render_jobs_claim ON render_jobs(status, available_at, created_at);

CREATE TABLE device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_device_event_idempotency
  ON device_events(device_id, event_id)
  WHERE event_id IS NOT NULL;

-- device_commands.type 'beep' 与 payload 由 D-017 新增
CREATE TABLE device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('force_full_refresh','reboot','beep')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','acked','expired')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  acked_at timestamptz
);

-- ===== D-012（2026-10-09）积分 / 心愿商城 / 家庭邀请 =====
-- 心愿奖品（家庭维度）
CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title text NOT NULL,
  icon text,
  cost integer NOT NULL CHECK (cost > 0),
  stock integer CHECK (stock IS NULL OR stock >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 兑换申请：pending（已扣积分，待家长核销）→ fulfilled / rejected（退回积分）
CREATE TABLE reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  reward_id uuid REFERENCES rewards(id) ON DELETE SET NULL,
  reward_title text NOT NULL,
  cost integer NOT NULL CHECK (cost > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','rejected')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

-- 积分流水：余额 = SUM(delta)。task 记录与任务完成状态一一对应（取消完成即删除）
CREATE TABLE point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  kind text NOT NULL CHECK (kind IN ('task','manual','redeem','refund','focus')),
  reason text NOT NULL,
  task_occurrence_id uuid REFERENCES task_occurrences(id) ON DELETE SET NULL,
  redemption_id uuid REFERENCES reward_redemptions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_point_ledger_task
  ON point_ledger(task_occurrence_id) WHERE kind = 'task';
CREATE INDEX ix_point_ledger_child_time ON point_ledger(child_id, created_at);

-- 家庭邀请码：只存 hash；一次性，过期失效
CREATE TABLE family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('guardian','viewer')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== D-013（2026-10-09）明日预览 / 每日古诗 / 天气 =====
CREATE TABLE weather_cache (
  location_id text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- ===== D-017（2026-10-10）家长立即提醒 / 定时提醒 =====
CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  remind_at text NOT NULL,
  weekdays smallint[] NOT NULL,
  text text NOT NULL,
  beep boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reminders_child ON reminders(child_id);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('instant','reminder')),
  text text NOT NULL,
  reminder_id uuid REFERENCES reminders(id) ON DELETE SET NULL,
  fire_date date,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  show_until timestamptz NOT NULL,
  cleared_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX ix_alerts_child_until ON alerts(child_id, show_until);
CREATE UNIQUE INDEX uq_alerts_reminder_day ON alerts(reminder_id, fire_date) WHERE reminder_id IS NOT NULL;

-- ===== D-024（2026-10-11）专注记录：设备与 H5 看板统一 =====
CREATE TABLE focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('device','board')),
  event_id uuid,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 180),
  awarded integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_focus_sessions_event ON focus_sessions(child_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX ix_focus_sessions_child_done ON focus_sessions(child_id, completed_at);
