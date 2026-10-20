"use client";

/**
 * 留言（PRD F06）：每天 0~1 条主留言，显示在墨水屏底部；最多 60 字，超长提示不截断。
 * 墨水屏无输入能力，因此这里只有"家长 → 墨水屏"的单向留言与历史记录。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import { Card, Empty, ErrorBox, InkPreview, PageHeader, dateLabel, shortDateTime, useLoad } from "../ui";

const MAX = 60;
const PHRASES = ["加油！你是最棒的！", "记得多喝水，保护眼睛哦~", "做完作业晚上一起拼乐高！", "放学前把桌面整理干净哦~", "每天阅读 20 分钟，遇见更好的自己！", "今天也要开开心心哦！"];

interface MessageRow {
  id: string;
  messageDate: string;
  body: string;
  updatedAt: string;
  createdByName: string | null;
}

export default function MessagesView() {
  const child = useChild();
  const { canEdit, notify, bumpData, dataVersion } = useDashboard();
  const base = `/api/v1/children/${child.id}`;
  const { data, error, reload } = useLoad(() => api<{ today: string; messages: MessageRow[] }>(`${base}/messages?days=30`), [base, dataVersion], `messages:${base}`);
  const todayMsg = data?.messages.find((m) => m.messageDate === data.today) ?? null;
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setDraft(todayMsg?.body ?? "");
  }, [todayMsg?.body]);

  async function save() {
    const body = draft.trim();
    if (!body) return notify("留言内容不能为空", false);
    if (body.length > MAX) return notify(`留言最多 ${MAX} 字（当前 ${body.length} 字）`, false);
    setBusy(true);
    try {
      await api(`${base}/message`, { method: "PUT", body: { body } });
      notify("留言已保存，墨水屏将在下次同步时显示（约 30 秒内）");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("撤下今天的留言？墨水屏留言区将变为空白。")) return;
    setBusy(true);
    try {
      await api(`${base}/message`, { method: "DELETE" });
      setDraft("");
      notify("已撤下今天的留言");
      bumpData();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  const tooLong = draft.trim().length > MAX;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader icon="💬" title="今日留言" subtitle={`每天一条，显示在${child.displayName}的墨水屏底部；最多 ${MAX} 字`} />

      {error && <ErrorBox text={error} onRetry={reload} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card title={data ? `今天（${dateLabel(data.today)}）` : "今天"}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canEdit}
            rows={4}
            placeholder={canEdit ? `想对${child.displayName}说点什么？` : "只读成员不能编辑留言"}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 10, border: `1px solid ${tooLong ? "#ef4444" : "var(--border)"}`, fontSize: "1rem", lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 12px" }}>
            <span style={{ fontSize: "0.78rem", color: tooLong ? "#dc2626" : "var(--text-muted)" }}>
              {draft.trim().length}/{MAX}
              {tooLong && " · 超出字数，墨水屏放不下，请精简"}
            </span>
            {todayMsg && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>当前留言由 {todayMsg.createdByName ?? "家长"} 于 {shortDateTime(todayMsg.updatedAt)} 设置</span>}
          </div>
          {canEdit && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {PHRASES.map((p) => (
                  <button key={p} type="button" className="btn btn-sm" onClick={() => setDraft(p)} style={{ background: "#fff", border: "1px solid var(--border)", color: "var(--text-sub)" }}>
                    {p}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary" disabled={busy || tooLong || !draft.trim() || draft.trim() === todayMsg?.body} onClick={save}>
                  {busy ? "保存中..." : todayMsg ? "更新留言" : "发送到墨水屏"}
                </button>
                {todayMsg && (
                  <button type="button" className="btn btn-outline" disabled={busy} onClick={remove} style={{ color: "#dc2626" }}>
                    撤下今天的留言
                  </button>
                )}
              </div>
            </>
          )}
        </Card>

        <Card title="墨水屏效果">
          <InkPreview childId={child.id} refreshKey={dataVersion} />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "10px 0 0" }}>留言显示在屏幕底部"家长留言"一栏，最多两行。</p>
        </Card>
      </div>

      <Card title="最近 30 天留言">
        {data && data.messages.length === 0 && <Empty text="还没有留言记录" />}
        {data?.messages.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 14, padding: "0.65rem 0", borderTop: "1px solid var(--border-subtle)" }}>
            <span style={{ minWidth: 130, fontSize: "0.8rem", color: "var(--text-sub)", fontWeight: 600 }}>{m.messageDate === data.today ? "今天" : dateLabel(m.messageDate)}</span>
            <span style={{ flex: 1, fontSize: "0.9rem" }}>{m.body}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{m.createdByName ?? ""}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
