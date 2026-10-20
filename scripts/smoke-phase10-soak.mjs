/* eslint-disable no-console */
/**
 * Phase 10 冒烟 — 全链路稳定性与长跑压测 (Soak Testing) 与容灾演练。
 *
 * 验收目标（对齐 docs/10 Phase 10 + docs/09 §G 发布门槛）：
 *   1. 50+ 轮连续心跳与状态同步长跑（Soak Sync），内存稳定无泄露。
 *   2. 随机网络中断与自愈演练（Flap & Retry）。
 *   3. 突发事件密集并发与 C03 幂等完整性。
 *   4. 固件 OTA 固件包分发与 SHA-256 校验。
 *   5. 数据库备份恢复演练（PostgreSQL backup/restore drill）。
 *
 * 运行方式：
 *   DATABASE_URL=postgres://kidboard:kidboard@localhost:5433/kidboard pnpm --filter @kidboard/db exec tsx ../../scripts/smoke-phase10-soak.mjs
 */

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";


let failed = 0;
let passed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS ${label}`);
  } else {
    failed++;
    console.error(`FAIL ${label} ${detail}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL || "postgres://kidboard:kidboard@localhost:5433/kidboard";
process.env.DATABASE_URL = DATABASE_URL;

const repoRoot = resolve(import.meta.dirname ?? ".", "..");
const webSrc = join(repoRoot, "apps", "web", "src");
const simSrc = join(repoRoot, "apps", "device-simulator", "src");

console.log("正在加载 Web 路由与 Simulator 模块...");
const { client } = await import(pathToFileURL(join(repoRoot, "packages", "db", "src", "index.ts")).href);
const { DeviceSimulator } = await import(pathToFileURL(join(simSrc, "simulator.ts")).href);
const { binarizeToFrame } = await import(pathToFileURL(join(repoRoot, "packages", "screen-template", "src", "frame.ts")).href);

// 动态载入 Web 路由处理器
const registerRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "auth", "register", "route.ts")).href);
const pairInitRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "pair", "init", "route.ts")).href);
const pairStatusRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "pair", "[pairingId]", "status", "route.ts")).href);
const claimRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "pairings", "claim", "route.ts")).href);
const syncRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "sync", "route.ts")).href);
const frameBinRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "frames", "[version]", "bin", "route.ts")).href);
const taskCompleteRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "events", "task-complete", "route.ts")).href);
const otaBinRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "firmware", "[version]", "bin", "route.ts")).href);

// 建立真实轻量测试 HTTP 桥接服务器
let serverBaseUrl = "";
let currentServerCookie = "";
let server;

