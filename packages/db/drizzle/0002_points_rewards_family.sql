-- Migration 0002: 积分 / 心愿商城 / 家庭邀请 / 儿童档案扩展 / 任务分类与分值（D-012）
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。

-- 儿童档案扩展字段（性别、出生年、年级、兴趣、作息、鼓励风格、心愿），结构由应用层 zod 校验
ALTER TABLE children ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 任务分类与积分分值（模板与当日实例各自保存，实例创建时从模板复制）
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;
ALTER TABLE task_occurrences ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE task_occurrences ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

-- 心愿奖品（家庭维度）
CREATE TABLE IF NOT EXISTS rewards (
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
CREATE TABLE IF NOT EXISTS reward_redemptions (
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
CREATE TABLE IF NOT EXISTS point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  kind text NOT NULL CHECK (kind IN ('task','manual','redeem','refund')),
  reason text NOT NULL,
  task_occurrence_id uuid REFERENCES task_occurrences(id) ON DELETE SET NULL,
  redemption_id uuid REFERENCES reward_redemptions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_task
  ON point_ledger(task_occurrence_id) WHERE kind = 'task';
CREATE INDEX IF NOT EXISTS ix_point_ledger_child_time ON point_ledger(child_id, created_at);

-- 家庭邀请码：只存 hash；一次性，过期失效
CREATE TABLE IF NOT EXISTS family_invitations (
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
