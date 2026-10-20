-- Migration 0006: 多页翻看（D-018）— 每个画面版本附带附加页（本周课表、积分……）
-- 每页文件 {FRAMES_DIR}/{childId}/{frameVersion}/page{index}.bin，与首页同为 48,000 字节 1-bit 帧
ALTER TABLE screen_frames ADD COLUMN IF NOT EXISTS pages jsonb NOT NULL DEFAULT '[]'::jsonb;
