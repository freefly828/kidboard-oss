/**
 * H5 看板专注计时（D-024）。孩子看板凭证或家长（guardian+）可用。
 * POST /api/v1/children/[childId]/focus-sessions { action: "start" } → { id, minutes, startedAt }
 * POST 同路径 { action: "complete", id } → { awarded, alreadyDone }；实际经过时间不足返回 409 { remainingSeconds }
 * 服务器以"开始"时记下的时间校验，防止不计时直接领分。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireChildOrBoard } from "@/lib/board-access";
import { completeBoardFocus, startBoardFocus } from "@/lib/focus";

type Params = { params: Promise<{ childId: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("complete"), id: z.string().uuid() }),
]);

export async function POST(req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    const { child } = await requireChildOrBoard(childId, "guardian");
    const body = bodySchema.parse(await req.json());
    if (body.action === "start") {
      return NextResponse.json(await startBoardFocus(child.id), { status: 201 });
    }
    const r = await completeBoardFocus(child.id, body.id);
    if (!r.ok) {
      if (r.reason === "not_found") throw new ApiError(404, "not_found", "Focus session not found");
      return NextResponse.json(
        { error: { code: "too_early", message: "专注时间还没到" }, remainingSeconds: r.remainingSeconds },
        { status: 409 },
      );
    }
    return NextResponse.json({ awarded: r.awarded, alreadyDone: r.alreadyDone });
  } catch (err) {
    return jsonError(err);
  }
}
