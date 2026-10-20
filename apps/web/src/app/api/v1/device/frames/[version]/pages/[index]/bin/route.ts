/**
 * 下载附加页帧（D-018）— 与首页 frame.bin 相同的 1-bit 800×480 / 48,000 字节格式。
 * GET /api/v1/device/frames/{version}/pages/{index}/bin
 */

import { and, eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { screenFrames } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireDevice } from "@/lib/device-token";
import { readPageFile } from "@/lib/frame-pages";

const FRAME_BYTES = 48000;

export async function GET(req: Request, context: { params: Promise<{ version: string; index: string }> }) {
  try {
    const dev = await requireDevice(req);
    if (!dev.childId) throw new ApiError(403, "device_not_paired", "Device is not paired to any child");
    const { version: rawVersion, index: rawIndex } = await context.params;
    const version = parseInt(rawVersion, 10);
    const index = parseInt(rawIndex, 10);
    if (!(version > 0) || !(index >= 1 && index <= 16)) throw new ApiError(400, "invalid_page", "Invalid frame version or page index");

    const row = (
      await db
        .select({ framePath: screenFrames.framePath, pages: screenFrames.pages })
        .from(screenFrames)
        .where(and(eq(screenFrames.childId, dev.childId), eq(screenFrames.frameVersion, version)))
        .limit(1)
    )[0];
    const meta = ((row?.pages as { index: number; sha256: string }[] | null) ?? []).find((p) => p.index === index);
    if (!row || !meta) throw new ApiError(404, "page_not_found", `Page ${index} of frame ${version} not found`);
    const data = await readPageFile(row.framePath, dev.childId, version, index, "bin");
    if (!data || data.length !== FRAME_BYTES) throw new ApiError(404, "page_not_found", `Page file ${index} missing`);

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(FRAME_BYTES),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Frame-SHA256": meta.sha256,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
