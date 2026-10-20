"use client";

/**
 * 注册（D-012）：新建家庭成为管理员；或填写邀请码加入已有家庭（不新建家庭）。
 * 支持 ?code=XXXX-XXXX 预填邀请码。
 */

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 15,
  boxSizing: "border-box",
};

function RegisterForm() {
  const params = useSearchParams();
  const rawRedirect = params.get("redirect") || "/";
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") && !rawRedirect.startsWith("/\\") ? rawRedirect : "/";

  const [mode, setMode] = React.useState<"new" | "join">(params.get("code") ? "join" : "new");
  const [form, setForm] = React.useState({ email: "", password: "", confirm: "", displayName: "", familyName: "", inviteCode: params.get("code") ?? "" });
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password.length < 8) return setError("密码至少 8 位");
    if (form.password !== form.confirm) return setError("两次输入的密码不一致");
    if (mode === "join" && form.inviteCode.trim().length < 6) return setError("请填写邀请码");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          ...(mode === "new" ? { familyName: form.familyName.trim() || "我的家" } : { inviteCode: form.inviteCode.trim() }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error?.code;
        setError(code === "email_taken" ? "该邮箱已注册，请直接登录" : code === "invalid_invite" ? "邀请码无效、已使用或已过期" : data.error?.message || "注册失败");
        return;
      }
      window.location.href = redirect;
    } catch (err) {
      setError(`网络错误：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={{ maxWidth: 440, margin: "40px auto", padding: "32px 28px", background: "#fff", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #e0e0e0" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px", textAlign: "center" }}>注册 KidBoard</h1>
      <p style={{ textAlign: "center", color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>家庭儿童墨水屏日程任务系统</p>

      <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 10, padding: 4, marginBottom: 20 }}>
        {(
          [
            ["new", "创建新家庭"],
            ["join", "用邀请码加入家庭"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)} style={{ flex: 1, border: "none", padding: "8px 0", borderRadius: 8, cursor: "pointer", fontWeight: 600, background: mode === k ? "#fff" : "transparent", color: mode === k ? "#2563eb" : "#6b7280" }}>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mode === "join" ? (
          <label>
            <span style={{ fontSize: 13, fontWeight: 600 }}>邀请码</span>
            <input style={{ ...input, letterSpacing: 3, textTransform: "uppercase" }} value={form.inviteCode} onChange={set("inviteCode")} placeholder="XXXX-XXXX" maxLength={12} />
          </label>
        ) : (
          <label>
            <span style={{ fontSize: 13, fontWeight: 600 }}>家庭名称</span>
            <input style={input} value={form.familyName} onChange={set("familyName")} placeholder="例如：小明一家" maxLength={60} />
          </label>
        )}
        <label>
          <span style={{ fontSize: 13, fontWeight: 600 }}>你的称呼</span>
          <input style={input} value={form.displayName} onChange={set("displayName")} placeholder="例如：妈妈、爷爷" maxLength={60} required />
        </label>
        <label>
          <span style={{ fontSize: 13, fontWeight: 600 }}>邮箱（用于登录）</span>
          <input style={input} type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
        </label>
        <label>
          <span style={{ fontSize: 13, fontWeight: 600 }}>密码（至少 8 位）</span>
          <input style={input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required />
        </label>
        <label>
          <span style={{ fontSize: 13, fontWeight: 600 }}>确认密码</span>
          <input style={input} type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
        </label>

        {error && <div style={{ padding: "10px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, fontSize: 14 }}>{error}</div>}

        <button type="submit" disabled={loading} style={{ padding: "12px 0", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          {loading ? "正在注册..." : mode === "join" ? "注册并加入家庭" : "注册"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "#6b7280" }}>
        已有账号？
        <a href={`/login${redirect !== "/" ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} style={{ color: "#2563eb", fontWeight: 600 }}>
          登录
        </a>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f9fafb", padding: "20px 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <Suspense fallback={<div>加载中...</div>}>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
