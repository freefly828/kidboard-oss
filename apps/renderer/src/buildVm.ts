/**
 * VM 组装（DB → ScreenViewModel）— renderer 侧实现（Phase 2 约定：组装器只吃扁平行）。
 *
 * docs/03 §7：屏幕的"今天"必须按 child timezone 计算，不用服务器时区。
 * 组装逻辑（weekday 过滤 / override / 排序截断 / 焦点分配）全部复用
 * packages/screen-template/assemble 的纯函数，renderer 只负责取数与日期换算。
 */

import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { loadScreenInput } from "@kidboard/db/screen-input";
import { assembleViewModel } from "@kidboard/screen-template/assemble";
import { poemOfDay, type ScreenViewModel } from "@kidboard/screen-template";
import { assemblePointsPage, assembleWeekPage, weekDatesOf } from "@kidboard/screen-template/pages";
import { loadFocusSummary, loadPointsSummary, loadWeekRows } from "@kidboard/db/pages-input";
import type { PageData } from "./renderPages.js";

const WEEKDAY_ZH = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export interface ChildRenderContext {
  id: string;
  familyId: string;
  displayName: string;
  timezone: string;
  contentVersion: number;
  /** D-013 明日预览开始时间（null = 关闭） */
  previewFrom: string | null;
}

export class ChildNotFoundError extends Error {}

/** 读取 child 渲染上下文（不存在则抛错，由 worker 记为 job failure） */
export async function loadChild(childId: string): Promise<ChildRenderContext> {
  const row = (
    await db.select().from(children).where(eq(children.id, childId)).limit(1)
  )[0];
  if (!row) throw new ChildNotFoundError(`child not found: ${childId}`);
  return {
    id: row.id,
    familyId: row.familyId,
    displayName: row.displayName,
    timezone: row.timezone,
    contentVersion: row.contentVersion,
    previewFrom: row.previewFrom,
  };
}

/**
 * 给定 IANA timezone 返回当地今天的 YYYY-MM-DD 与 ISO weekday。
 * 用 Intl 而非手算时区偏移，避免 DST/历史时区规则出错。
 */
export function todayIn(timezone: string, now = new Date()): { today: string; isoWeekday: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now); // en-CA → YYYY-MM-DD
  const isoWeekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  return { today, isoWeekday };
}

/** 日期标签："9月16日 周三"（与 docs/02 头部文案一致） */
export function dateLabelOf(today: string, isoWeekday: number): string {
  const [, m, d] = today.split("-").map(Number);
  return `${m}月${d}日 ${WEEKDAY_ZH[isoWeekday]}`;
}

/**
 * 从 DB 组装 ScreenViewModel。
 *
 * 只读：不修改 content_version，不创建 job（那是 Web API 的职责）。
 * 调用方需在拿到的 job 的 requested_content_version 上做 stale 判定。
 */
export async function buildViewModel(
  child: ChildRenderContext,
  options: { now?: Date; syncStatus?: ScreenViewModel["syncStatus"]; offlineNotice?: string } = {},
): Promise<{ vm: ScreenViewModel; today: string; isoWeekday: number }> {
  // D-013：取数与"今天/明日预览"判定由 @kidboard/db/screen-input 统一完成（Web 端同源）
  const { plan, input } = await loadScreenInput(child, options.now);
  const vm = assembleViewModel({
    ...input,
    poem: poemOfDay(plan.today),
    syncStatus: options.syncStatus ?? "synced",
    offlineNotice: options.offlineNotice,
  });
  return { vm, today: plan.date, isoWeekday: plan.isoWeekday };
}

/** D-018 附加页数据：显示日所在周的课表、积分与心愿 */
export async function buildPageData(child: ChildRenderContext, displayDate: string): Promise<PageData> {
  const weekDates = weekDatesOf(displayDate);
  const [rows, points, focus] = await Promise.all([
    loadWeekRows(child.id, weekDates),
    loadPointsSummary(child, weekDates[0]!, displayDate),
    loadFocusSummary(child),
  ]);
  return {
    week: assembleWeekPage({ ...rows, weekDates, today: displayDate }),
    points: assemblePointsPage(points),
    focus,
  };
}
