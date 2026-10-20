/**
 * 端到端渲染集成测试（真实 PostgreSQL + 真实 Chromium）。
 *
 * 覆盖：
 * - B01：frame.bin 恰好 48,000 bytes、PNG 800×480、meta.json 契约字段
 * - B04 失败保护：渲染失败时旧 active frame 不变、新 job 标记 failed
 * - active frame 原子切换 + uq_active_frame_per_child 单 active 约束
 * - 落盘布局（frame.bin/preview.png/meta.json）与 DB 路径一致
 * - content_version 不变时不推进 frame_version（不变不刷新）
 * - dirty area 写入且 x 8 像素对齐
 *
 * 需要 DATABASE_URL（已应用 schema）与可用 Chromium；否则整组跳过。
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { client } from "@kidboard/db";
import {
  assertFrameSize,
  decodeFrameToGray,
  FRAME_BYTES,
} from "@kidboard/screen-template";
import { claimNextJob, getJob, markJobFailed } from "../src/jobs";
import { renderJob } from "../src/pipeline";
import { decodePngToRawImage } from "../src/png";
import { parkForeignJobs } from "../src/helpers/parkForeignJobs";
import { launchBrowser } from "../src/screenshot";

const DATABASE_URL = process.env.DATABASE_URL;
const dbEnabled = Boolean(DATABASE_URL);

let browser: Browser | undefined;
let framesDir = "";
let familyId = "";
let childId = "";
let today = "";
let restoreForeignJobs: (() => Promise<void>) | undefined;

/**
 * Chromium 可用性必须在模块加载期确定：describe.skipIf 会在 beforeAll 之前求值，
 * 若在 beforeAll 里才设 browser，整组测试会被静默跳过（这正是要避免的"假装 PASS"）。
 */
let browserProbe: Browser | undefined;
let browserReason = "";
try {
  browserProbe = await launchBrowser({ launchArgs: ["--no-sandbox"] });
} catch (err) {
  browserReason = err instanceof Error ? err.message : String(err);
}
const chromEnabled = Boolean(browserProbe);
if (!chromEnabled) {
  console.warn(`[e2e render tests SKIPPED] Chromium unavailable: ${browserReason}`);
}
if (!dbEnabled) {
  console.warn("[e2e render tests SKIPPED] DATABASE_URL not set");
}
const enabled = dbEnabled && chromEnabled;

beforeAll(async () => {
  if (!enabled) return;
  browser = browserProbe;
  framesDir = await mkdtemp(join(tmpdir(), "kidboard-frames-"));

  const f = await client`
    INSERT INTO families (name) VALUES (${`e2e-render-${Date.now()}`}) RETURNING id
  `;
  familyId = String(f[0]!.id);
  const c = await client`
    INSERT INTO children (family_id, display_name, timezone)
    VALUES (${familyId}, '端到端娃', 'Asia/Shanghai') RETURNING id
  `;
  childId = String(c[0]!.id);
  // 共享测试库可能残留其它可抢占 job，先停放，保证 claimNextJob 抢到的是本用例的 job
  restoreForeignJobs = await parkForeignJobs(client, [childId]);

  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const isoWeekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;

  // 铺数据：今日课程 + 今天物化的任务 + 留言
  await client`
    INSERT INTO weekly_schedule_items (child_id, weekday, start_minute, end_minute, title)
    VALUES (${childId}, ${isoWeekday}, 500, 550, '数学'), (${childId}, ${isoWeekday}, 560, 610, '语文')
  `;
  await client`
    INSERT INTO task_occurrences (child_id, occurrence_date, title, estimated_minutes, sort_order, status)
    VALUES (${childId}, ${today}, '晨读', 15, 0, 'pending'),
           (${childId}, ${today}, '整理书包', NULL, 1, 'pending')
  `;
  await client`
    INSERT INTO messages (child_id, message_date, body, active)
    VALUES (${childId}, ${today}, '端到端渲染测试留言。', true)
  `;
});

