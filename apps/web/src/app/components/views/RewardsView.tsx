"use client";

/**
 * 积分与奖励（D-012）：
 * - 积分明细：任务完成自动入账、家长手动奖惩、兑换扣分与驳回退分。
 * - 心愿商城：家长维护奖品（上下架、库存），按积分兑换（无支付）。
 * - 兑换记录：兑换即扣分进入"待核销"，家长兑现后核销，或驳回退回积分。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import { Card, Empty, ErrorBox, Field, Modal, PageHeader, StatCard, inputStyle, shortDateTime, useLoad } from "../ui";

interface LedgerRow {
  id: string;
  delta: number;
  kind: "task" | "manual" | "redeem" | "refund" | "focus";
  reason: string;
  createdAt: string;
  createdByName: string | null;
}

interface Reward {
  id: string;
  title: string;
  icon: string | null;
  cost: number;
  stock: number | null;
  active: boolean;
}

interface Redemption {
  id: string;
  rewardTitle: string;
  icon: string | null;
  cost: number;
  status: "pending" | "fulfilled" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  requestedByName: string | null;
}

const KIND_LABEL: Record<LedgerRow["kind"], { text: string; bg: string; fg: string }> = {
  task: { text: "完成任务", bg: "#ecfdf5", fg: "#059669" },
  manual: { text: "家长调整", bg: "#eff6ff", fg: "#2563eb" },
  redeem: { text: "兑换奖励", bg: "#fff7ed", fg: "#c2410c" },
  refund: { text: "驳回退分", bg: "#f5f3ff", fg: "#7c3aed" },
  focus: { text: "专注计时", bg: "#fdf2f8", fg: "#be185d" },
};
/** 未知类型（服务端新增而前端未更新）不让整页崩溃 */
const KIND_FALLBACK = { text: "其它", bg: "#f1f5f9", fg: "#475569" };

const STATUS_LABEL: Record<Redemption["status"], { text: string; bg: string; fg: string }> = {
  pending: { text: "待核销", bg: "#fffbeb", fg: "#b45309" },
  fulfilled: { text: "已兑现", bg: "#ecfdf5", fg: "#059669" },
  rejected: { text: "已驳回", bg: "#f1f5f9", fg: "#64748b" },
};

/** D-026 常用扣分：默认几项 + 这个孩子用过的手动扣分原因（按次数），只在后台显示 */
const DEFAULT_DEDUCTIONS: { amount: number; reason: string }[] = [
  { amount: 5, reason: "拖拉" },
  { amount: 10, reason: "没完成作业" },
  { amount: 5, reason: "玩手机/看电视超时" },
  { amount: 5, reason: "发脾气" },
];
const MAX_QUICK = 8;
const UNDO_MS = 10 * 60 * 1000;

function quickDeductions(ledger: LedgerRow[]): { amount: number; reason: string }[] {
  const used = new Map<string, { amount: number; reason: string; n: number }>();
  for (const l of ledger) {
    if (l.kind !== "manual" || l.delta >= 0) continue;
    const key = `${-l.delta}|${l.reason}`;
    const hit = used.get(key);
    if (hit) hit.n += 1;
    else used.set(key, { amount: -l.delta, reason: l.reason, n: 1 });
  }
  const out = [...used.values()].sort((a, b) => b.n - a.n).map(({ amount, reason }) => ({ amount, reason }));
  for (const d of DEFAULT_DEDUCTIONS) {
    if (!out.some((o) => o.reason === d.reason)) out.push(d);
  }
  return out.slice(0, MAX_QUICK);
}

