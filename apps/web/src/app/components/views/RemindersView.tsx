"use client";

/**
 * 提醒（D-017）：
 * - 立即提醒：家长发一句话，墨水屏底部黑底横幅显示所选时长（缺省 30 分钟，D-027），设备蜂鸣 3 声（下次同步时送达）；
 * - 定时提醒：每周选定几天的固定时间自动提醒（如 7:20 出门、21:00 洗漱睡觉）。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import { Card, Empty, ErrorBox, Field, InkPreview, Modal, PageHeader, shortDateTime, useLoad } from "../ui";

const MAX = 40;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const QUICK = ["回家吃饭啦！", "该出门上学了", "作业写完了吗？", "该洗漱睡觉了", "喝杯水休息一下眼睛"];
const PRESETS: { remindAt: string; text: string; weekdays: number[] }[] = [
  { remindAt: "07:20", text: "该出门上学了，书包带好了吗？", weekdays: [1, 2, 3, 4, 5] },
  { remindAt: "19:00", text: "开始写作业啦", weekdays: [1, 2, 3, 4, 5] },
  { remindAt: "21:00", text: "洗漱睡觉时间到", weekdays: [1, 2, 3, 4, 5, 6, 7] },
];

interface AlertRow {
  id: string;
  kind: "instant" | "reminder";
  text: string;
  createdAt: string;
  showUntil: string;
  deliveredAt: string | null;
  showing: boolean;
  createdByName: string | null;
}

interface ReminderRow {
  id: string;
  remindAt: string;
  weekdays: number[];
  text: string;
  beep: boolean;
  active: boolean;
}

type Draft = { id?: string; remindAt: string; weekdays: number[]; text: string; beep: boolean; active: boolean };

const inputStyle: React.CSSProperties = { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.95rem", boxSizing: "border-box" };

function weekdaysLabel(days: number[]): string {
  const s = [...days].sort().join(",");
  if (s === "1,2,3,4,5,6,7") return "每天";
  if (s === "1,2,3,4,5") return "工作日";
  if (s === "6,7") return "周末";
  return days.map((d) => `周${WEEKDAYS[d - 1]}`).join("、");
}

/** D-027 立即提醒显示时长选项（服务端允许 1~720 分钟） */
const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 10, label: "10 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 120, label: "2 小时" },
  { minutes: 240, label: "4 小时" },
];

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function RemindersView() {
  const child = useChild();
  const { canEdit, notify, bumpData, dataVersion } = useDashboard();
  const base = `/api/v1/children/${child.id}`;
  const alertsLoad = useLoad(() => api<{ alerts: AlertRow[] }>(`${base}/alerts`), [base, dataVersion], `alerts:${base}`);
  const remindersLoad = useLoad(() => api<{ reminders: ReminderRow[] }>(`${base}/reminders`), [base, dataVersion], `reminders:${base}`);
  const [text, setText] = React.useState("");
  const [minutes, setMinutes] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  // 发送后轮询送达状态
  React.useEffect(() => {
    const pending = alertsLoad.data?.alerts.some((a) => a.showing && !a.deliveredAt);
    if (!pending) return;
    const t = setInterval(() => alertsLoad.reload(), 10_000);
    return () => clearInterval(t);
  }, [alertsLoad]);

  async function sendNow() {
    const body = text.trim();
    if (!body) return notify("提醒内容不能为空", false);
    if (body.length > MAX) return notify(`最多 ${MAX} 字`, false);
    setBusy(true);
    try {
      const r = await api<{ devicesQueued: number }>(`${base}/alerts`, { method: "POST", body: { text: body, minutes } });
      notify(r.devicesQueued > 0 ? "已发送：墨水屏下次同步时显示并响铃（约 30 秒内）" : "已发送到屏幕；还没有绑定设备，暂时不会响铃");
      setText("");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await api(`${base}/alerts/${id}`, { method: "DELETE" });
      notify("已从屏幕撤下");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function saveReminder() {
    if (!draft) return;
    const t = draft.text.trim();
    if (!t) return notify("提醒内容不能为空", false);
    if (t.length > MAX) return notify(`最多 ${MAX} 字`, false);
    if (draft.weekdays.length === 0) return notify("至少选择一天", false);
    setBusy(true);
    try {
      const payload = { remindAt: draft.remindAt, weekdays: draft.weekdays, text: t, beep: draft.beep, active: draft.active };
      if (draft.id) await api(`${base}/reminders/${draft.id}`, { method: "PATCH", body: payload });
      else await api(`${base}/reminders`, { method: "POST", body: payload });
      notify("定时提醒已保存");
      setDraft(null);
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: ReminderRow) {
    try {
      await api(`${base}/reminders/${r.id}`, { method: "PATCH", body: { active: !r.active } });
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  async function removeReminder(r: ReminderRow) {
    if (!window.confirm(`删除 ${r.remindAt}「${r.text}」？`)) return;
    try {
      await api(`${base}/reminders/${r.id}`, { method: "DELETE" });
      notify("已删除");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  const alertsList = alertsLoad.data?.alerts ?? [];
  const reminders = remindersLoad.data?.reminders ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader icon="⏰" title="提醒" subtitle={`发到${child.displayName}的墨水屏：底部黑底横幅显示一段时间（发送时选择），设备响铃 3 声`} />
      {(alertsLoad.error || remindersLoad.error) && <ErrorBox text={alertsLoad.error ?? remindersLoad.error ?? ""} onRetry={() => { alertsLoad.reload(); remindersLoad.reload(); }} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card title="立即提醒">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canEdit}
            maxLength={MAX + 10}
            placeholder={canEdit ? "例如：回家吃饭啦！" : "只读成员不能发送提醒"}
            style={{ ...inputStyle, borderColor: text.trim().length > MAX ? "#ef4444" : "var(--border)" }}
            onKeyDown={(e) => e.key === "Enter" && !busy && void sendNow()}
          />
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "6px 0 10px" }}>{text.trim().length}/{MAX}</div>
          {canEdit && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {QUICK.map((q) => (
                  <button key={q} type="button" className="btn btn-sm" onClick={() => setText(q)} style={{ background: "#fff", border: "1px solid var(--border)", color: "var(--text-sub)" }}>
                    {q}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-sub)", marginRight: 4 }}>显示多久</span>
                {DURATIONS.map((d) => (
                  <button
                    key={d.minutes}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setMinutes(d.minutes)}
                    style={{
                      background: minutes === d.minutes ? "var(--primary)" : "#fff",
                      color: minutes === d.minutes ? "#fff" : "var(--text-sub)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary" disabled={busy || !text.trim() || text.trim().length > MAX} onClick={sendNow}>
                {busy ? "发送中..." : "🔔 发送并响铃"}
              </button>
            </>
          )}
          <div style={{ marginTop: 16 }}>
            {alertsList.length === 0 && <Empty text="还没有发过提醒" />}
            {alertsList.slice(0, 8).map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "0.55rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 92, color: "var(--text-muted)", fontSize: "0.75rem" }}>{shortDateTime(a.createdAt)}</span>
                <span style={{ flex: 1 }}>
                  {a.kind === "reminder" ? "⏰ " : ""}
                  {a.text}
                </span>
                <span style={{ fontSize: "0.75rem", color: a.deliveredAt ? "#10b981" : a.showing ? "#d97706" : "var(--text-muted)" }}>
                  {a.deliveredAt ? "已响铃" : a.showing ? "等待设备同步" : "未响铃"}
                  {a.showing ? ` · 显示到 ${hhmm(a.showUntil)}` : ""}
                </span>
                {canEdit && a.showing && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => withdraw(a.id)}>
                    撤下
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="墨水屏效果">
          <InkPreview childId={child.id} refreshKey={dataVersion} />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "10px 0 0" }}>提醒显示时会替代底部的留言 / 古诗，到时间后自动恢复；定时提醒固定显示 30 分钟。</p>
        </Card>
      </div>

      <Card
        title="定时提醒"
        extra={
          canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDraft({ remindAt: "07:20", weekdays: [1, 2, 3, 4, 5], text: "", beep: true, active: true })}>
              + 新建
            </button>
          )
        }
      >
        {reminders.length === 0 && (
          <Empty
            text="还没有定时提醒。可以从常用提醒开始："
            action={
              canEdit && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {PRESETS.map((p) => (
                    <button key={p.remindAt} type="button" className="btn btn-outline btn-sm" onClick={() => setDraft({ ...p, beep: true, active: true })}>
                      {p.remindAt} {p.text}
                    </button>
                  ))}
                </div>
              )
            }
          />
        )}
        {reminders.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "0.7rem 0", borderTop: "1px solid var(--border-subtle)", opacity: r.active ? 1 : 0.5 }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 64 }}>{r.remindAt}</span>
            <span style={{ flex: 1 }}>
              <div style={{ fontSize: "0.92rem" }}>{r.text}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {weekdaysLabel(r.weekdays)} · {r.beep ? "响铃" : "不响铃"}
                {r.active ? "" : " · 已暂停"}
              </div>
            </span>
            {canEdit && (
              <>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => toggle(r)}>{r.active ? "暂停" : "启用"}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft({ ...r })}>编辑</button>
                <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} onClick={() => removeReminder(r)}>删除</button>
              </>
            )}
          </div>
        ))}
      </Card>

      {draft && (
        <Modal title={draft.id ? "编辑定时提醒" : "新建定时提醒"} onClose={() => setDraft(null)}>
          <Field label="时间" hint={`${child.displayName}所在时区`}>
            <input type="time" style={inputStyle} value={draft.remindAt} onChange={(e) => setDraft({ ...draft, remindAt: e.target.value })} />
          </Field>
          <Field label="重复">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {WEEKDAYS.map((w, i) => {
                const d = i + 1;
                const on = draft.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] })}
                    style={{ minWidth: 40, background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={`提醒内容（${draft.text.trim().length}/${MAX}）`}>
            <input style={inputStyle} value={draft.text} maxLength={MAX + 10} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="例如：该出门上学了" />
          </Field>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9rem", marginBottom: 16 }}>
            <input type="checkbox" checked={draft.beep} onChange={(e) => setDraft({ ...draft, beep: e.target.checked })} />
            到点时设备响铃 3 声
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setDraft(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveReminder}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
