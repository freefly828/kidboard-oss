/**
 * 墨水屏内容 VM API — Web/H5 看板多端同屏。
 * GET /api/v1/children/[childId]/screen → { contentVersion, role, vm }
 *     viewer+；只读，不 bump content_version、不建 render job。
 * vm 与 renderer 生成墨水屏帧所用 ScreenViewModel 同源（@/lib/screen-vm）。
 */

import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth-guard";
import { requireChildOrBoard } from "@/lib/board-access";
import { loadScreenViewModel } from "@/lib/screen-vm";

type Params = { params: Promise<{ childId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { childId } = await params;
    // D-020 家长登录或孩子看板密码凭证均可读取
    const { child, role } = await requireChildOrBoard(childId);
    const vm = await loadScreenViewModel(child);
    return NextResponse.json(
      { contentVersion: Number(child.contentVersion), role, vm },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}
