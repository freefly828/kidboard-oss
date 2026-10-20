import { asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { getPrimaryFamily, getSessionUser } from "@/lib/session";
import DashboardClient from "./DashboardClient";
import type { ChildItem, ChildProfile } from "./components/DashboardContext";

export const dynamic = "force-dynamic";

export default async function Home() {
  let dbOk = false;
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;

  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    user = await getSessionUser();
  } catch (err) {
    console.error("Home load error:", err);
  }

  // 家长后台必须登录（docs/08 §2）；redirect() 通过抛出实现，不能放在 try 内
  if (dbOk && !user) redirect("/login");
  if (!dbOk || !user) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div className="card" style={{ padding: "2rem", maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.2rem", margin: "0 0 0.5rem" }}>服务暂时不可用</h1>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>数据库连接失败，请稍后刷新重试。</p>
        </div>
      </main>
    );
  }

  const family = await getPrimaryFamily(user.id);
  const rows = family
    ? await db
        .select({
          id: children.id,
          displayName: children.displayName,
          timezone: children.timezone,
          contentVersion: children.contentVersion,
          profile: children.profile,
          previewFrom: children.previewFrom,
          focusMinutes: children.focusMinutes,
          focusPoints: children.focusPoints,
          focusDailyCap: children.focusDailyCap,
        })
        .from(children)
        .where(eq(children.familyId, family.id))
        .orderBy(asc(children.createdAt))
    : [];

  const childrenList: ChildItem[] = rows.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    timezone: c.timezone,
    contentVersion: Number(c.contentVersion),
    profile: (c.profile ?? {}) as ChildProfile,
    previewFrom: c.previewFrom,
    focusMinutes: c.focusMinutes,
    focusPoints: c.focusPoints,
    focusDailyCap: c.focusDailyCap,
  }));

  return (
    <main style={{ minHeight: "100vh", width: "100%", background: "var(--bg-app)" }}>
      <DashboardClient
        initialChildren={childrenList}
        initialUser={{ id: user.id, email: user.email, displayName: user.displayName }}
        initialFamily={{ name: family?.name ?? "我的家", role: family?.role ?? "viewer" }}
      />
    </main>
  );
}
