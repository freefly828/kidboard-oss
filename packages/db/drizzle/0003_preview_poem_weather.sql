-- Migration 0003: 明日预览 / 每日古诗 / 天气与穿衣提醒（D-013）
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。

-- 明日预览：每天几点起首页切换为"明天"（HH:MM，孩子时区；NULL = 关闭）
ALTER TABLE children ADD COLUMN IF NOT EXISTS preview_from text DEFAULT '19:00';

-- 课程"需准备的物品"（明日预览底部汇总显示）
ALTER TABLE weekly_schedule_items ADD COLUMN IF NOT EXISTS prepare text;
ALTER TABLE schedule_overrides ADD COLUMN IF NOT EXISTS prepare text;

-- 家庭所在城市（和风天气 location id / 名称 / 经纬度）；NULL = 使用默认城市
ALTER TABLE families ADD COLUMN IF NOT EXISTS location jsonb;

-- 天气缓存：按和风 location id 每小时刷新，屏幕与 Web 共用
CREATE TABLE IF NOT EXISTS weather_cache (
  location_id text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
