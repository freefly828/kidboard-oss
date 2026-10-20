"use client";

/**
 * 家长后台外壳：侧栏导航 + 顶栏 + 当前视图。
 * 只管理"选中哪个孩子 / 当前用户 / 家庭与角色 / 全局提示"；各视图自行向 API 取真实数据。
 */

import * as React from "react";
import Sidebar, { type NavKey } from "./components/Sidebar";
import Header from "./components/Header";
import DashboardView from "./components/views/DashboardView";
import TasksView from "./components/views/TasksView";
import ScheduleView from "./components/views/ScheduleView";
import DevicesView from "./components/views/DevicesView";
import ChildrenView from "./components/views/ChildrenView";
import RewardsView from "./components/views/RewardsView";
import MessagesView from "./components/views/MessagesView";
import RemindersView from "./components/views/RemindersView";
import FamilyView from "./components/views/FamilyView";
import AnalyticsView from "./components/views/AnalyticsView";
import SettingsView from "./components/views/SettingsView";
import { api } from "./components/api";
import {
  DashboardContext,
  type ChildItem,
  type ChildProfile,
  type CurrentUser,
  type DashboardContextValue,
  type Role,
  type Toast,
} from "./components/DashboardContext";

const SELECTED_CHILD_KEY = "kidboard.selectedChildId";

/** 不依赖孩子的视图；其余视图在还没有孩子档案时引导去"孩子管理"创建 */
const CHILDLESS_VIEWS: NavKey[] = ["children", "family", "settings"];

export default function DashboardClient({
  initialChildren,
  initialUser,
  initialFamily,
}: {
  initialChildren: ChildItem[];
  initialUser: CurrentUser;
  initialFamily: { name: string; role: Role };
}) {
  const [activeNav, setActiveNav] = React.useState<NavKey>("dashboard");
  const [childrenList, setChildrenList] = React.useState<ChildItem[]>(initialChildren);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialChildren[0]?.id ?? null);
  const [user, setUser] = React.useState<CurrentUser>(initialUser);
  const [family, setFamily] = React.useState(initialFamily);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [dataVersion, setDataVersion] = React.useState(0);

  // 恢复上次选中的孩子（仅当它仍在服务端列表中）
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SELECTED_CHILD_KEY);
      if (saved && initialChildren.some((c) => c.id === saved)) setSelectedId(saved);
    } catch {
      // 隐私模式等场景 storage 不可用，使用第一个孩子
    }
  }, [initialChildren]);

  const selectChild = React.useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_CHILD_KEY, id);
    } catch {
      // 忽略
    }
  }, []);

  const reloadChildren = React.useCallback(async () => {
    const res = await api<{ children: (Omit<ChildItem, "profile" | "contentVersion" | "previewFrom"> & { contentVersion: number | string; profile: ChildProfile | null; previewFrom?: string | null })[] }>(
      "/api/v1/children",
    );
    const list = res.children.map((c) => ({ ...c, contentVersion: Number(c.contentVersion), profile: c.profile ?? {}, previewFrom: c.previewFrom ?? null }));
    setChildrenList(list);
    setSelectedId((cur) => (cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
  }, []);

  const reloadFamily = React.useCallback(async () => {
    const res = await api<{ family: { name: string }; myRole: Role }>("/api/v1/family");
    setFamily({ name: res.family.name, role: res.myRole });
  }, []);

  const notify = React.useCallback((text: string, ok = true) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, ok, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ok ? 4000 : 7000);
  }, []);

  const child = childrenList.find((c) => c.id === selectedId) ?? childrenList[0] ?? null;

  const ctx: DashboardContextValue = {
    children: childrenList,
    child,
    selectChild,
    reloadChildren,
    user,
    setUser,
    familyName: family.name,
    setFamilyName: (name: string) => setFamily((f) => ({ ...f, name })),
    role: family.role,
    reloadFamily,
    canEdit: family.role !== "viewer",
    navigate: setActiveNav,
    notify,
    dataVersion,
    bumpData: () => setDataVersion((v) => v + 1),
  };

  const needsChild = !CHILDLESS_VIEWS.includes(activeNav);

  // 窄屏侧栏抽屉：选菜单或按 Esc 关闭
  const [navOpen, setNavOpen] = React.useState(false);
  const selectNav = (key: NavKey) => {
    setActiveNav(key);
    setNavOpen(false);
  };
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <DashboardContext.Provider value={ctx}>
      <div className="kb-shell">
        <Sidebar activeNav={activeNav} onSelectNav={selectNav} open={navOpen} />
        {navOpen && <div className="kb-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

        <div className="kb-main">
          <Header menuOpen={navOpen} onOpenMenu={() => setNavOpen(true)} />

          <div className="kb-content">
            {needsChild && !child ? (
              <div className="card" style={{ padding: "2.5rem", textAlign: "center" }}>
                <div style={{ fontSize: "2rem" }}>👶</div>
                <h2 style={{ fontSize: "1.2rem", margin: "0.5rem 0" }}>还没有孩子档案</h2>
                <p style={{ color: "var(--text-muted)", margin: "0 0 1rem" }}>先创建一个孩子档案，才能安排课程、任务并绑定墨水屏。</p>
                <button type="button" className="btn btn-primary" onClick={() => setActiveNav("children")}>
                  去创建孩子档案
                </button>
              </div>
            ) : (
              <>
                {activeNav === "dashboard" && child && <DashboardView key={child.id} />}
                {activeNav === "children" && <ChildrenView />}
                {activeNav === "tasks" && child && <TasksView key={child.id} />}
                {activeNav === "schedule" && child && <ScheduleView key={child.id} />}
                {activeNav === "rewards" && child && <RewardsView key={child.id} />}
                {activeNav === "devices" && child && <DevicesView key={child.id} />}
                {activeNav === "messages" && child && <MessagesView key={child.id} />}
                {activeNav === "reminders" && child && <RemindersView key={child.id} />}
                {activeNav === "family" && <FamilyView />}
                {activeNav === "analytics" && child && <AnalyticsView key={child.id} />}
                {activeNav === "settings" && <SettingsView />}
              </>
            )}
          </div>
        </div>

        {/* 全局提示：顶部居中，比角落更醒目 */}
        <div style={{ position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 300, pointerEvents: "none" }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              style={{
                padding: "0.75rem 1.25rem",
                borderRadius: 10,
                fontSize: "0.92rem",
                fontWeight: 600,
                background: t.ok ? "#ecfdf5" : "#fef2f2",
                color: t.ok ? "#065f46" : "#b91c1c",
                border: `1px solid ${t.ok ? "#a7f3d0" : "#fecaca"}`,
                maxWidth: 480,
                boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
