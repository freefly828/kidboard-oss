/**
 * content_version 联动 — docs/01 PRD F07 + docs/03 §6。
 * 任何影响屏幕内容的变更: 事务内 content_version+1 并创建 render job。
 * Phase 1 只落库 (render job 由 Phase 3 worker 消费),不阻塞响应。
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, renderJobs } from "@kidboard/db/schema";

/**
 * 在事务中: child.content_version +1 并插入 render_jobs 行。
 * 返回新的 content_version。
 */
export async function bumpContentVersion(
  childId: string,
  tx: {
    update: typeof db.update;
    insert: typeof db.insert;
  } = db,
): Promise<number> {
  const updated = await tx
    .update(children)
    .set({
      contentVersion: sql`${children.contentVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(children.id, childId))
    .returning({ contentVersion: children.contentVersion });
  const newVersion = updated[0]?.contentVersion;
  if (newVersion === undefined) {
    throw new Error(`child not found: ${childId}`);
  }
  await tx.insert(renderJobs).values({
    childId,
    requestedContentVersion: newVersion,
  });
  return newVersion;
}

/** D-018 家庭级内容（心愿清单）变化：重渲染该家庭所有孩子的画面 */
export async function bumpFamilyChildren(familyId: string): Promise<void> {
  const rows = await db.select({ id: children.id }).from(children).where(eq(children.familyId, familyId));
  for (const r of rows) await bumpContentVersion(r.id);
}
