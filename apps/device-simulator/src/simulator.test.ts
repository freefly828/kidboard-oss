/**
 * Device Simulator 单元测试 — 覆盖 C01/C02/C03 契约、离线队列、帧校验与 NVS 存储。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { FRAME_BYTES } from "@kidboard/screen-template";
import { DeviceSimulator } from "./simulator";
import { SimulatorStorage } from "./nvs";

describe("Simulator Storage & NVS", () => {
  it("默认屏幕缓冲区必须恰好 48,000 字节全白（0xff）", () => {
    const storage = new SimulatorStorage({});
    const frame = storage.getLastFrame();
    expect(frame.length).toBe(FRAME_BYTES);
    expect(frame[0]).toBe(0xff);
    expect(frame[FRAME_BYTES - 1]).toBe(0xff);
  });

  it("更新帧缓冲区时若字节数不为 48,000 必须抛错", () => {
    const storage = new SimulatorStorage({});
    expect(() => storage.setLastFrame(new Uint8Array(47999))).toThrow();
    expect(() => storage.setLastFrame(new Uint8Array(48001))).toThrow();
  });

  it("NVS 状态更新与读取一致", () => {
    const storage = new SimulatorStorage({ hardwareId: "KB-TEST-HW" });
    storage.updateState({ frameVersion: 10, partialRefreshCount: 3 });
    const s = storage.getState();
    expect(s.hardwareId).toBe("KB-TEST-HW");
    expect(s.frameVersion).toBe(10);
    expect(s.partialRefreshCount).toBe(3);
  });
});

describe("DeviceSimulator Protocol & Contracts", () => {
  let sim: DeviceSimulator;
  const mockBaseUrl = "http://mock-api.local";

  beforeEach(() => {
    sim = new DeviceSimulator({
      apiBaseUrl: mockBaseUrl,
      hardwareId: "KB-S3-SIMTEST",
      firmwareVersion: "1.0.0",
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Step B: initPairing 请求正确的参数并返回 6 位配对码", async () => {
    const mockInitResponse = {
      pairingId: "33333333-3333-4333-8333-333333333333",
      code: "654321",
      expiresAt: "2026-09-16T12:00:00.000Z",
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockInitResponse,
    } as Response);

    const res = await sim.initPairing();
    expect(res.code).toBe("654321");
    expect(res.pairingId).toBe("33333333-3333-4333-8333-333333333333");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/device/pair/init`,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("Step D: pollPairingStatus 成功获取 token 并写入 NVS", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "paired",
        token: "kb_dev_mock_token_12345",
        deviceId: "dev-uuid-1",
      }),
    } as Response);

    const res = await sim.pollPairingStatus("pair-uuid-1");
    expect(res.status).toBe("paired");
    expect(res.token).toBe("kb_dev_mock_token_12345");
    expect(sim.getNvsState().deviceToken).toBe("kb_dev_mock_token_12345");
  });

  it("C01: sync 时若 desiredFrame.version 与当前一致，不下载帧（up_to_date）", async () => {
    // 注入 token 与当前帧版本 5
    sim.getStorageForTest().updateState({
      deviceToken: "kb_dev_test",
      frameVersion: 5,
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        desiredFrame: {
          version: 5,
          width: 800,
          height: 480,
          bytes: 48000,
          sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          url: "/api/v1/device/frames/5/bin",
          forceFullRefresh: false,
        },
      }),
    } as Response);

    const outcome = await sim.sync();
    expect(outcome.action).toBe("up_to_date");
    expect(outcome.frameVersion).toBe(5);
    // 仅发生 1 次 sync 请求，没有产生 frame download 请求
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("C02: 校验失败（篡改 1 字节）时，必须拒绝显示并保持旧帧（rejected）", async () => {
    sim.getStorageForTest().updateState({
      deviceToken: "kb_dev_test",
      frameVersion: 1,
    });

    // 构造合法的 48,000 字节帧
    const rawFrame = new Uint8Array(FRAME_BYTES);
    rawFrame.fill(0xaa);
    const correctHash = createHash("sha256").update(rawFrame).digest("hex");

    // 开启篡改仿真
    sim.setTamperedFrame(true);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          desiredFrame: {
            version: 2,
            width: 800,
            height: 480,
            bytes: 48000,
            sha256: correctHash,
            url: "/api/v1/device/frames/2/bin",
            forceFullRefresh: false,
          },
          refreshPolicy: { partialMaxCount: 5 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => rawFrame.buffer,
      } as Response);

    const outcome = await sim.sync();
    expect(outcome.action).toBe("rejected");
    expect(outcome.error).toContain("SHA-256 checksum mismatch");
    // NVS 内部的 frameVersion 必须保持旧的 1，不推进版本
    expect(sim.getNvsState().frameVersion).toBe(1);
  });

  it("下载合法帧时更新本地缓冲区与 NVS 版本", async () => {
    sim.getStorageForTest().updateState({
      deviceToken: "kb_dev_test",
      frameVersion: 1,
    });

    const rawFrame = new Uint8Array(FRAME_BYTES);
    rawFrame[0] = 0x12;
    rawFrame[FRAME_BYTES - 1] = 0x34;
    const correctHash = createHash("sha256").update(rawFrame).digest("hex");

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          desiredFrame: {
            version: 2,
            width: 800,
            height: 480,
            bytes: 48000,
            sha256: correctHash,
            url: "/api/v1/device/frames/2/bin",
            forceFullRefresh: false,
          },
          refreshPolicy: { partialMaxCount: 5 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => rawFrame.buffer,
      } as Response);

    const outcome = await sim.sync();
    expect(outcome.action).toBe("downloaded");
    expect(outcome.frameVersion).toBe(2);
    expect(sim.getNvsState().frameVersion).toBe(2);
    expect(sim.getLastFrame()[0]).toBe(0x12);
  });

  it("PRD F11: 离线时按键记录进入本地队列，网络恢复后自动重放", async () => {
    sim.getStorageForTest().updateState({
      deviceToken: "kb_dev_test",
      frameVersion: 2,
    });

    // 1. 设置断网
    sim.setNetworkOnline(false);
    const pressRes = await sim.pressDone({
      taskOccurrenceId: "task-offline-1",
    });
    expect(pressRes.sent).toBe(false);
    expect(pressRes.queued).toBe(true);
    expect(sim.getPendingEvents().length).toBe(1);
    expect(sim.getPendingEvents()[0]?.taskOccurrenceId).toBe("task-offline-1");

    // 2. 恢复网络并在 sync 时重放
    sim.setNetworkOnline(true);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        // 重放 task-complete
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", applied: true }),
      } as Response)
      .mockResolvedValueOnce({
        // sync
        ok: true,
        status: 200,
        json: async () => ({ desiredFrame: null }),
      } as Response);

    const syncOutcome = await sim.sync();
    expect(syncOutcome.replayedEventsCount).toBe(1);
    expect(sim.getPendingEvents().length).toBe(0); // 队列被清空
  });

  it("ASCII 预览生成格式正常", () => {
    const preview = sim.getAsciiPreview(32, 48);
    expect(typeof preview).toBe("string");
    expect(preview.length).toBeGreaterThan(0);
    expect(preview).toContain("\n");
  });
});
