"use client";

/** 总览：今日任务 / 积分 / 设备 / 近 7 天趋势 / 今日日程 / 今日留言 / 墨水屏预览，全部为真实数据 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import {
  BarChart,
  Card,
  CategoryBadge,
  Empty,
  ErrorBox,
  InkPreview,
  StatCard,
  dateLabel,
  isoWeekdayOf,
  minuteToHHMM,
  relativeTime,
  todayIn,
  useLoad,
  WEEKDAY_ZH,
} from "../ui";
import type { TaskRow } from "./TasksView";
import type { ScheduleRow } from "./ScheduleView";

interface Overview {
  tasks: TaskRow[];
  schedule: ScheduleRow[];
  points: { balance: number; earnedThisWeek: number };
  devices: { id: string; name: string | null; online: boolean; lastSeenAt: string | null }[];
  stats: { daily: { date: string; planned: number; completed: number }[]; streakDays: number };
  message: { body: string } | null;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default function DashboardView() {
  const child = useChild();
  const { navigate, canEdit, notify, dataVersion, bumpData } = useDashboard();
  const today = todayIn(child.timezone);
  const base = `/api/v1/children/${child.id}`;

  const { data, error, reload } = useLoad<Overview>(async () => {
    const [t, s, p, d, st, m] = await Promise.all([
      api<{ tasks: TaskRow[] }>(`${base}/tasks`),
      api<{ items: ScheduleRow[] }>(`${base}/schedule`),
      api<{ balance: number; earnedThisWeek: number }>(`${base}/points?limit=1`),
      api<{ devices: Overview["devices"] }>(`${base}/devices`),
      api<Overview["stats"]>(`${base}/stats?days=7`),
      api<{ message: { body: string } | null }>(`${base}/message`),
    ]);
    return { tasks: t.tasks, schedule: s.items, points: p, devices: d.devices, stats: st, message: m.message };
  }, [child.id, dataVersion], `overview:${child.id}`);

  const [msgDraft, setMsgDraft] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function toggleTask(t: TaskRow) {
    try {
      await api(`${base}/tasks/${t.id}`, { method: "PATCH", body: { status: t.status === "completed" ? "pending" : "completed" } });
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  async function saveMessage() {
    if (msgDraft === null) return;
    setBusy(true);
    try {
      if (msgDraft.trim()) await api(`${base}/message`, { method: "PUT", body: { body: msgDraft.trim() } });
      else await api(`${base}/message`, { method: "DELETE" });
      setMsgDraft(null);
      notify("留言已更新，墨水屏将在下次同步时显示");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data) return <div style={{ color: "var(--text-muted)" }}>加载中...</div>;

  const pending = data.tasks.filter((t) => t.status === "pending");
  const done = data.tasks.filter((t) => t.status === "completed");
  const weekday = isoWeekdayOf(today);
  const todaySchedule = data.schedule.filter((s) => s.active && s.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
  const nowMinute = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: child.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  })();
  const device = data.devices[0] ?? null;
  const pendingMinutes = pending.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div className="card" style={{ padding: "1.25rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 800, margin: 0 }}>
            {greeting()}，{child.displayName}的家长！
            {data.tasks.length === 0 ? "今天还没有安排任务" : pending.length === 0 ? "今天的任务都完成啦 🎉" : `今天还有 ${pending.length} 项任务待完成`}
          </h1>
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: 4 }}>
            {dateLabel(today)}
            {data.stats.streakDays > 0 && ` · 已连续 ${data.stats.streakDays} 天完成任务 🔥`}
          </div>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => navigate("tasks")}>
            + 新建任务
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "1rem" }}>
        <StatCard icon="⏳" label="今日待完成" value={`${pending.length} 项`} sub={pendingMinutes > 0 ? `预计还需 ${pendingMinutes} 分钟` : "—"} />
        <StatCard
          icon="✅"
          label="今日已完成"
          value={`${done.length} / ${data.tasks.length}`}
          sub={data.tasks.length > 0 ? `完成率 ${Math.round((done.length / data.tasks.length) * 100)}%` : "今天暂无任务"}
          color="#059669"
        />
        <StatCard icon="🏆" label="积分余额" value={`${data.points.balance} 分`} sub={`本周获得 +${data.points.earnedThisWeek}`} color="#d97706" />
        <StatCard
          icon="📱"
          label="墨水屏"
          value={!device ? "未绑定" : device.online ? "在线" : "离线"}
          sub={device ? `最后同步 ${relativeTime(device.lastSeenAt)}` : "到设备管理中绑定"}
          color={!device ? "var(--text-muted)" : device.online ? "#059669" : "#dc2626"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem" }}>
        <Card title="近 7 天任务完成情况" extra={<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("analytics")}>统计分析 ›</button>}>
          {data.stats.daily.every((d) => d.planned === 0) ? (
            <Empty text="最近 7 天还没有任务记录" />
          ) : (
            <BarChart
              data={data.stats.daily.map((d) => ({ label: d.date === today ? "今天" : `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`, values: [d.planned, d.completed] }))}
              series={[
                { name: "计划任务", color: "#bfdbfe" },
                { name: "实际完成", color: "#2563eb" },
              ]}
            />
          )}
        </Card>

        <Card title="今日任务" extra={<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("tasks")}>任务中心 ›</button>}>
          {data.tasks.length === 0 ? (
            <Empty text="今天还没有任务" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.tasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleTask(t)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0.7rem", borderRadius: 8, border: "1px solid var(--border-subtle)", background: t.status === "completed" ? "#f0fdf4" : "#fff", cursor: canEdit ? "pointer" : "default", textAlign: "left" }}
                >
                  <span style={{ width: 18, height: 18, borderRadius: 5, border: "2px solid #94a3b8", background: t.status === "completed" ? "#10b981" : "#fff", color: "#fff", fontSize: 12, lineHeight: "14px", textAlign: "center" }}>
                    {t.status === "completed" ? "✓" : ""}
                  </span>
                  <span style={{ flex: 1, fontSize: "0.88rem", textDecoration: t.status === "completed" ? "line-through" : "none", color: t.status === "completed" ? "var(--text-muted)" : "var(--text-main)" }}>{t.title}</span>
                  <CategoryBadge category={t.category} />
                  {t.points > 0 && <span style={{ fontSize: "0.75rem", color: "#d97706", fontWeight: 700 }}>+{t.points}</span>}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "1.5rem" }}>
        <Card title={`今日日程（${WEEKDAY_ZH[weekday]}）`} extra={<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("schedule")}>课程表 ›</button>}>
          {todaySchedule.length === 0 ? (
            <Empty text="今天没有课程安排" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {todaySchedule.map((s) => {
                const state = nowMinute >= s.endMinute ? "done" : nowMinute >= s.startMinute ? "now" : "next";
                return (
                  <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "0.5rem 0.7rem", borderRadius: 8, background: state === "now" ? "var(--primary-light)" : "#f8fafc", border: state === "now" ? "1px solid var(--primary-border)" : "1px solid transparent" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-sub)", minWidth: 92 }}>
                      {minuteToHHMM(s.startMinute)}-{minuteToHHMM(s.endMinute)}
                    </span>
                    <span style={{ flex: 1, fontSize: "0.88rem", color: state === "done" ? "var(--text-muted)" : "var(--text-main)" }}>{s.title}</span>
                    <span style={{ fontSize: "0.7rem", color: state === "now" ? "var(--primary)" : "var(--text-muted)" }}>{state === "done" ? "已结束" : state === "now" ? "进行中" : "未开始"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="墨水屏当前内容" extra={<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("devices")}>设备管理 ›</button>}>
          <InkPreview childId={child.id} refreshKey={dataVersion} />
        </Card>

        <Card title="💌 今日留言" extra={<span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>显示在墨水屏底部</span>}>
          {msgDraft === null ? (
            <>
              <div style={{ minHeight: 70, padding: "0.75rem", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a", fontSize: "0.9rem", lineHeight: 1.6, color: data.message ? "var(--text-main)" : "var(--text-muted)" }}>
                {data.message?.body ?? "今天还没有留言"}
              </div>
              {canEdit && (
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setMsgDraft(data.message?.body ?? "")}>
                  ✏️ {data.message ? "修改留言" : "写留言"}
                </button>
              )}
            </>
          ) : (
            <>
              <textarea value={msgDraft} maxLength={60} rows={3} onChange={(e) => setMsgDraft(e.target.value)} placeholder="给孩子写一句话（最多 60 字，留空表示撤下留言）" style={{ width: "100%", padding: "0.6rem", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{msgDraft.length}/60</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setMsgDraft(null)}>取消</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveMessage}>{busy ? "保存中..." : "保存"}</button>
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

