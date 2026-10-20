"use client";

/**
 * 孩子管理（PRD F02 + D-012 档案扩展）：多个孩子档案的新增/编辑/删除；
 * 绑定设备、积分、连续完成天数、近 7 天完成率均为真实数据。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useDashboard, type ChildItem, type ChildProfile } from "../DashboardContext";
import { Card, Empty, Field, Modal, PageHeader, StatCard, inputStyle, relativeTime, useLoad } from "../ui";

const TIMEZONES = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

interface ChildForm {
  /** D-013 明日预览开始时间；"" = 关闭 */
  previewFrom: string;
  /** D-019 专注计时 */
  focusMinutes: number;
  focusPoints: number;
  focusDailyCap: number;
  displayName: string;
  timezone: string;
  profile: ChildProfile;
  interestsText: string;
}

function toForm(c?: ChildItem): ChildForm {
  return {
    displayName: c?.displayName ?? "",
    timezone: c?.timezone ?? "Asia/Shanghai",
    profile: c?.profile ?? {},
    interestsText: (c?.profile.interests ?? []).join("、"),
    previewFrom: c ? (c.previewFrom ?? "") : "19:00",
    focusMinutes: c?.focusMinutes ?? 25,
    focusPoints: c?.focusPoints ?? 5,
    focusDailyCap: c?.focusDailyCap ?? 3,
  };
}

function cleanProfile(f: ChildForm): ChildProfile {
  const p = f.profile;
  const interests = f.interestsText
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    gender: p.gender || null,
    birthYear: p.birthYear || null,
    grade: p.grade?.trim() || null,
    interests: interests.length ? interests : null,
    wakeTime: p.wakeTime || null,
    bedTime: p.bedTime || null,
    encouragementStyle: p.encouragementStyle?.trim() || null,
    wishGoal: p.wishGoal?.trim() || null,
  };
}

