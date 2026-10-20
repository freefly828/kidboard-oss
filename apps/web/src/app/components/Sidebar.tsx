"use client";

import * as React from "react";

export type NavKey =
  | "dashboard"
  | "children"
  | "tasks"
  | "schedule"
  | "rewards"
  | "devices"
  | "messages"
  | "reminders"
  | "family"
  | "analytics"
  | "settings";

interface SidebarProps {
  activeNav: NavKey;
  onSelectNav: (key: NavKey) => void;
  /** 窄屏抽屉是否打开（宽屏下侧栏常驻，忽略） */
  open?: boolean;
}

const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  icon: string;
}> = [
  { key: "dashboard", label: "总览仪表盘", icon: "🏠" },
  { key: "children", label: "孩子管理", icon: "👤" },
  { key: "tasks", label: "任务中心", icon: "📋" },
  { key: "schedule", label: "课程与日程", icon: "📅" },
  { key: "rewards", label: "积分与奖励", icon: "🏆" },
  { key: "devices", label: "设备管理", icon: "📱" },
  { key: "messages", label: "消息留言", icon: "💬" },
  { key: "reminders", label: "提醒", icon: "⏰" },
  { key: "family", label: "家庭成员", icon: "👥" },
  { key: "analytics", label: "统计分析", icon: "📊" },
  { key: "settings", label: "系统设置", icon: "⚙️" },
];

export default function Sidebar({
  activeNav,
  onSelectNav,
  open = false,
}: SidebarProps) {
  return (
    <aside
      id="kb-sidebar"
      className={open ? "kb-sidebar open" : "kb-sidebar"}
      aria-label="主菜单"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#ffffff",
        borderRight: "1px solid var(--border)",
        padding: "1.25rem 1rem",
      }}
    >
      {/* Top Section: Brand Logo & Nav */}
      <div>
        {/* Brand Logo (Exactly matching design mockups) */}
        <div
          onClick={() => onSelectNav("dashboard")}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0.25rem 0.25rem 1rem 0.25rem",
            cursor: "pointer",
            borderBottom: "1px solid var(--border-subtle)",
            marginBottom: "1rem",
            userSelect: "none",
          }}
          title="KidBoard 家庭成长任务系统"
        >
          <img
            src="/brand-logo.png"
            alt="KidBoard 家庭成长任务系统"
            style={{
              height: "44px",
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>

        {/* Nav Items List */}
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectNav(item.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "10px",
                  border: "none",
                  background: isActive ? "var(--primary-light)" : "transparent",
                  color: isActive ? "var(--primary)" : "var(--text-sub)",
                  fontWeight: isActive ? 600 : 500,
                  fontSize: "0.925rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#f1f5f9";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "1.15rem" }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Illustration (Exactly matching design mockups) */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: "0.85rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          userSelect: "none",
        }}
      >
        <img
          src="/sidebar-illustration.png"
          alt="好习惯 让孩子遇见更好的自己 ♡ - 陪伴成长 让爱看得见"
          style={{
            width: "100%",
            maxWidth: 220,
            height: "auto",
            objectFit: "contain",
            display: "block",
            borderRadius: "12px",
          }}
        />
      </div>
    </aside>
  );
}
