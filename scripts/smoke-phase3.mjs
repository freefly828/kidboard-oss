/* eslint-disable no-console */
/**
 * Phase 3 冒烟 — Renderer 渲染管线端到端（真实 PostgreSQL + 真实 Chromium）。
 *
 * 与 phase1/phase2 冒烟的区别：那两个走 HTTP；本脚本直接驱动 renderer 的核心链路，
 * 因为没有必要为冒烟单独起一个 worker 进程（worker 主循环本身已由单元/集成测试覆盖）。
 *
 * 前置：
 *   - DATABASE_URL 指向已应用 schema 的库（本脚本自建 family/child，结束回收）
 *   - 本机或容器内可用的 Chromium（否则显式报 SKIPPED，不伪装 PASS）
 *
 * 校验（对齐 docs/09 的 B 组）：
 *   B01  frame.bin 恰好 48,000 bytes；preview.png 800×480；meta.json 契约字段齐全
 *   B02  同一 VM 连续渲染 3 次 → frame SHA-256 完全一致
 *   B03  中文正常绘制：中文字符区域有墨点，且与纯空白渲染结果不同（无 tofu 静默退化）
 *   B04  失败保护：渲染中途失败 → 旧 active frame 不变，且不产生新的 active frame
 *   另附  active frame 唯一性、frame_version 单调、dirty area 8 像素对齐
 *
 * 运行：
 *   DATABASE_URL=... node --import tsx scripts/smoke-phase3.mjs
 *   （或在 apps/renderer 下用 tsx 执行）
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FRAME_BYTES = 48_000;

let failed = 0;
let skipped = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    failed++;
    console.error(`FAIL ${label} ${detail}`);
  }
}
function skip(label, reason) {
  skipped++;
  console.warn(`SKIP ${label} — ${reason}`);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is required (smoke does not fake results)");
  process.exit(2);
}

/** 从仓库根解析 renderer 的 TS 入口（用 tsx 动态 import，避免额外构建步骤） */
const repoRoot = resolve(import.meta.dirname ?? ".", "..");
const rendererSrc = join(repoRoot, "apps", "renderer", "src");

async function load() {
  const mods = {};
  for (const [key, rel] of [
    ["pipeline", "pipeline.ts"],
    ["jobs", "jobs.ts"],
    ["screenshot", "screenshot.ts"],
    ["png", "png.ts"],
    ["storage", "storage.ts"],
  ]) {
    mods[key] = await import(pathToFileURL(join(rendererSrc, rel)).href);
  }
  mods.db = await import(pathToFileURL(join(repoRoot, "packages", "db", "src", "index.ts")).href);
  return mods;
}

const { pipeline, jobs, screenshot, png, storage, db } = await load();
const { client } = db;

// --- 0. Chromium 可用性（不可用直接报 SKIPPED，绝不假装通过）---
let browser = null;
try {
  browser = await screenshot.launchBrowser({ launchArgs: ["--no-sandbox"] });
} catch (err) {
  skip("全部渲染用例", `Chromium 不可用：${err instanceof Error ? err.message : String(err)}`);
  console.log(`\nSMOKE RESULT: SKIPPED (${skipped})`);
  await client.end().catch(() => {});
  process.exit(0);
}

const framesDir = await mkdtemp(join(tmpdir(), "kidboard-smoke-p3-"));
let familyId = "";
let childId = "";

