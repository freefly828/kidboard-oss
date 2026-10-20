-- Migration 0004: 设备传感器（D-016）— 室内温湿度（SHT40）与电池电量
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。

ALTER TABLE devices ADD COLUMN IF NOT EXISTS battery_mv integer;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS battery_percent integer;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS temperature_c real;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS humidity_pct real;
-- 最近一次收到传感器读数的时间（超过 30 分钟视为过期，不显示）
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sensor_at timestamptz;
-- 温度校准（℃，加到读数上；机壳内 SHT40 受主板发热影响通常偏高）
ALTER TABLE devices ADD COLUMN IF NOT EXISTS temperature_offset real NOT NULL DEFAULT 0;
-- 画面上当前显示的室内读数 {t, h, low, at}：变化才重渲染，且最多 30 分钟一次（低电状态变化立即）
ALTER TABLE devices ADD COLUMN IF NOT EXISTS indoor_shown jsonb;
