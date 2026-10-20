"use client";

/**
 * 任务中心（PRD F05）：
 * - 当日任务：按日期查看，新建/编辑/完成/删除/批量；分类、积分、优先级为真实字段。
 * - 重复任务：task_templates（每天 / 工作日 / 每周指定星期 / 仅一次 + 起止日期），
 *   每天由服务端自动生成当日任务（家长打开页面或零点跨天时物化）。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import {
  CATEGORY_COLORS,
  Card,
  CategoryBadge,
  Empty,
  ErrorBox,
  Field,
  Modal,
  PageHeader,
  TASK_CATEGORIES,
  WEEKDAY_ZH,
  addDays,
  dateLabel,
  inputStyle,
  todayIn,
  useLoad,
} from "../ui";

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
  priority: number;
  category: string | null;
  points: number;
  status: "pending" | "completed" | "skipped";
  sourceTemplateId: string | null;
}

interface Recurrence {
  type: "once" | "daily" | "weekly";
  weekdays?: number[] | null;
  startDate: string;
  endDate?: string | null;
}

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  recurrence: Recurrence;
  estimatedMinutes: number | null;
  priority: number;
  category: string | null;
  points: number;
  active: boolean;
}

const PRIORITIES = [
  { value: 0, label: "普通" },
  { value: 5, label: "重要" },
  { value: 9, label: "紧急" },
];

function priorityBadge(p: number) {
  if (p >= 9) return <span className="badge" style={{ background: "#fef2f2", color: "#dc2626", fontSize: "0.7rem" }}>紧急</span>;
  if (p >= 5) return <span className="badge" style={{ background: "#fffbeb", color: "#b45309", fontSize: "0.7rem" }}>重要</span>;
  return <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>普通</span>;
}

export function describeRecurrence(r: Recurrence): string {
  const range = r.endDate ? `${r.startDate} 至 ${r.endDate}` : `${r.startDate} 起`;
  if (r.type === "once") return `仅 ${r.startDate} 一次`;
  if (r.type === "daily") return `每天 · ${range}`;
  const days = [...(r.weekdays ?? [])].sort();
  if (days.join(",") === "1,2,3,4,5") return `工作日 · ${range}`;
  if (days.join(",") === "6,7") return `周末 · ${range}`;
  return `每周${days.map((d) => WEEKDAY_ZH[d]?.slice(1)).join("、")} · ${range}`;
}

interface TaskForm {
  title: string;
  description: string;
  category: string;
  points: number;
  estimatedMinutes: string;
  priority: number;
}

const emptyForm: TaskForm = { title: "", description: "", category: "学习", points: 5, estimatedMinutes: "", priority: 0 };

function TaskFields({ form, setForm }: { form: TaskForm; setForm: (f: TaskForm) => void }) {
  return (
    <>
      <Field label="任务名称">
        <input style={inputStyle} value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：阅读 20 分钟" autoFocus />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
        <Field label="分类">
          <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option value="">不分类</option>
          </select>
        </Field>
        <Field label="完成可得积分">
          <input style={inputStyle} type="number" min={0} max={1000} value={form.points} onChange={(e) => setForm({ ...form, points: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label="预计时长（分钟，可空）">
          <input style={inputStyle} type="number" min={1} max={480} value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
        </Field>
        <Field label="优先级">
          <select style={inputStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="说明（可空）">
        <input style={inputStyle} value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </>
  );
}

function formToBody(form: TaskForm) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    category: form.category || null,
    points: form.points,
    estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
    priority: form.priority,
  };
}

export default function TasksView() {
  const child = useChild();
  const { canEdit, notify, bumpData, dataVersion } = useDashboard();
  const base = `/api/v1/children/${child.id}`;
  const today = todayIn(child.timezone);
  const [tab, setTab] = React.useState<"day" | "templates">("day");
  const [date, setDate] = React.useState(today);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="📋"
        title="任务中心"
        subtitle="当日任务会显示在墨水屏上；孩子按 DONE 键或家长在此打勾即完成，并自动获得积分"
        actions={
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
            {(
              [
                ["day", "当日任务"],
                ["templates", "重复任务"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{ border: "none", padding: "0.45rem 1rem", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", background: tab === k ? "#fff" : "transparent", color: tab === k ? "var(--primary)" : "var(--text-sub)", boxShadow: tab === k ? "var(--shadow-sm)" : "none" }}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      {tab === "day" ? (
        <DayTasks base={base} date={date} setDate={setDate} today={today} canEdit={canEdit} notify={notify} bumpData={bumpData} dataVersion={dataVersion} />
      ) : (
        <Templates base={base} today={today} canEdit={canEdit} notify={notify} bumpData={bumpData} />
      )}
    </div>
  );
}

interface SectionProps {
  base: string;
  today: string;
  canEdit: boolean;
  notify: (t: string, ok?: boolean) => void;
  bumpData: () => void;
}

function DayTasks({ base, date, setDate, today, canEdit, notify, bumpData, dataVersion }: SectionProps & { date: string; setDate: (d: string) => void; dataVersion: number }) {
  const { data, error, reload } = useLoad(() => api<{ tasks: TaskRow[] }>(`${base}/tasks?date=${date}`), [base, date, dataVersion], `tasks:${base}:${date}`);
  const stats = useLoad(() => api<{ totals: { completionRate: number | null; planned: number; completed: number }; byCategory: { category: string; planned: number; completed: number }[] }>(`${base}/stats?days=7`), [base, dataVersion], `stats7:${base}`);
  const [filter, setFilter] = React.useState<string>("全部");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<{ id: string | null; form: TaskForm } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const tasks = (data?.tasks ?? []).filter((t) => filter === "全部" || (t.category ?? "未分类") === filter);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try {
      await fn();
      notify(okText);
      bumpData();
      setSelected(new Set());
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!editing) return;
    const body = formToBody(editing.form);
    if (!body.title) return notify("请填写任务名称", false);
    await run(
      () =>
        editing.id
          ? api(`${base}/tasks/${editing.id}`, { method: "PATCH", body })
          : api(`${base}/tasks`, { method: "POST", body: { ...body, occurrenceDate: date } }),
      editing.id ? "任务已更新" : "任务已添加，墨水屏将在下次同步时显示",
    );
    setEditing(null);
  }

  const setStatus = (ids: string[], status: "completed" | "pending") =>
    run(() => Promise.all(ids.map((id) => api(`${base}/tasks/${id}`, { method: "PATCH", body: { status } }))), status === "completed" ? "已标记完成" : "已取消完成");

  const remove = (ids: string[]) => {
    if (!window.confirm(`确定删除 ${ids.length} 项任务？已获得的积分会一并撤销。`)) return;
    void run(() => Promise.all(ids.map((id) => api(`${base}/tasks/${id}`, { method: "DELETE" }))), "已删除");
  };

  const allChecked = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const doneCount = (data?.tasks ?? []).filter((t) => t.status === "completed").length;

  return (
    <div className="kb-split-side" style={{ display: "grid", gap: "1.5rem", alignItems: "start" }}>
      <Card
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="前一天">‹</button>
            <span>{date === today ? `今天 · ${dateLabel(date)}` : dateLabel(date)}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDate(addDays(date, 1))} aria-label="后一天">›</button>
            {date !== today && <button type="button" className="btn btn-outline btn-sm" onClick={() => setDate(today)}>回到今天</button>}
          </span>
        }
        extra={canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ id: null, form: emptyForm })}>+ 新建任务</button>}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {["全部", ...TASK_CATEGORIES, "未分类"].map((c) => (
            <button key={c} type="button" onClick={() => setFilter(c)} className="btn btn-sm" style={{ background: filter === c ? "var(--primary-light)" : "#fff", color: filter === c ? "var(--primary)" : "var(--text-sub)", border: `1px solid ${filter === c ? "var(--primary-border)" : "var(--border)"}` }}>
              {c}
            </button>
          ))}
        </div>

        {error && <ErrorBox text={error} onRetry={reload} />}
        {data && tasks.length === 0 && <Empty text={filter === "全部" ? "这一天还没有任务" : `没有「${filter}」类任务`} />}

        {tasks.length > 0 && (
          <>
            {canEdit && selected.size > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0.5rem 0.75rem", background: "var(--primary-light)", borderRadius: 8, marginBottom: 8, fontSize: "0.82rem" }}>
                已选 {selected.size} 项
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setStatus([...selected], "completed")}>批量完成</button>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setStatus([...selected], "pending")}>批量取消完成</button>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} style={{ color: "#dc2626" }} onClick={() => remove([...selected])}>批量删除</button>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: "0.86rem" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", fontSize: "0.78rem", textAlign: "left" }}>
                  {canEdit && (
                    <th style={th}>
                      <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(tasks.map((t) => t.id)))} aria-label="全选" />
                    </th>
                  )}
                  <th style={th}>任务</th>
                  <th style={th}>分类</th>
                  <th style={th}>时长</th>
                  <th style={th}>积分</th>
                  <th style={th}>优先级</th>
                  <th style={th}>状态</th>
                  {canEdit && <th style={{ ...th, textAlign: "right" }}>操作</th>}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    {canEdit && (
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => {
                            const next = new Set(selected);
                            if (next.has(t.id)) next.delete(t.id);
                            else next.add(t.id);
                            setSelected(next);
                          }}
                          aria-label={`选择 ${t.title}`}
                        />
                      </td>
                    )}
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {t.title}
                        {t.sourceTemplateId && <span title="由重复任务生成" style={{ marginLeft: 6, fontSize: "0.7rem", color: "var(--text-muted)" }}>🔁</span>}
                      </div>
                      {t.description && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t.description}</div>}
                    </td>
                    <td style={td}><CategoryBadge category={t.category} /></td>
                    <td style={td}>{t.estimatedMinutes ? `${t.estimatedMinutes} 分钟` : "—"}</td>
                    <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{t.points > 0 ? `+${t.points}` : "—"}</td>
                    <td style={td}>{priorityBadge(t.priority)}</td>
                    <td style={td}>
                      {t.status === "completed" ? (
                        <span className="badge" style={{ background: "#ecfdf5", color: "#059669" }}>已完成</span>
                      ) : t.status === "skipped" ? (
                        <span className="badge" style={{ background: "#f1f5f9", color: "#64748b" }}>已跳过</span>
                      ) : (
                        <span className="badge" style={{ background: "#f8fafc", color: "var(--text-sub)" }}>待完成</span>
                      )}
                    </td>
                    {canEdit && (
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setStatus([t.id], t.status === "completed" ? "pending" : "completed")}>
                          {t.status === "completed" ? "取消完成" : "完成"}
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            setEditing({
                              id: t.id,
                              form: { title: t.title, description: t.description ?? "", category: t.category ?? "", points: t.points, estimatedMinutes: t.estimatedMinutes ? String(t.estimatedMinutes) : "", priority: t.priority >= 9 ? 9 : t.priority >= 5 ? 5 : 0 },
                            })
                          }
                        >
                          编辑
                        </button>{" "}
                        <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} disabled={busy} onClick={() => remove([t.id])}>
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Card title="当天进度">
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--primary)" }}>
            {doneCount} / {data?.tasks.length ?? 0}
          </div>
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
            <div style={{ width: `${data && data.tasks.length > 0 ? (doneCount / data.tasks.length) * 100 : 0}%`, height: "100%", background: "#10b981" }} />
          </div>
        </Card>
        <Card title="近 7 天">
          {stats.data ? (
            <>
              <div style={{ fontSize: "0.85rem", color: "var(--text-sub)", marginBottom: 10 }}>
                完成率 <b style={{ color: "var(--primary)", fontSize: "1.2rem" }}>{stats.data.totals.completionRate ?? "—"}{stats.data.totals.completionRate !== null && "%"}</b>
                <span style={{ color: "var(--text-muted)" }}> · 共 {stats.data.totals.planned} 项，完成 {stats.data.totals.completed} 项</span>
              </div>
              {stats.data.byCategory.length === 0 ? (
                <Empty text="暂无数据" />
              ) : (
                stats.data.byCategory.map((c) => (
                  <div key={c.category} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                      <span>{c.category}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {c.completed}/{c.planned}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(c.completed / Math.max(1, c.planned)) * 100}%`, height: "100%", background: (CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS["未分类"]!).bar }} />
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{stats.error ?? "加载中..."}</div>
          )}
        </Card>
      </div>

      {editing && (
        <Modal title={editing.id ? "编辑任务" : `新建任务 · ${dateLabel(date)}`} onClose={() => setEditing(null)}>
          <TaskFields form={editing.form} setForm={(form) => setEditing({ ...editing, form })} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface TemplateForm extends TaskForm {
  type: "daily" | "weekdays" | "weekly" | "once";
  weekdays: number[];
  startDate: string;
  endDate: string;
}

function Templates({ base, today, canEdit, notify, bumpData }: SectionProps) {
  const { data, error, reload } = useLoad(() => api<{ templates: TemplateRow[] }>(`${base}/task-templates`), [base], `templates:${base}`);
  const [editing, setEditing] = React.useState<{ id: string | null; form: TemplateForm } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const newForm = (): TemplateForm => ({ ...emptyForm, type: "weekdays", weekdays: [1, 2, 3, 4, 5], startDate: today, endDate: "" });

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try {
      await fn();
      notify(okText);
      bumpData();
      await reload();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!editing) return;
    const f = editing.form;
    if (!f.title.trim()) return notify("请填写任务名称", false);
    if (f.type === "weekly" && f.weekdays.length === 0) return notify("请至少选择一天", false);
    const recurrence: Recurrence =
      f.type === "once"
        ? { type: "once", startDate: f.startDate }
        : f.type === "daily"
          ? { type: "daily", startDate: f.startDate, endDate: f.endDate || null }
          : { type: "weekly", weekdays: f.type === "weekdays" ? [1, 2, 3, 4, 5] : f.weekdays, startDate: f.startDate, endDate: f.endDate || null };
    const body = { ...formToBody(f), recurrence };
    await run(
      () => (editing.id ? api(`${base}/task-templates/${editing.id}`, { method: "PATCH", body }) : api(`${base}/task-templates`, { method: "POST", body })),
      editing.id ? "重复任务已更新（从明天起生效）" : "重复任务已创建，符合规则的日期会自动生成任务",
    );
    setEditing(null);
  }

  function edit(t: TemplateRow) {
    const r = t.recurrence;
    const isWeekdays = r.type === "weekly" && [...(r.weekdays ?? [])].sort().join(",") === "1,2,3,4,5";
    setEditing({
      id: t.id,
      form: {
        title: t.title,
        description: t.description ?? "",
        category: t.category ?? "",
        points: t.points,
        estimatedMinutes: t.estimatedMinutes ? String(t.estimatedMinutes) : "",
        priority: t.priority >= 9 ? 9 : t.priority >= 5 ? 5 : 0,
        type: r.type === "once" ? "once" : r.type === "daily" ? "daily" : isWeekdays ? "weekdays" : "weekly",
        weekdays: r.weekdays ?? [],
        startDate: r.startDate,
        endDate: r.endDate ?? "",
      },
    });
  }

  return (
    <Card
      title="重复任务"
      extra={canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ id: null, form: newForm() })}>+ 新建重复任务</button>}
    >
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 12px" }}>
        按规则每天自动生成当日任务（零点切换或家长打开任务列表时生成）。修改规则不影响已生成的当日任务。
      </p>
      {error && <ErrorBox text={error} onRetry={reload} />}
      {data && data.templates.length === 0 && <Empty text="还没有重复任务。比如「每个工作日 · 整理书包」「每天 · 阅读 20 分钟」" />}
      {data && data.templates.length > 0 && (
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: "0.86rem" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", fontSize: "0.78rem", textAlign: "left" }}>
              <th style={th}>任务</th>
              <th style={th}>重复规则</th>
              <th style={th}>分类</th>
              <th style={th}>积分</th>
              <th style={th}>状态</th>
              {canEdit && <th style={{ ...th, textAlign: "right" }}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {data.templates.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid var(--border-subtle)", opacity: t.active ? 1 : 0.55 }}>
                <td style={td}>
                  <b>{t.title}</b>
                  {t.estimatedMinutes ? <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}> · {t.estimatedMinutes} 分钟</span> : null}
                </td>
                <td style={td}>{describeRecurrence(t.recurrence)}</td>
                <td style={td}><CategoryBadge category={t.category} /></td>
                <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{t.points > 0 ? `+${t.points}` : "—"}</td>
                <td style={td}>{t.active ? "启用中" : "已暂停"}</td>
                {canEdit && (
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api(`${base}/task-templates/${t.id}`, { method: "PATCH", body: { active: !t.active } }), t.active ? "已暂停" : "已启用")}>
                      {t.active ? "暂停" : "启用"}
                    </button>{" "}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => edit(t)}>编辑</button>{" "}
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ color: "#dc2626" }}
                      disabled={busy}
                      onClick={() => window.confirm(`删除重复任务「${t.title}」？已生成的当日任务会保留。`) && void run(() => api(`${base}/task-templates/${t.id}`, { method: "DELETE" }), "已删除")}
                    >
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? "编辑重复任务" : "新建重复任务"} onClose={() => setEditing(null)} width={540}>
          <TaskFields form={editing.form} setForm={(f) => setEditing({ ...editing, form: { ...editing.form, ...f } })} />
          <Field label="重复规则">
            <select style={inputStyle} value={editing.form.type} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, type: e.target.value as TemplateForm["type"] } })}>
              <option value="weekdays">每个工作日（周一至周五）</option>
              <option value="daily">每天</option>
              <option value="weekly">每周指定几天</option>
              <option value="once">仅一次</option>
            </select>
          </Field>
          {editing.form.type === "weekly" && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const on = editing.form.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setEditing({ ...editing, form: { ...editing.form, weekdays: on ? editing.form.weekdays.filter((x) => x !== d) : [...editing.form.weekdays, d] } })
                    }
                    style={{ background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}
                  >
                    {WEEKDAY_ZH[d]}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
            <Field label={editing.form.type === "once" ? "日期" : "开始日期"}>
              <input style={inputStyle} type="date" value={editing.form.startDate} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, startDate: e.target.value } })} />
            </Field>
            {editing.form.type !== "once" && (
              <Field label="结束日期（可空 = 长期）">
                <input style={inputStyle} type="date" value={editing.form.endDate} min={editing.form.startDate} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, endDate: e.target.value } })} />
              </Field>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

const th: React.CSSProperties = { padding: "0.5rem 0.4rem", fontWeight: 600 };
const td: React.CSSProperties = { padding: "0.6rem 0.4rem", verticalAlign: "middle" };