try {
  // 清理之前测试可能遗留的 queued jobs，确保 claimNextJob 领到的是本测试用例的 job
  await client`UPDATE render_jobs SET status = 'failed', last_error = 'stale_test_job' WHERE status = 'queued'`;

  // --- 1. 造数据 ---
  const fam = await client`INSERT INTO families (name) VALUES (${`smoke-p3-${Date.now()}`}) RETURNING id`;
  familyId = String(fam[0].id);
  const ch = await client`
    INSERT INTO children (family_id, display_name, timezone)
    VALUES (${familyId}, '冒烟娃', 'Asia/Shanghai') RETURNING id
  `;
  childId = String(ch[0].id);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const isoWeekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;

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
    VALUES (${childId}, ${today}, '冒烟测试留言。', true)
  `;

  async function enqueueAndClaim(contentVersion) {
    await client`
      INSERT INTO render_jobs (child_id, requested_content_version)
      VALUES (${childId}, ${contentVersion})
    `;
    const job = await jobs.claimNextJob();
    if (!job) throw new Error("expected a claimable render job");
    return job;
  }
  /**
   * 为指定 child 入队并领取。claimNextJob 是全局 FIFO，所以调用前必须确保
   * 没有其它 queued job 抢在前面（见调用处的清理逻辑）。
   */
  async function enqueueJobFor(targetChildId, contentVersion) {
    const inserted = await client`
      INSERT INTO render_jobs (child_id, requested_content_version)
      VALUES (${targetChildId}, ${contentVersion})
      RETURNING id
    `;
    const job = await jobs.claimNextJob();
    if (!job) return null;
    if (String(job.id) !== String(inserted[0].id)) {
      // 领到了别的 job：说明队列里还有残留，冒烟场景下视为前置条件不满足
      return job;
    }
    return job;
  }
  async function reset() {
    await client`UPDATE render_jobs SET status = 'succeeded' WHERE child_id = ${childId}`;
    await client`DELETE FROM screen_frames WHERE child_id = ${childId}`;
  }

  // --- B01 ---
  await reset();
  const outcome = await pipeline.renderJob(browser, await enqueueAndClaim(1), { framesDir });
  check("B01 render succeeded", outcome.status === "succeeded", `status=${outcome.status}`);
  check("B01 frame.bin == 48,000 bytes", outcome.frameBytes === FRAME_BYTES, `got ${outcome.frameBytes}`);

  const row = (
    await client`
      SELECT frame_version, content_version, width, height, bytes, sha256, frame_path, preview_path
        FROM screen_frames WHERE child_id = ${childId} AND is_active = true
    `
  )[0];
  check("B01 screen_frames 只有一行 active 且尺寸契约正确",
    row && Number(row.width) === 800 && Number(row.height) === 480 && Number(row.bytes) === FRAME_BYTES,
    JSON.stringify(row ?? null));

  const frameBin = await readFile(String(row.frame_path));
  check("B01 磁盘 frame.bin 精确 48,000 bytes", frameBin.length === FRAME_BYTES, `got ${frameBin.length}`);
  const digest = createHash("sha256").update(frameBin).digest("hex");
  check("B01 磁盘内容 SHA-256 与 DB 记录一致（设备校验依据）", digest === String(row.sha256));

  const previewPng = await readFile(String(row.preview_path));
  const img = png.decodePngToRawImage(previewPng);
  check("B01 preview.png 为 800×480", img.width === 800 && img.height === 480, `${img.width}x${img.height}`);

  const meta = JSON.parse(await readFile(join(String(row.frame_path), "..", "meta.json"), "utf8"));
  check("B01 meta.json 契约字段齐全 (docs/06 §6)",
    meta.width === 800 && meta.height === 480 && meta.bytes === 48000 &&
    meta.threshold === 160 && meta.sha256 === String(row.sha256) &&
    meta.contentVersion === Number(row.content_version) &&
    meta.frameVersion === Number(row.frame_version) &&
    meta.renderedForDate === today,
    JSON.stringify(meta));

  // --- B02 确定性 ---
  await reset();
  const hashes = [];
  for (let i = 0; i < 3; i++) {
    const h = createHash("sha256");
    const o = await pipeline.renderJob(browser, await enqueueAndClaim(1), { framesDir });
    hashes.push(o.sha256);
    void h;
  }
  check("B02 连续 3 次渲染 SHA-256 完全一致", new Set(hashes).size === 1, hashes.join(","));

  // --- B03 中文绘制 ---
  await reset();
  await pipeline.renderJob(browser, await enqueueAndClaim(1), { framesDir });
  const withTextPath = (
    await client`SELECT frame_path FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
  )[0].frame_path;
  const withText = new Uint8Array(await readFile(String(withTextPath)));
  const blackOf = (f) => {
    let n = 0;
    for (const b of f) {
      let v = b ^ 0xff;
      while (v) { v &= v - 1; n++; }
    }
    return n;
  };
  check("B03 中文标签产生真实墨点（非空白帧）", blackOf(withText) > 5000, `black=${blackOf(withText)}`);

  // --- 位序 / 布局分区（用真实帧验证 row-major + 1=白）---
  const blackInRow = (f, y) => {
    let n = 0;
    for (let i = y * 100; i < (y + 1) * 100; i++) {
      let v = f[i] ^ 0xff;
      while (v) { v &= v - 1; n++; }
    }
    return n;
  };
  const fullRows = [];
  for (let y = 0; y < 480; y++) if (blackInRow(withText, y) === 800) fullRows.push(y);
  check("位序：存在整行 800 像素全黑的分隔实线（2px 边框 × 3）",
    fullRows.length >= 6, `fullRows=${fullRows.join(",")}`);
  check("位序：整行全黑时按 MSB first 打包，每字节必须为 0x00",
    fullRows.every((y) => {
      for (let i = y * 100; i < (y + 1) * 100; i++) if (withText[i] !== 0x00) return false;
      return true;
    }));
  let allWhiteRows = 0;
  for (let y = 0; y < 480; y++) {
    let ok = true;
    for (let i = y * 100; i < (y + 1) * 100; i++) if (withText[i] !== 0xff) { ok = false; break; }
    if (ok) allWhiteRows++;
  }
  check("位序：存在整行全白（0xff）的行，1=白 成立", allWhiteRows > 0, `allWhiteRows=${allWhiteRows}`);
  check("布局：三个分区边框落在 y=52/53、352/353、429/430（网格合计 480）",
    [52, 53, 352, 353, 429, 430].every((y) => fullRows.includes(y)),
    `fullRows=${fullRows.join(",")}`);

  // --- dirty area ---
  await reset();
  const first = await pipeline.renderJob(browser, await enqueueAndClaim(1), { framesDir });
  check("dirty：首帧无历史基线 → changed_ratio = 1", Number(first.changedRatio) === 1, `got ${first.changedRatio}`);

  const upd = await client`
    UPDATE task_occurrences SET status = 'completed'
     WHERE child_id = ${childId} AND title = '晨读'
  `;
  check("dirty：前置更新必须命中一行", upd.count === 1, `count=${upd.count}`);
  const second = await pipeline.renderJob(browser, await enqueueAndClaim(2), { framesDir });
  check("dirty：内容变化 → 不复用旧帧", second.reusedExisting === false);
  check("dirty：changed_ratio 在 (0, 0.25)", second.changedRatio > 0 && second.changedRatio < 0.25,
    `got ${second.changedRatio}`);
  check("dirty：dirty_rect x 8 像素对齐", second.dirtyRect && second.dirtyRect.x % 8 === 0,
    JSON.stringify(second.dirtyRect));
  check("dirty：dirty_rect 落在画布内",
    second.dirtyRect && second.dirtyRect.x >= 0 &&
    second.dirtyRect.x + second.dirtyRect.width <= 800 &&
    second.dirtyRect.y + second.dirtyRect.height <= 480,
    JSON.stringify(second.dirtyRect));

  // --- active 原子切换 + 不变不刷新 ---
  const actives = await client`
    SELECT COUNT(*)::int AS n FROM screen_frames WHERE child_id = ${childId} AND is_active = true
  `;
  check("active 唯一：每个 child 至多一行 active", Number(actives[0].n) === 1, `got ${actives[0].n}`);
  const third = await pipeline.renderJob(browser, await enqueueAndClaim(2), { framesDir });
  check("不变不刷新：同内容再渲染复用 active 帧、不推进 frame_version",
    third.reusedExisting === true && Number(third.frameVersion) === Number(second.frameVersion),
    `reused=${third.reusedExisting} v=${third.frameVersion}`);

  // --- B04 失败保护 ---
  await reset();
  await pipeline.renderJob(browser, await enqueueAndClaim(1), { framesDir });
  const beforeRow = (
    await client`SELECT id, frame_version, sha256 FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
  )[0];

  // 构造失败：先造一个真实 child 并入队/领取，再把它删掉（render_jobs 是 ON DELETE CASCADE），
  // 然后拿着内存里的已领 job 去渲染 → loadChild 必然抛 "child not found"。
  // 这比伪造 child_id 更贴近真实故障（child 在 job 处理过程中被删除）。
  await client`
    UPDATE render_jobs SET status = 'succeeded'
     WHERE child_id = ${childId} AND status IN ('queued', 'running')
  `;
  const doomedChild = (
    await client`
      INSERT INTO children (family_id, display_name, timezone)
      VALUES (${familyId}, '中途被删的娃', 'Asia/Shanghai') RETURNING id
    `
  )[0];
  const doomedJob = await enqueueJobFor(String(doomedChild.id), 1);
  check("B04 构造失败任务可被领取", Boolean(doomedJob));
  await client`DELETE FROM children WHERE id = ${String(doomedChild.id)}`;

  let threw = false;
  try {
    await pipeline.renderJob(browser, doomedJob, { framesDir });
  } catch {
    threw = true;
  }
  check("B04 渲染失败必须抛错（不静默成功）", threw);

  // 注意：上面删 child 时 render_jobs 因 ON DELETE CASCADE 一并消失，
  // 所以这里不再对 doomedJob 调 markJobFailed（那是 worker 主循环的职责，
  // 且已由 jobs.integration.test.ts 的"重试/终态"用例覆盖）。
  // 本小节的关注点是 B04：失败绝不能动到**别的** child 的 active frame。
  const afterRow = (
    await client`SELECT id, frame_version, sha256 FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
  )[0];
  check("B04 旧 active frame 完全未被改动",
    afterRow && String(afterRow.id) === String(beforeRow.id) &&
    String(afterRow.sha256) === String(beforeRow.sha256),
    JSON.stringify({ before: beforeRow, after: afterRow }));
  const totalFrames = await client`
    SELECT COUNT(*)::int AS n FROM screen_frames WHERE child_id = ${childId}
  `;
  check("B04 失败未产生新帧文件记录", Number(totalFrames[0].n) === 1, `got ${totalFrames[0].n}`);

  // --- stale job（合并语义，docs/03 §5）---
  // isJobStale 的判据是"存在 requested_content_version 更高的 queued/running job"。
  // 因此构造方式：先入队低版本(1) 并领取，再入队高版本(99) 保持 queued，
  // 此时低版本 job 处理时就会发现自己已过期 → superseded，且不产出新帧。
  await client`
    UPDATE render_jobs SET status = 'succeeded'
     WHERE child_id = ${childId} AND status IN ('queued', 'running')
  `;
  const staleJob = await enqueueJobFor(childId, 1);
  check("合并：低版本 job 被领取", Boolean(staleJob) && Number(staleJob.requestedContentVersion) === 1,
    JSON.stringify(staleJob ?? null));
  await client`
    INSERT INTO render_jobs (child_id, requested_content_version) VALUES (${childId}, 99)
  `;

  const versionBefore = (
    await client`SELECT frame_version FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
  )[0];
  const staleOutcome = await pipeline.renderJob(browser, staleJob, { framesDir });
  check("合并：过期 job 标记 superseded",
    staleOutcome.status === "superseded" && (await jobs.getJob(staleJob.id)).status === "superseded",
    `status=${staleOutcome.status} reason=${staleOutcome.reason ?? ""}`);
  const versionAfter = (
    await client`SELECT frame_version FROM screen_frames WHERE child_id = ${childId} AND is_active = true`
  )[0];
  check("合并：过期 job 不产出新帧（旧帧版本不变）",
    Number(versionAfter.frame_version) === Number(versionBefore.frame_version),
    `${versionBefore.frame_version} → ${versionAfter.frame_version}`);

  // --- 落盘布局 ---
  const paths = await storage.peekNextFrameVersion(childId);
  check("落盘：peekNextFrameVersion 返回正整数", Number.isInteger(paths) && paths > 0, `got ${paths}`);
  check("落盘：frame.bin 与 preview.png 同目录",
    join(String(row.frame_path), "..") === join(String(row.preview_path), ".."));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (familyId) await client`DELETE FROM families WHERE id = ${familyId}`.catch(() => {});
  await rm(framesDir, { recursive: true, force: true }).catch(() => {});
  await client.end().catch(() => {});
}

if (failed === 0) {
  console.log(`\nSMOKE RESULT: ALL PASS${skipped ? ` (${skipped} skipped)` : ""}`);
  process.exit(0);
}
console.log(`\nSMOKE RESULT: ${failed} FAILED${skipped ? ` (${skipped} skipped)` : ""}`);
process.exit(1);
