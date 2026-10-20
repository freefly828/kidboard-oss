-- Migration 0009: 专注记录（D-024）— 设备与 H5 看板的专注计时统一记录
-- 幂等：全新库由 db/schema.sql 建好同样结构，本迁移需可重复执行。
--  - 设备：完成时上报（event_id 幂等），started_at 为空
--  - 看板：开始时建记录（started_at = 服务器时间），完成时校验实际经过时间，防止不计时直接领分
CREATE TABLE IF NOT EXISTS focus_sessions (
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_focus_sessions_event ON focus_sessions(child_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_focus_sessions_child_done ON focus_sessions(child_id, completed_at);

-- 回填：D-019 起设备上报的专注完成事件
INSERT INTO focus_sessions (child_id, device_id, source, event_id, minutes, completed_at, created_at)
SELECT d.child_id, e.device_id, 'device', e.event_id, (e.payload->>'minutes')::int,
       coalesce(e.occurred_at, e.received_at), e.received_at
  FROM device_events e
  JOIN devices d ON d.id = e.device_id
 WHERE e.type = 'focus_complete' AND d.child_id IS NOT NULL AND e.event_id IS NOT NULL
   AND (e.payload->>'minutes') ~ '^[0-9]+$'
ON CONFLICT DO NOTHING;
