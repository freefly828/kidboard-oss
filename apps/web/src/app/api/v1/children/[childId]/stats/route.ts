/**
 * 统计分析（D-012）— 全部由 task_occurrences 与 point_ledger 实时计算，不存冗余表。
 * GET /api/v1/children/[childId]/stats?days=7（1..90）
 * → { today, days, daily[], byCategory[], totals, streakDays, topTasks[] }
 *   daily：每天计划/完成任务数与获得积分（孩子时区日期）
 *   streakDays：截至今天（今天尚无完成则截至昨天）连续"至少完成 1 项任务"的天数（最多回看 365 天）
 */

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger, taskOccurrences } from "@kidboard/db/schema";
import { jsonError, requireChildAccess } from "@/lib/auth-guard";
import { addDays, todayFor } from "@/lib/dates";
import { getBalance } from "@/lib/points";

type Params = { params: Promise<{ childId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildAccess(childId);
    const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 7)));
    const today = todayFor(child.timezone);
    const from = addDays(today, -(days - 1));
    const localDate = sql<string>`to_char((${pointLedger.createdAt} AT TIME ZONE ${child.timezone})::date, 'YYYY-MM-DD')`;

    const [taskDays, catRows, pointDays, pointTotals, topRows, completedDays, balance] = await Promise.all([
      db
        .select({
          date: sql<string>`to_char(${taskOccurrences.occurrenceDate}::date, 'YYYY-MM-DD')`,
          planned: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${taskOccurrences.status} = 'completed')::int`,
        })
        .from(taskOccurrences)
        .where(
          and(
            eq(taskOccurrences.childId, child.id),
            gte(taskOccurrences.occurrenceDate, from),
            lte(taskOccurrences.occurrenceDate, today),
          ),
        )
        .groupBy(taskOccurrences.occurrenceDate),
      db
        .select({
          category: sql<string>`coalesce(${taskOccurrences.category}, '未分类')`,
          planned: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${taskOccurrences.status} = 'completed')::int`,
        })
        .from(taskOccurrences)
        .where(
          and(
            eq(taskOccurrences.childId, child.id),
            gte(taskOccurrences.occurrenceDate, from),
            lte(taskOccurrences.occurrenceDate, today),
          ),
        )
        .groupBy(sql`coalesce(${taskOccurrences.category}, '未分类')`),
      db
        .select({ date: localDate, earned: sql<number>`sum(${pointLedger.delta})::int` })
        .from(pointLedger)
        .where(
          and(
            eq(pointLedger.childId, child.id),
            sql`${pointLedger.delta} > 0`,
            sql`(${pointLedger.createdAt} AT TIME ZONE ${child.timezone})::date >= ${from}::date`,
          ),
        )
        // 按列序号分组：时区参数在 SELECT/GROUP BY 中会被绑定为不同占位符，PG 视为不同表达式
        .groupBy(sql`1`),
      db
        .select({
          earned: sql<number>`coalesce(sum(${pointLedger.delta}) filter (where ${pointLedger.delta} > 0), 0)::int`,
          spent: sql<number>`coalesce(-sum(${pointLedger.delta}) filter (where ${pointLedger.kind} = 'redeem'), 0)::int`,
        })
        .from(pointLedger)
        .where(
          and(
            eq(pointLedger.childId, child.id),
            sql`(${pointLedger.createdAt} AT TIME ZONE ${child.timezone})::date >= ${from}::date`,
          ),
        ),
      db
        .select({ title: taskOccurrences.title, completed: sql<number>`count(*)::int` })
        .from(taskOccurrences)
        .where(
          and(
            eq(taskOccurrences.childId, child.id),
            eq(taskOccurrences.status, "completed"),
            gte(taskOccurrences.occurrenceDate, from),
          ),
        )
        .groupBy(taskOccurrences.title)
        .orderBy(desc(sql`count(*)`))
        .limit(5),
      db
        .selectDistinct({ date: sql<string>`to_char(${taskOccurrences.occurrenceDate}::date, 'YYYY-MM-DD')` })
        .from(taskOccurrences)
        .where(
          and(
            eq(taskOccurrences.childId, child.id),
            eq(taskOccurrences.status, "completed"),
            gte(taskOccurrences.occurrenceDate, addDays(today, -365)),
          ),
        ),
      getBalance(child.id),
    ]);

    const byDate = new Map(taskDays.map((r) => [r.date, r]));
    const pointsByDate = new Map(pointDays.map((r) => [r.date, r.earned]));
    const daily = Array.from({ length: days }, (_, i) => {
      const date = addDays(from, i);
      const t = byDate.get(date);
      return { date, planned: t?.planned ?? 0, completed: t?.completed ?? 0, points: pointsByDate.get(date) ?? 0 };
    });

    const doneSet = new Set(completedDays.map((r) => r.date));
    let cursor = doneSet.has(today) ? today : addDays(today, -1);
    let streakDays = 0;
    while (doneSet.has(cursor) && streakDays < 365) {
      streakDays++;
      cursor = addDays(cursor, -1);
    }

    const planned = daily.reduce((s, d) => s + d.planned, 0);
    const completed = daily.reduce((s, d) => s + d.completed, 0);
    return NextResponse.json({
      today,
      days,
      daily,
      byCategory: catRows.sort((a, b) => b.planned - a.planned),
      totals: {
        planned,
        completed,
        completionRate: planned === 0 ? null : Math.round((completed / planned) * 100),
        pointsEarned: pointTotals[0]?.earned ?? 0,
        pointsSpent: pointTotals[0]?.spent ?? 0,
        balance,
      },
      streakDays,
      topTasks: topRows,
    });
  } catch (err) {
    return jsonError(err);
  }
}
