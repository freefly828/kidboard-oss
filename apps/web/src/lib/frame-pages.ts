/**
 * D-018 附加页文件定位：{FRAMES_DIR}/{childId}/{frameVersion}/page{index}.bin / .png
 * （与 screen_frames.frame_path 同目录；frame_path 不可用时按 FRAMES_DIR 推算）
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function readPageFile(
  framePath: string,
  childId: string,
  frameVersion: number,
  index: number,
  ext: "bin" | "png",
): Promise<Buffer | null> {
  const name = `page${index}.${ext}`;
  const candidates = [
    resolve(dirname(framePath), name),
    resolve(process.env.FRAMES_DIR || "/tmp/kidboard-frames", childId, String(frameVersion), name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) return fsp.readFile(/*turbopackIgnore: true*/ p);
  }
  return null;
}
