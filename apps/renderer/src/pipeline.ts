/**
 * Render job 处理管线（单任务）— 从抢到的 job 到 active frame 落地。
 *
 * 流程（docs/03 §3 renderer / docs/06 §4）：
 *   1. 读 child（含 timezone）→ 组装 ScreenViewModel
 *   2. 重新核对 content_version：已有更新 job 则本 job 标记 superseded（docs/03 §5）
 *   3. 渲染 HTML → Playwright 800×480 截图
 *   4. PNG → RGBA → 灰阶 → 阈值二值化 → 48,000 byte frame.bin
 *   5. SHA-256
 *   6. 与 active 帧比 XOR → dirty area / changed_ratio
 *   7. 原子落盘 frame.bin + preview.png + meta.json
 *   8. DB 事务写 screen_frames + active 原子切换
 *
 * 失败语义（B04）：任一步抛错 → 旧 active frame 保持不变（因为新帧只在第 8 步才生效），
 * job 由调用方标记失败并重试。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser } from "playwright-core";
import {
  assertFrameSize,
  binarizeToFrame,
  computeDirtyArea,
  DEFAULT_THRESHOLD,
  FRAME_BYTES,
  FRAME_HEIGHT,
  FRAME_WIDTH,
} from "@kidboard/screen-template";
import { buildPageData, buildViewModel, loadChild } from "./buildVm.js";
import { renderExtraPageHtml } from "./renderPages.js";
import { PAGE_COUNT, PAGE_ORDER } from "@kidboard/screen-template/pages";
import type { PageFrame } from "./storage.js";
import {
  isJobStale,
  markJobSuperseded,
  type ClaimedJob,
} from "./jobs.js";
import { decodePngToRawImage } from "./png.js";
import { renderScreenHtml } from "./renderPage.js";
import { screenshotHtml, type ScreenshotOptions } from "./screenshot.js";
import {
  commitFrame,
  loadActiveFrame,
  persistFrameFiles,
  peekNextFrameVersion,
} from "./storage.js";

export interface RenderOptions {
  framesDir: string;
  threshold?: number;
  screenshot?: ScreenshotOptions;
  /** 注入当前时间（测试用；生产不传，走系统时钟） */
  now?: Date;
}

export interface RenderOutcome {
  jobId: string;
  childId: string;
  status: "succeeded" | "superseded";
  frameVersion?: number;
  contentVersion?: number;
  sha256?: string;
  frameBytes?: number;
  pngBytes?: number;
  changedPixels?: number;
  changedRatio?: number;
  dirtyRect?: { x: number; y: number; width: number; height: number } | null;
  reusedExisting?: boolean;
  durationMs: number;
  reason?: string;
}

/**
 * 处理单个 job。抛错表示失败（调用方负责 markJobFailed / 重试）。
 */
export async function renderJob(
  browser: Browser,
  job: ClaimedJob,
  options: RenderOptions,
): Promise<RenderOutcome> {
  const started = Date.now();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const framesDir = options.framesDir;
  if (!framesDir) {
    throw new Error("framesDir is required (set FRAMES_DIR)");
  }

  // --- 1. 组装 VM ---
  const child = await loadChild(job.childId);

  // --- 2. stale 判定：已有更新的 queued/running job 则本 job 直接 superseded ---
  if (await isJobStale(job.childId, job.requestedContentVersion)) {
    await markJobSuperseded(job.id);
    return {
      jobId: job.id,
      childId: job.childId,
      status: "superseded",
      durationMs: Date.now() - started,
      reason: `newer render job exists (requestedContentVersion=${job.requestedContentVersion}, child.contentVersion=${child.contentVersion})`,
    };
  }

  const { vm, today } = await buildViewModel(child, { now: options.now });

  // --- 3. 截图 ---
  const html = renderScreenHtml(vm);
  const { png } = await screenshotHtml(browser, html, options.screenshot);
  const img = decodePngToRawImage(png);
  if (img.width !== FRAME_WIDTH || img.height !== FRAME_HEIGHT) {
    throw new Error(
      `screenshot is ${img.width}x${img.height}, expected ${FRAME_WIDTH}x${FRAME_HEIGHT}`,
    );
  }

  // --- 4. 二值化打包 ---
  const frame = binarizeToFrame(img, threshold);
  assertFrameSize(frame);
  if (frame.length !== FRAME_BYTES) {
    throw new Error(`frame must be ${FRAME_BYTES} bytes, got ${frame.length}`);
  }

  // --- 5. SHA-256 ---
  const sha256 = createHash("sha256").update(frame).digest("hex");

  // --- 5b. D-018 附加页：同一 job 内渲染，各自独立的 48,000 字节帧 ---
  const pageData = await buildPageData(child, today);
  const pages: PageFrame[] = [];
  for (const [i, kind] of PAGE_ORDER.entries()) {
    const index = i + 1;
    const shot = await screenshotHtml(browser, renderExtraPageHtml(kind, vm, pageData, index, PAGE_COUNT), options.screenshot);
    const pageFrame = binarizeToFrame(decodePngToRawImage(shot.png), threshold);
    assertFrameSize(pageFrame);
    pages.push({ index, frame: pageFrame, png: shot.png, sha256: createHash("sha256").update(pageFrame).digest("hex") });
  }

  // --- 6. dirty area（与当前 active 帧比较） ---
  const active = await loadActiveFrame(job.childId);
  let changedPixels = FRAME_WIDTH * FRAME_HEIGHT;
  let changedRatio = 1;
  let dirtyRect: { x: number; y: number; width: number; height: number } | null = null;
  if (active) {
    try {
      const previous = new Uint8Array(await readFile(active.framePath));
      if (previous.length === FRAME_BYTES) {
        const d = computeDirtyArea(previous, frame);
        changedPixels = d.changedPixels;
        changedRatio = d.changedRatio;
        dirtyRect = d.dirtyRect;
      }
    } catch {
      // active 帧文件缺失（历史异常/清理）：退化为"整屏变化"，不阻断渲染
      dirtyRect = { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT };
    }
  }

  // --- 7. 原子落盘 ---
  const predictedVersion = await peekNextFrameVersion(job.childId);
  const paths = await persistFrameFiles(
    {
      childId: job.childId,
      contentVersion: child.contentVersion,
      framesDir,
      frame,
      previewPng: png,
      sha256,
      threshold,
      changedPixels,
      changedRatio,
      dirtyRect,
      renderedForDate: today,
      pages,
    },
    predictedVersion,
  );

  // --- 8. DB 事务提交（含 active 原子切换） ---
  const stored = await commitFrame({
    childId: job.childId,
    contentVersion: child.contentVersion,
    framesDir,
    frame,
    previewPng: png,
    sha256,
    threshold,
    changedPixels,
    changedRatio,
    dirtyRect,
    renderedForDate: today,
    pages,
    framePath: paths.framePath,
    previewPath: paths.previewPath,
  });

  return {
    jobId: job.id,
    childId: job.childId,
    status: "succeeded",
    frameVersion: stored.frameVersion,
    contentVersion: child.contentVersion,
    sha256,
    frameBytes: frame.length,
    pngBytes: png.length,
    changedPixels,
    changedRatio,
    dirtyRect,
    reusedExisting: stored.reusedExisting,
    durationMs: Date.now() - started,
  };
}
