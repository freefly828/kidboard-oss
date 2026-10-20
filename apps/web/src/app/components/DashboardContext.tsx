"use client";

/**
 * 家长后台共享状态：孩子列表与当前选中孩子、当前用户、家庭与角色、全局提示。
 * 数据全部来自服务端（/api/v1/children、/api/v1/family、/api/v1/auth/me）；
 * 浏览器只记住"上次选中的孩子 id"这一便利项。
 */

import * as React from "react";
import type { NavKey } from "./Sidebar";

export type Role = "owner" | "guardian" | "viewer";

export interface ChildProfile {
  gender?: "boy" | "girl" | null;
  birthYear?: number | null;
  grade?: string | null;
  interests?: string[] | null;
  wakeTime?: string | null;
  bedTime?: string | null;
  encouragementStyle?: string | null;
  wishGoal?: string | null;
}

export interface ChildItem {
  id: string;
  displayName: string;
  timezone: string;
  contentVersion: number;
  profile: ChildProfile;
  /** D-013 明日预览开始时间 HH:MM；null = 关闭 */
  previewFrom: string | null;
  /** D-019 专注计时：每次分钟数、完成积分、每天最多计分次数 */
  focusMinutes: number;
  focusPoints: number;
  focusDailyCap: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Toast {
  id: number;
  ok: boolean;
  text: string;
}

export interface DashboardContextValue {
  children: ChildItem[];
  child: ChildItem | null;
  selectChild: (id: string) => void;
  reloadChildren: () => Promise<void>;
  user: CurrentUser;
  setUser: (u: CurrentUser) => void;
  familyName: string;
  setFamilyName: (name: string) => void;
  role: Role;
  reloadFamily: () => Promise<void>;
  canEdit: boolean;
  navigate: (key: NavKey) => void;
  notify: (text: string, ok?: boolean) => void;
  /** 任何会改变屏幕/统计的数据写入后递增，供其它卡片刷新 */
  dataVersion: number;
  bumpData: () => void;
}

export const DashboardContext = React.createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = React.useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardContext");
  return ctx;
}

/** 当前选中孩子（视图只在有孩子时渲染，因此这里断言非空） */
export function useChild(): ChildItem {
  const { child } = useDashboard();
  if (!child) throw new Error("no child selected");
  return child;
}
