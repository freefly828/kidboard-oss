/**
 * /preview/[childId] — 实数据墨水屏预览（docs/02 P06）。
 * Server Component 直接渲染 <Screen/>（与 renderer 共用同一模板源）。
 * "今天"按 child timezone 计算（docs/03 §7）；走 requireChildAccess 鉴权。
 */

import * as React from "react";
import { Screen } from "@kidboard/screen-template";
import { requireChildAccess, ApiError } from "@/lib/auth-guard";
import { loadScreenViewModel } from "@/lib/screen-vm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ childId: string }> };

export default async function ChildPreviewPage({ params }: Params) {
  const { childId } = await params;
  let vm = null;
  let authError: { status: number; message: string } | null = null;

  try {
    const { child } = await requireChildAccess(childId);
    vm = await loadScreenViewModel(child);
  } catch (err) {
    if (err instanceof ApiError) {
      authError = { status: err.status, message: err.message };
    } else {
      authError = { status: 500, message: "预览生成异常" };
    }
  }

  // 严格走登录鉴权流程（不跳过规范流程）
  if (authError || vm === null) {
    const isLoginRequired = authError?.status === 401;
    const isForbidden = authError?.status === 403;

    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#f3f4f6",
          padding: "40px 16px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            padding: "32px 28px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 28 }}>{isLoginRequired ? "🔒" : "⚠️"}</span>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#111827" }}>
                {isLoginRequired
                  ? "查看墨水屏预览需要登录"
                  : isForbidden
                  ? "访问受限：无家庭权限"
                  : "墨水屏预览不可用"}
              </h1>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
                儿童实机墨水屏属于家庭私有数据，遵循权限安全规范（docs/08 §2）
              </p>
            </div>
          </div>

          <div
            style={{
              padding: "12px 14px",
              background: "#f9fafb",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              fontSize: 14,
              color: "#374151",
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            {isLoginRequired ? (
              <>
                <strong>请使用家长账号登录后访问。</strong>
              </>
            ) : (
              <div>{authError?.message || "无权访问该儿童的排版数据"}</div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a
              href={`/login?redirect=/preview/${encodeURIComponent(childId)}`}
              style={{
                display: "block",
                textAlign: "center",
                padding: "12px 20px",
                background: "#111827",
                color: "#fff",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              前往家长端登录 →
            </a>

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <a
                href="/preview/fixtures"
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: "10px 14px",
                  background: "#fff",
                  color: "#4b5563",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                查看 8 套排版预置
              </a>
              <a
                href="/"
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: "10px 14px",
                  background: "#fff",
                  color: "#4b5563",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                返回控制台首页
              </a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        margin: 0,
        padding: 24,
        background: "#e8e8e4",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 840, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
              儿童墨水屏实时排版预览（800×480）
            </h1>
            <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>
              严格与固件硬件帧及 Phase 3 渲染管线共用同一模板源
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href="/"
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                color: "#333",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              ← 控制台
            </a>
            <a
              href="/preview/fixtures"
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                color: "#333",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              8 套预置
            </a>
          </div>
        </div>

        <div
          style={{
            width: 800,
            height: 480,
            border: "4px solid #1a1a1a",
            background: "#fff",
            overflow: "hidden",
            boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
          }}
        >
          <Screen vm={vm} />
        </div>

        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "#fff",
            borderRadius: 8,
            fontSize: 13,
            color: "#4b5563",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>📐 契约规格：800×480 · 1-bit 黑白点阵 · MSB First · 48,000 Bytes 帧缓冲区</span>
          <span style={{ color: "#059669", fontWeight: 600 }}>● 实时数据已挂载</span>
        </div>
      </div>
    </main>
  );
}