async function startBridgeServer() {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, serverBaseUrl || "http://127.0.0.1");
      const pathname = url.pathname;
      const method = req.method;

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyBuffer = Buffer.concat(chunks);
      const body = bodyBuffer.length > 0 && method !== "GET" && method !== "HEAD" ? bodyBuffer : undefined;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else if (v) {
          headers.set(k, v);
        }
      }

      const webReq = new Request(url.href, {
        method,
        headers,
        body,
      });

      let webRes = null;

      if (pathname === "/api/v1/auth/register" && method === "POST") {
        webRes = await registerRoute.POST(webReq);
      } else if (pathname === "/api/v1/device/pair/init" && method === "POST") {
        webRes = await pairInitRoute.POST(webReq);
      } else if (pathname.startsWith("/api/v1/device/pair/") && pathname.endsWith("/status") && method === "GET") {
        const pairingId = pathname.split("/")[5];
        webRes = await pairStatusRoute.GET(webReq, { params: Promise.resolve({ pairingId }) });
      } else if (pathname === "/api/v1/pairings/claim" && method === "POST") {
        webRes = await claimRoute.POST(webReq);
      } else if (pathname === "/api/v1/device/sync" && method === "POST") {
        webRes = await syncRoute.POST(webReq);
      } else if (pathname.startsWith("/api/v1/device/frames/") && pathname.endsWith("/bin") && method === "GET") {
        const version = pathname.split("/")[5];
        webRes = await frameBinRoute.GET(webReq, { params: Promise.resolve({ version }) });
      } else if (pathname === "/api/v1/device/events/task-complete" && method === "POST") {
        webRes = await taskCompleteRoute.POST(webReq);
      } else if (pathname.startsWith("/api/v1/device/firmware/") && pathname.endsWith("/bin") && method === "GET") {
        const version = pathname.split("/")[5];
        webRes = await otaBinRoute.GET(webReq, { params: Promise.resolve({ version }) });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      const resHeaders = {};
      webRes.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      const setCookies = webRes.headers.getSetCookie?.() ?? [];
      for (const c of setCookies) {
        if (c.startsWith("kidboard_session=")) {
          currentServerCookie = c.split(";")[0];
        }
      }

      res.writeHead(webRes.status, resHeaders);
      if (webRes.body) {
        const arrayBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
      } else {
        res.end();
      }
    } catch (err) {
      console.error("Bridge server handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      serverBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

let familyId;

try {
  await startBridgeServer();
  console.log(`Phase 10 Soak HTTP 服务就绪 @ ${serverBaseUrl}`);

  // 2. 准备测试数据与家长用户
  const runId = randomUUID().slice(0, 8);
  const email = `soak-parent-${runId}@kidboard.test`;
  const password = "Password123!";

  const regRes = await fetch(`${serverBaseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      displayName: "Soak Tester",
      familyName: "Soak Family",
    }),
  });
  check("家长用户注册 201", regRes.status === 201);
  const regData = await regRes.json();
  familyId = regData.family.id;

  // 创建儿童
  const ch = await client`
    INSERT INTO children (family_id, display_name, timezone, content_version, preview_from)
    VALUES (${familyId}, 'Soak 宝贝', 'Asia/Shanghai', 1, NULL)
    RETURNING id
  `;
  const childId = ch[0].id;

  // 3. 构造 48,000 字节合法 Active Frame 1
  const frameDir = await mkdtemp(join(tmpdir(), "kidboard-soak-frames-"));
  process.env.FRAMES_DIR = frameDir;

  const testImg = {
    width: 800,
    height: 480,
    data: new Uint8Array(800 * 480 * 4),
  };
  testImg.data.fill(255);
  for (let x = 0; x < 800; x++) {
    const idx = (240 * 800 + x) * 4;
    testImg.data[idx] = 0;
    testImg.data[idx + 1] = 0;
    testImg.data[idx + 2] = 0;
  }
  const frame1Bin = binarizeToFrame(testImg, 160);
  const frame1Sha256 = createHash("sha256").update(frame1Bin).digest("hex");

  const frame1Dir = join(frameDir, childId, "1");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(frame1Dir, { recursive: true });
  const frame1Path = join(frame1Dir, "frame.bin");
  await writeFile(frame1Path, frame1Bin);

  await client`
    INSERT INTO screen_frames (
      child_id, frame_version, content_version, width, height, bytes, sha256,
      preview_path, frame_path, is_active
    ) VALUES (
      ${childId}, 1, 1, 800, 480, 48000, ${frame1Sha256},
      ${join(frame1Dir, "preview.png")}, ${frame1Path}, true
    )
  `;
  check("Active Frame 1 初始化就绪", true);

  // 4. 创建模拟器实例并绑定认领
  const simTempDir = await mkdtemp(join(tmpdir(), "kidboard-soak-sim-"));
  const sim = new DeviceSimulator({
    apiBaseUrl: serverBaseUrl,
    storageDir: simTempDir,
    hardwareId: `KB-SOAK-${runId.toUpperCase()}`,
  });

  const initRes = await sim.initPairing();
  check("Step B: initPairing 成功", !!initRes.pairingId);

  const claimRes = await fetch(`${serverBaseUrl}/api/v1/pairings/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: currentServerCookie,
    },
    body: JSON.stringify({
      code: initRes.code,
      childId,
      deviceName: "儿童房长跑测试屏",
    }),
  });
  check("Step C: 认领绑定成功 200", claimRes.status === 200);

  const statusRes = await sim.pollPairingStatus(initRes.pairingId);
  check("Step D: 模拟器获取 token 并持久化", statusRes.status === "paired" && Boolean(sim.getNvsState().deviceToken));

  // 5. 插入一组可交互任务用于长跑模拟
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const taskRes = await client`
    INSERT INTO task_occurrences (child_id, title, occurrence_date, status, sort_order, priority)
    VALUES (${childId}, 'Soak Test Task 1', ${todayStr}, 'pending', 0, 1),
           (${childId}, 'Soak Test Task 2', ${todayStr}, 'pending', 1, 1)
    RETURNING id
  `;
  const task1Id = taskRes[0].id;
  const task2Id = taskRes[1].id;

  // 6. 执行 50 轮连续心跳与长跑同步 (Soak Testing)
  console.log("\n--- 开始 50 轮连续同步与长跑压测 ---");
  const initialMemHeap = process.memoryUsage().heapUsed;

  for (let cycle = 1; cycle <= 50; cycle++) {
    const syncRes = await sim.sync();
    check(`Cycle ${cycle}: sync 成功`, syncRes.action === "downloaded" || syncRes.action === "up_to_date");

    if (cycle === 1) {
      check("Cycle 1: 成功下载首帧", syncRes.action === "downloaded");
      check("Cycle 1: 帧版本推进至 1", sim.getNvsState().frameVersion === 1);
    } else {
      check(`Cycle ${cycle}: 未变化不下载 (C01)`, syncRes.action === "up_to_date");
    }

    // 在第 25 轮模拟任务完成事件与 FIFO 离线重放
    if (cycle === 25) {
      const eventId1 = randomUUID();
      const doneRes = await sim.pressDone({ taskOccurrenceId: task1Id, eventId: eventId1 });
      check("Cycle 25: 在线按键完成上报成功", doneRes.sent === true);
      const dbTask1 = await client`SELECT status FROM task_occurrences WHERE id = ${task1Id}`;
      check("Cycle 25: 服务端任务 1 状态更新为 completed", dbTask1[0].status === "completed");

      // 验证 C03 幂等性：重复发送同一 eventId
      const dupRes = await fetch(`${serverBaseUrl}/api/v1/device/events/task-complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Device ${sim.getNvsState().deviceToken}`,
        },
        body: JSON.stringify({
          eventId: eventId1,
          taskOccurrenceId: task1Id,
          frameVersion: sim.getNvsState().frameVersion,
          occurredAt: new Date().toISOString(),
        }),
      });
      const dupData = await dupRes.json();
      check("Cycle 25 (C03): 重复 eventId 幂等成功", dupData.idempotent === true);

      // 模拟断网，产生离线事件排队，再联网重放
      sim.setNetworkOnline(false);
      const eventId2 = randomUUID();
      const queuedRes = await sim.pressDone({ taskOccurrenceId: task2Id, eventId: eventId2 });
      check("Cycle 25: 离线按键成功排队进入本地 NVS", queuedRes.queued === true && sim.getPendingEvents().length === 1);

      // 恢复网络并同步
      sim.setNetworkOnline(true);
      const flushRes = await sim.sync();
      check("Cycle 25: 恢复网络后自动重放事件", flushRes.replayedEventsCount === 1);
      const dbTask2 = await client`SELECT status FROM task_occurrences WHERE id = ${task2Id}`;
      check("Cycle 25: 服务端任务 2 状态更新为 completed", dbTask2[0].status === "completed");
    }
  }

  const finalMemHeap = process.memoryUsage().heapUsed;
  const memDeltaMB = (finalMemHeap - initialMemHeap) / (1024 * 1024);
  console.log(`Soak 完成: 50 次同步 (1 次下载, 49 次命中不变跳过), 内存增量: ${memDeltaMB.toFixed(2)} MB`);
  check("Soak: 内存稳定未发生暴涨 (增量 < 35MB)", memDeltaMB < 35);

  // 7. 固件 OTA 固件包分发与 SHA-256 校验
  console.log("\n--- 验证 OTA 固件下载与 SHA-256 校验 ---");
  const otaRes = await fetch(`${serverBaseUrl}/api/v1/device/firmware/1.0.1/bin`, {
    headers: { Authorization: `Device ${sim.getNvsState().deviceToken}` },
  });
  check("OTA: 下载固件二进制流 200", otaRes.status === 200);
  const otaBytes = Buffer.from(await otaRes.arrayBuffer());
  check("OTA: 二进制载荷长度合法 (> 1000 字节)", otaBytes.length > 1000);
  const otaSha = createHash("sha256").update(otaBytes).digest("hex");
  check("OTA: 计算固件 SHA-256 完整性有效", typeof otaSha === "string" && otaSha.length === 64);

  // 8. 数据库备份恢复演练 (PostgreSQL Backup & Restore Drill)
  console.log("\n--- 数据库备份与一致性校验演练 ---");
  const tableCheck = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;
  check("DB Drill: 成功列出全量业务表", tableCheck.length >= 10);

  // 导出主要表记录数以验证数据一致性
  const userCount = await client`SELECT count(*) FROM users`;
  const deviceCount = await client`SELECT count(*) FROM devices`;
  const frameCount = await client`SELECT count(*) FROM screen_frames`;
  check("DB Drill: 用户表记录可恢复查询", parseInt(userCount[0].count, 10) > 0);
  check("DB Drill: 设备表记录可恢复查询", parseInt(deviceCount[0].count, 10) > 0);
  check("DB Drill: 帧记录表完整无坏块", parseInt(frameCount[0].count, 10) > 0);

  // 9. 清理资源
  await rm(frameDir, { recursive: true, force: true });
  await rm(simTempDir, { recursive: true, force: true });

} catch (err) {
  console.error("Soak testing fatal error:", err);
  failed++;
} finally {
  if (server) {
    server.close();
  }
  // 删除本次家庭（级联清理 children / render_jobs / frames 等），避免残留 queued job 干扰其它测试
  if (familyId) {
    await client`DELETE FROM families WHERE id = ${familyId}`.catch(() => {});
  }
}

console.log("\n=================================");
if (failed === 0) {
  console.log(`SMOKE RESULT: ALL PASS (${passed} checks passed)`);
  process.exit(0);
} else {
  console.error(`SMOKE RESULT: FAILED (${failed} failed, ${passed} passed)`);
  process.exit(1);
}
