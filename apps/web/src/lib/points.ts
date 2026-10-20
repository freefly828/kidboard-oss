/**
 * 积分账本（D-012）— 余额 = SUM(point_ledger.delta)。
 *
 * 不变量：kind='task' 的流水与任务完成状态一一对应——任务处于 completed 且
 * points>0 时恰有一条奖励流水，否则没有（uq_point_ledger_task 兜底并发）。
 * 所有改变任务完成状态的入口（家长后台、H5 看板、设备 DONE 键）都调用 syncTaskAward。
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pointLedger } from "@kidboard/db/schema";

export type DbExecutor = Pick<typeof db, "select" | "insert" | "delete" | "update">;

export interface TaskForAward {
  id: string;
  childId: string;
  title: string;
  points: number;
  status: string;
}

export async function syncTaskAward(
  tx: DbExecutor,
  task: TaskForAward,
  createdBy: string | null,
): Promise<void> {
  const shouldAward = task.status === "completed" && task.points > 0;
  const existing = await tx
    .select({ id: pointLedger.id, delta: pointLedger.delta })
    .from(pointLedger)
    .where(and(eq(pointLedger.taskOccurrenceId, task.id), eq(pointLedger.kind, "task")))
    .limit(1);
  const row = existing[0];

  if (!shouldAward) {
    if (row) await tx.delete(pointLedger).where(eq(pointLedger.id, row.id));
    return;
  }
  if (row) {
    // 已完成任务的分值被修改时同步更新流水
    if (row.delta !== task.points) {
      await tx.update(pointLedger).set({ delta: task.points }).where(eq(pointLedger.id, row.id));
    }
    return;
  }
  await tx
    .insert(pointLedger)
    .values({
      childId: task.childId,
      delta: task.points,
      kind: "task",
      reason: `完成任务「${task.title}」`,
      taskOccurrenceId: task.id,
      createdBy,
    })
    .onConflictDoNothing();
}

export async function getBalance(childId: string, tx: DbExecutor = db): Promise<number> {
  const rows = await tx
    .select({ total: sql<string | null>`sum(${pointLedger.delta})` })
    .from(pointLedger)
    .where(eq(pointLedger.childId, childId));
  return Number(rows[0]?.total ?? 0);
}
