"use client";

/**
 * 系统设置：只保留真正生效的设置——账户资料、修改密码、看板入口、服务状态。
 * 设备同步间隔在"设备管理"中设置；家庭名称与成员在"家庭成员"中管理。
 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useDashboard } from "../DashboardContext";
import { Card, Field, PageHeader, inputStyle, useLoad } from "../ui";
import WeatherCityCard from "./WeatherCityCard";

export default function SettingsView() {
  const { user, setUser, notify, navigate, child, familyName } = useDashboard();
  const [name, setName] = React.useState(user.displayName);
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = React.useState(false);
  const health = useLoad(() => api<{ status: string; checks: { database: { ok: boolean; detail?: string } }; time: string }>("/api/health"), []);

  async function saveName() {
    setBusy(true);
    try {
      const res = await api<{ user: { id: string; email: string; displayName: string } }>("/api/v1/auth/me", { method: "PATCH", body: { displayName: name.trim() } });
      setUser(res.user);
      notify("显示名称已更新");
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (pw.next.length < 8) return notify("新密码至少 8 位", false);
    if (pw.next !== pw.confirm) return notify("两次输入的新密码不一致", false);
    setBusy(true);
    try {
      await api("/api/v1/auth/password", { method: "POST", body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      notify("密码已修改，其他设备上的登录已退出");
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader icon="⚙️" title="系统设置" subtitle={`当前家庭：${familyName}`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem", alignItems: "start" }}>
        <Card title="账户资料">
          <Field label="登录邮箱">
            <input style={{ ...inputStyle, background: "#f8fafc" }} value={user.email} readOnly />
          </Field>
          <Field label="显示名称（家庭成员看到的名字）">
            <input style={inputStyle} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || name.trim() === user.displayName} onClick={saveName}>
            保存
          </button>
        </Card>

        <Card title="修改密码">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
          <Field label="当前密码">
            <input style={inputStyle} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="新密码（至少 8 位）">
            <input style={inputStyle} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="确认新密码">
            <input style={inputStyle} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={busy || !pw.current || !pw.next}>
            修改密码
          </button>
          </form>
        </Card>

        <WeatherCityCard />

        <Card title="孩子看板（Web / 手机 H5）">
          <p style={{ fontSize: "0.85rem", color: "var(--text-sub)", marginTop: 0 }}>
            在平板或手机上打开，显示与墨水屏相同的内容，并可点选完成任务。需要用家庭成员账号登录。
          </p>
          <a className="btn btn-primary" href={child ? `/board/${child.id}` : "/board"} target="_blank" rel="noreferrer">
            打开看板
          </a>
        </Card>

        <Card title="其他设置在哪里">
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 2, color: "var(--text-sub)" }}>
            <li>
              墨水屏同步间隔、改名、解绑：<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("devices")}>设备管理</button>
            </li>
            <li>
              家庭名称、邀请成员、角色：<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("family")}>家庭成员</button>
            </li>
            <li>
              任务积分、心愿奖品：<button type="button" className="btn btn-outline btn-sm" onClick={() => navigate("rewards")}>积分与奖励</button>
            </li>
          </ul>
        </Card>

        <Card title="服务状态">
          {health.data ? (
            <div style={{ fontSize: "0.85rem", lineHeight: 2 }}>
              <div>
                服务：<b style={{ color: health.data.status === "ok" ? "#059669" : "#dc2626" }}>{health.data.status === "ok" ? "正常" : "异常"}</b>
              </div>
              <div>
                数据库：<b style={{ color: health.data.checks.database.ok ? "#059669" : "#dc2626" }}>{health.data.checks.database.ok ? `正常（${health.data.checks.database.detail ?? ""}）` : "异常"}</b>
              </div>
              <div style={{ color: "var(--text-muted)" }}>服务器时间：{new Date(health.data.time).toLocaleString("zh-CN")}</div>
            </div>
          ) : (
            <div style={{ fontSize: "0.85rem", color: health.error ? "#dc2626" : "var(--text-muted)" }}>{health.error ?? "检查中..."}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
