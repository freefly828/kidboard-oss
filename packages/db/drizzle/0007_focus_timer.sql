-- Migration 0007: 专注计时（D-019）— 孩子级配置与积分类型
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。
ALTER TABLE children ADD COLUMN IF NOT EXISTS focus_minutes integer NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 5 AND 90);
ALTER TABLE children ADD COLUMN IF NOT EXISTS focus_points integer NOT NULL DEFAULT 5 CHECK (focus_points BETWEEN 0 AND 50);
ALTER TABLE children ADD COLUMN IF NOT EXISTS focus_daily_cap integer NOT NULL DEFAULT 3 CHECK (focus_daily_cap BETWEEN 0 AND 10);
ALTER TABLE point_ledger DROP CONSTRAINT IF EXISTS point_ledger_kind_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_kind_check CHECK (kind IN ('task','manual','redeem','refund','focus'));
