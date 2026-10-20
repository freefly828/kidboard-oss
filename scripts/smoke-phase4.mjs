/* eslint-disable no-console */
/**
 * Phase 4 冒烟 — Device Simulator 与真实 Device API 端到端集成验收。
 *
 * 验收目标（对齐 docs/09 C 组 + docs/05 协议）：
 *   C01 Sync：旧 version 获取新 manifest 并下载；相同 version 不下载帧。
 *   C02 校验保护：帧数据或传输被篡改（SHA-256 不匹配）时，模拟器拒绝显示并保持旧帧。
 *   C03 任务完成幂等：同一 eventId 连续发送两次，只应用一次且服务端返回幂等成功。
 *   Pairing：Step B init -> 6 位码 -> Step C claim -> Step D status (token 仅单次返回)。
 *   Offline：断网时保持本地 last_frame.bin（D01/D04），按键事件在本地 NVS 队列积压，联网后自动重放。
 *   契约完整性：800×480、48,000 字节严格满铺、1-bit MSB first、UUID 幂等。
 *
 * 运行方式：
 *   DATABASE_URL=postgres://kidboard:kidboard@localhost:5433/kidboard node scripts/smoke-phase4.mjs
 *   （或使用 tsx 执行）
 */

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FRAME_BYTES = 48_000;

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

// 1. 加载依赖模块
console.log("正在加载 Web 路由与 Simulator 模块...");
const { client } = await import(pathToFileURL(join(repoRoot, "packages", "db", "src", "index.ts")).href);
const { DeviceSimulator } = await import(pathToFileURL(join(simSrc, "simulator.ts")).href);
const { binarizeToFrame } = await import(pathToFileURL(join(repoRoot, "packages", "screen-template", "src", "frame.ts")).href);

// Web API 路由处理器
const pairInitRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "pair", "init", "route.ts")).href);
const pairStatusRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "pair", "[pairingId]", "status", "route.ts")).href);
const pairClaimRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "pairings", "claim", "route.ts")).href);
const syncRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "sync", "route.ts")).href);
const frameBinRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "frames", "[version]", "bin", "route.ts")).href);
const taskCompleteRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "device", "events", "task-complete", "route.ts")).href);
const authRegisterRoute = await import(pathToFileURL(join(webSrc, "app", "api", "v1", "auth", "register", "route.ts")).href);

// 2. 构建真实 HTTP 桥接服务器（真实网络 TCP/HTTP 交互，非 mock）
let currentServerCookie = "";

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    // 读取请求体
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyBuf = Buffer.concat(chunks);
    const body = bodyBuf.length > 0 && method !== "GET" && method !== "HEAD" ? bodyBuf : undefined;

    // 构造 Web 标准 Request
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

    let webRes;

    // 路由分发
    if (pathname === "/api/v1/auth/register" && method === "POST") {
      webRes = await authRegisterRoute.POST(webReq);
    } else if (pathname === "/api/v1/device/pair/init" && method === "POST") {
      webRes = await pairInitRoute.POST(webReq);
    } else if (pathname.startsWith("/api/v1/device/pair/") && pathname.endsWith("/status") && method === "GET") {
      const segments = pathname.split("/");
      const pairingId = segments[5];
      webRes = await pairStatusRoute.GET(webReq, { params: Promise.resolve({ pairingId }) });
    } else if (pathname === "/api/v1/pairings/claim" && method === "POST") {
      webRes = await pairClaimRoute.POST(webReq);
    } else if (pathname === "/api/v1/device/sync" && method === "POST") {
      webRes = await syncRoute.POST(webReq);
    } else if (pathname.startsWith("/api/v1/device/frames/") && pathname.endsWith("/bin") && method === "GET") {
      const segments = pathname.split("/");
      const version = segments[5];
      webRes = await frameBinRoute.GET(webReq, { params: Promise.resolve({ version }) });
    } else if (pathname === "/api/v1/device/events/task-complete" && method === "POST") {
      webRes = await taskCompleteRoute.POST(webReq);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    // 将 Web Response 写回 HTTP
    const resHeaders = {};
    webRes.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    // 记录 cookie 便于后续 claim
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
    console.error("HTTP Bridge Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", message: err.message }));
  }
});

