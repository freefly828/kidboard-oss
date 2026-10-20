/**
 * 任务物化（materialization）— 把 task_templates 按 recurrence 规则
 * 展开为某日的 task_occurrences。docs/04 §6/§7。
 *
 * 规则:
 * - once:     只在 startDate 当天
 * - daily:    startDate..endDate(或无限) 每天
 * - weekly:   startDate..endDate(或无限) 内落在 weekdays 的天
 * - 幂等:     uq_task_materialize(child_id, occurrence_date,
 *             source_template_id, source_key) ON CONFLICT DO NOTHING
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from ".";
import { taskTemplates, taskOccurrences } from "./schema";

export type Recurrence =
  | { type: "once"; startDate: string }
  | {
      type: "daily" | "weekly";
      weekdays?: number[];
      startDate: string;
      endDate?: string | null;
    };

/** 判断模板在某日期是否应生成 occurrence */
export function occursOn(recurrence: Recurrence, date: string): boolean {
  if (date < recurrence.startDate) return false;
  if (
    "endDate" in recurrence &&
    recurrence.endDate != null &&
    date > recurrence.endDate
  ) {
    return false;
  }
  switch (recurrence.type) {
    case "once":
      return date === recurrence.startDate;
    case "daily":
      return true;
    case "weekly": {
      // ISO weekday: Mon=1..Sun=7
      const wd = new Date(date + "T00:00:00Z").getUTCDay();
      const isoWeekday = wd === 0 ? 7 : wd;
      return (recurrence.weekdays ?? []).includes(isoWeekday);
    }
  }
}

/**
 * 为指定儿童物化某日任务（幂等，可重复调用）。
 * 返回新插入的 occurrence 数量。
 */
export async function materializeDay(
  childId: string,
  date: string,
  tx = db,
): Promise<number> {
  const templates = await tx
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.childId, childId), eq(taskTemplates.active, true)));

  let inserted = 0;
  for (const tpl of templates) {
    const rec = tpl.recurrence as unknown as Recurrence;
    if (!occursOn(rec, date)) continue;
    // 注: uq_task_materialize 是部分唯一索引(WHERE source_template_id IS NOT NULL),
    // PG 的 ON CONFLICT 推断不支持部分索引 → 改为先查后插,
    // 唯一索引仍在并发窗口下兖底(捕获 23505 视为已存在)。
    const existing = await tx
      .select({ id: taskOccurrences.id })
      .from(taskOccurrences)
      .where(
        and(
          eq(taskOccurrences.childId, childId),
          eq(taskOccurrences.occurrenceDate, date),
          eq(taskOccurrences.sourceTemplateId, tpl.id),
          eq(taskOccurrences.sourceKey, `${tpl.id}:${date}`),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    try {
      const rows = await tx
        .insert(taskOccurrences)
        .values({
          childId,
          sourceTemplateId: tpl.id,
          sourceKey: `${tpl.id}:${date}`,
          occurrenceDate: date,
          title: tpl.title,
          description: tpl.description,
          estimatedMinutes: tpl.estimatedMinutes,
          priority: tpl.priority,
          category: tpl.category,
          points: tpl.points,
          sortOrder: tpl.sortOrder,
          status: "pending",
        })
        .returning({ id: taskOccurrences.id });
      inserted += rows.length;
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException & { code?: string }).code === "23505"
      ) {
        continue; // 并发下已被物化
      }
      throw err;
    }
  }
  return inserted;
}

/** 供路由检查“今天是否已物化”用 */
export async function alreadyMaterialized(
  childId: string,
  date: string,
): Promise<boolean> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taskOccurrences)
    .where(
      and(
        eq(taskOccurrences.childId, childId),
        eq(taskOccurrences.occurrenceDate, date),
        sql`${taskOccurrences.sourceTemplateId} IS NOT NULL`,
      ),
    );
  return (rows[0]?.n ?? 0) > 0;
}
