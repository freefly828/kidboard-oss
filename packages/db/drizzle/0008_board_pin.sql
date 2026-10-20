-- Migration 0008: 看板 4 位数字密码（D-020）
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。
ALTER TABLE children ADD COLUMN IF NOT EXISTS board_pin_hash text;
-- 改/清密码时 +1：已发出的看板凭证全部失效
ALTER TABLE children ADD COLUMN IF NOT EXISTS board_pin_version integer NOT NULL DEFAULT 0;
-- 连续输错次数与锁定截止时间（错 5 次锁 15 分钟）
ALTER TABLE children ADD COLUMN IF NOT EXISTS board_pin_failures integer NOT NULL DEFAULT 0;
ALTER TABLE children ADD COLUMN IF NOT EXISTS board_pin_locked_until timestamptz;
