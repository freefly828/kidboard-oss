"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  // 仅允许站内路径，防止 ?redirect=https://evil 开放重定向
  const rawRedirect = searchParams.get("redirect") || "/";
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") && !rawRedirect.startsWith("/\\") ? rawRedirect : "/";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || "登录失败，请检查账号和密码");
      } else {
        // 登录成功，跳转目标页面或首页
        window.location.href = redirect;
      }
    } catch (err) {
      setError(`网络错误: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 440,
        margin: "60px auto",
        padding: "32px 28px",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
        border: "1px solid #e0e0e0",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <span
          className="badge"
          style={{
            background: "#f3f4f6",
            color: "#374151",
            padding: "4px 10px",
            borderRadius: 12,
            fontSize: 12,
            display: "inline-block",
            marginBottom: 8,
          }}
        >
          KidBoard 家长端
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "6px 0" }}>
          家长登录
        </h1>
        <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
          登录后可查看儿童墨水屏实时排版、发布任务与绑定设备
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fee2e2",
            color: "#b91c1c",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 18,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 6,
              color: "#333",
            }}
          >
            家长邮箱
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 15,
              border: "1px solid #ccc",
              borderRadius: 6,
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 6,
              color: "#333",
            }}
          >
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 15,
              border: "1px solid #ccc",
              borderRadius: 6,
              outline: "none",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            background: "#111827",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "background 0.2s",
          }}
        >
          {loading ? "正在登录..." : "登 录"}
        </button>
      </form>
      <div style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: "#6b7280" }}>
        还没有账号？<a href={`/register${redirect !== "/" ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} style={{ color: "#2563eb", fontWeight: 600 }}>注册</a>
        <span style={{ margin: "0 6px" }}>·</span>收到家庭邀请码也在注册页填写
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f9fafb",
        padding: "20px 16px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 440, margin: "0 auto", paddingBottom: 16 }}>
        <a
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 14,
            color: "#6b7280",
            textDecoration: "none",
          }}
        >
          ← 返回控制台首页
        </a>
      </div>
      <Suspense fallback={<div>加载中...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