function QuickDeduct({
  base,
  ledger,
  balance,
  onChanged,
  notify,
}: {
  base: string;
  ledger: LedgerRow[];
  balance: number;
  onChanged: () => void;
  notify: (text: string, ok?: boolean) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<{ id: string; amount: number; reason: string; at: number } | null>(null);
  const items = quickDeductions(ledger);

  React.useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), Math.max(0, last.at + UNDO_MS - Date.now()));
    return () => clearTimeout(t);
  }, [last]);

  async function deduct(amount: number, reason: string) {
    setBusy(true);
    try {
      const r = await api<{ entry: { id: string } }>(`${base}/points`, { method: "POST", body: { delta: -amount, reason } });
      setLast({ id: r.entry.id, amount, reason, at: Date.now() });
      notify(`已扣 ${amount} 分：${reason}`);
      onChanged();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!last) return;
    setBusy(true);
    try {
      await api(`${base}/points/${last.id}`, { method: "DELETE" });
      notify(`已撤销：${last.reason}`);
      setLast(null);
      onChanged();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="常用扣分" extra={<span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>点一下立即扣分 · 只在后台显示，孩子在明细里看到原因</span>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((d) => (
          <button
            key={`${d.amount}|${d.reason}`}
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy || balance < d.amount}
            title={balance < d.amount ? `积分不足（当前 ${balance} 分）` : undefined}
            onClick={() => void deduct(d.amount, d.reason)}
            style={{ color: "#dc2626", borderColor: "#fecaca" }}
          >
            <b>-{d.amount}</b>&nbsp;{d.reason}
          </button>
        ))}
      </div>
      {last && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, fontSize: "0.85rem", color: "var(--text-sub)" }}>
          刚刚扣了 {last.amount} 分（{last.reason}）
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void undo()}>
            撤销
          </button>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: "0.75rem", color: "var(--text-muted)" }}>
        用「扣除积分」填写过的新原因，会自动出现在这里
      </div>
    </Card>
  );
}

