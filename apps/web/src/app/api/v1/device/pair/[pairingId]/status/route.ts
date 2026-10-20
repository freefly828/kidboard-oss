/**
 * 设备轮询配对状态 — docs/05 §2 Step D + openapi.yaml
 * GET /api/v1/device/pair/{pairingId}/status?nonce=...
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@kidboard/db";
import { pairingRequests } from "@kidboard/db/schema";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { deriveDeviceToken } from "@/lib/device-token";

export async function GET(
  req: Request,
  context: { params: Promise<{ pairingId: string }> },
) {
  try {
    const { pairingId } = await context.params;
    const { searchParams } = new URL(req.url);
    const nonce = searchParams.get("nonce");

    if (!nonce) {
      throw new ApiError(400, "missing_nonce", "Query param 'nonce' is required");
    }

    const rows = await db
      .select({
        id: pairingRequests.id,
        hardwareId: pairingRequests.hardwareId,
        deviceNonce: pairingRequests.deviceNonce,
        expiresAt: pairingRequests.expiresAt,
        claimedAt: pairingRequests.claimedAt,
        deviceId: pairingRequests.deviceId,
      })
      .from(pairingRequests)
      .where(eq(pairingRequests.id, pairingId))
      .limit(1);

    const pairReq = rows[0];
    if (!pairReq) {
      throw new ApiError(404, "pairing_not_found", "Pairing request not found");
    }

    if (pairReq.deviceNonce !== nonce) {
      throw new ApiError(403, "nonce_mismatch", "Device nonce does not match");
    }

    // 尚未被认领
    if (!pairReq.claimedAt) {
      if (pairReq.expiresAt <= new Date()) {
        return NextResponse.json({ status: "expired" });
      }
      return NextResponse.json({ status: "pending" });
    }

    // 已认领：token 仅下发一次（首次读取后将 expiresAt 设为过去）
    if (pairReq.expiresAt > new Date()) {
      const token = deriveDeviceToken(pairReq.hardwareId, pairReq.deviceNonce, pairReq.id);
      await db
        .update(pairingRequests)
        .set({ expiresAt: new Date(0) })
        .where(eq(pairingRequests.id, pairReq.id));

      return NextResponse.json({
        status: "paired",
        token,
        deviceId: pairReq.deviceId,
      });
    }

    // 已成功认领且 token 已获取过一次
    return NextResponse.json({
      status: "paired",
      deviceId: pairReq.deviceId,
    });
  } catch (err) {
    return jsonError(err);
  }
}
