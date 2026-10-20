/**
 * @kidboard/renderer — 渲染 worker（Phase 3）。
 *
 * 循环：抢占 render_job → 渲染管线 → 成功/失败标记 → 空闲退避。
 * 契约: frame.bin 必须正好 48,000 bytes (800×480 / 8)，1=white / 0=black / row-major / MSB first。
 *
 * 启动:
 *   FRAMES_DIR=/data/frames DATABASE_URL=postgresql://... node --experimental-strip-types apps/renderer/src/main.ts
 * 或在容器中: node apps/renderer/dist/main.js
 */

import { launchBrowser } from "./screenshot.js";
import {
  claimNextJob,
  markJobFailed,
  markJobSucceeded,
  workerId,
  type ClaimedJob,
} from "./jobs.js";
import { renderJob } from "./pipeline.js";
import { runDayRollover } from "./dayRollover.js";
import { runWeatherRefresh } from "./weatherRefresh.js";
import { runAlertSweep } from "./alertSweep.js";

export const FRAME_WIDTH = 800 as const;
export const FRAME_HEIGHT = 480 as const;
export const FRAME_BYTES = (FRAME_WIDTH * FRAME_HEIGHT) / 8; // 48,000

export interface WorkerConfig {
  framesDir: string;
  /** 空闲轮询间隔（ms） */
  idleIntervalMs: number;
  /** 单轮最多处理多少个 job（0 = 不限，直到队列空） */
  maxJobsPerCycle: number;
  /** 单 job 超时（ms）；超过则视为失败以便重试 */
  jobTimeoutMs: number;
  threshold: number;
  launchArgs: string[];
  executablePath?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    framesDir: env.FRAMES_DIR ?? "/data/frames",
    idleIntervalMs: Number(env.RENDERER_IDLE_MS ?? 3000),
    maxJobsPerCycle: Number(env.RENDERER_MAX_JOBS ?? 0),
    jobTimeoutMs: Number(env.RENDERER_JOB_TIMEOUT_MS ?? 60000),
    threshold: Number(env.RENDER_THRESHOLD ?? 160),
    launchArgs: (env.CHROMIUM_ARGS ?? "--no-sandbox,--disable-dev-shm-usage")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    executablePath: env.CHROMIUM_PATH || undefined,
  };
}

/** 结构化 JSON 日志（docs/03 §9 字段） */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      component: "renderer",
      event,
      ...fields,
    }),
  );
}

/** 带超时的执行（防止 Chromium 卡死导致 job 永久 running） */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CycleResult {
  processed: number;
  succeeded: number;
  superseded: number;
  failed: number;
}

/**
 * 跑一轮：处理到队列空或达到 maxJobsPerCycle。
 * 供 main() 与测试复用。
 */
