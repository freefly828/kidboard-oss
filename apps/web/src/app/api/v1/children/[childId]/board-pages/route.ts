/**
 * H5 看板附加页数据（D-024）：积分商城、本周课表、专注计时（与墨水屏 D-018/D-019 同源取数）。
 * GET /api/v1/children/[childId]/board-pages → { points, week, focus }
 * 家长登录或孩子看板密码凭证均可读取。
 */

import { NextResponse } from "next/server";
import { displayPlan } from "@kidboard/db/screen-input";
import { loadFocusSummary, loadPointsSummary, loadWeekRows } from "@kidboard/db/pages-input";
import { assembleWeekPage, weekDatesOf } from "@kidboard/screen-template/pages";
import { jsonError } from "@/lib/auth-guard";
import { requireChildOrBoard } from "@/lib/board-access";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildOrBoard(childId);
    const plan = displayPlan(new Date(), child.timezone, child.previewFrom);
    const weekDates = weekDatesOf(plan.date);
    const [rows, points, focus] = await Promise.all([
      loadWeekRows(child.id, weekDates),
      loadPointsSummary(child, weekDates[0]!, plan.date, 10),
      loadFocusSummary(child),
    ]);
    return NextResponse.json(
      {
        week: assembleWeekPage({ ...rows, weekDates, today: plan.date }),
        points: {
          balance: points.balance,
          weekEarned: points.weekEarned,
          available: points.available,
          rewards: [...points.rewards].sort((a, b) => a.cost - b.cost),
          recent: points.recent,
        },
        focus,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}
