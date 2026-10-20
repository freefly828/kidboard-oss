/**
 * 测试辅助：临时"停放"不属于本测试的可抢占 render job。
 *
 * claimNextJob() 按设计从全表抢占，集成测试却断言"抢到的是自己刚入队的 job"。
 * 共享测试库中若残留其它 queued / 锁超时 running 的 job（如冒烟脚本未清理），
 * 会被先抢走导致用例随机失败。这里把这些 job 的 available_at / locked_at 整体
 * 后移 100 年使其暂不可抢占，返回的 restore() 按同一偏移原样移回，不改变其它字段。
 */

import type { Sql } from "postgres";

const PARK_SHIFT = "100 years";

export async function parkForeignJobs(
  sql: Sql,
  ownChildIds: string[],
): Promise<() => Promise<void>> {
  const parked = await sql`
    UPDATE render_jobs
       SET available_at = available_at + ${PARK_SHIFT}::interval,
           locked_at = locked_at + ${PARK_SHIFT}::interval
     WHERE status IN ('queued', 'running')
       AND NOT (child_id = ANY(${ownChildIds}::uuid[]))
    RETURNING id
  `;
  const ids = parked.map((r) => String(r.id));

  return async () => {
    if (ids.length === 0) return;
    await sql`
      UPDATE render_jobs
         SET available_at = available_at - ${PARK_SHIFT}::interval,
             locked_at = locked_at - ${PARK_SHIFT}::interval
       WHERE id = ANY(${ids}::uuid[])
    `;
  };
}
