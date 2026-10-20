"use client";

/**
 * 课程与日程：
 * - 周课表（PRD F03）：按星期查看/新增/编辑/删除，按时间排序；复制某天到其它天；预设导入。
 * - 临时调整（PRD F04）：指定日期加课、调整某节课、停课，优先于周课表。
 * 墨水屏首页最多显示 10 条当日日程。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import {
  Card,
  Empty,
  ErrorBox,
  Field,
  InkPreview,
  Modal,
  PageHeader,
  WEEKDAY_ZH,
  addDays,
  dateLabel,
  hhmmToMinute,
  inputStyle,
  isoWeekdayOf,
  minuteToHHMM,
  todayIn,
  useLoad,
} from "../ui";

export interface ScheduleRow {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  title: string;
  location: string | null;
  note: string | null;
  /** D-013 需准备的物品 */
  prepare: string | null;
  active: boolean;
}

interface OverrideRow {
  id: string;
  overrideDate: string;
  action: "add" | "replace" | "cancel";
  targetScheduleItemId: string | null;
  startMinute: number | null;
  endMinute: number | null;
  title: string | null;
  prepare: string | null;
}

const PRESETS: Record<string, { label: string; items: [string, string, string][] }> = {
  school: {
    label: "标准校内课表",
    items: [
      ["08:00", "08:40", "语文"],
      ["08:50", "09:30", "数学"],
      ["09:50", "10:30", "英语"],
      ["10:40", "11:20", "体育"],
      ["14:00", "14:40", "科学"],
      ["15:30", "16:00", "放学整理"],
    ],
  },
  weekend: {
    label: "周末兴趣安排",
    items: [
      ["09:00", "10:30", "兴趣班"],
      ["15:00", "17:00", "户外活动"],
      ["19:30", "20:00", "亲子阅读"],
    ],
  },
};

interface ItemForm {
  title: string;
  start: string;
  end: string;
  location: string;
  prepare: string;
}

