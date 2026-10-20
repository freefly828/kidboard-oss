/**
 * 帧存储与 screen_frames 写入（docs/03 §3 frame storage、docs/06 §6）。
 *
 * 落盘约定（FRAMES_DIR 下，按 child 分目录）：
 *   {FRAMES_DIR}/{childId}/{frameVersion}/frame.bin
 *   {FRAMES_DIR}/{childId}/{frameVersion}/preview.png
 *   {FRAMES_DIR}/{childId}/{frameVersion}/meta.json
 *
 * DB 写盘顺序（B04 失败保护的关键）：
 *   1. 先写文件系统（原子 rename：临时目录 → 正式目录）；
 *   2. 再在单个事务内：分配 frame_version → 切换 active → 插入 screen_frames 行。
 *
 * 为什么先落盘再写库：若先写库再落盘，崩溃会留下"可下载但文件不存在"的 active frame，
 * 设备会拿到 404/空文件；反之只会留下未被引用的孤儿文件，可安全清理。
 *
 * active 切换与 uq_active_frame_per_child 唯一索引配合：
 * 同一事务内先 set is_active=false 再 insert/update is_active=true，
 * 保证任意时刻每个 child 至多一行 active，且不会出现"两个 active"。
 */

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Sql } from "postgres";
import { client } from "@kidboard/db";
import { FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "@kidboard/screen-template";

export interface FrameMeta {
  width: number;
  height: number;
  bytes: number;
  threshold: number;
  sha256: string;
  contentVersion: number;
  frameVersion: number;
  /** docs/06 §7 附加的诊断信息 */
  changedPixels?: number;
  changedRatio?: number | null;
  dirtyRect?: { x: number; y: number; width: number; height: number } | null;
  /** 渲染目标日期（child timezone 的"今天"） */
  renderedForDate?: string;
  createdAt?: string;
}

/** D-018 附加页（页号从 1 开始） */
export interface PageFrame {
  index: number;
  frame: Uint8Array;
  png: Buffer;
  sha256: string;
}

/** screen_frames.pages 中每页的记录 */
export interface PageMeta {
  index: number;
  sha256: string;
  bytes: number;
}

export function pagesMetaOf(pages: PageFrame[] | undefined): PageMeta[] {
  return (pages ?? []).map((p) => ({ index: p.index, sha256: p.sha256, bytes: p.frame.length }));
}

/** 两组页是否完全一致（页数与每页 SHA） */
export function samePages(a: PageMeta[], b: PageMeta[]): boolean {
  if (a.length !== b.length) return false;
  const key = (x: PageMeta[]) => [...x].sort((p, q) => p.index - q.index).map((p) => `${p.index}:${p.sha256}`).join(",");
  return key(a) === key(b);
}

export interface StoreFrameInput {
  childId: string;
  contentVersion: number;
  framesDir: string;
  frame: Uint8Array;
  previewPng: Buffer;
  sha256: string;
  threshold: number;
  changedPixels: number;
  changedRatio: number;
  dirtyRect: { x: number; y: number; width: number; height: number } | null;
  renderedForDate: string;
  /** D-018 附加页 */
  pages?: PageFrame[];
}

export interface StoredFrame {
  id: string;
  frameVersion: number;
  framePath: string;
  previewPath: string;
  metaPath: string;
  sha256: string;
}

export class FrameSinkError extends Error {}

function assertPayload(frame: Uint8Array, previewPng: Buffer): void {
  if (frame.length !== FRAME_BYTES) {
    throw new FrameSinkError(
      `frame must be exactly ${FRAME_BYTES} bytes, got ${frame.length}`,
    );
  }
  if (previewPng.length === 0) {
    throw new FrameSinkError("preview PNG is empty");
  }
}

/**
 * 第 1 步：原子落盘（临时目录 → rename），返回最终目录路径。
 * rename 在同一文件系统内是原子的，避免设备读到半个文件。
 */
export async function persistFrameFiles(
  input: Omit<StoreFrameInput, "contentVersion"> & { contentVersion: number },
  frameVersion: number,
): Promise<{ dir: string; framePath: string; previewPath: string; metaPath: string }> {
  const { framesDir, childId } = input;
  assertPayload(input.frame, input.previewPng);

  const childDir = join(framesDir, childId);
  const finalDir = join(childDir, String(frameVersion));
  const tmpDir = join(childDir, `.tmp-${frameVersion}-${process.pid}-${Date.now()}`);

  const meta: FrameMeta = {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    bytes: FRAME_BYTES,
    threshold: input.threshold,
    sha256: input.sha256,
    contentVersion: input.contentVersion,
    frameVersion,
    changedPixels: input.changedPixels,
    changedRatio: input.changedRatio,
    dirtyRect: input.dirtyRect,
    renderedForDate: input.renderedForDate,
    createdAt: new Date().toISOString(),
  };

  await mkdir(tmpDir, { recursive: true });
  try {
    await writeFile(join(tmpDir, "frame.bin"), input.frame);
    await writeFile(join(tmpDir, "preview.png"), input.previewPng);
    await writeFile(join(tmpDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    for (const p of input.pages ?? []) {
      if (p.frame.length !== FRAME_BYTES) throw new FrameSinkError(`page ${p.index} must be ${FRAME_BYTES} bytes`);
      await writeFile(join(tmpDir, `page${p.index}.bin`), p.frame);
      await writeFile(join(tmpDir, `page${p.index}.png`), p.png);
    }
    // 目标目录若已存在（同 frame_version 重放），先移除再 rename
    await rm(finalDir, { recursive: true, force: true });
    await mkdir(dirname(finalDir), { recursive: true });
    await rename(tmpDir, finalDir);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return {
    dir: finalDir,
    framePath: join(finalDir, "frame.bin"),
    previewPath: join(finalDir, "preview.png"),
    metaPath: join(finalDir, "meta.json"),
  };
}

/**
 * 第 2 步：DB 事务 — 分配 frame_version + 原子切换 active + 插入行。
 *
 * frame_version = 该 child 当前最大 frame_version + 1（事务内计算，配合
 * UNIQUE(child_id, frame_version) 兜底并发）。
 *
 * 若当前 active 帧的 sha256 与本帧相同（内容无变化），则不产生新帧版本，
 * 直接复用 active 帧 —— 这保证 docs/09 D03「不变不刷新」不会被无意义的新版本破坏。
 */
export async function commitFrame(
  input: StoreFrameInput & { framePath: string; previewPath: string },
  dbClient: Sql = client,
): Promise<StoredFrame & { reusedExisting: boolean }> {
  return dbClient.begin(async (tx) => {
    const childRows = await tx`
      SELECT id, content_version FROM children WHERE id = ${input.childId} FOR UPDATE
    `;
    const child = childRows[0] as Record<string, unknown> | undefined;
    if (!child) throw new FrameSinkError(`child not found: ${input.childId}`);

    const activeRows = await tx`
      SELECT id, frame_version, sha256, frame_path, preview_path, pages
        FROM screen_frames
       WHERE child_id = ${input.childId} AND is_active = true
       LIMIT 1
    `;
    const active = activeRows[0] as Record<string, unknown> | undefined;
    const pagesMeta = pagesMetaOf(input.pages);

    // 内容完全一致（首页与各附加页）：复用已有帧，不推进 frame_version（docs/09 D03 不变不刷新）
    if (active && String(active.sha256) === input.sha256 && samePages((active.pages as PageMeta[] | null) ?? [], pagesMeta)) {
      return {
        id: String(active.id),
        frameVersion: Number(active.frame_version),
        framePath: String(active.frame_path),
        previewPath: String(active.preview_path),
        metaPath: join(dirname(String(active.frame_path)), "meta.json"),
        sha256: input.sha256,
        reusedExisting: true,
      };
    }

    const versionRows = await tx`
      SELECT COALESCE(MAX(frame_version), 0) + 1 AS next FROM screen_frames WHERE child_id = ${input.childId}
    `;
    const frameVersion = Number((versionRows[0] as { next: unknown }).next);

    // 先取消旧 active（满足 uq_active_frame_per_child）
    await tx`
      UPDATE screen_frames SET is_active = false
       WHERE child_id = ${input.childId} AND is_active = true
    `;

    const inserted = await tx`
      INSERT INTO screen_frames (
        child_id, frame_version, content_version, width, height, bytes, sha256,
        preview_path, frame_path, changed_ratio, dirty_rect, is_active, pages
      ) VALUES (
        ${input.childId}, ${frameVersion}, ${input.contentVersion},
        ${SCREEN_WIDTH}, ${SCREEN_HEIGHT}, ${FRAME_BYTES}, ${input.sha256},
        ${input.previewPath}, ${input.framePath}, ${input.changedRatio},
        ${JSON.stringify(input.dirtyRect)}::jsonb, true, ${JSON.stringify(pagesMeta)}::jsonb
      )
      RETURNING id
    `;

    return {
      id: String((inserted[0] as { id: unknown }).id),
      frameVersion,
      framePath: input.framePath,
      previewPath: input.previewPath,
      metaPath: join(dirname(input.framePath), "meta.json"),
      sha256: input.sha256,
      reusedExisting: false,
    };
  }) as Promise<StoredFrame & { reusedExisting: boolean }>;
}

/** 读取当前 active 帧（计算 dirty area 的基准） */
export async function loadActiveFrame(
  childId: string,
  dbClient: Sql = client,
): Promise<{ frameVersion: number; contentVersion: number; sha256: string; framePath: string; dirtyRect: unknown } | null> {
  const rows = await dbClient`
    SELECT frame_version, content_version, sha256, frame_path, dirty_rect
      FROM screen_frames
     WHERE child_id = ${childId} AND is_active = true
     LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    frameVersion: Number(row.frame_version),
    contentVersion: Number(row.content_version),
    sha256: String(row.sha256),
    framePath: String(row.frame_path),
    dirtyRect: row.dirty_rect,
  };
}

/** 供 worker 落盘前计算 frame_version 预估（仅日志用；权威值由 commitFrame 事务内分配） */
export async function peekNextFrameVersion(
  childId: string,
  dbClient: Sql = client,
): Promise<number> {
  const rows = await dbClient`
    SELECT COALESCE(MAX(frame_version), 0) + 1 AS next FROM screen_frames WHERE child_id = ${childId}
  `;
  return Number((rows[0] as { next: unknown }).next);
}
