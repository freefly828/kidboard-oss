/**
 * KidBoard Device Simulator 核心引擎 — PRD F12 + docs/05 + docs/09 C/D 组。
 * 与真机共用完全相同的 Device API，支持配对、心跳、帧校验、离线排队与异常模拟。
 */

import { createHash, randomUUID } from "node:crypto";
import { FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "@kidboard/screen-template";
import { SimulatorStorage } from "./nvs";
import type {
  InteractiveTaskItem,
  SimulatorNvsState,
  SimulatorOptions,
  SimulatorPendingEvent,
  SyncOutcome,
} from "./types";

export class DeviceSimulator {
  public readonly apiBaseUrl: string;
  private readonly storage: SimulatorStorage;
  private networkOnline: boolean;
  private simulateTamperedFrame: boolean;
  private interactiveTasks: InteractiveTaskItem[] = [];
  private readonly startTime: number;
  public lastError: string | null = null;

  constructor(options: SimulatorOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.storage = new SimulatorStorage({
      storageDir: options.storageDir,
      hardwareId: options.hardwareId,
      firmwareVersion: options.firmwareVersion,
    });
    this.networkOnline = options.networkOnline ?? true;
    this.simulateTamperedFrame = options.simulateTamperedFrame ?? false;
    this.startTime = Date.now();
  }

  public getNvsState(): SimulatorNvsState {
    return this.storage.getState();
  }

  public getLastFrame(): Uint8Array {
    return this.storage.getLastFrame();
  }

  public getPendingEvents(): SimulatorPendingEvent[] {
    return this.storage.getPendingEvents();
  }

  public getStorageForTest(): SimulatorStorage {
    return this.storage;
  }

  public setNetworkOnline(online: boolean): void {
    this.networkOnline = online;
  }

  public isNetworkOnline(): boolean {
    return this.networkOnline;
  }

  public setTamperedFrame(tamper: boolean): void {
    this.simulateTamperedFrame = tamper;
  }

  /** Step B: 发起配对，获取 6 位数字码与 pairingId */
  public async initPairing(): Promise<{ pairingId: string; code: string; expiresAt: string }> {
    if (!this.networkOnline) {
      throw new Error("Network offline: cannot init pairing");
    }
    const state = this.storage.getState();
    const res = await fetch(`${this.apiBaseUrl}/api/v1/device/pair/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hardwareId: state.hardwareId,
        deviceNonce: state.deviceNonce,
        firmwareVersion: state.firmwareVersion,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Init pairing failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { pairingId: string; code: string; expiresAt: string };
    return data;
  }

  /** Step D: 轮询配对状态并获取 token（token 仅一次有效） */
  public async pollPairingStatus(pairingId: string): Promise<{
    status: "pending" | "paired" | "expired";
    token?: string;
    deviceId?: string;
  }> {
    if (!this.networkOnline) {
      throw new Error("Network offline: cannot poll pairing status");
    }
    const state = this.storage.getState();
    const url = `${this.apiBaseUrl}/api/v1/device/pair/${pairingId}/status?nonce=${encodeURIComponent(state.deviceNonce)}`;
    const res = await fetch(url);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Poll status failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { status: "pending" | "paired" | "expired"; token?: string; deviceId?: string };
    if (data.status === "paired" && data.token) {
      this.storage.updateState({ deviceToken: data.token });
    }
    return data;
  }

  /** 重放离线排队的事件（带 UUID 幂等） */
  public async replayPendingEvents(): Promise<number> {
    if (!this.networkOnline) return 0;
    const state = this.storage.getState();
    if (!state.deviceToken) return 0;

    const pending = this.storage.getPendingEvents();
    let replayed = 0;

    for (const ev of pending) {
      try {
        const res = await fetch(`${this.apiBaseUrl}/api/v1/device/events/task-complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Device ${state.deviceToken}`,
          },
          body: JSON.stringify({
            eventId: ev.eventId,
            frameVersion: ev.frameVersion,
            taskOccurrenceId: ev.taskOccurrenceId,
            occurredAt: ev.occurredAt,
          }),
        });

        if (res.ok) {
          this.storage.removePendingEvent(ev.eventId);
          replayed++;
        }
      } catch {
        // 网络抖动，保留在队列下次重试
        break;
      }
    }
    return replayed;
  }

  /** 周期同步心跳与新帧下载 */
  public async sync(): Promise<SyncOutcome> {
    const state = this.storage.getState();
    if (!this.networkOnline) {
      return {
        action: "offline",
        frameVersion: state.frameVersion,
        replayedEventsCount: 0,
      };
    }

    if (!state.deviceToken) {
      return {
        action: "unpaired",
        frameVersion: state.frameVersion,
        replayedEventsCount: 0,
      };
    }

    // 先重放离线积压的按键事件
    const replayed = await this.replayPendingEvents();

    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const syncReqBody = {
      firmwareVersion: state.firmwareVersion,
      frameVersion: state.frameVersion,
      lastRefreshMode: state.lastRefreshMode,
      lastRefreshAt: state.lastRefreshAt,
      partialRefreshCount: state.partialRefreshCount,
      rssi: state.rssi,
      uptimeSeconds: state.uptimeSeconds + elapsedSeconds,
      freeHeap: state.freeHeap,
      resetReason: state.resetReason,
    };

    let syncRes: Response;
    try {
      syncRes = await fetch(`${this.apiBaseUrl}/api/v1/device/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Device ${state.deviceToken}`,
        },
        body: JSON.stringify(syncReqBody),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return {
        action: "server_error",
        frameVersion: state.frameVersion,
        error: msg,
        replayedEventsCount: replayed,
      };
    }

    if (!syncRes.ok) {
      const errText = await syncRes.text();
      this.lastError = `Sync failed (${syncRes.status}): ${errText}`;
      return {
        action: "server_error",
        frameVersion: state.frameVersion,
        error: this.lastError,
        replayedEventsCount: replayed,
      };
    }

    const data = (await syncRes.json()) as {
      desiredFrame: {
        version: number;
        width: number;
        height: number;
        bytes: number;
        sha256: string;
        url: string;
        forceFullRefresh: boolean;
      } | null;
      refreshPolicy: {
        partialEnabled: boolean;
        partialMaxCount: number;
        forceFullAfterHours: number;
        partialAreaMaxRatio: number;
      };
      interactiveTasks: InteractiveTaskItem[];
    };

    if (Array.isArray(data.interactiveTasks)) {
      this.interactiveTasks = data.interactiveTasks;
    }

    const desired = data.desiredFrame;
    // C01: 若无新帧或版本未增长，不下载帧
    if (!desired || desired.version <= state.frameVersion) {
      return {
        action: "up_to_date",
        frameVersion: state.frameVersion,
        desiredVersion: desired?.version,
        replayedEventsCount: replayed,
      };
    }

    // 下载新帧二进制数据
    const downloadUrl = desired.url.startsWith("http")
      ? desired.url
      : `${this.apiBaseUrl}${desired.url}`;

    let frameRes: Response;
    try {
      frameRes = await fetch(downloadUrl, {
        headers: {
          Authorization: `Device ${state.deviceToken}`,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = `Frame download network error: ${msg}`;
      return {
        action: "server_error",
        frameVersion: state.frameVersion,
        desiredVersion: desired.version,
        error: this.lastError,
        replayedEventsCount: replayed,
      };
    }

    if (!frameRes.ok) {
      this.lastError = `Frame download HTTP ${frameRes.status}`;
      return {
        action: "server_error",
        frameVersion: state.frameVersion,
        desiredVersion: desired.version,
        error: this.lastError,
        replayedEventsCount: replayed,
      };
    }

    let frameData = new Uint8Array(await frameRes.arrayBuffer());

    // 仿真校验破坏：篡改某 1 字节测试 C02/D06 校验保护
    if (this.simulateTamperedFrame) {
      const tampered = new Uint8Array(frameData);
      tampered[200] = (tampered[200] ?? 0) ^ 0xff;
      frameData = tampered;
    }

    // C02/D06 严格校验：1. 长度恰好 48,000；2. SHA-256 吻合
    if (frameData.length !== FRAME_BYTES) {
      this.lastError = `Frame size mismatch: got ${frameData.length}, expected ${FRAME_BYTES}`;
      return {
        action: "rejected",
        frameVersion: state.frameVersion,
        desiredVersion: desired.version,
        error: this.lastError,
        replayedEventsCount: replayed,
      };
    }

    const calcHash = createHash("sha256").update(frameData).digest("hex");
    if (calcHash !== desired.sha256) {
      // 校验失败：必须拒绝显示、保留旧帧、不推进 reported frame_version（C02 / D06 契约）
      this.lastError = `SHA-256 checksum mismatch: got ${calcHash}, expected ${desired.sha256}`;
      return {
        action: "rejected",
        frameVersion: state.frameVersion,
        desiredVersion: desired.version,
        sha256: calcHash,
        error: this.lastError,
        replayedEventsCount: replayed,
      };
    }

    // 校验通过：更新本地屏幕缓冲区与 NVS
    this.storage.setLastFrame(frameData);

    const maxPartial = data.refreshPolicy?.partialMaxCount ?? 5;
    const shouldFull = desired.forceFullRefresh || state.partialRefreshCount >= maxPartial;
    const refreshMode = shouldFull ? "full" : "partial";
    const nextPartialCount = shouldFull ? 0 : state.partialRefreshCount + 1;

    this.storage.updateState({
      frameVersion: desired.version,
      lastRefreshMode: refreshMode,
      lastRefreshAt: new Date().toISOString(),
      partialRefreshCount: nextPartialCount,
    });

    return {
      action: "downloaded",
      frameVersion: desired.version,
      desiredVersion: desired.version,
      sha256: calcHash,
      refreshMode,
      replayedEventsCount: replayed,
    };
  }

  /** 模拟按键 DONE：完成指定任务或当前 slot 任务 */
  public async pressDone(options?: {
    taskOccurrenceId?: string;
    slotIndex?: number;
    eventId?: string;
  }): Promise<{
    sent: boolean;
    queued: boolean;
    eventId: string;
    idempotent?: boolean;
    error?: string;
  }> {
    const targetId =
      options?.taskOccurrenceId ||
      (options?.slotIndex !== undefined
        ? this.interactiveTasks[options.slotIndex]?.id
        : this.interactiveTasks[0]?.id);

    if (!targetId) {
      throw new Error("No task occurrence available to complete");
    }

    const eventId = options?.eventId || randomUUID();
    const state = this.storage.getState();
    const event: SimulatorPendingEvent = {
      eventId,
      frameVersion: state.frameVersion,
      taskOccurrenceId: targetId,
      occurredAt: new Date().toISOString(),
      retryCount: 0,
    };

    // 离线状态：排队至本地 NVS 队列（PRD F11）
    if (!this.networkOnline || !state.deviceToken) {
      this.storage.addPendingEvent(event);
      return {
        sent: false,
        queued: true,
        eventId,
      };
    }

    try {
      const res = await fetch(`${this.apiBaseUrl}/api/v1/device/events/task-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Device ${state.deviceToken}`,
        },
        body: JSON.stringify({
          eventId,
          frameVersion: state.frameVersion,
          taskOccurrenceId: targetId,
          occurredAt: event.occurredAt,
        }),
      });

      if (!res.ok) {
        // 网络/服务异常入队
        this.storage.addPendingEvent(event);
        return {
          sent: false,
          queued: true,
          eventId,
          error: `HTTP ${res.status}`,
        };
      }

      const resJson = (await res.json()) as { idempotent?: boolean };
      return {
        sent: true,
        queued: false,
        eventId,
        idempotent: resJson.idempotent,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.storage.addPendingEvent(event);
      return {
        sent: false,
        queued: true,
        eventId,
        error: msg,
      };
    }
  }

  /** 生成用于控制台打印与调试的低分辨率 ASCII 预览图（800×480 降采样） */
  public getAsciiPreview(sampleStepX = 16, sampleStepY = 24): string {
    const frame = this.storage.getLastFrame();
    const lines: string[] = [];

    for (let y = 0; y < SCREEN_HEIGHT; y += sampleStepY) {
      let rowStr = "";
      for (let x = 0; x < SCREEN_WIDTH; x += sampleStepX) {
        const byteIndex = y * 100 + (x >> 3);
        const bitIndex = 7 - (x & 7);
        const isWhite = ((frame[byteIndex] ?? 0) & (1 << bitIndex)) !== 0;
        rowStr += isWhite ? " " : "█";
      }
      lines.push(rowStr);
    }
    return lines.join("\n");
  }
}
