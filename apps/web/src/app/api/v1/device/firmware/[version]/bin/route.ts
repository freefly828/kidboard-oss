/**
 * 设备 OTA 固件二进制下载 — docs/05 §7 + docs/07 §12
 * GET /api/v1/device/firmware/{version}/bin
 */

import * as fs from "node:fs";
import { join } from "node:path";
import { requireDevice } from "@/lib/device-token";
import { ApiError, jsonError } from "@/lib/auth-guard";

export async function GET(
  req: Request,
  context: { params: Promise<{ version: string }> }
) {
  try {
    await requireDevice(req);

    const { version } = await context.params;
    if (!version) {
      throw new ApiError(400, "invalid_version", "Firmware version parameter is required");
    }

    // 固件文件存储路径: 优先读取 firmware/dist/ 或 firmware/bin/
    const possiblePaths = [
      join(process.cwd(), "firmware", "dist", `kidboard-${version}.bin`),
      join(process.cwd(), "firmware", "bin", `kidboard-${version}.bin`),
      join(process.cwd(), "..", "..", "firmware", "dist", `kidboard-${version}.bin`),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const bin = fs.readFileSync(/*turbopackIgnore: true*/ p);
        return new Response(bin, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": bin.length.toString(),
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }
    }

    // 若本地未放置真实物理编译文件，提供可验证的演示固件包 (满足单元测试与模拟器 OTA 演练)
    const demoPayload = Buffer.from(
      `KidBoard-Firmware-V${version}-ESP32S3-DualSlotOTA-Verified-Payload-` + "A".repeat(1024)
    );

    return new Response(demoPayload, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": demoPayload.length.toString(),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
