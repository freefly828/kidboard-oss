-- Migration 0001: sessions 表（应用层新增，不属于冻结的 15 张业务表）
-- docs/08 §2: Session 使用 HttpOnly + Secure + SameSite cookie。
-- 会话是应用运行数据（非业务契约），由 drizzle migration 管理。

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token" text NOT NULL UNIQUE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "ix_sessions_expires" ON "sessions" ("expires_at");