export default function ChildrenView() {
  const { children, child, selectChild, reloadChildren, canEdit, role, notify, navigate, bumpData } = useDashboard();
  const [editing, setEditing] = React.useState<{ id: string | null; form: ChildForm } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!editing) return;
    const f = editing.form;
    if (!f.displayName.trim()) return notify("请填写昵称", false);
    setBusy(true);
    try {
      const body = {
        displayName: f.displayName.trim(),
        timezone: f.timezone,
        profile: cleanProfile(f),
        previewFrom: f.previewFrom || null,
        focusMinutes: f.focusMinutes,
        focusPoints: f.focusPoints,
        focusDailyCap: f.focusDailyCap,
      };
      if (editing.id) {
        await api(`/api/v1/children/${editing.id}`, { method: "PATCH", body });
      } else {
        const res = await api<{ child: { id: string } }>("/api/v1/children", { method: "POST", body: { displayName: body.displayName, timezone: body.timezone } });
        await api(`/api/v1/children/${res.child.id}`, { method: "PATCH", body: { profile: body.profile, previewFrom: body.previewFrom, focusMinutes: body.focusMinutes, focusPoints: body.focusPoints, focusDailyCap: body.focusDailyCap } });
        selectChild(res.child.id);
      }
      await reloadChildren();
      bumpData();
      notify(editing.id ? "档案已保存" : "孩子档案已创建");
      setEditing(null);
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: ChildItem) {
    if (!window.confirm(`确定删除「${c.displayName}」的档案？课表、任务、积分、留言会全部删除，绑定的墨水屏会被解绑。此操作不可恢复。`)) return;
    try {
      await api(`/api/v1/children/${c.id}`, { method: "DELETE" });
      await reloadChildren();
      notify("档案已删除");
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="👤"
        title="孩子管理"
        subtitle={`共 ${children.length} 个孩子档案；每个孩子有独立的课表、任务、积分和墨水屏`}
        actions={canEdit && <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null, form: toForm() })}>+ 添加孩子</button>}
      />

      {children.length === 0 ? (
        <div className="card" style={{ padding: "2rem" }}>
          <Empty text="还没有孩子档案" action={canEdit && <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null, form: toForm() })}>创建第一个孩子档案</button>} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: "1rem" }}>
          {children.map((c) => {
            const active = c.id === child?.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectChild(c.id)}
                className="card"
                style={{ padding: "1rem 1.25rem", textAlign: "left", cursor: "pointer", border: active ? "2px solid var(--primary)" : "1px solid var(--border)", background: active ? "var(--primary-light)" : "#fff" }}
              >
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {c.profile.gender === "girl" ? "👧" : c.profile.gender === "boy" ? "👦" : "🧒"} {c.displayName}
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>
                  {[c.profile.birthYear ? `${new Date().getFullYear() - c.profile.birthYear} 岁` : null, c.profile.grade].filter(Boolean).join(" · ") || "未填写年龄/年级"}
                </div>
                {active && <div style={{ fontSize: "0.72rem", color: "var(--primary)", marginTop: 6 }}>当前查看</div>}
              </button>
            );
          })}
        </div>
      )}

      {child && <ChildDetail key={child.id} c={child} canEdit={canEdit} isOwner={role === "owner"} onEdit={() => setEditing({ id: child.id, form: toForm(child) })} onDelete={() => remove(child)} navigate={navigate} />}

      {editing && (
        <Modal title={editing.id ? "编辑孩子档案" : "添加孩子"} onClose={() => setEditing(null)} width={560}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
            <Field label="昵称（显示在墨水屏顶部）">
              <input style={inputStyle} value={editing.form.displayName} maxLength={30} autoFocus onChange={(e) => setEditing({ ...editing, form: { ...editing.form, displayName: e.target.value } })} />
            </Field>
            <Field label="时区（决定「今天」是哪天）">
              <select style={inputStyle} value={editing.form.timezone} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, timezone: e.target.value } })}>
                {TIMEZONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="性别">
              <select style={inputStyle} value={editing.form.profile.gender ?? ""} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, gender: (e.target.value || null) as ChildProfile["gender"] } } })}>
                <option value="">不填写</option>
                <option value="boy">男孩</option>
                <option value="girl">女孩</option>
              </select>
            </Field>
            <Field label="出生年份">
              <input style={inputStyle} type="number" min={2000} max={2100} value={editing.form.profile.birthYear ?? ""} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, birthYear: e.target.value ? Number(e.target.value) : null } } })} placeholder="例如 2019" />
            </Field>
            <Field label="年级">
              <input style={inputStyle} value={editing.form.profile.grade ?? ""} maxLength={20} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, grade: e.target.value } } })} placeholder="例如 一年级" />
            </Field>
            <Field label="兴趣（用顿号分隔）">
              <input style={inputStyle} value={editing.form.interestsText} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, interestsText: e.target.value } })} placeholder="阅读、画画、游泳" />
            </Field>
            <Field label="起床时间">
              <input style={inputStyle} type="time" value={editing.form.profile.wakeTime ?? ""} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, wakeTime: e.target.value || null } } })} />
            </Field>
            <Field label="明日预览（墨水屏几点起显示明天）" hint="晚上提前看到明天的课程、任务和要带的东西；0 点切回今天">
              <select style={inputStyle} value={editing.form.previewFrom} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, previewFrom: e.target.value } })}>
                <option value="">关闭</option>
                {["17:00", "18:00", "19:00", "20:00", "21:00"].map((t) => (
                  <option key={t} value={t}>
                    {t} 起
                  </option>
                ))}
              </select>
            </Field>
            <Field label="专注计时（墨水屏第 4 页）" hint="孩子在设备上按 DONE 开始倒计时，完成后响铃并得积分">
              <div style={{ display: "flex", gap: 6 }}>
                <select style={inputStyle} value={editing.form.focusMinutes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, focusMinutes: Number(e.target.value) } })}>
                  {[10, 15, 20, 25, 30, 40, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      每次 {m} 分钟
                    </option>
                  ))}
                </select>
                <select style={inputStyle} value={editing.form.focusPoints} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, focusPoints: Number(e.target.value) } })}>
                  {[0, 1, 2, 3, 5, 8, 10].map((p) => (
                    <option key={p} value={p}>
                      {p === 0 ? "不加积分" : `完成 +${p} 分`}
                    </option>
                  ))}
                </select>
                <select style={inputStyle} value={editing.form.focusDailyCap} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, focusDailyCap: Number(e.target.value) } })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      每天最多 {n} 次
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="睡觉时间">
              <input style={inputStyle} type="time" value={editing.form.profile.bedTime ?? ""} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, bedTime: e.target.value || null } } })} />
            </Field>
          </div>
          <Field label="鼓励方式（给家庭成员参考）">
            <input style={inputStyle} value={editing.form.profile.encouragementStyle ?? ""} maxLength={60} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, encouragementStyle: e.target.value } } })} placeholder="例如：多肯定努力过程" />
          </Field>
          <Field label="心愿目标">
            <input style={inputStyle} value={editing.form.profile.wishGoal ?? ""} maxLength={60} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, profile: { ...editing.form.profile, wishGoal: e.target.value } } })} placeholder="例如：攒 500 分换乐高" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChildDetail({
  c,
  canEdit,
  isOwner,
  onEdit,
  onDelete,
  navigate,
}: {
  c: ChildItem;
  canEdit: boolean;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
  navigate: ReturnType<typeof useDashboard>["navigate"];
}) {
  const base = `/api/v1/children/${c.id}`;
  const { data } = useLoad(async () => {
    const [stats, devices] = await Promise.all([
      api<{ streakDays: number; totals: { completionRate: number | null; balance: number; completed: number }; topTasks: { title: string; completed: number }[] }>(`${base}/stats?days=7`),
      api<{ devices: { id: string; name: string | null; hardwareId: string; online: boolean; lastSeenAt: string | null }[] }>(`${base}/devices`),
    ]);
    return { stats, devices: devices.devices };
  }, [base], `childDetail:${base}`);
  const p = c.profile;

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", padding: "0.45rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.86rem" }}>
      <span style={{ width: 96, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ flex: 1 }}>{value || <span style={{ color: "var(--text-muted)" }}>未填写</span>}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "1rem" }}>
        <StatCard icon="🏆" label="积分余额" value={data ? `${data.stats.totals.balance} 分` : "…"} color="#d97706" />
        <StatCard icon="🔥" label="连续完成" value={data ? `${data.stats.streakDays} 天` : "…"} sub="每天至少完成 1 项任务" color="#dc2626" />
        <StatCard icon="✅" label="近 7 天完成率" value={data ? (data.stats.totals.completionRate === null ? "—" : `${data.stats.totals.completionRate}%`) : "…"} sub={data ? `共完成 ${data.stats.totals.completed} 项` : undefined} color="#059669" />
        <StatCard
          icon="📱"
          label="绑定墨水屏"
          value={data ? (data.devices.length === 0 ? "未绑定" : data.devices[0]!.online ? "在线" : "离线") : "…"}
          sub={data?.devices[0] ? `${data.devices[0].hardwareId} · ${relativeTime(data.devices[0].lastSeenAt)}同步` : "到设备管理中输入配对码绑定"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card
          title={`${c.displayName} 的档案`}
          extra={
            <span style={{ display: "flex", gap: 6 }}>
              {canEdit && <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}>✏️ 编辑档案</button>}
              {isOwner && <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} onClick={onDelete}>删除</button>}
            </span>
          }
        >
          {row("性别", p.gender === "boy" ? "男孩" : p.gender === "girl" ? "女孩" : null)}
          {row("年龄", p.birthYear ? `${new Date().getFullYear() - p.birthYear} 岁（${p.birthYear} 年生）` : null)}
          {row("年级", p.grade)}
          {row("兴趣", p.interests?.length ? p.interests.map((i) => <span key={i} className="badge" style={{ marginRight: 4, background: "#f1f5f9", color: "var(--text-sub)" }}>#{i}</span>) : null)}
          {row("作息", p.wakeTime || p.bedTime ? `起床 ${p.wakeTime ?? "—"} · 睡觉 ${p.bedTime ?? "—"}` : null)}
          {row("鼓励方式", p.encouragementStyle)}
          {row("心愿目标", p.wishGoal)}
          {row("明日预览", c.previewFrom ? `每天 ${c.previewFrom} 起墨水屏显示明天` : "已关闭")}
          {row("专注计时", `每次 ${c.focusMinutes} 分钟${c.focusPoints > 0 ? ` · 完成 +${c.focusPoints} 分（每天最多 ${c.focusDailyCap} 次）` : " · 不加积分"}`)}
          {row("时区", c.timezone)}
        </Card>

        <BoardPinCard childId={c.id} childName={c.displayName} canEdit={canEdit} />

        <Card title="近 7 天完成最多的任务" extra={<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("analytics")}>统计分析 ›</button>}>
          {!data ? (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>加载中...</div>
          ) : data.stats.topTasks.length === 0 ? (
            <Empty text="最近 7 天还没有完成的任务" />
          ) : (
            data.stats.topTasks.map((t) => (
              <div key={t.title} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.88rem" }}>
                <span>{t.title}</span>
                <span style={{ color: "var(--text-muted)" }}>完成 {t.completed} 次</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

/** D-020 看板密码：孩子在平板 / 手机上输入 4 位密码即可打开看板，不需要家长账号 */
function BoardPinCard({ childId, childName, canEdit }: { childId: string; childName: string; canEdit: boolean }) {
  const { notify } = useDashboard();
  const base = `/api/v1/children/${childId}/board-pin`;
  const { data, reload } = useLoad(() => api<{ enabled: boolean }>(base), [base], `board-pin:${childId}`);
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const boardUrl = `${origin}/board/${childId}`;

  async function save(value: string | null) {
    if (value !== null && !/^\d{4}$/.test(value)) return notify("密码必须是 4 位数字", false);
    if (value === null && !window.confirm("清除后，孩子需要用家长账号登录才能打开看板。确定清除？")) return;
    setBusy(true);
    try {
      await api(base, { method: "PUT", body: { pin: value } });
      notify(value === null ? "已清除看板密码" : "看板密码已设置；已登录的平板需要重新输入");
      setPin("");
      reload();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="看板密码（孩子平板 / 手机用）">
      <div style={{ fontSize: "0.86rem", color: "var(--text-sub)", lineHeight: 1.7 }}>
        在平板或手机浏览器打开下面的地址，输入 4 位密码即可查看{childName}的看板并勾选完成任务（不能修改任务、看不到后台）。连续输错 5 次锁定 15 分钟。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
        <code style={{ fontSize: "0.8rem", background: "#f1f5f9", padding: "4px 8px", borderRadius: 6, wordBreak: "break-all" }}>{boardUrl}</code>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(boardUrl).then(() => notify("地址已复制"));
          }}
        >
          复制
        </button>
        <a className="btn btn-outline btn-sm" href={`/board/${childId}`} target="_blank" rel="noreferrer">
          打开
        </a>
      </div>
      <div style={{ fontSize: "0.86rem", marginBottom: 8 }}>
        当前状态：{data ? (data.enabled ? <b style={{ color: "#059669" }}>已设置</b> : <b style={{ color: "var(--text-muted)" }}>未设置（只能用家长账号登录查看）</b>) : "…"}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={{ ...inputStyle, width: 140, letterSpacing: 8, fontSize: "1.1rem", textAlign: "center" }}
            inputMode="numeric"
            maxLength={4}
            value={pin}
            placeholder="4 位数字"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || pin.length !== 4} onClick={() => save(pin)}>
            {data?.enabled ? "修改密码" : "设置密码"}
          </button>
          {data?.enabled && (
            <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} disabled={busy} onClick={() => save(null)}>
              清除
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
