/* eslint-disable no-console */
/**
 * Device Simulator 命令行交互式运行器 — 供开发调试与手动仿真使用。
 * 用法:
 *   npx tsx src/cli.ts --api http://localhost:3000
 */

import { parseArgs } from "node:util";
import { DeviceSimulator } from "./simulator";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: process.env.API_BASE_URL || "http://localhost:3000" },
    hw: { type: "string" },
    storage: { type: "string", default: "./.simulator-data" },
  },
});

const sim = new DeviceSimulator({
  apiBaseUrl: values.api!,
  hardwareId: values.hw,
  storageDir: values.storage,
});

console.log("==========================================");
console.log("  KidBoard Device Simulator (ESP32-S3 Mock) ");
console.log("==========================================");
console.log(`API Base: ${sim.apiBaseUrl}`);
console.log(`Hardware ID: ${sim.getNvsState().hardwareId}`);
console.log(`Device Nonce: ${sim.getNvsState().deviceNonce}`);
console.log(`Current Frame Version: ${sim.getNvsState().frameVersion}`);
console.log(`Device Token: ${sim.getNvsState().deviceToken ? "[Configured]" : "[Unpaired]"}`);
console.log("------------------------------------------");

async function run() {
  const state = sim.getNvsState();
  if (!state.deviceToken) {
    console.log("设备尚未配对，正在向服务端申请 6 位配对码...");
    try {
      const pair = await sim.initPairing();
      console.log(`\n【请在 Web 端认领设备】`);
      console.log(`配对码 (Code): >>>  ${pair.code}  <<<`);
      console.log(`Pairing ID: ${pair.pairingId}`);
      console.log(`过期时间: ${pair.expiresAt}`);
      console.log("\n正在等待家长认领 (按 Ctrl+C 退出)...");

      while (!sim.getNvsState().deviceToken) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await sim.pollPairingStatus(pair.pairingId);
        if (st.status === "paired") {
          console.log("✓ 设备认领成功！Token 已写入虚拟 NVS。");
          break;
        } else if (st.status === "expired") {
          console.error("✗ 配对码已过期，请重新运行。");
          process.exit(1);
        }
      }
    } catch (err: unknown) {
      console.error("配对初始化异常:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  console.log("\n开始进入周期同步循环 (每 30 秒)...");
  const tick = async () => {
    try {
      const outcome = await sim.sync();
      console.log(`[${new Date().toLocaleTimeString()}] Sync: ${outcome.action} | Frame: v${outcome.frameVersion} | Mode: ${outcome.refreshMode || "none"}`);
      if (outcome.action === "downloaded") {
        console.log("\n--- 屏幕预览 (ASCII 降采样) ---");
        console.log(sim.getAsciiPreview(32, 48));
        console.log("-------------------------------\n");
      }
    } catch (err: unknown) {
      console.error("Sync error:", err instanceof Error ? err.message : String(err));
    }
  };

  await tick();
  setInterval(tick, 30_000);
}

run().catch((e) => {
  console.error("Simulator Fatal:", e);
  process.exit(1);
});
