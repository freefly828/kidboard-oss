"use client";

/**
 * 家庭成员（PRD F01 + D-012）：成员与角色、邀请码（owner 创建/撤销，7 天有效、一次性）、
 * 用邀请码加入家庭、家庭改名、退出家庭。
 * 角色：owner 管理员（全部权限） / guardian 家长（编辑课表任务积分） / viewer 只读。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useDashboard, type Role } from "../DashboardContext";
import { Card, ErrorBox, Field, Modal, PageHeader, inputStyle, shortDateTime, useLoad } from "../ui";

interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  joinedAt: string;
  isMe: boolean;
}

interface Invitation {
  id: string;
  role: "guardian" | "viewer";
  expiresAt: string;
  createdAt: string;
}

const ROLE_INFO: Record<Role, { label: string; desc: string; bg: string; fg: string }> = {
  owner: { label: "管理员", desc: "全部权限：成员管理、删除孩子、解绑设备", bg: "#fef3c7", fg: "#b45309" },
  guardian: { label: "家长", desc: "编辑课表、任务、留言、积分与奖品", bg: "#eff6ff", fg: "#2563eb" },
  viewer: { label: "只读", desc: "只能查看，不能修改", bg: "#f1f5f9", fg: "#475569" },
};

export default function FamilyView() {
  const { role: myRole, familyName, notify, reloadFamily, reloadChildren, setFamilyName } = useDashboard();
  const { data, error, reload, setData } = useLoad(() => api<{ family: { id: string; name: string }; myRole: Role; members: Member[]; invitations: Invitation[] }>("/api/v1/family"), [], "family");
  const [newCode, setNewCode] = React.useState<{ code: string; role: string } | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [joinCode, setJoinCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const isOwner = myRole === "owner";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      notify(ok);
      await reload();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  /** 用服务端返回的名称直接更新页面与顶栏，不再额外请求，弹窗立即关闭 */
  async function saveFamilyName() {
    const name = renaming?.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await api<{ family: { id: string; name: string } }>("/api/v1/family", { method: "PATCH", body: { name } });
      setFamilyName(res.family.name);
      setData((prev) => (prev ? { ...prev, family: res.family } : prev));
      setRenaming(null);
      notify(`家庭名称已改为「${res.family.name}」`);
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function invite(role: "guardian" | "viewer") {
    setBusy(true);
    try {
      const res = await api<{ code: string }>("/api/v1/family/invitations", { method: "POST", body: { role } });
      setNewCode({ code: res.code, role: ROLE_INFO[role].label });
      await reload();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function leave(me: Member) {
    if (!window.confirm("确定退出这个家庭？退出后将看不到这个家庭的孩子。")) return;
    try {
      await api(`/api/v1/family/members/${me.userId}`, { method: "DELETE" });
      window.location.reload();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <PageHeader icon="👥" title={`家庭成员 · ${familyName}`} subtitle="邀请爸爸妈妈、爷爷奶奶一起管理孩子的课表、任务和积分" />
        <div className="card" style={{ padding: "1.5rem", color: "var(--text-muted)" }}>正在加载成员与邀请…</div>
      </div>
    );
  const me = data.members.find((m) => m.isMe);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="👥"
        title={`家庭成员 · ${data.family.name}`}
        subtitle="邀请爸爸妈妈、爷爷奶奶一起管理孩子的课表、任务和积分"
        actions={isOwner && <button type="button" className="btn btn-outline btn-sm" onClick={() => setRenaming(data.family.name)}>修改家庭名称</button>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card title={`成员（${data.members.length}）`}>
          {data.members.map((m) => (
            <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.7rem 0", borderTop: "1px solid var(--border-subtle)" }}>
              <span style={{ width: 36, height: 36, borderRadius: 999, background: "var(--primary-light)", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {m.displayName.slice(0, 1)}
              </span>
              <span style={{ flex: 1 }}>
                <b>{m.displayName}</b>
                {m.isMe && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>（我）</span>}
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {m.email} · {shortDateTime(m.joinedAt)} 加入
                </span>
              </span>
              {isOwner && !m.isMe ? (
                <select
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => run(() => api(`/api/v1/family/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }), "角色已更新")}
                  style={{ ...inputStyle, width: "auto" }}
                  aria-label={`${m.displayName} 的角色`}
                >
                  {(["owner", "guardian", "viewer"] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="badge" style={{ background: ROLE_INFO[m.role].bg, color: ROLE_INFO[m.role].fg }}>{ROLE_INFO[m.role].label}</span>
              )}
              {isOwner && !m.isMe && (
                <button type="button" className="btn btn-outline btn-sm" style={{ color: "#dc2626" }} disabled={busy} onClick={() => window.confirm(`把 ${m.displayName} 移出家庭？`) && void run(() => api(`/api/v1/family/members/${m.userId}`, { method: "DELETE" }), "已移除")}>
                  移除
                </button>
              )}
            </div>
          ))}
          <div style={{ marginTop: 14, padding: "0.75rem", background: "#f8fafc", borderRadius: 10, fontSize: "0.78rem", color: "var(--text-sub)", lineHeight: 1.8 }}>
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
              <div key={r}>
                <b>{ROLE_INFO[r].label}</b>：{ROLE_INFO[r].desc}
              </div>
            ))}
          </div>
          {me && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12, color: "#dc2626" }} onClick={() => leave(me)}>
              退出这个家庭
            </button>
          )}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {isOwner && (
            <Card title="邀请成员">
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 0 }}>
                生成邀请码发给对方。对方在注册页填写邀请码，或登录后在下方"加入家庭"输入，即可加入。邀请码 7 天内有效，只能用一次。
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => invite("guardian")}>邀请家长</button>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => invite("viewer")}>邀请只读成员</button>
              </div>
              {data.invitations.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>未使用的邀请</div>
                  {data.invitations.map((inv) => (
                    <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.8rem" }}>
                      <span style={{ flex: 1 }}>
                        {ROLE_INFO[inv.role].label} · {shortDateTime(inv.expiresAt)} 前有效
                      </span>
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api(`/api/v1/family/invitations/${inv.id}`, { method: "DELETE" }), "邀请已撤销")}>
                        撤销
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title="加入其他家庭">
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 0 }}>收到别的家庭的邀请码？在这里输入即可加入。</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...inputStyle, letterSpacing: 2, textTransform: "uppercase" }} value={joinCode} maxLength={12} placeholder="XXXX-XXXX" onChange={(e) => setJoinCode(e.target.value)} />
              <button
                type="button"
                className="btn btn-primary"
                style={{ whiteSpace: "nowrap" }}
                disabled={busy || joinCode.trim().length < 6}
                onClick={() =>
                  run(async () => {
                    await api("/api/v1/family/join", { method: "POST", body: { code: joinCode } });
                    setJoinCode("");
                    await Promise.all([reloadFamily(), reloadChildren()]);
                  }, "已加入家庭")
                }
              >
                加入
              </button>
            </div>
          </Card>
        </div>
      </div>

      {newCode && (
        <Modal title="邀请码已生成" onClose={() => setNewCode(null)}>
          <p style={{ fontSize: "0.85rem", color: "var(--text-sub)", marginTop: 0 }}>把下面的邀请码发给要加入的{newCode.role}。它只显示这一次，关闭后无法再查看。</p>
          <div style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: 6, textAlign: "center", padding: "1rem", background: "#f8fafc", borderRadius: 12, fontFamily: "monospace" }}>{newCode.code}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() =>
                navigator.clipboard
                  .writeText(newCode.code)
                  .then(() => notify("已复制"))
                  .catch(() => notify("复制失败，请手动记下", false))
              }
            >
              复制
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setNewCode(null)}>我已记下</button>
          </div>
        </Modal>
      )}

      {renaming !== null && (
        <Modal title="修改家庭名称" onClose={() => setRenaming(null)}>
          <Field label="家庭名称">
            <input
              style={inputStyle}
              value={renaming}
              maxLength={60}
              autoFocus
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveFamilyName()}
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setRenaming(null)}>取消</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !renaming.trim()}
              onClick={saveFamilyName}
            >
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