export async function runCycle(
  config: WorkerConfig,
  deps?: { browser?: Awaited<ReturnType<typeof launchBrowser>> },
): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, succeeded: 0, superseded: 0, failed: 0 };
  const worker = workerId();
  const browser = deps?.browser ?? (await launchBrowser({
    launchArgs: config.launchArgs,
    executablePath: config.executablePath,
  }));
  const ownsBrowser = !deps?.browser;

  try {
    for (;;) {
      if (config.maxJobsPerCycle > 0 && result.processed >= config.maxJobsPerCycle) break;
      const job: ClaimedJob | null = await claimNextJob();
      if (!job) break;
      result.processed++;
      log("render_job_claimed", {
        request_id: job.id,
        child_id: job.childId,
        render_job_attempt: job.attempts,
        content_version: job.requestedContentVersion,
        locked_by: worker,
      });

      try {
        const outcome = await withTimeout(
          renderJob(browser, job, {
            framesDir: config.framesDir,
            threshold: config.threshold,
            screenshot: {
              launchArgs: config.launchArgs,
              executablePath: config.executablePath,
            },
          }),
          config.jobTimeoutMs,
          `render job ${job.id}`,
        );

        if (outcome.status === "superseded") {
          result.superseded++;
          log("render_job_superseded", {
            request_id: job.id,
            child_id: job.childId,
            reason: outcome.reason,
            duration_ms: outcome.durationMs,
            result: "superseded",
          });
        } else {
          result.succeeded++;
          await markJobSucceeded(job.id, outcome.frameVersion ?? 0);
          log("render_job_succeeded", {
            request_id: job.id,
            child_id: job.childId,
            frame_version: outcome.frameVersion,
            content_version: outcome.contentVersion,
            frame_bytes: outcome.frameBytes,
            sha256: outcome.sha256,
            changed_ratio: outcome.changedRatio,
            dirty_rect: outcome.dirtyRect,
            reused_existing: outcome.reusedExisting,
            duration_ms: outcome.durationMs,
            result: "succeeded",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed++;
        const { willRetry } = await markJobFailed(job.id, message);
        log("render_job_failed", {
          request_id: job.id,
          child_id: job.childId,
          render_job_attempt: job.attempts,
          error: message,
          will_retry: willRetry,
          result: "failed",
        });
      }
    }
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
  }
  return result;
}

/** 常驻主循环 */
export async function main(): Promise<void> {
  const config = loadConfig();
  log("renderer_started", {
    frames_dir: config.framesDir,
    threshold: config.threshold,
    idle_ms: config.idleIntervalMs,
    locked_by: workerId(),
  });

  // 浏览器复用：整个进程共用一个 Chromium（每次 job 新建 context）
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  let stopping = false;
  const stop = (signal: string) => {
    log("renderer_stopping", { signal });
    stopping = true;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // 跨天切换：每分钟检查一次（启动时立即检查），失败只记日志不影响渲染
  const ROLLOVER_INTERVAL_MS = 60_000;
  let lastRolloverAt = 0;
  // D-017 定时提醒到点 / 横幅过期：每 15 秒检查
  const ALERT_SWEEP_MS = 15_000;
  let lastAlertSweepAt = 0;
  // 天气：每小时刷新一次（启动时立即刷新）；失败不影响渲染
  const WEATHER_INTERVAL_MS = Number(process.env.WEATHER_REFRESH_MS ?? 3_600_000);
  let lastWeatherAt = 0;

  try {
    while (!stopping) {
      if (Date.now() - lastWeatherAt >= WEATHER_INTERVAL_MS) {
        lastWeatherAt = Date.now();
        try {
          const wr = await runWeatherRefresh();
          if (wr.skipped) log("weather_skipped", { reason: wr.skipped });
          else log("weather_refreshed", { locations: wr.locations, changed: wr.changed, rerendered: wr.rerendered, errors: wr.errors });
        } catch (err) {
          log("weather_refresh_failed", { error: String(err) });
        }
      }
      if (Date.now() - lastAlertSweepAt >= ALERT_SWEEP_MS) {
        lastAlertSweepAt = Date.now();
        try {
          const ar = await runAlertSweep();
          if (ar.fired.length > 0 || ar.cleared > 0) log("alert_sweep", { fired: ar.fired, cleared: ar.cleared });
        } catch (err) {
          log("alert_sweep_failed", { error: String(err) });
        }
      }
      if (Date.now() - lastRolloverAt >= ROLLOVER_INTERVAL_MS) {
        lastRolloverAt = Date.now();
        try {
          const rr = await runDayRollover();
          if (rr.rolled.length > 0) log("day_rollover", { checked: rr.checked, rolled: rr.rolled });
        } catch (err) {
          log("day_rollover_failed", { error: String(err) });
        }
      }
      if (browser === null || !browser.isConnected()) {
        browser = await launchBrowser({
          launchArgs: config.launchArgs,
          executablePath: config.executablePath,
        });
      }
      const r = await runCycle(config, { browser });
      if (r.processed === 0) {
        await new Promise((res) => setTimeout(res, config.idleIntervalMs));
      } else {
        log("renderer_cycle_done", { ...r });
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    log("renderer_stopped", {});
  }
}

/** 冻结尺寸断言（供外部调用，保持 Phase 0 导出兼容） */
export function assertFrameSize(bytes: Uint8Array): void {
  if (bytes.length !== FRAME_BYTES) {
    throw new Error(
      `frame.bin must be exactly ${FRAME_BYTES} bytes, got ${bytes.length}`,
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  /main\.(ts|js)$/.test(process.argv[1]) &&
  process.env.RENDERER_NO_AUTOSTART !== "1";

if (isDirectRun) {
  main().catch((err) => {
    console.error("renderer fatal:", err);
    process.exit(1);
  });
}
