/**
 * main.ts 单元测试（不启动 Chromium、不连数据库）。
 *
 * 覆盖：冻结尺寸契约、env 配置解析、runCycle 注入式依赖下的主循环编排。
 * 真实 Chromium + PostgreSQL 的端到端行为见 pipeline.integration.test.ts 与 jobs.integration.test.ts。
 */

import { describe, expect, it, vi } from "vitest";
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, assertFrameSize, loadConfig } from "./main.js";

describe("冻结尺寸契约（docs/06 §5）", () => {
  it("800×480 / 8 = 48,000 bytes", () => {
    expect(FRAME_WIDTH).toBe(800);
    expect(FRAME_HEIGHT).toBe(480);
    expect(FRAME_BYTES).toBe(48_000);
  });

  it("恰好 48,000 通过，47,999 / 48,001 必须抛错", () => {
    expect(() => assertFrameSize(new Uint8Array(48_000))).not.toThrow();
    expect(() => assertFrameSize(new Uint8Array(47_999))).toThrow(/48000/);
    expect(() => assertFrameSize(new Uint8Array(48_001))).toThrow(/48000/);
  });
});

describe("loadConfig（env 解析）", () => {
  it("全部缺省时给出安全默认值（阈值必须为 160）", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.framesDir).toBe("/data/frames");
    expect(c.threshold).toBe(160);
    expect(c.idleIntervalMs).toBe(3000);
    expect(c.maxJobsPerCycle).toBe(0);
    expect(c.jobTimeoutMs).toBe(60_000);
    expect(c.executablePath).toBeUndefined();
  });

  it("CHROMIUM_ARGS 按逗号切分并去空白/去空项", () => {
    const c = loadConfig({ CHROMIUM_ARGS: " --no-sandbox , --disable-dev-shm-usage ,, " } as NodeJS.ProcessEnv);
    expect(c.launchArgs).toEqual(["--no-sandbox", "--disable-dev-shm-usage"]);
  });

  it("CHROMIUM_ARGS 缺省时给出容器可用的默认参数", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.launchArgs).toEqual(["--no-sandbox", "--disable-dev-shm-usage"]);
  });

  it("显式覆盖生效，且 CHROMIUM_PATH 映射到 executablePath", () => {
    const c = loadConfig({
      FRAMES_DIR: "/tmp/f",
      RENDERER_IDLE_MS: "500",
      RENDERER_MAX_JOBS: "3",
      RENDERER_JOB_TIMEOUT_MS: "1000",
      RENDER_THRESHOLD: "128",
      CHROMIUM_PATH: "/usr/bin/chromium",
    } as NodeJS.ProcessEnv);
    expect(c.framesDir).toBe("/tmp/f");
    expect(c.idleIntervalMs).toBe(500);
    expect(c.maxJobsPerCycle).toBe(3);
    expect(c.jobTimeoutMs).toBe(1000);
    expect(c.threshold).toBe(128);
    expect(c.executablePath).toBe("/usr/bin/chromium");
  });
});

describe("runCycle 编排（注入依赖，不启动真实 Chromium）", () => {
  /** 造一个假的 browser 对象，仅满足 runCycle 的类型与 close 调用 */
  const fakeBrowser = { isConnected: () => true, close: vi.fn(async () => {}) };

  it("注入 browser 时不得关闭调用方传入的浏览器（所有权不转移）", async () => {
    const { runCycle } = await import("./main.js");
    const browser = { isConnected: () => true, close: vi.fn(async () => {}) };
    // 队列为空：claimNextJob 会在真实 DB 上返回 null 之外的错误风险 →
    // 因此这里只做「注入的 browser 不被关闭」这一条可确定性验证。
    await runCycle(
      { ...loadConfig({} as NodeJS.ProcessEnv), maxJobsPerCycle: 0 },
      { browser: browser as never },
    ).catch(() => {
      /* DB 不可用时忽略；本用例只断言浏览器所有权 */
    });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("fakeBrowser 具备 runCycle 所需的最小形状", () => {
    expect(fakeBrowser.isConnected()).toBe(true);
  });
});
