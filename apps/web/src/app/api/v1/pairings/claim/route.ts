/**
 * 用户认领设备配对码 — docs/05 §2 Step C + openapi.yaml
 * POST /api/v1/pairings/claim
 */

import { NextResponse } from "next/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@kidboard/db";
import { children, devices, pairingRequests } from "@kidboard/db/schema";
import { pairingClaimSchema } from "@/lib/schemas";
import { ApiError, jsonError, requireUser } from "@/lib/auth-guard";
import { getPrimaryFamily } from "@/lib/session";
import { deriveDeviceToken, hashString } from "@/lib/device-token";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const family = await getPrimaryFamily(user.id);
    if (!family) {
      throw new ApiError(404, "no_family", "User has no associated family");
    }
    if (family.role === "viewer") {
      throw new ApiError(403, "forbidden", "Viewer cannot claim device");
    }

    const body = pairingClaimSchema.parse(await req.json());

    // 校验 child 属于当前家庭
    const childRows = await db
      .select({ id: children.id })
      .from(children)
      .where(and(eq(children.id, body.childId), eq(children.familyId, family.id)))
      .limit(1);

    if (!childRows[0]) {
      throw new ApiError(404, "child_not_found", "Child not found in your family");
    }

    const codeHash = hashString(body.code);
    const now = new Date();

    // 寻找有效且未被领取的配对请求
    const requests = await db
      .select({
        id: pairingRequests.id,
        hardwareId: pairingRequests.hardwareId,
        deviceNonce: pairingRequests.deviceNonce,
        expiresAt: pairingRequests.expiresAt,
      })
      .from(pairingRequests)
      .where(
        and(
          eq(pairingRequests.codeHash, codeHash),
          isNull(pairingRequests.claimedAt),
          gt(pairingRequests.expiresAt, now),
        ),
      )
      .limit(1);

    const pairReq = requests[0];
    if (!pairReq) {
      throw new ApiError(409, "code_expired_or_invalid", "Code expired or already used");
    }

    // 派生该设备的专属 token 并哈希存库
    const deviceToken = deriveDeviceToken(pairReq.hardwareId, pairReq.deviceNonce, pairReq.id);
    const deviceTokenHash = hashString(deviceToken);

    // 查找对应设备记录
    const devRows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.hardwareId, pairReq.hardwareId))
      .limit(1);

    let deviceId = devRows[0]?.id;
    if (!deviceId) {
      const [newDev] = await db
        .insert(devices)
        .values({
          hardwareId: pairReq.hardwareId,
          familyId: family.id,
          childId: body.childId,
          name: body.deviceName,
          deviceTokenHash,
        })
        .returning({ id: devices.id });
      deviceId = newDev!.id;
    } else {
      await db
        .update(devices)
        .set({
          familyId: family.id,
          childId: body.childId,
          name: body.deviceName,
          deviceTokenHash,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(devices.id, deviceId));
    }

    // 标记配对请求已认领
    await db
      .update(pairingRequests)
      .set({
        claimedAt: now,
        claimedBy: user.id,
        deviceId,
      })
      .where(eq(pairingRequests.id, pairReq.id));

    return NextResponse.json({ status: "claimed" });
  } catch (err) {
    return jsonError(err);
  }
}
