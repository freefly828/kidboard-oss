/**
 * 设备上报任务完成事件 — docs/05 §5 + openapi.yaml
 * POST /api/v1/device/events/task-complete
 */

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@kidboard/db";
import { deviceEvents, taskOccurrences } from "@kidboard/db/schema";
import { deviceTaskCompleteSchema } from "@/lib/schemas";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireDevice } from "@/lib/device-token";
import { bumpContentVersion } from "@/lib/content-version";
import { syncTaskAward } from "@/lib/points";

export async function POST(req: Request) {
  try {
    const dev = await requireDevice(req);
    if (!dev.childId) {
      throw new ApiError(403, "device_not_paired", "Device is not paired to any child");
    }

    const body = deviceTaskCompleteSchema.parse(await req.json());
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();

    // 1. 幂等插入事件日志（通过 uq_device_event_idempotency 拦截重放）
    const insertedEvents = await db
      .insert(deviceEvents)
      .values({
        deviceId: dev.id,
        eventId: body.eventId,
        type: "task_complete",
        payload: {
          taskOccurrenceId: body.taskOccurrenceId,
          frameVersion: body.frameVersion,
        },
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: deviceEvents.id });

    // 若未产生新插入行，说明该 eventId 已经处理过，直接幂等成功返回（C03 验收项）
    if (insertedEvents.length === 0) {
      return NextResponse.json({
        status: "ok",
        applied: false,
        idempotent: true,
      });
    }

    // 2. 校验任务属于该绑定的 child
    const taskRows = await db
      .select({
        id: taskOccurrences.id,
        status: taskOccurrences.status,
        title: taskOccurrences.title,
        points: taskOccurrences.points,
      })
      .from(taskOccurrences)
      .where(
        and(
          eq(taskOccurrences.id, body.taskOccurrenceId),
          eq(taskOccurrences.childId, dev.childId),
        ),
      )
      .limit(1);

    const task = taskRows[0];
    if (!task) {
      throw new ApiError(404, "task_not_found", "Task occurrence not found for this child");
    }

    // 若已经处于 completed 状态，直接返回成功
    if (task.status === "completed") {
      return NextResponse.json({
        status: "ok",
        applied: false,
        alreadyCompleted: true,
      });
    }

    // 3. 将任务标记为 completed，并联动 content_version + 1 入队 render_job
    await db.transaction(async (tx) => {
      await tx
        .update(taskOccurrences)
        .set({
          status: "completed",
          completedAt: occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(taskOccurrences.id, task.id));

      // D-012：设备 DONE 键完成任务同样入账积分
      await syncTaskAward(tx, { id: task.id, childId: dev.childId!, title: task.title, points: task.points, status: "completed" }, null);
      await bumpContentVersion(dev.childId!, tx);
    });

    return NextResponse.json({
      status: "ok",
      applied: true,
    });
  } catch (err) {
    return jsonError(err);
  }
}
