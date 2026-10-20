-- Migration 0005: 家长立即提醒 / 定时提醒 / 设备蜂鸣（D-017）
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。

-- 定时提醒：孩子时区每周指定几天的 HH:MM 触发
CREATE TABLE IF NOT EXISTS reminders (
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
CREATE INDEX IF NOT EXISTS ix_reminders_child ON reminders(child_id);

-- 提醒横幅：立即提醒（家长发送）或定时提醒触发后，在屏幕底部显示到 show_until
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('instant','reminder')),
  text text NOT NULL,
  reminder_id uuid REFERENCES reminders(id) ON DELETE SET NULL,
  -- 定时提醒触发的孩子时区日期：同一提醒每天只触发一次
  fire_date date,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  show_until timestamptz NOT NULL,
  -- 过期后 renderer 已重渲染去掉横幅
  cleared_at timestamptz,
  -- 设备同步时已收到对应的蜂鸣命令
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_alerts_child_until ON alerts(child_id, show_until);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_reminder_day ON alerts(reminder_id, fire_date) WHERE reminder_id IS NOT NULL;

-- 设备命令：新增 beep（蜂鸣），payload 带次数与关联提醒
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS device_commands_type_check;
ALTER TABLE device_commands ADD CONSTRAINT device_commands_type_check CHECK (type IN ('force_full_refresh','reboot','beep'));
