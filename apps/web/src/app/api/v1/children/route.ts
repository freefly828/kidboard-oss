/**
 * 儿童档案 API — PRD F02。
 * GET    /api/v1/children          列出本家庭儿童
 * POST   /api/v1/children          新建（guardian+）
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children } from "@kidboard/db/schema";
import { childCreateSchema } from "@/lib/schemas";
import { jsonError, requireUser, ApiError } from "@/lib/auth-guard";
import { getPrimaryFamily } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireUser();
    const family = await getPrimaryFamily(user.id);
    if (!family) throw new ApiError(404, "no_family", "No family for user");
    const rows = await db
      .select({
        id: children.id,
        displayName: children.displayName,
        timezone: children.timezone,
        screenLayout: children.screenLayout,
        contentVersion: children.contentVersion,
        profile: children.profile,
        previewFrom: children.previewFrom,
        focusMinutes: children.focusMinutes,
        focusPoints: children.focusPoints,
        focusDailyCap: children.focusDailyCap,
        createdAt: children.createdAt,
      })
      .from(children)
      .where(eq(children.familyId, family.id));
    return NextResponse.json({ children: rows });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const family = await getPrimaryFamily(user.id);
    if (!family) throw new ApiError(404, "no_family", "No family for user");
    if (family.role === "viewer") {
      throw new ApiError(403, "forbidden", "Viewer cannot create child");
    }
    const body = childCreateSchema.parse(await req.json());
    const [child] = await db
      .insert(children)
      .values({
        familyId: family.id,
        displayName: body.displayName,
        timezone: body.timezone,
      })
      .returning();
    return NextResponse.json(
      {
        child: {
          id: child!.id,
          displayName: child!.displayName,
          timezone: child!.timezone,
          screenLayout: child!.screenLayout,
          contentVersion: child!.contentVersion,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
