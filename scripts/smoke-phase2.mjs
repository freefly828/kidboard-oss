/* eslint-disable no-console */
/**
 * Phase 2 compose 集成冒烟 - 预览页与模板链路。
 * 前置: compose up(WEB_PORT=3100)+ migrate:sql 已执行 + Phase 1 smoke 已注册的用户存在。
 * 本脚本自建用户/数据,不依赖 Phase 1 冒烟残留。
 */

const B = process.env.SMOKE_BASE ?? "http://localhost:3100";
let cookie = "";

async function req(method, path, body) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    if (c.startsWith("kidboard_session=")) cookie = c.split(";")[0];
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 非 JSON 响应：下面回退读取 text
  }
  return { status: res.status, json, text: json ? null : await res.text().catch(() => null) };
}

let failed = 0;
function check(label, cond, detail = "") {
  if (cond) console.log(`PASS ${label}`);
  else {
    failed++;
    console.error(`FAIL ${label} ${detail}`);
  }
}

const stamp = Date.now();
const email = `p2_${stamp}@test.dev`;

// --- 1. fixtures 总览页: 8 套 fixture 全渲染 ---
const fx = await fetch(B + "/preview/fixtures");
const fxHtml = await fx.text();
check("fixtures page 200", fx.status === 200, `got ${fx.status}`);
check(
  "fixtures page renders all 8",
  [
    "emptyDay",
    "fullSchedule",
    "fullTasks",
    "allCompleted",
    "longChinese",
    "mixedContent",
    "offlineState",
    "largeFontEdge",
  ].every((n) => fxHtml.includes(n)),
);
check("fixtures page uses template (今日安排)", fxHtml.includes("今日安排"));
check("fixtures page no remote fonts", !fxHtml.includes("fonts.googleapis"));
// Next App Router 自带框架 <script>（hydration 用），与模板无关;
// 模板约束的“禁 script”针对墨水屏渲染产物（Phase 3 renderer 用独立纯 HTML）。
// 此处精确匹配真实事件属性（onclick/onerror 等）；Next 的 nonce= 属性不算。
check(
  "template markup no event handlers",
  !/\son(click|error|load|change|input|submit|mouseover|keydown|keyup|focus|blur)="/.test(fxHtml),
);

// --- 2. 未登录访问实数据预览 → 不可用态(Server Component 渲染错误态而非 200 数据)---
const pre = await fetch(B + "/preview/00000000-0000-0000-0000-000000000000");
check("unauth preview returns error state", pre.status === 200 || pre.status === 401 || pre.status === 403, `got ${pre.status}`);
const preHtml = await pre.text();
check(
  "unauth preview shows unavailable, not child data",
  preHtml.includes("不可用") || pre.status !== 200,
);

// --- 3. 注册→建儿童→铺数据→实数据预览渲染 ---
await req("POST", "/api/v1/auth/register", {
  email,
  password: "Passw0rd!123",
  displayName: "P2家长",
  familyName: "P2家庭",
});
check("register ok", cookie.length > 0);

let r = await req("POST", "/api/v1/children", { displayName: "屏测娃", timezone: "Asia/Shanghai" });
const childId = r.json?.child?.id;
check("child created", childId != null, JSON.stringify(r.json));

// 周三课程(今天 2026-09-16 是周三)
r = await req("POST", `/api/v1/children/${childId}/schedule`, {
  weekday: 3, startMinute: 500, endMinute: 550, title: "数学", sortOrder: 0, active: true,
});
check("schedule created", r.status === 201);

// 任务模板(工作日晨读 → 今天物化)
r = await req("POST", `/api/v1/children/${childId}/task-templates`, {
  title: "晨读",
  recurrence: { type: "weekly", weekdays: [1, 2, 3, 4, 5], startDate: "2026-09-01", endDate: null },
  estimatedMinutes: 15, priority: 0, sortOrder: 0,
});
check("template created", r.status === 201);

// 留言
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
r = await req("PUT", `/api/v1/children/${childId}/message`, {
  messageDate: today, body: "预览链路测试留言。",
});
check("message saved", r.status === 200);

// 实数据预览页
const pv = await fetch(B + `/preview/${childId}`, { headers: { cookie } });
const pvHtml = await pv.text();
check("preview page 200", pv.status === 200, `got ${pv.status}`);
check("preview renders date header", /20\d{2}年\d+月\d+日/.test(pvHtml), "date header missing");
check("preview renders child name", pvHtml.includes("屏测娃"));
check("preview renders schedule item", pvHtml.includes("数学"));
check("preview renders task with focus marker", pvHtml.includes("晨读"));
check("preview renders message", pvHtml.includes("预览链路测试留言"));
check("preview renders footer keys", pvHtml.includes("DONE") && pvHtml.includes("NEXT"));
check("preview 800x480 frame present", pvHtml.includes("800px"));
check("preview no animation", !pvHtml.includes("animation"));
check("preview no remote font", !pvHtml.includes("fonts.googleapis"));
check("preview no network image", !/<img[^]+src=["']https?:/.test(pvHtml));

// --- 4. 越权: 他人会话访问该 child 预览 → 不可用态 ---
const saved = cookie;
cookie = "";
await req("POST", "/api/v1/auth/register", {
  email: `evil_p2_${stamp}@test.dev`, password: "Passw0rd!123", displayName: "路人",
});
const evil = await fetch(B + `/preview/${childId}`, { headers: { cookie } });
const evilHtml = await evil.text();
check(
  "cross-family preview blocked",
  evilHtml.includes("不可用") || evilHtml.includes("403") || evilHtml.includes("404"),
  `status=${evil.status}`,
);
cookie = saved;

console.log(failed === 0 ? "\nSMOKE RESULT: ALL PASS" : `\nSMOKE RESULT: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
