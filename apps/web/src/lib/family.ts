/**
 * 家庭与邀请（D-012 / PRD F01："Owner 可邀请 Guardian"）。
 * 当前家庭 = getPrimaryFamily（优先自己是 owner 的家庭）。邀请码只在创建时返回一次，库中只存 hash。
 */

import { randomInt } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { db } from "@kidboard/db";
import { familyInvitations, familyMembers } from "@kidboard/db/schema";
import { ApiError, requireFamily, requireUser, type Role } from "./auth-guard";
import { getPrimaryFamily } from "./session";
import { hashString } from "./device-token";

export const INVITE_TTL_DAYS = 7;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉易混淆的 I/L/O/0/1

export async function requireCurrentFamily(minRole: Role = "viewer") {
  const user = await requireUser();
  const family = await getPrimaryFamily(user.id);
  if (!family) throw new ApiError(404, "no_family", "No family for user");
  const ctx = await requireFamily(family.id, minRole);
  return { ...ctx, family };
}

/** 8 位邀请码，展示为 XXXX-XXXX */
export function generateInviteCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 归一化用户输入（大小写、空格、横线）后求 hash */
export function hashInviteCode(code: string): string {
  return hashString(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
}

type Executor = Pick<typeof db, "select" | "insert" | "update">;

/**
 * 校验并消费邀请码，把用户加入对应家庭；已是成员则不改变角色。
 * 返回加入的 familyId。
 */
export async function acceptInvitation(tx: Executor, code: string, userId: string): Promise<string> {
  const inv = (
    await tx
      .select()
      .from(familyInvitations)
      .where(
        and(
          eq(familyInvitations.codeHash, hashInviteCode(code)),
          isNull(familyInvitations.acceptedAt),
          isNull(familyInvitations.revokedAt),
          gt(familyInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1)
  )[0];
  if (!inv) throw new ApiError(400, "invalid_invite", "邀请码无效、已使用或已过期");

  await tx
    .insert(familyMembers)
    .values({ familyId: inv.familyId, userId, role: inv.role })
    .onConflictDoNothing();
  await tx
    .update(familyInvitations)
    .set({ acceptedBy: userId, acceptedAt: new Date() })
    .where(eq(familyInvitations.id, inv.id));
  return inv.familyId;
}
