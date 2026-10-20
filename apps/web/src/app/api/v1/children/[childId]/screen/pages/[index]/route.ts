/**
 * 后台预览附加页（D-018）：当前 active 画面第 index 页的 PNG（与设备显示同一帧）。
 * GET /api/v1/children/[childId]/screen/pages/[index]
 */

import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { screenFrames } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireChildOrBoard } from "@/lib/board-access";
import { readPageFile } from "@/lib/frame-pages";

type Params = { params: Promise<{ childId: string; index: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId, index: rawIndex } = await params;
    const { child } = await requireChildOrBoard(childId); // D-024 孩子看板也能看墨水屏样式的附加页
    const index = parseInt(rawIndex, 10);
    if (!(index >= 1 && index <= 16)) throw new ApiError(400, "invalid_page", "Invalid page index");
    const row = (
      await db
        .select({ framePath: screenFrames.framePath, frameVersion: screenFrames.frameVersion })
        .from(screenFrames)
        .where(and(eq(screenFrames.childId, child.id), eq(screenFrames.isActive, true)))
        .limit(1)
    )[0];
    if (!row) throw new ApiError(404, "frame_not_found", "No active frame yet");
    const png = await readPageFile(row.framePath, child.id, row.frameVersion, index, "png");
    if (!png) throw new ApiError(404, "page_not_found", "Page not rendered yet");
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Frame-Version": String(row.frameVersion) },
    });
  } catch (err) {
    return jsonError(err);
  }
}
