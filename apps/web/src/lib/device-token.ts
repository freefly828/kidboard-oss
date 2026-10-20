/**
 * 设备配对令牌派生与鉴权工具 — docs/05 §2 + §3。
 * 服务端只持久化 device_token_hash，纯文本 token 仅在设备轮询 status 时成功下发一次。
 */

import { createHash, createHmac } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@kidboard/db";
import { devices } from "@kidboard/db/schema";
import { ApiError } from "./auth-guard";

const TOKEN_SECRET = process.env.SESSION_SECRET || "kidboard-device-token-secret-fallback-2026";

/** 6 位随机数字验证码 */
export function generatePairingCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 派生确定性 device token：仅在 claim 与首次 status 之间一致 */
export function deriveDeviceToken(hardwareId: string, deviceNonce: string, pairingId: string): string {
  const raw = createHmac("sha256", TOKEN_SECRET)
    .update(`${hardwareId}:${deviceNonce}:${pairingId}`)
    .digest("hex");
  return `kb_dev_${raw}`;
}

export interface AuthenticatedDevice {
  id: string;
  hardwareId: string;
  familyId: string | null;
  childId: string | null;
  name: string | null;
  syncIntervalSeconds: number;
  desiredFullRefresh: boolean;
}

/**
 * 校验 Device 请求的 Authorization 头：
 * 格式：`Authorization: Device <token>` 或 `Bearer <token>`
 */
export async function requireDevice(req: Request): Promise<AuthenticatedDevice> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) {
    throw new ApiError(401, "unauthorized", "Missing Authorization header");
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || (parts[0] !== "Device" && parts[0] !== "Bearer")) {
    throw new ApiError(401, "unauthorized", "Authorization format must be 'Device <token>'");
  }

  const token = parts[1];
  if (!token) {
    throw new ApiError(401, "unauthorized", "Missing token in Authorization header");
  }
  const tokenHash = hashString(token);

  const matched = await db
    .select({
      id: devices.id,
      hardwareId: devices.hardwareId,
      familyId: devices.familyId,
      childId: devices.childId,
      name: devices.name,
      syncIntervalSeconds: devices.syncIntervalSeconds,
      desiredFullRefresh: devices.desiredFullRefresh,
    })
    .from(devices)
    .where(and(eq(devices.deviceTokenHash, tokenHash), isNull(devices.revokedAt)))
    .limit(1);

  const dev = matched[0];
  if (!dev) {
    throw new ApiError(401, "unauthorized", "Invalid or revoked device token");
  }

  return dev;
}
