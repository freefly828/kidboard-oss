/**
 * /board — Web/H5 看板入口：只有一个孩子时直接进入，多个时列出供选择。
 * 仅列出当前登录用户所属家庭的孩子（docs/08 §2）。
 */

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, familyMembers } from "@kidboard/db/schema";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BoardIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/board");

  const rows = await db
    .select({ id: children.id, displayName: children.displayName })
    .from(children)
    .innerJoin(familyMembers, eq(familyMembers.familyId, children.familyId))
    .where(eq(familyMembers.userId, user.id));

  if (rows.length === 1) redirect(`/board/${rows[0]!.id}`);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 16,
        background: "#f4f2ec",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 480, margin: "40px auto 0" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>选择要查看的孩子</h1>
        {rows.length === 0 ? (
          <p style={{ color: "#6b7280" }}>
            还没有孩子档案，请先在<a href="/">家长后台</a>创建。
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((c) => (
              <li key={c.id} style={{ marginBottom: 10 }}>
                <a
                  href={`/board/${c.id}`}
                  style={{
                    display: "block",
                    padding: "16px 18px",
                    background: "#fff",
                    border: "1px solid #e5e2d9",
                    borderRadius: 14,
                    color: "#1f2328",
                    fontSize: 18,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {c.displayName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
