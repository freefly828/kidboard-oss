import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Phase 0 冒烟测试: 验证 vitest 运行时 + zod 校验链路可用。
 * 业务逻辑测试在 Phase 1+ 逐步补充。
 */
describe("phase 0 baseline", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("zod parse works (dependency smoke)", () => {
    const schema = z.object({
      firmwareVersion: z.string(),
      frameVersion: z.number().int().min(0),
    });
    const parsed = schema.parse({
      firmwareVersion: "1.0.0",
      frameVersion: 3,
    });
    expect(parsed.firmwareVersion).toBe("1.0.0");
    expect(() =>
      schema.parse({ firmwareVersion: "1.0.0", frameVersion: -1 }),
    ).toThrow();
  });
});