export default function ScheduleView() {
  const child = useChild();
  const { canEdit, notify, bumpData, dataVersion } = useDashboard();
  const base = `/api/v1/children/${child.id}`;
  const today = todayIn(child.timezone);
  const [weekday, setWeekday] = React.useState(isoWeekdayOf(today));
  const { data, error, reload } = useLoad(() => api<{ items: ScheduleRow[] }>(`${base}/schedule`), [base, dataVersion], `schedule:${base}`);
  const [editing, setEditing] = React.useState<{ id: string | null; form: ItemForm } | null>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const items = (data?.items ?? []).filter((s) => s.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
  const countOf = (d: number) => (data?.items ?? []).filter((s) => s.weekday === d && s.active).length;

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try {
      await fn();
      notify(okText);
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!editing) return;
    const f = editing.form;
    const startMinute = hhmmToMinute(f.start);
    const endMinute = hhmmToMinute(f.end);
    if (!f.title.trim()) return notify("请填写名称", false);
    if (endMinute <= startMinute) return notify("结束时间必须晚于开始时间", false);
    const body = { weekday, startMinute, endMinute, title: f.title.trim(), location: f.location.trim() || null, prepare: f.prepare.trim() || null };
    await run(
      () => (editing.id ? api(`${base}/schedule/${editing.id}`, { method: "PATCH", body }) : api(`${base}/schedule`, { method: "POST", body })),
      editing.id ? "已更新" : "已添加",
    );
    setEditing(null);
  }

  function importPreset(key: string) {
    const preset = PRESETS[key]!;
    if (items.length > 0 && !window.confirm(`${WEEKDAY_ZH[weekday]}已有 ${items.length} 条安排，导入「${preset.label}」会追加，继续？`)) return;
    void run(
      async () => {
        for (const [s, e, title] of preset.items) {
          await api(`${base}/schedule`, { method: "POST", body: { weekday, startMinute: hhmmToMinute(s), endMinute: hhmmToMinute(e), title } });
        }
      },
      `已导入「${preset.label}」到${WEEKDAY_ZH[weekday]}`,
    );
  }

  async function copyTo(targets: number[]) {
    setCopyOpen(false);
    await run(async () => {
      for (const d of targets) {
        for (const s of items) {
          await api(`${base}/schedule`, { method: "POST", body: { weekday: d, startMinute: s.startMinute, endMinute: s.endMinute, title: s.title, location: s.location, prepare: s.prepare } });
        }
      }
    }, `已把${WEEKDAY_ZH[weekday]}的 ${items.length} 条安排复制到 ${targets.map((d) => WEEKDAY_ZH[d]).join("、")}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="📅"
        title="课程与日程"
        subtitle="周课表每周重复；临时调整只影响指定日期。墨水屏首页按时间显示当天最多 10 条日程"
        actions={
          canEdit && (
            <>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => importPreset("school")}>导入标准校内课表</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => importPreset("weekend")}>导入周末兴趣安排</button>
            </>
          )
        }
      />

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: 8 }}>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button key={d} type="button" onClick={() => setWeekday(d)} style={{ border: "none", borderRadius: 10, padding: "0.65rem 0", cursor: "pointer", background: d === weekday ? "var(--primary)" : "transparent", color: d === weekday ? "#fff" : "var(--text-main)" }}>
            <div style={{ fontWeight: 700 }}>
              {WEEKDAY_ZH[d]}
              {d === isoWeekdayOf(today) && <span style={{ fontSize: "0.7rem", marginLeft: 4 }}>（今天）</span>}
            </div>
            <div style={{ fontSize: "0.72rem", opacity: 0.8 }}>{countOf(d) > 0 ? `${countOf(d)} 条` : "暂无"}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card
          title={`${WEEKDAY_ZH[weekday]}课表（${items.length} 条${items.length > 10 ? "，墨水屏只显示前 10 条" : ""}）`}
          extra={
            canEdit && (
              <span style={{ display: "flex", gap: 6 }}>
                {items.length > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setCopyOpen(true)}>复制到其它天</button>}
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ id: null, form: { title: "", start: "08:00", end: "08:40", location: "", prepare: "" } })}>+ 添加</button>
              </span>
            )
          }
        >
          {error && <ErrorBox text={error} onRetry={reload} />}
          {data && items.length === 0 && <Empty text={`${WEEKDAY_ZH[weekday]}还没有安排`} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.65rem 0.85rem", borderRadius: 10, background: "#f8fafc", border: "1px solid var(--border-subtle)", opacity: i >= 10 ? 0.55 : 1 }}>
                <span style={{ fontWeight: 700, color: "var(--primary)", minWidth: 100, fontSize: "0.88rem" }}>
                  {minuteToHHMM(s.startMinute)} - {minuteToHHMM(s.endMinute)}
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>
                  {s.title}
                  {s.location && <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--text-muted)" }}> · {s.location}</span>}
                  {s.prepare && <span style={{ display: "block", fontWeight: 400, fontSize: "0.75rem", color: "#b45309" }}>🎒 需准备：{s.prepare}</span>}
                </span>
                {canEdit && (
                  <>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ id: s.id, form: { title: s.title, start: minuteToHHMM(s.startMinute), end: minuteToHHMM(s.endMinute), location: s.location ?? "", prepare: s.prepare ?? "" } })}>
                      编辑
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} disabled={busy} onClick={() => window.confirm(`删除「${s.title}」？`) && void run(() => api(`${base}/schedule/${s.id}`, { method: "DELETE" }), "已删除")}>
                      删除
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <Card title="墨水屏当前内容">
            <InkPreview childId={child.id} refreshKey={dataVersion} />
          </Card>
          <Overrides base={base} today={today} weeklyItems={data?.items ?? []} canEdit={canEdit} run={run} busy={busy} dataVersion={dataVersion} />
        </div>
      </div>

      {editing && (
        <Modal title={`${editing.id ? "编辑" : "添加"}${WEEKDAY_ZH[weekday]}安排`} onClose={() => setEditing(null)}>
          <Field label="名称">
            <input style={inputStyle} value={editing.form.title} maxLength={60} autoFocus onChange={(e) => setEditing({ ...editing, form: { ...editing.form, title: e.target.value } })} placeholder="例如：数学、钢琴课" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
            <Field label="开始">
              <input style={inputStyle} type="time" value={editing.form.start} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, start: e.target.value } })} />
            </Field>
            <Field label="结束">
              <input style={inputStyle} type="time" value={editing.form.end} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, end: e.target.value } })} />
            </Field>
          </div>
          <Field label="地点（可空）">
            <input style={inputStyle} value={editing.form.location} maxLength={60} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, location: e.target.value } })} />
          </Field>
          <Field label="需准备的物品（可空）" hint="用顿号或空格分隔；前一天晚上的明日预览会在墨水屏底部汇总显示">
            <input style={inputStyle} value={editing.form.prepare} maxLength={60} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, prepare: e.target.value } })} placeholder="例如：泳衣、泳镜、毛巾" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}

      {copyOpen && <CopyDialog from={weekday} onClose={() => setCopyOpen(false)} onConfirm={copyTo} />}
    </div>
  );
}

function CopyDialog({ from, onClose, onConfirm }: { from: number; onClose: () => void; onConfirm: (days: number[]) => void }) {
  const [days, setDays] = React.useState<number[]>([]);
  return (
    <Modal title={`把${WEEKDAY_ZH[from]}的安排复制到…`} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[1, 2, 3, 4, 5, 6, 7]
          .filter((d) => d !== from)
          .map((d) => {
            const on = days.includes(d);
            return (
              <button key={d} type="button" className="btn btn-sm" onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])} style={{ background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}>
                {WEEKDAY_ZH[d]}
              </button>
            );
          })}
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>复制是追加，不会删除目标日已有的安排。</p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>取消</button>
        <button type="button" className="btn btn-primary" disabled={days.length === 0} onClick={() => onConfirm(days.sort())}>复制</button>
      </div>
    </Modal>
  );
}

function Overrides({
  base,
  today,
  weeklyItems,
  canEdit,
  run,
  busy,
  dataVersion,
}: {
  base: string;
  today: string;
  weeklyItems: ScheduleRow[];
  canEdit: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  busy: boolean;
  dataVersion: number;
}) {
  const { data, error, reload } = useLoad(() => api<{ overrides: OverrideRow[] }>(`${base}/overrides?from=${today}&to=${addDays(today, 30)}`), [base, today, dataVersion], `overrides:${base}:${today}`);
  const [form, setForm] = React.useState<{ date: string; action: OverrideRow["action"]; target: string; title: string; start: string; end: string; prepare: string } | null>(null);

  const itemsOn = (date: string) => weeklyItems.filter((s) => s.active && s.weekday === isoWeekdayOf(date)).sort((a, b) => a.startMinute - b.startMinute);
  const titleOf = (id: string | null) => weeklyItems.find((s) => s.id === id)?.title ?? "（已删除的课程）";

  async function submit() {
    if (!form) return;
    const body: Record<string, unknown> = { overrideDate: form.date, action: form.action };
    if (form.action !== "add") {
      if (!form.target) return;
      body.targetScheduleItemId = form.target;
    }
    if (form.action !== "cancel") {
      body.startMinute = hhmmToMinute(form.start);
      body.endMinute = hhmmToMinute(form.end);
      if (form.title.trim()) body.title = form.title.trim();
      else if (form.action === "add") return;
      if (form.prepare.trim()) body.prepare = form.prepare.trim();
    }
    await run(() => api(`${base}/overrides`, { method: "POST", body }), "临时调整已保存");
    setForm(null);
  }

  const describe = (o: OverrideRow) =>
    o.action === "add"
      ? `加课：${minuteToHHMM(o.startMinute ?? 0)}-${minuteToHHMM(o.endMinute ?? 0)} ${o.title}${o.prepare ? `（需准备：${o.prepare}）` : ""}`
      : o.action === "cancel"
        ? `停课：${titleOf(o.targetScheduleItemId)}`
        : `调整：${titleOf(o.targetScheduleItemId)} → ${o.startMinute !== null ? `${minuteToHHMM(o.startMinute)}-${minuteToHHMM(o.endMinute ?? 0)} ` : ""}${o.title ?? ""}`;

  return (
    <Card
      title="临时调整（未来 30 天）"
      extra={canEdit && <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm({ date: today, action: "cancel", target: "", title: "", start: "16:00", end: "17:00", prepare: "" })}>+ 新增</button>}
    >
      {error && <ErrorBox text={error} onRetry={reload} />}
      {data && data.overrides.length === 0 && <Empty text="没有临时调整。调课、停课、加活动都在这里设置" />}
      {data?.overrides.map((o) => (
        <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.5rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.84rem" }}>
          <span style={{ minWidth: 90, color: "var(--text-sub)", fontWeight: 600 }}>{o.overrideDate === today ? "今天" : dateLabel(o.overrideDate).slice(5)}</span>
          <span style={{ flex: 1 }}>{describe(o)}</span>
          {canEdit && (
            <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} disabled={busy} onClick={() => void run(() => api(`${base}/overrides/${o.id}`, { method: "DELETE" }), "已撤销")}>
              撤销
            </button>
          )}
        </div>
      ))}

      {form && (
        <Modal title="新增临时调整" onClose={() => setForm(null)}>
          <Field label="日期">
            <input style={inputStyle} type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, target: "" })} />
          </Field>
          <Field label="类型">
            <select style={inputStyle} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as OverrideRow["action"] })}>
              <option value="cancel">停课（这一天不上某节课）</option>
              <option value="replace">调整（改时间或名称）</option>
              <option value="add">加课 / 加活动</option>
            </select>
          </Field>
          {form.action !== "add" && (
            <Field label={`${dateLabel(form.date)} 的课程`} hint={itemsOn(form.date).length === 0 ? "这一天周课表里没有课程" : undefined}>
              <select
                style={inputStyle}
                value={form.target}
                onChange={(e) => {
                  // 调整类型默认沿用原课程时间，避免误改
                  const item = weeklyItems.find((s) => s.id === e.target.value);
                  setForm({ ...form, target: e.target.value, ...(item ? { start: minuteToHHMM(item.startMinute), end: minuteToHHMM(item.endMinute) } : {}) });
                }}
              >
                <option value="">请选择</option>
                {itemsOn(form.date).map((s) => (
                  <option key={s.id} value={s.id}>
                    {minuteToHHMM(s.startMinute)} {s.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {form.action !== "cancel" && (
            <>
              <Field label={form.action === "add" ? "名称" : "新名称（可空 = 不改）"}>
                <input style={inputStyle} value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
                <Field label="开始">
                  <input style={inputStyle} type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                </Field>
                <Field label="结束">
                  <input style={inputStyle} type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
                </Field>
              </div>
              <Field label="需准备的物品（可空）">
                <input style={inputStyle} value={form.prepare} maxLength={60} onChange={(e) => setForm({ ...form, prepare: e.target.value })} placeholder="例如：画笔、围裙" />
              </Field>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy || (form.action !== "add" && !form.target) || (form.action === "add" && !form.title.trim())} onClick={submit}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
