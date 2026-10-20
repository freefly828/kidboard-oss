/**
 * Device API 单元测试 — 覆盖设备鉴权、令牌派生、Zod 契约模式校验。
 */

import { describe, it, expect } from "vitest";
import {
  deriveDeviceToken,
  generatePairingCode,
  hashString,
} from "./device-token";
import {
  devicePairInitSchema,
  pairingClaimSchema,
  deviceSyncRequestSchema,
  deviceTaskCompleteSchema,
} from "./schemas";

describe("Device Auth & Tokens", () => {
  it("6 位配对码必须为 100000 到 999999 之间的纯数字", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[1-9][0-9]{5}$/);
      expect(code.length).toBe(6);
    }
  });

  it("相同参数派生出的 device token 必须完全一致", () => {
    const hw = "KB-S3-TEST";
    const nonce = "test-nonce-1234567890";
    const pairId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    const t1 = deriveDeviceToken(hw, nonce, pairId);
    const t2 = deriveDeviceToken(hw, nonce, pairId);
    expect(t1).toBe(t2);
    expect(t1.startsWith("kb_dev_")).toBe(true);
  });

  it("不同 nonce 派生出的 token 必须不同", () => {
    const hw = "KB-S3-TEST";
    const pairId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    const t1 = deriveDeviceToken(hw, "nonce-1-123456789", pairId);
    const t2 = deriveDeviceToken(hw, "nonce-2-123456789", pairId);
    expect(t1).not.toBe(t2);
  });

  it("SHA-256 哈希必须产生 64 位小写十六进制字符串", () => {
    const hash = hashString("test-token");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Device API Schemas (OpenAPI Parity)", () => {
  it("devicePairInitSchema 校验合法输入", () => {
    const valid = {
      hardwareId: "KB-S3-A1B2C3D4",
      deviceNonce: "base64-random-32-bytes-long-string",
      firmwareVersion: "1.0.0",
    };
    expect(devicePairInitSchema.parse(valid)).toEqual(valid);

    expect(() => devicePairInitSchema.parse({ hardwareId: "" })).toThrow();
  });

  it("pairingClaimSchema 校验 6 位数字码与 uuid", () => {
    const valid = {
      code: "123456",
      childId: "11111111-1111-4111-8111-111111111111",
      deviceName: "书桌墨水屏",
    };
    expect(pairingClaimSchema.parse(valid)).toEqual(valid);

    // 非 6 位数字码应抛错
    expect(() => pairingClaimSchema.parse({ ...valid, code: "12345" })).toThrow();
    expect(() => pairingClaimSchema.parse({ ...valid, code: "12345a" })).toThrow();
  });

  it("deviceSyncRequestSchema 校验遥测字段与缺省值", () => {
    const valid = {
      firmwareVersion: "1.0.0",
      frameVersion: 104,
      lastRefreshMode: "full",
      lastRefreshAt: "2026-09-15T08:10:02.000Z",
      partialRefreshCount: 0,
      rssi: -61,
      uptimeSeconds: 83122,
      freeHeap: 182144,
      resetReason: "power_on",
    };
    const parsed = deviceSyncRequestSchema.parse(valid);
    expect(parsed.frameVersion).toBe(104);
    expect(parsed.rssi).toBe(-61);
  });

  it("deviceTaskCompleteSchema 校验事件幂等入参", () => {
    const valid = {
      eventId: "22222222-2222-4222-8222-222222222222",
      frameVersion: 105,
      taskOccurrenceId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-09-15T08:11:05.000Z",
    };
    expect(deviceTaskCompleteSchema.parse(valid)).toEqual(valid);
  });
});
