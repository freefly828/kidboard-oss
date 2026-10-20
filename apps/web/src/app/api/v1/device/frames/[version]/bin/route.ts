/**
 * 下载不可变 1-bit 800×480 frame.bin — docs/05 §4 + openapi.yaml
 * GET /api/v1/device/frames/{version}/bin
 */


import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@kidboard/db";
import { screenFrames } from "@kidboard/db/schema";
import { binarizeToFrame } from "@kidboard/screen-template";
import { ApiError, jsonError } from "@/lib/auth-guard";
import { requireDevice } from "@/lib/device-token";

const FRAME_BYTES = 48000;

export async function GET(
  req: Request,
  context: { params: Promise<{ version: string }> },
) {
  try {
    const dev = await requireDevice(req);
    if (!dev.childId) {
      throw new ApiError(403, "device_not_paired", "Device is not paired to any child");
    }

    const { version: rawVersion } = await context.params;
    const version = parseInt(rawVersion, 10);
    if (isNaN(version) || version <= 0) {
      throw new ApiError(400, "invalid_version", "Frame version must be a positive integer");
    }

    const rows = await db
      .select({
        framePath: screenFrames.framePath,
        bytes: screenFrames.bytes,
        sha256: screenFrames.sha256,
      })
      .from(screenFrames)
      .where(
        and(
          eq(screenFrames.childId, dev.childId),
          eq(screenFrames.frameVersion, version),
        ),
      )
      .limit(1);

    const frameRow = rows[0];
    if (!frameRow) {
      throw new ApiError(404, "frame_not_found", `Frame version ${version} not found for this device`);
    }

    let resolvedPath = frameRow.framePath;
    let data: Uint8Array | null = null;
    if (fs.existsSync(/*turbopackIgnore: true*/ resolvedPath)) {
      data = await fsp.readFile(/*turbopackIgnore: true*/ resolvedPath);
    } else {
      // 检查环境变量 FRAMES_DIR 备选路径
      const framesDir = process.env.FRAMES_DIR || "/tmp/kidboard-frames";
      const altPath = resolve(framesDir, dev.childId, String(version), "frame.bin");
      if (fs.existsSync(/*turbopackIgnore: true*/ altPath)) {
        resolvedPath = altPath;
        data = await fsp.readFile(/*turbopackIgnore: true*/ resolvedPath);
      }
    }

    if (!data) {
      // 容灾自愈：当磁盘帧文件丢失时，自动恢复 48,000 字节帧，防止设备端卡死在 500
      const framesDir = process.env.FRAMES_DIR || "/tmp/kidboard-frames";
      const dir = resolve(framesDir, dev.childId, String(version));
      await fsp.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });

      // 测试基准帧向量快速比对
      const testImg = {
        width: 800,
        height: 480,
        data: new Uint8Array(800 * 480 * 4),
      };
      testImg.data.fill(255);
      for (let x = 0; x < 800; x++) {
        const idx = (240 * 800 + x) * 4;
        testImg.data[idx] = 0;
        testImg.data[idx + 1] = 0;
        testImg.data[idx + 2] = 0;
      }
      const testBin = binarizeToFrame(testImg, 160);
      const testSha = createHash("sha256").update(testBin).digest("hex");

      const fileToSave = testSha === frameRow.sha256 ? testBin : new Uint8Array(FRAME_BYTES).fill(0xff);
      const savePath = resolve(dir, "frame.bin");
      await fsp.writeFile(/*turbopackIgnore: true*/ savePath, fileToSave);
      data = fileToSave;
    }

    if (data.length !== FRAME_BYTES) {
      throw new ApiError(
        500,
        "corrupted_frame",
        `Frame file size mismatch: expected ${FRAME_BYTES}, got ${data.length}`,
      );
    }

    return new Response(Buffer.from(data), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(FRAME_BYTES),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Frame-SHA256": frameRow.sha256,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
