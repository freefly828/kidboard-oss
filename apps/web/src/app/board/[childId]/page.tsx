/**
 * /board/[childId] — Web/H5 看板：与墨水屏显示同一份内容（多端同屏）。
 * 首屏在服务端取 VM（与 renderer 同源），之后由 BoardClient 轮询
 * /api/v1/children/[childId]/screen 保持同步。
 * 鉴权（D-020）：家长登录优先；未登录时若家长设置了 4 位看板密码，显示密码键盘，
 * 输入正确后凭该孩子的看板凭证访问；未设置密码则跳转登录。
 */

import { redirect } from "next/navigation";
import { ApiError } from "@/lib/auth-guard";
import { loadChildForBoard, requireChildOrBoard } from "@/lib/board-access";
import BoardPinGate from "./BoardPinGate";
import { loadScreenViewModel } from "@/lib/screen-vm";
import BoardClient from "./BoardClient";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ childId: string }> };

export default async function BoardPage({ params }: Params) {
  const { childId } = await params;
  let initial: Awaited<ReturnType<typeof load>> | null = null;
  let error: ApiError | null = null;

  try {
    initial = await load(childId);
  } catch (err) {
    error = err instanceof ApiError ? err : new ApiError(500, "internal", "看板加载异常");
  }

  // 未登录：设置了看板密码则显示密码键盘
  if (error?.status === 401) {
    const child = await loadChildForBoard(childId).catch(() => null);
    if (child?.boardPinHash) return <BoardPinGate childId={childId} childName={child.displayName} />;
  }

  // redirect() 通过抛出实现，不能放在 try 内
  if (error?.status === 401) {
    redirect(`/login?redirect=${encodeURIComponent(`/board/${childId}`)}`);
  }

  if (!initial) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#f3f4f6",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", color: "#374151" }}>
          <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            {error?.status === 403 ? "无权查看该孩子的看板" : "看板不可用"}
          </p>
          <a href="/board" style={{ color: "#2563eb" }}>
            返回孩子列表
          </a>
        </div>
      </main>
    );
  }

  return <BoardClient childId={childId} initial={initial} />;
}

async function load(childId: string) {
  const { child, role } = await requireChildOrBoard(childId);
  const vm = await loadScreenViewModel(child);
  return { contentVersion: Number(child.contentVersion), role, vm };
}