export default function RewardsView() {
  const child = useChild();
  const { canEdit, notify, bumpData, dataVersion } = useDashboard();
  const base = `/api/v1/children/${child.id}`;
  const [tab, setTab] = React.useState<"mall" | "ledger" | "redemptions">("mall");

  const { data, error, reload } = useLoad(async () => {
    const [points, rewards, redemptions] = await Promise.all([
      api<{ balance: number; earnedThisWeek: number; ledger: LedgerRow[] }>(`${base}/points?limit=100`),
      api<{ rewards: Reward[] }>(`${base}/rewards${canEdit ? "?all=1" : ""}`),
      api<{ redemptions: Redemption[] }>(`${base}/redemptions`),
    ]);
    return { points, rewards: rewards.rewards, redemptions: redemptions.redemptions };
  }, [base, dataVersion, canEdit], `rewards:${base}:${canEdit}`);

  const [adjust, setAdjust] = React.useState<{ sign: 1 | -1; amount: number; reason: string } | null>(null);
  const [rewardForm, setRewardForm] = React.useState<{ id: string | null; title: string; icon: string; cost: number; stock: string; active: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      notify(ok);
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data) return <div style={{ color: "var(--text-muted)" }}>加载中...</div>;

  const balance = data.points.balance;
  const pending = data.redemptions.filter((r) => r.status === "pending");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="🏆"
        title="积分与奖励"
        subtitle="完成带积分的任务自动入账；用积分在心愿商城兑换奖励，家长兑现后核销"
        actions={
          canEdit && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setAdjust({ sign: 1, amount: 10, reason: "" })}>✨ 奖励积分</button>
              <button type="button" className="btn btn-outline" onClick={() => setAdjust({ sign: -1, amount: 10, reason: "" })}>扣除积分</button>
            </>
          )
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "1rem" }}>
        <StatCard icon="🏆" label="积分余额" value={`${balance} 分`} color="#d97706" />
        <StatCard icon="📈" label="本周获得" value={`+${data.points.earnedThisWeek}`} sub="周一起累计" color="#059669" />
        <StatCard icon="🎁" label="待核销兑换" value={`${pending.length} 项`} sub={pending.length ? "到「兑换记录」处理" : "—"} />
        <StatCard icon="⭐" label="心愿目标" value={<span style={{ fontSize: "1rem" }}>{child.profile.wishGoal || "未设置"}</span>} sub="在孩子档案中设置" />
      </div>

      {canEdit && <QuickDeduct base={base} ledger={data.points.ledger} balance={balance} onChanged={bumpData} notify={notify} />}

      <div style={{ display: "flex", gap: 6 }}>
        {(
          [
            ["mall", "🎁 心愿商城"],
            ["ledger", "📊 积分明细"],
            ["redemptions", `📜 兑换记录${pending.length ? `（${pending.length} 待核销）` : ""}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className="btn" onClick={() => setTab(k)} style={{ background: tab === k ? "var(--primary)" : "#fff", color: tab === k ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "mall" && (
        <Card title="心愿商城" extra={canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setRewardForm({ id: null, title: "", icon: "🎁", cost: 50, stock: "", active: true })}>+ 上架奖品</button>}>
          {data.rewards.length === 0 ? (
            <Empty text="还没有奖品。和孩子一起定几个心愿吧，比如「周末去公园」「看一集动画片」" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: "1rem" }}>
              {data.rewards.map((r) => {
                const soldOut = r.stock !== null && r.stock <= 0;
                const affordable = balance >= r.cost;
                return (
                  <div key={r.id} className="card" style={{ padding: "1rem", opacity: r.active ? 1 : 0.55 }}>
                    <div style={{ fontSize: "2rem" }}>{r.icon || "🎁"}</div>
                    <div style={{ fontWeight: 700, margin: "0.3rem 0" }}>{r.title}</div>
                    <div style={{ color: "#d97706", fontWeight: 800 }}>{r.cost} 分</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0.6rem" }}>
                      {!r.active ? "已下架" : r.stock === null ? "不限数量" : `剩余 ${r.stock} 个`}
                    </div>
                    {canEdit && r.active && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy || soldOut || !affordable}
                        title={!affordable ? `还差 ${r.cost - balance} 分` : undefined}
                        onClick={() => window.confirm(`用 ${r.cost} 分兑换「${r.title}」？`) && void run(() => api(`${base}/redemptions`, { method: "POST", body: { rewardId: r.id } }), `已兑换「${r.title}」，记得兑现后核销`)}
                        style={{ width: "100%" }}
                      >
                        {soldOut ? "已兑完" : affordable ? "兑换" : `还差 ${r.cost - balance} 分`}
                      </button>
                    )}
                    {canEdit && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => setRewardForm({ id: r.id, title: r.title, icon: r.icon ?? "", cost: r.cost, stock: r.stock === null ? "" : String(r.stock), active: r.active })}>
                          编辑
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => api(`${base}/rewards/${r.id}`, { method: "PATCH", body: { active: !r.active } }), r.active ? "已下架" : "已上架")}>
                          {r.active ? "下架" : "上架"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === "ledger" && (
        <Card title="积分明细（最近 100 条）">
          {data.points.ledger.length === 0 ? (
            <Empty text="还没有积分记录。给任务设置积分，孩子完成后会自动入账" />
          ) : (
            data.points.ledger.map((l) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.6rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.87rem" }}>
                <span style={{ minWidth: 110, color: "var(--text-muted)", fontSize: "0.78rem" }}>{shortDateTime(l.createdAt)}</span>
                <span className="badge" style={{ background: (KIND_LABEL[l.kind] ?? KIND_FALLBACK).bg, color: (KIND_LABEL[l.kind] ?? KIND_FALLBACK).fg, fontSize: "0.7rem" }}>{(KIND_LABEL[l.kind] ?? KIND_FALLBACK).text}</span>
                <span style={{ flex: 1 }}>{l.reason}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{l.createdByName ?? (l.kind === "task" || l.kind === "focus" ? "墨水屏" : "")}</span>
                <span style={{ minWidth: 60, textAlign: "right", fontWeight: 800, color: l.delta > 0 ? "#059669" : "#dc2626" }}>
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
              </div>
            ))
          )}
        </Card>
      )}

      {tab === "redemptions" && (
        <Card title="兑换记录">
          {data.redemptions.length === 0 ? (
            <Empty text="还没有兑换记录" />
          ) : (
            data.redemptions.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.65rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.87rem" }}>
                <span style={{ fontSize: "1.3rem" }}>{r.icon || "🎁"}</span>
                <span style={{ flex: 1 }}>
                  <b>{r.rewardTitle}</b>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {shortDateTime(r.createdAt)} · {r.requestedByName ?? "家长"}兑换 · {r.cost} 分
                  </span>
                </span>
                <span className="badge" style={{ background: STATUS_LABEL[r.status].bg, color: STATUS_LABEL[r.status].fg }}>{STATUS_LABEL[r.status].text}</span>
                {canEdit && r.status === "pending" && (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api(`${base}/redemptions/${r.id}`, { method: "PATCH", body: { status: "fulfilled" } }), "已核销")}>
                      已兑现，核销
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => window.confirm(`驳回「${r.rewardTitle}」？${r.cost} 分会退回给孩子。`) && void run(() => api(`${base}/redemptions/${r.id}`, { method: "PATCH", body: { status: "rejected" } }), "已驳回，积分已退回")}
                    >
                      驳回
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </Card>
      )}

      {adjust && (
        <Modal title={adjust.sign > 0 ? "奖励积分" : "扣除积分"} onClose={() => setAdjust(null)}>
          <Field label="分数">
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[5, 10, 20, 50].map((n) => (
                <button key={n} type="button" className="btn btn-sm" onClick={() => setAdjust({ ...adjust, amount: n })} style={{ background: adjust.amount === n ? "var(--primary)" : "#fff", color: adjust.amount === n ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}>
                  {n}
                </button>
              ))}
            </div>
            <input style={inputStyle} type="number" min={1} max={10000} value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="原因（孩子能在明细里看到）">
            <input style={inputStyle} value={adjust.reason} maxLength={60} autoFocus onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder={adjust.sign > 0 ? "例如：主动帮忙做家务" : "例如：约定的看电视时间超时"} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setAdjust(null)}>取消</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !adjust.reason.trim()}
              onClick={async () => {
                await run(() => api(`${base}/points`, { method: "POST", body: { delta: adjust.sign * adjust.amount, reason: adjust.reason.trim() } }), adjust.sign > 0 ? `已奖励 ${adjust.amount} 分` : `已扣除 ${adjust.amount} 分`);
                setAdjust(null);
              }}
            >
              {busy ? "保存中..." : "确定"}
            </button>
          </div>
        </Modal>
      )}

      {rewardForm && (
        <Modal title={rewardForm.id ? "编辑奖品" : "上架奖品"} onClose={() => setRewardForm(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "0 0.75rem" }}>
            <Field label="图标">
              <input style={{ ...inputStyle, textAlign: "center", fontSize: "1.2rem" }} value={rewardForm.icon} maxLength={4} onChange={(e) => setRewardForm({ ...rewardForm, icon: e.target.value })} />
            </Field>
            <Field label="奖品名称">
              <input style={inputStyle} value={rewardForm.title} maxLength={40} autoFocus onChange={(e) => setRewardForm({ ...rewardForm, title: e.target.value })} placeholder="例如：周末去公园" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.75rem" }}>
            <Field label="所需积分">
              <input style={inputStyle} type="number" min={1} value={rewardForm.cost} onChange={(e) => setRewardForm({ ...rewardForm, cost: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>
            <Field label="库存（可空 = 不限）">
              <input style={inputStyle} type="number" min={0} value={rewardForm.stock} onChange={(e) => setRewardForm({ ...rewardForm, stock: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {rewardForm.id ? (
              <button
                type="button"
                className="btn btn-outline"
                style={{ color: "#dc2626" }}
                onClick={async () => {
                  if (!window.confirm("删除这个奖品？已有兑换记录会保留。")) return;
                  await run(() => api(`${base}/rewards/${rewardForm.id}`, { method: "DELETE" }), "已删除");
                  setRewardForm(null);
                }}
              >
                删除
              </button>
            ) : (
              <span />
            )}
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setRewardForm(null)}>取消</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !rewardForm.title.trim()}
                onClick={async () => {
                  const body = { title: rewardForm.title.trim(), icon: rewardForm.icon.trim() || null, cost: rewardForm.cost, stock: rewardForm.stock === "" ? null : Number(rewardForm.stock), active: rewardForm.active };
                  await run(() => (rewardForm.id ? api(`${base}/rewards/${rewardForm.id}`, { method: "PATCH", body }) : api(`${base}/rewards`, { method: "POST", body })), rewardForm.id ? "奖品已更新" : "奖品已上架");
                  setRewardForm(null);
                }}
              >
                {busy ? "保存中..." : "保存"}
              </button>
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