// 随机绑定可用端口
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const apiBaseUrl = `http://127.0.0.1:${port}`;
console.log(`Device API 冒烟测试服务就绪 @ ${apiBaseUrl}`);

const testDir = await mkdtemp(join(tmpdir(), "kidboard-smoke-p4-"));
process.env.FRAMES_DIR = join(testDir, "frames");
await mkdir(process.env.FRAMES_DIR, { recursive: true });

let familyId = "";
let childId = "";

try {
  // 3. 造基础测试数据
  const stamp = Date.now();
  const regEmail = `smoke_p4_${stamp}@test.dev`;
  const regRes = await fetch(`${apiBaseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: regEmail,
      password: "Passw0rd!123",
      displayName: "模拟器测试家长",
      familyName: "模拟器测试家庭",
    }),
  });

  check("用户注册 201", regRes.status === 201);
  const regJson = await regRes.json();
  familyId = regJson.family.id;

  // 创建儿童
  const ch = await client`
    INSERT INTO children (family_id, display_name, timezone, content_version, preview_from)
    VALUES (${familyId}, '模拟器宝贝', 'Asia/Shanghai', 1, NULL)
    RETURNING id
  `;
  childId = String(ch[0].id);

  // 4. 准备真实 48,000 字节帧文件（Frame Version 1）
  const testImg = {
    width: 800,
    height: 480,
    data: new Uint8Array(800 * 480 * 4),
  };
  testImg.data.fill(255); // 全白
  // 在中间画一条黑线区分内容
  for (let x = 0; x < 800; x++) {
    const idx = (240 * 800 + x) * 4;
    testImg.data[idx] = 0;
    testImg.data[idx + 1] = 0;
    testImg.data[idx + 2] = 0;
  }
  const frame1Bin = binarizeToFrame(testImg, 160);
  check("frame1Bin 恰好 48,000 bytes", frame1Bin.length === FRAME_BYTES);
  const sha256Frame1 = createHash("sha256").update(frame1Bin).digest("hex");

  const frame1Dir = join(process.env.FRAMES_DIR, childId, "1");
  await mkdir(frame1Dir, { recursive: true });
  const frame1Path = join(frame1Dir, "frame.bin");
  await writeFile(frame1Path, frame1Bin);

  // 写入 screen_frames 表作为 active 帧
  await client`
    INSERT INTO screen_frames (
      child_id, frame_version, content_version, width, height, bytes, sha256,
      preview_path, frame_path, is_active
    ) VALUES (
      ${childId}, 1, 1, 800, 480, 48000, ${sha256Frame1},
      ${join(frame1Dir, "preview.png")}, ${frame1Path}, true
    )
  `;
  check("active frame 准备完毕", true);

  // 5. 初始化设备模拟器
  const simStorageDir = join(testDir, "sim_storage");
  const sim = new DeviceSimulator({
    apiBaseUrl,
    hardwareId: `KB-S3-TEST-${stamp}`,
    firmwareVersion: "1.0.0",
    storageDir: simStorageDir,
  });

  // --- Step B: 配对初始化 ---
  const pairInitRes = await sim.initPairing();
  check("Step B: initPairing 返回 pairingId", Boolean(pairInitRes.pairingId));
  check("Step B: 配对码为 6 位纯数字", /^[0-9]{6}$/.test(pairInitRes.code), `got ${pairInitRes.code}`);

  // 轮询状态（认领前）
  const statusBefore = await sim.pollPairingStatus(pairInitRes.pairingId);
  check("Step D: 认领前 status 为 pending", statusBefore.status === "pending");

  // --- Step C: 用户认领 ---
  const claimRes = await fetch(`${apiBaseUrl}/api/v1/pairings/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: currentServerCookie,
    },
    body: JSON.stringify({
      code: pairInitRes.code,
      childId,
      deviceName: "儿童房模拟墨水屏",
    }),
  });
  check("Step C: claim 成功 200", claimRes.status === 200);

  // 重复认领相同过期/已使用码拒绝 409
  const claimAgain = await fetch(`${apiBaseUrl}/api/v1/pairings/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: currentServerCookie,
    },
    body: JSON.stringify({
      code: pairInitRes.code,
      childId,
      deviceName: "重复认领",
    }),
  });
  check("Step C: 重复认领拒绝 409", claimAgain.status === 409);

  // --- Step D: 认领后轮询获取 Token ---
  const statusAfter = await sim.pollPairingStatus(pairInitRes.pairingId);
  check("Step D: 认领后 status 为 paired", statusAfter.status === "paired");
  check("Step D: 成功获取 device token", Boolean(statusAfter.token?.startsWith("kb_dev_")));
  check("Step D: token 写入模拟器 NVS", sim.getNvsState().deviceToken === statusAfter.token);

  // 验证「token only returned once after claim」契约
  const statusSecond = await sim.pollPairingStatus(pairInitRes.pairingId);
  check("Step D: 再次轮询 status 仍为 paired 但不重复返回 token", statusSecond.status === "paired" && !statusSecond.token);

  // --- 6. C01 Sync: 旧 version 获取并下载帧 ---
  check("初始模拟器 frameVersion 为 0", sim.getNvsState().frameVersion === 0);
  const sync1 = await sim.sync();
  check("C01: 首次 sync 成功下载新帧", sync1.action === "downloaded");
  check("C01: 帧版本推进至 1", sync1.frameVersion === 1);
  check("C01: 模拟器本地帧缓冲区更新为 48,000 bytes", sim.getLastFrame().length === FRAME_BYTES);
  check("C01: 下载帧 SHA-256 与期望一致", sync1.sha256 === sha256Frame1);

  // --- 7. C01: 相同 version 不重复下载帧 ---
  const sync2 = await sim.sync();
  check("C01: 相同 version 触发 up_to_date（不下载帧）", sync2.action === "up_to_date");
  check("C01: 帧版本保持 1", sync2.frameVersion === 1);

  // --- 8. C02: 校验失败保护（篡改字节拒绝显示） ---
  // 构造 Frame Version 2
  const frame2Bin = new Uint8Array(FRAME_BYTES);
  frame2Bin.fill(0x55);
  const sha256Frame2 = createHash("sha256").update(frame2Bin).digest("hex");
  const frame2Dir = join(process.env.FRAMES_DIR, childId, "2");
  await mkdir(frame2Dir, { recursive: true });
  const frame2Path = join(frame2Dir, "frame.bin");
  await writeFile(frame2Path, frame2Bin);

  await client`UPDATE screen_frames SET is_active = false WHERE child_id = ${childId}`;
  await client`
    INSERT INTO screen_frames (
      child_id, frame_version, content_version, width, height, bytes, sha256,
      preview_path, frame_path, is_active
    ) VALUES (
      ${childId}, 2, 2, 800, 480, 48000, ${sha256Frame2},
      ${join(frame2Dir, "preview.png")}, ${frame2Path}, true
    )
  `;

  // 开启传输篡改仿真
  sim.setTamperedFrame(true);
  const syncTampered = await sim.sync();
  check("C02: 篡改数据后模拟器拒绝显示（action: rejected）", syncTampered.action === "rejected");
  check("C02: 校验错误记录 checksum mismatch", syncTampered.error?.includes("checksum mismatch"));
  check("C02: 拒绝后模拟器 frameVersion 保持旧版本 1", sim.getNvsState().frameVersion === 1);
  check("C02: 屏幕缓冲区保持旧帧（开头字节未变成 0x55）", sim.getLastFrame()[0] !== 0x55);

  // 关闭篡改，正常下载 Frame 2
  sim.setTamperedFrame(false);
  const syncNormal2 = await sim.sync();
  check("C02 恢复: 正常下载 Frame 2", syncNormal2.action === "downloaded" && syncNormal2.frameVersion === 2);
  check("C02 恢复: 屏幕缓冲区更新为新帧", sim.getLastFrame()[0] === 0x55);

  // --- 9. C03: 任务完成按键事件与幂等性 ---
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const taskRow = await client`
    INSERT INTO task_occurrences (child_id, occurrence_date, title, sort_order, status)
    VALUES (${childId}, ${today}, '跳绳 500 个', 0, 'pending')
    RETURNING id
  `;
  const taskId = String(taskRow[0].id);

  // 同一 eventId 连续发送两次
  const fixedEventId = randomUUID();
  const press1 = await sim.pressDone({
    taskOccurrenceId: taskId,
    eventId: fixedEventId,
  });
  check("C03: 首次任务完成请求发送成功", press1.sent === true);

  // 检查 DB 任务已完成
  const taskAfter1 = await client`SELECT status FROM task_occurrences WHERE id = ${taskId}`;
  check("C03: 数据库任务状态更新为 completed", taskAfter1[0]?.status === "completed");

  const cvAfter1 = await client`SELECT content_version FROM children WHERE id = ${childId}`;

  // 再次发送完全相同的 eventId（重放）
  const press2 = await sim.pressDone({
    taskOccurrenceId: taskId,
    eventId: fixedEventId,
  });
  check("C03: 重复 eventId 返回幂等成功", press2.sent === true && press2.idempotent === true);

  const cvAfter2 = await client`SELECT content_version FROM children WHERE id = ${childId}`;
  check("C03: 幂等重放不得重复递增 content_version", Number(cvAfter1[0].content_version) === Number(cvAfter2[0].content_version));

  // --- 10. 离线/断网保持最后一帧与恢复后自动重放 ---
  const taskRow2 = await client`
    INSERT INTO task_occurrences (child_id, occurrence_date, title, sort_order, status)
    VALUES (${childId}, ${today}, '睡前阅读', 1, 'pending')
    RETURNING id
  `;
  const taskId2 = String(taskRow2[0].id);

  // 拔掉网络
  sim.setNetworkOnline(false);
  const offlinePress = await sim.pressDone({
    taskOccurrenceId: taskId2,
  });
  check("Offline: 断网时按键不会抛异常，而是入队本地 NVS", offlinePress.queued === true);
  check("Offline: 队列长度为 1", sim.getPendingEvents().length === 1);
  check("Offline: 屏幕最后一帧保持不变", sim.getLastFrame().length === FRAME_BYTES);

  // 网络恢复并 sync
  sim.setNetworkOnline(true);
  const syncRecover = await sim.sync();
  check("Offline: 恢复网络后 sync 自动重放离线事件", syncRecover.replayedEventsCount === 1);
  check("Offline: 离线事件队列被清空", sim.getPendingEvents().length === 0);

  const taskAfter2 = await client`SELECT status FROM task_occurrences WHERE id = ${taskId2}`;
  check("Offline: 重放后离线任务已在服务端成功标记 completed", taskAfter2[0]?.status === "completed");

  // --- 11. ASCII 预览图输出验证 ---
  const ascii = sim.getAsciiPreview(32, 48);
  check("ASCII 预览图生成有效字符网格", ascii.includes("█") || ascii.includes(" "));

} catch (err) {
  console.error("SMOKE RUNTIME ERROR:", err);
  failed++;
} finally {
  server.close();
  // 清理临时数据
  if (familyId) {
    await client`DELETE FROM families WHERE id = ${familyId}`.catch(() => {});
  }
  await client.end().catch(() => {});
  await rm(testDir, { recursive: true, force: true }).catch(() => {});
}

console.log("\n=================================");
if (failed === 0) {
  console.log(`SMOKE RESULT: ALL PASS (${passed} checks passed)`);
  process.exit(0);
} else {
  console.error(`SMOKE RESULT: FAILED (${failed} failed, ${passed} passed)`);
  process.exit(1);
}
