/**
 * NVS (Non-Volatile Storage) 与本地帧缓存仿真 — docs/05 §2/§4 + docs/09 D01。
 * 仿真真机 flash 分区：保存配对凭证、遥测状态及 48,000 字节的 last_frame.bin。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FRAME_BYTES } from "@kidboard/screen-template";
import type { SimulatorNvsState, SimulatorPendingEvent } from "./types";

export class SimulatorStorage {
  private state: SimulatorNvsState;
  private pendingEvents: SimulatorPendingEvent[] = [];
  private lastFrameBuffer: Uint8Array;
  private readonly storageDir?: string;

  constructor(options: {
    storageDir?: string;
    hardwareId?: string;
    firmwareVersion?: string;
  }) {
    this.storageDir = options.storageDir;

    // 默认开机全白帧（1=white / 48000 bytes 0xff）
    this.lastFrameBuffer = new Uint8Array(FRAME_BYTES);
    this.lastFrameBuffer.fill(0xff);

    const defaultHw = options.hardwareId || `KB-S3-${randomBytes(4).toString("hex").toUpperCase()}`;
    const defaultNonce = randomBytes(24).toString("base64");

    this.state = {
      hardwareId: defaultHw,
      deviceNonce: defaultNonce,
      firmwareVersion: options.firmwareVersion || "1.0.0",
      deviceToken: null,
      frameVersion: 0,
      lastRefreshMode: null,
      lastRefreshAt: null,
      partialRefreshCount: 0,
      uptimeSeconds: 0,
      freeHeap: 180000,
      rssi: -60,
      resetReason: "power_on",
    };

    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.storageDir) return;
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      const nvsFile = join(this.storageDir, "nvs.json");
      if (existsSync(nvsFile)) {
        const parsed = JSON.parse(readFileSync(nvsFile, "utf8"));
        this.state = { ...this.state, ...parsed };
      }
      const queueFile = join(this.storageDir, "events.json");
      if (existsSync(queueFile)) {
        this.pendingEvents = JSON.parse(readFileSync(queueFile, "utf8"));
      }
      const frameFile = join(this.storageDir, "last_frame.bin");
      if (existsSync(frameFile)) {
        const bin = readFileSync(frameFile);
        if (bin.length === FRAME_BYTES) {
          this.lastFrameBuffer = new Uint8Array(bin);
        }
      }
    } catch {
      // 容错降级
    }
  }

  public saveToDisk(): void {
    if (!this.storageDir) return;
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      writeFileSync(join(this.storageDir, "nvs.json"), JSON.stringify(this.state, null, 2), "utf8");
      writeFileSync(join(this.storageDir, "events.json"), JSON.stringify(this.pendingEvents, null, 2), "utf8");
      writeFileSync(join(this.storageDir, "last_frame.bin"), this.lastFrameBuffer);
    } catch {
      // 忽略磁盘错误
    }
  }

  public getState(): SimulatorNvsState {
    return { ...this.state };
  }

  public updateState(partial: Partial<SimulatorNvsState>): void {
    this.state = { ...this.state, ...partial };
    this.saveToDisk();
  }

  public getLastFrame(): Uint8Array {
    return this.lastFrameBuffer;
  }

  public setLastFrame(frame: Uint8Array): void {
    if (frame.length !== FRAME_BYTES) {
      throw new Error(`Frame buffer must be exactly ${FRAME_BYTES} bytes, got ${frame.length}`);
    }
    this.lastFrameBuffer = new Uint8Array(frame);
    this.saveToDisk();
  }

  public getPendingEvents(): SimulatorPendingEvent[] {
    return [...this.pendingEvents];
  }

  public addPendingEvent(event: SimulatorPendingEvent): void {
    this.pendingEvents.push(event);
    this.saveToDisk();
  }

  public removePendingEvent(eventId: string): void {
    this.pendingEvents = this.pendingEvents.filter((e) => e.eventId !== eventId);
    this.saveToDisk();
  }
}