afterAll(async () => {
  if (restoreForeignJobs) await restoreForeignJobs().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (familyId) await client`DELETE FROM families WHERE id = ${familyId}`.catch(() => {});
  if (framesDir) await rm(framesDir, { recursive: true, force: true }).catch(() => {});
});

const d = describe.skipIf(!enabled);

d("端到端渲染管线（B01 / B04 / 帧版本）", () => {
  async function resetActive() {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE child_id = ${childId}`;
    await client`DELETE FROM screen_frames WHERE child_id = ${childId}`;
  }

  async function enqueueAndClaim(contentVersion: number) {
    await client`
      INSERT INTO render_jobs (child_id, requested_content_version)
      VALUES (${childId}, ${contentVersion})
    `;
    const job = await claimNextJob();
    if (!job) throw new Error("expected a claimable job");
    return job;
  }

  it("B01：frame.bin 恰好 48,000 bytes，PNG 800×480，meta.json 契约字段完整", async () => {
    await resetActive();
    const job = await enqueueAndClaim(1);
    const outcome = await renderJob(browser!, job, { framesDir });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.frameBytes).toBe(48_000);

    const row = (
      await client`
        SELECT frame_version, content_version, width, height, bytes, sha256, frame_path, preview_path, is_active
          FROM screen_frames WHERE child_id = ${childId} AND is_active = true
      `
    )[0]!;
    expect(Number(row.width)).toBe(800);
    expect(Number(row.height)).toBe(480);
    expect(Number(row.bytes)).toBe(48_000);
    expect(String(row.sha256)).toHaveLength(64);
    expect(row.is_active).toBe(true);

    // 文件真实存在且大小精确
    const framePath = String(row.frame_path);
    const previewPath = String(row.preview_path);
    const frameBin = await readFile(framePath);
    expect(frameBin.length).toBe(FRAME_BYTES);
    assertFrameSize(new Uint8Array(frameBin));

    // SHA-256 与 DB 记录一致（设备侧校验依据）
    expect(createHash("sha256").update(frameBin).digest("hex")).toBe(String(row.sha256));

    // preview.png 必须是 800×480
    const previewPng = await readFile(previewPath);
    const img = decodePngToRawImage(previewPng);
    expect(img.width).toBe(800);
    expect(img.height).toBe(480);

    // meta.json 契约字段（docs/06 §6）
    const meta = JSON.parse(await readFile(join(framePath, "..", "meta.json"), "utf8"));
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(480);
    expect(meta.bytes).toBe(48000);
    expect(meta.threshold).toBe(160);
    expect(meta.sha256).toBe(String(row.sha256));
    expect(meta.contentVersion).toBe(Number(row.content_version));
    expect(meta.frameVersion).toBe(Number(row.frame_version));
    expect(meta.renderedForDate).toBe(today);
  });

  it("渲染结果包含业务内容（不是空白帧），中文正常绘制", async () => {
    await resetActive();
    const job = await enqueueAndClaim(1);
    await renderJob(browser!, job, { framesDir });

    const row = (
      await client`SELECT frame_path FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
    )[0]!;
    const frame = new Uint8Array(await readFile(String(row.frame_path)));

    // 至少应有分栏标题/中文/边框的墨点
    let black = 0;
    for (const byte of frame) {
      let v = byte ^ 0xff;
      while (v) {
        v &= v - 1;
        black++;
      }
    }
    expect(black).toBeGreaterThan(5000);

    // 解码确认是有效的 1-bit 帧
    const gray = decodeFrameToGray(frame);
    expect(gray.length).toBe(800 * 480);
  });

  it("active frame 原子切换：始终只有一行 active，frame_version 单调递增", async () => {
    await resetActive();
    await renderJob(browser!, await enqueueAndClaim(1), { framesDir });

    // 改动内容 → content_version+1 → 再渲染
    await client`UPDATE task_occurrences SET title = '晨读（已更新）' WHERE child_id = ${childId} AND title = '晨读'`;
    await renderJob(browser!, await enqueueAndClaim(2), { framesDir });

    const actives = await client`
      SELECT frame_version FROM screen_frames WHERE child_id = ${childId} AND is_active = true
    `;
    expect(actives.length).toBe(1);
    expect(Number(actives[0]!.frame_version)).toBe(2);

    const total = await client`
      SELECT COUNT(*)::int AS n, MAX(frame_version)::int AS maxv FROM screen_frames WHERE child_id = ${childId}
    `;
    expect(Number(total[0]!.n)).toBe(2); // 历史帧保留
    expect(Number(total[0]!.maxv)).toBe(2);

    // 复位标题，避免污染后续测试（测试隔离，非产品行为）
    await client`UPDATE task_occurrences SET title = '晨读' WHERE child_id = ${childId} AND title = '晨读（已更新）'`;
  });

  it("内容无变化：不推进 frame_version，复用 active 帧", async () => {
    await resetActive();
    await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    const first = (
      await client`SELECT frame_version, sha256 FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
    )[0]!;

    // 同样的内容再渲染一次
    const outcome = await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.reusedExisting).toBe(true);

    const rows = await client`
      SELECT frame_version, sha256, is_active FROM screen_frames WHERE child_id = ${childId}
    `;
    expect(rows.length).toBe(1); // 没有新增帧行
    expect(Number(rows[0]!.frame_version)).toBe(Number(first.frame_version));
    expect(String(rows[0]!.sha256)).toBe(String(first.sha256));
    expect(rows[0]!.is_active).toBe(true);
  });

  it("dirty area：相对上一帧计算，changed_ratio 合理且 dirty_rect 的 x 8 像素对齐", async () => {
    await resetActive();

    // 前置：确保任务标题处于基线状态。前面的测试会把 '晨读' 改名，
    // 若不显式复位，本测试的 UPDATE ... WHERE title='晨读' 会匹配 0 行，
    // 于是像素无变化、reusedExisting=true，断言就会以"测试串扰"的形式失败。
    await client`
      UPDATE task_occurrences SET title = '晨读', status = 'pending'
       WHERE child_id = ${childId} AND title IN ('晨读', '晨读（已更新）')
    `;
    const pendingBefore = await client`
      SELECT COUNT(*)::int AS n FROM task_occurrences
       WHERE child_id = ${childId} AND status = 'pending'
    `;
    expect(Number(pendingBefore[0]!.n), "前置数据应存在 pending 任务").toBeGreaterThan(0);

    // 第 1 帧：无历史帧可比 → 整屏视为变化（ratio = 1）
    const firstOutcome = await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    expect(firstOutcome.status).toBe("succeeded");
    const first = (
      await client`
        SELECT frame_version, changed_ratio, dirty_rect FROM screen_frames
         WHERE child_id = ${childId} AND is_active = true
      `
    )[0]!;
    expect(Number(first.frame_version)).toBe(1);
    expect(Number(first.changed_ratio)).toBe(1);

    // 第 2 帧：把一条任务勾选为完成（draws a checked box + 删除线）→ 必须是局部变化
    const updated = await client`
      UPDATE task_occurrences SET status = 'completed'
       WHERE child_id = ${childId} AND title = '晨读'
    `;
    expect(updated.count, "必须命中恰好一行，否则本测试没有真正改变内容").toBe(1);

    const outcome = await renderJob(browser!, await enqueueAndClaim(2), { framesDir });
    expect(outcome.status).toBe("succeeded");
    // 内容确实变了 → 必须产生新帧版本，而不是复用旧帧
    expect(outcome.reusedExisting, "内容已变化，不应复用旧帧").toBe(false);

    const second = (
      await client`
        SELECT frame_version, changed_ratio, dirty_rect FROM screen_frames
         WHERE child_id = ${childId} AND is_active = true
      `
    )[0]!;
    expect(Number(second.frame_version)).toBe(2);

    const ratio = Number(second.changed_ratio);
    // 只勾选一个复选框：变化应远小于整屏，且确实大于 0
    expect(ratio, "勾选一条任务应产生可观测变化").toBeGreaterThan(0);
    expect(ratio, "勾选一条任务的像素变化应远小于整屏").toBeLessThan(0.25);

    const rect = second.dirty_rect as { x: number; y: number; width: number; height: number } | null;
    expect(rect).not.toBeNull();
    // x 必须 8 像素对齐（docs/06 §7）：脏区按整字节粒度上报
    expect(rect!.x % 8).toBe(0);
    expect(rect!.width % 8).toBe(0);
    expect(rect!.height).toBeGreaterThan(0);
    // 变化区域必须落在画布内
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(800);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(480);
    // 任务栏在右半屏（docs/02 §3 双栏布局），复选框位于右栏
    expect(rect!.x, "任务栏复选框位于右半屏").toBeGreaterThanOrEqual(400);
  });

  it("B04 失败保护：渲染失败 → 旧 active frame 不变，job 记 failed", async () => {
    await resetActive();
    // 先成功渲染一帧，作为"旧 active frame"
    await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    const before = (
      await client`
        SELECT id, frame_version, sha256, frame_path FROM screen_frames
         WHERE child_id = ${childId} AND is_active = true
      `
    )[0]!;

    // 构造失败：删掉 child 让其不存在，loadChild 会抛错
    const doomedChild = (
      await client`
        INSERT INTO children (family_id, display_name) VALUES (${familyId}, '将被删除的娃')
        RETURNING id
      `
    )[0]!;
    await client`
      INSERT INTO render_jobs (child_id, requested_content_version) VALUES (${String(doomedChild.id)}, 1)
    `;

    const browser2 = await launchBrowser({ launchArgs: ["--no-sandbox"] });
    await browser2.close(); // 关闭浏览器 → 渲染阶段必定失败

    const job = await claimNextJob();
    expect(job).not.toBeNull();
    let thrown: unknown = null;
    try {
      await renderJob(browser2, job!, { framesDir });
    } catch (err) {
      thrown = err;
      await markJobFailed(job!.id, err instanceof Error ? err.message : String(err));
    }
    expect(thrown).not.toBeNull();

    const failedJob = await getJob(job!.id);
    expect(failedJob!.status).toBe("queued"); // attempts=1 < 3 → 退回重试
    expect(failedJob!.lastError).toBeTruthy();

    // 关键断言：旧 active frame 完全没变
    const after = (
      await client`
        SELECT id, frame_version, sha256, frame_path FROM screen_frames
         WHERE child_id = ${childId} AND is_active = true
      `
    )[0]!;
    expect(String(after.id)).toBe(String(before.id));
    expect(Number(after.frame_version)).toBe(Number(before.frame_version));
    expect(String(after.sha256)).toBe(String(before.sha256));
    // 且仍只允许一个 active
    const actives = await client`
      SELECT COUNT(*)::int AS n FROM screen_frames WHERE child_id = ${childId} AND is_active = true
    `;
    expect(Number(actives[0]!.n)).toBe(1);
    // 文件仍在，大小仍精确
    expect((await stat(String(after.frame_path))).size).toBe(FRAME_BYTES);

    await client`DELETE FROM children WHERE id = ${String(doomedChild.id)}`;
  });

  it("stale job 不产出新帧（superseded，旧帧保持 active）", async () => {
    await resetActive();
    await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    const before = (
      await client`SELECT frame_version FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
    )[0]!;

    // 造一个"落后"的 job：requested_content_version 较小，且存在更新的 queued job
    await client`
      INSERT INTO render_jobs (child_id, requested_content_version, available_at)
      VALUES (${childId}, 1, now() - interval '10 seconds')
    `;
    await client`
      INSERT INTO render_jobs (child_id, requested_content_version)
      VALUES (${childId}, 99)
    `;
    const staleJob = await claimNextJob();
    const outcome = await renderJob(browser!, staleJob!, { framesDir });

    expect(outcome.status).toBe("superseded");
    expect((await getJob(staleJob!.id))!.status).toBe("superseded");

    const after = (
      await client`SELECT frame_version FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
    )[0]!;
    expect(Number(after.frame_version)).toBe(Number(before.frame_version));
  });

  it("frame 位序在真实渲染结果上成立（1=白 / 0=黑，row-major MSB first）", async () => {
    await resetActive();
    await renderJob(browser!, await enqueueAndClaim(1), { framesDir });
    const row = (
      await client`SELECT frame_path FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
    )[0]!;
    const frame = new Uint8Array(await readFile(String(row.frame_path)));

    // 分区墨点分布：头部/双栏/留言/按键栏都应有内容。
    // 注意不能用"首行（y=0）必须有墨点"做断言：头部高 54px、文字垂直居中，
    // 第 0 行本身是纯空白（已实测确认），按行扫描才是可靠的判据。
    const blackInRows = (y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let i = y * 100; i < (y + 1) * 100; i++) {
          n += 8 - popcount(frame[i]!);
        }
      }
      return n;
    };
    expect(blackInRows(0, 53), "头部区域应有墨点").toBeGreaterThan(1000);
    expect(blackInRows(54, 351), "双栏区域应有墨点").toBeGreaterThan(1000);
    expect(blackInRows(429, 479), "按键栏应有墨点").toBeGreaterThan(500);

    // 2px 黑实线分隔：分隔行应接近全黑（用于确认 row-major 行索引正确）。
    // 注意一行最多只有 800 个像素，阈值必须 <= 800，否则永远不成立（早期写 1500 是错的）。
    const blackInRow = (y: number) => {
      let n = 0;
      for (let i = y * 100; i < (y + 1) * 100; i++) n += 8 - popcount(frame[i]!);
      return n;
    };
    const solidRows: number[] = [];
    for (let y = 0; y < 480; y++) if (blackInRow(y) >= 780) solidRows.push(y);
    expect(solidRows.length, "应存在整行近黑的分隔实线").toBeGreaterThan(0);

    // MSB first 的字节级判据：一行 800 个像素 → 100 个字节。
    // 若整行 800 像素全黑，则每字节 8 位全 0，故 100 个字节必须全为 0x00。
    const aSolidRow = solidRows[0]!;
    expect(blackInRow(aSolidRow), "分隔行应覆盖整行 800 像素").toBe(800);
    for (let i = aSolidRow * 100; i < (aSolidRow + 1) * 100; i++) {
      expect(frame[i], `第 ${aSolidRow} 行第 ${i - aSolidRow * 100} 字节应为 0x00（MSB first）`).toBe(0x00);
    }

    // 反向判据：整行全白时每个字节必须是 0xff（1=白）
    const whiteRow = whiteInRowAbove(frame, solidRows);
    expect(whiteRow, "应能找到一个整行全白的行作为反向判据").not.toBeNull();
    for (let i = whiteRow! * 100; i < (whiteRow! + 1) * 100; i++) {
      expect(frame[i], `第 ${whiteRow} 行应为全白 0xff`).toBe(0xff);
    }

    // MSB-first 的位序判据：取分隔行的下一行（按键栏内容区），
    // 手工把第一个字节的 8 个 bit 还原成像素，确认最左像素落在 bit7。
    const probeY = aSolidRow;
    const firstByte = frame[probeY * 100]!;
    expect(firstByte >> 7, "最左像素必须是 bit7（MSB first）").toBe(0);

    // 同一帧重复解码结果一致（解码确定性）
    expect(decodeFrameToGray(frame)).toEqual(decodeFrameToGray(frame));
  });
});

/**
 * 找一个整行全白（0xff × 100）的行作为"1=白"的反向判据。
 * 不硬编码具体行号：布局调整后行号会变，但"存在纯空白行"这一性质不会变。
 */
function whiteInRowAbove(frame: Uint8Array, solidRows: number[]): number | null {
  for (let y = 0; y < 480; y++) {
    if (solidRows.includes(y)) continue;
    let allWhite = true;
    for (let i = y * 100; i < (y + 1) * 100; i++) {
      if (frame[i] !== 0xff) {
        allWhite = false;
        break;
      }
    }
    if (allWhite) return y;
  }
  return null;
}

/** 统计帧中的黑像素数（0=黑，故统计为 0 的 bit） */
function popcount(b: number): number {
  let n = 0;
  let v = b;
  while (v) {
    v &= v - 1;
    n++;
  }
  return n;
}
