"use client";

/**
 * 顶栏：孩子切换、真实提醒（待核销兑换、设备离线）、账户菜单。
 * 窄屏（≤860px）左侧显示 ☰ 打开侧栏抽屉（样式见 globals.css .kb-*）。
 */

import * as React from "react";
import { api } from "./api";
import { useDashboard } from "./DashboardContext";
import { inputStyle } from "./ui";

interface Notice {
  key: string;
  text: string;
  nav: "rewards" | "devices";
}

export default function Header({ menuOpen: navOpen = false, onOpenMenu }: { menuOpen?: boolean; onOpenMenu?: () => void }) {
  const { children, child, selectChild, user, familyName, role, navigate, dataVersion } = useDashboard();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const [notices, setNotices] = React.useState<Notice[]>([]);
  // 已读提醒（按用户存本机）：铃铛数字只统计未读；打开下拉即全部标为已读。
  // 设备离线提醒的 key 含最后在线时间，设备恢复后再次离线会重新计为未读。
  const seenKey = `kidboard.seenNotices.${user.id}`;
  const [seen, setSeen] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    try {
      setSeen(new Set(JSON.parse(localStorage.getItem(seenKey) ?? "[]") as string[]));
    } catch {
      setSeen(new Set());
    }
  }, [seenKey]);
  const unread = notices.filter((n) => !seen.has(n.key));

  function openBell() {
    if (!bellOpen && unread.length > 0) {
      const next = new Set([...seen, ...notices.map((n) => n.key)]);
      setSeen(next);
      try {
        localStorage.setItem(seenKey, JSON.stringify([...next].slice(-200)));
      } catch {
        // 存储不可用时只在本次页面内生效
      }
    }
    setBellOpen(!bellOpen);
  }


  React.useEffect(() => {
    if (!child) {
      setNotices([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [red, dev] = await Promise.all([
          api<{ redemptions: { id: string; rewardTitle: string }[] }>(`/api/v1/children/${child.id}/redemptions?status=pending`),
          api<{ devices: { id: string; name: string | null; online: boolean; lastSeenAt: string | null; batteryPercent: number | null }[] }>(`/api/v1/children/${child.id}/devices`),
        ]);
        if (cancelled) return;
        setNotices([
          ...red.redemptions.map((r) => ({ key: `r-${r.id}`, text: `待核销兑换：「${r.rewardTitle}」`, nav: "rewards" as const })),
          ...dev.devices
            .filter((d) => !d.online)
            .map((d) => ({ key: `d-${d.id}-${d.lastSeenAt ?? "never"}`, text: `${d.name || "墨水屏"} 已离线`, nav: "devices" as const })),
          // D-016 低电提醒（每降 5% 视为一条新提醒）
          ...dev.devices
            .filter((d) => d.batteryPercent !== null && d.batteryPercent <= 20)
            .map((d) => ({
              key: `b-${d.id}-${Math.floor((d.batteryPercent ?? 0) / 5)}`,
              text: `${d.name || "墨水屏"} 电量 ${d.batteryPercent}%，请充电`,
              nav: "devices" as const,
            })),
        ]);
      } catch {
        // 提醒加载失败不影响主页面
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [child, dataVersion]);

  async function logout() {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  const roleLabel = role === "owner" ? "管理员" : role === "guardian" ? "家长" : "只读成员";

  return (
    <header
      className="kb-header"
      style={{
        height: 64,
        background: "#ffffff",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 10,
        gap: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
        <button
          type="button"
          className="kb-menu-btn"
          onClick={onOpenMenu}
          aria-label="打开菜单"
          aria-controls="kb-sidebar"
          aria-expanded={navOpen}
          style={{ alignItems: "center", justifyContent: "center", width: 38, height: 38, border: "1px solid var(--border)", background: "#fff", borderRadius: 10, cursor: "pointer", fontSize: "1.1rem", flex: "none" }}
        >
          ☰
        </button>
        <span className="kb-hide-sm" style={{ fontSize: "0.85rem", color: "var(--text-sub)" }}>当前孩子</span>
        {children.length > 0 ? (
          <select
            value={child?.id ?? ""}
            onChange={(e) => selectChild(e.target.value)}
            style={{ ...inputStyle, width: "auto", minWidth: 110, maxWidth: "40vw", fontWeight: 600 }}
            aria-label="切换孩子"
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("children")}>
            + 创建孩子档案
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: "none" }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={openBell}
            aria-label={`提醒：${unread.length} 条未读，共 ${notices.length} 条`}
            style={{ position: "relative", border: "1px solid var(--border)", background: "#fff", borderRadius: 999, width: 38, height: 38, cursor: "pointer", fontSize: "1rem" }}
          >
            🔔
            {unread.length > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: 999, fontSize: 11, minWidth: 18, height: 18, lineHeight: "18px", padding: "0 4px" }}>
                {unread.length}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="card" style={{ position: "absolute", right: -52, top: 46, width: 280, maxWidth: "calc(100vw - 24px)", padding: "0.75rem", zIndex: 20 }}>
              {notices.length === 0 ? (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", padding: "0.25rem" }}>暂无提醒</div>
              ) : (
                notices.map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    onClick={() => {
                      navigate(n.nav);
                      setBellOpen(false);
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#f8fafc", borderRadius: 8, padding: "0.55rem 0.7rem", marginBottom: 6, cursor: "pointer", fontSize: "0.82rem" }}
                  >
                    {n.text}
                    <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>处理后自动消失 · 点击前往</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: "0.6rem", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ width: 36, height: 36, borderRadius: 999, background: "var(--primary-light)", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
              {user.displayName.slice(0, 1)}
            </span>
            <span className="kb-hide-sm">
              <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 700 }}>{user.displayName}</span>
              <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {familyName} · {roleLabel}
              </span>
            </span>
          </button>
          {menuOpen && (
            <div className="card" style={{ position: "absolute", right: 0, top: 48, width: 220, padding: "0.5rem", zIndex: 20 }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0.4rem 0.6rem" }}>{user.email}</div>
              <button type="button" onClick={() => { navigate("settings"); setMenuOpen(false); }} style={menuItem}>
                ⚙️ 账户设置
              </button>
              <button type="button" onClick={() => { navigate("family"); setMenuOpen(false); }} style={menuItem}>
                👥 家庭成员
              </button>
              <button type="button" onClick={logout} style={{ ...menuItem, color: "#dc2626" }}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "none",
  padding: "0.55rem 0.6rem",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: "0.85rem",
};
