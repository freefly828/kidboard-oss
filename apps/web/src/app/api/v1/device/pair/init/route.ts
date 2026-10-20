/**
 * 设备配对初始化 — docs/05 §2 Step B + openapi.yaml
 * POST /api/v1/device/pair/init
 */

import { NextResponse } from "next/server";

import { db } from "@kidboard/db";
import { devices, pairingRequests } from "@kidboard/db/schema";
import { devicePairInitSchema } from "@/lib/schemas";
import { jsonError } from "@/lib/auth-guard";
import { generatePairingCode, hashString } from "@/lib/device-token";

export async function POST(req: Request) {
  try {
    const body = devicePairInitSchema.parse(await req.json());

    // 确保 devices 表有该硬件记录
    await db
      .insert(devices)
      .values({
        hardwareId: body.hardwareId,
        firmwareVersion: body.firmwareVersion,
      })
      .onConflictDoUpdate({
        target: devices.hardwareId,
        set: {
          firmwareVersion: body.firmwareVersion,
          updatedAt: new Date(),
        },
      });

    const code = generatePairingCode();
    const codeHash = hashString(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 分钟有效期

    const [inserted] = await db
      .insert(pairingRequests)
      .values({
        hardwareId: body.hardwareId,
        deviceNonce: body.deviceNonce,
        codeHash,
        expiresAt,
      })
      .returning({ id: pairingRequests.id });

    return NextResponse.json({
      pairingId: inserted!.id,
      code,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
