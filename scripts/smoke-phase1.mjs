/* eslint-disable no-console */
/**
 * Phase 1 compose 集成冒烟 — Node fetch + cookie 手动传递（绕开 PS 会话怪癖）。
 * 覆盖: 注册→me→建儿童→课程→任务模板→物化→完成→留言→超长拒绝→登出→401→幂等。
 * 退出码 0 = 全部断言通过。
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
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    if (c.startsWith("kidboard_session=")) cookie = c.split(";")[0];
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 非 JSON 响应（如 500 页面）→ 保持 null
  }
  return { status: res.status, json };
}

let failed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    failed++;
    console.error(`FAIL ${label} ${detail}`);
  }
}

const stamp = Date.now();
const email = `smoke_${stamp}@test.dev`;

// 1. 注册
let r = await req("POST", "/api/v1/auth/register", {
  email,
  password: "Passw0rd!123",
  displayName: "冒烟家长",
  familyName: "冒烟家庭",
});
check("register 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
check("register sets cookie", cookie.startsWith("kidboard_session="));

// 2. me
r = await req("GET", "/api/v1/auth/me");
check("me 200 owner", r.status === 200 && r.json.family?.role === "owner");

// 3. 重复注册拒绝
r = await req("POST", "/api/v1/auth/register", {
  email,
  password: "Passw0rd!123",
  displayName: "x",
});
check("duplicate register 409", r.status === 409, `got ${r.status}`);

// 4. 错误密码（不限速触发，避免锁定主账号）
r = await req("POST", "/api/v1/auth/login", { email, password: "wrong" });
check("bad password 401", r.status === 401, `got ${r.status}`);

// 5. 建儿童
r = await req("POST", "/api/v1/children", {
  displayName: "小冒烟",
  timezone: "Asia/Shanghai",
});
check("create child 201", r.status === 201, `got ${r.status}`);
const childId = r.json.child.id;
const cv0 = r.json.child.contentVersion;

// 6. 课程
r = await req("POST", `/api/v1/children/${childId}/schedule`, {
  weekday: 3,
  startMinute: 500,
  endMinute: 550,
  title: "数学",
  sortOrder: 0,
  active: true,
});
check("schedule POST 201 + cv bump", r.status === 201 && r.json.contentVersion === cv0 + 1, `got ${r.status} cv=${r.json?.contentVersion}`);

// 7. 非法时间拒绝
r = await req("POST", `/api/v1/children/${childId}/schedule`, {
  weekday: 3,
  startMinute: 550,
  endMinute: 550,
  title: "坏数据",
  sortOrder: 0,
  active: true,
});
check("schedule end<=start rejected 400", r.status === 400, `got ${r.status}`);

// 8. 任务模板（工作日晨读）→ 今天物化
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const isWorkday = [1, 2, 3, 4, 5].includes(
  new Date(today + "T00:00:00Z").getUTCDay() || 7,
);
r = await req("POST", `/api/v1/children/${childId}/task-templates`, {
  title: "晨读",
  recurrence: { type: "weekly", weekdays: [1, 2, 3, 4, 5], startDate: "2026-09-01", endDate: null },
  estimatedMinutes: 15,
  priority: 0,
  sortOrder: 0,
});
check(
  "template 201 + materialize today",
  r.status === 201 && r.json.materializedToday === (isWorkday ? 1 : 0),
  `got ${r.status} mat=${r.json?.materializedToday} isWorkday=${isWorkday}`,
);
const cvAfterTpl = r.json.contentVersion;

// 9. 任务列表（幂等物化，不重复）
r = await req("GET", `/api/v1/children/${childId}/tasks`);
const tasks = r.json.tasks;
check(
  "tasks GET 200 + idempotent materialize",
  r.status === 200 && tasks.filter((t) => t.title === "晨读").length === (isWorkday ? 1 : 0),
  `count=${tasks.length}`,
);
if (tasks.length > 0) {
  const task = tasks[0];
  r = await req("PATCH", `/api/v1/children/${childId}/tasks/${task.id}`, { status: "completed" });
  check(
    "task complete 200 + cv bump",
    r.status === 200 && r.json.task.status === "completed" && r.json.contentVersion > cvAfterTpl,
    `got ${r.status}`,
  );
  // 重复 PATCH 幂等（状态相同）
  r = await req("PATCH", `/api/v1/children/${childId}/tasks/${task.id}`, { status: "completed" });
  check("task re-complete idempotent 200", r.status === 200);
}

// 10. 留言
r = await req("PUT", `/api/v1/children/${childId}/message`, {
  messageDate: today,
  body: "今天英语完成后可以看一会儿动画片。",
});
check("message PUT 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
const cvAfterMsg = r.json.contentVersion;
r = await req("GET", `/api/v1/children/${childId}/message`);
check(
  "message GET roundtrip",
  r.status === 200 && r.json.message?.body === "今天英语完成后可以看一会儿动画片。",
);
// 再 PUT 同日 → 更新而非新建（active 唯一）
r = await req("PUT", `/api/v1/children/${childId}/message`, {
  messageDate: today,
  body: "更新后的留言",
});
check("message PUT same day updates (no dup)", r.status === 200 && r.json.contentVersion === cvAfterMsg + 1, `cv=${r.json?.contentVersion}`);

// 11. 超长留言拒绝（A05）
r = await req("PUT", `/api/v1/children/${childId}/message`, {
  messageDate: today,
  body: "a".repeat(61),
});
check("message 61 chars rejected 400", r.status === 400, `got ${r.status}`);

// 12. 越权防护：未登录访问 child 资源
const savedCookie = cookie;
cookie = "";
r = await req("GET", `/api/v1/children/${childId}/tasks`);
check("unauth child access 401", r.status === 401, `got ${r.status}`);
cookie = savedCookie;

// 13. 跨家庭隔离：新注册用户不能访问别人的 child
r = await req("POST", "/api/v1/auth/register", {
  email: `evil_${stamp}@test.dev`,
  password: "Passw0rd!123",
  displayName: "路人",
});
check("attacker registered", r.status === 201);
r = await req("GET", `/api/v1/children/${childId}/tasks`);
check("cross-family child access 403/404", r.status === 403 || r.status === 404, `got ${r.status}`);

// 14. 登出后 401
cookie = savedCookie;
r = await req("POST", "/api/v1/auth/logout");
check("logout 200", r.status === 200);
r = await req("GET", "/api/v1/auth/me");
check("me after logout 401", r.status === 401, `got ${r.status}`);

// 15. 登录限速（放最后，用独立 email，避免影响主流程）
const rlEmail = `ratelimit_${stamp}@test.dev`;
await req("POST", "/api/v1/auth/register", {
  email: rlEmail,
  password: "Passw0rd!123",
  displayName: "限速测试",
});
let lastStatus = 0;
for (let i = 0; i < 6; i++) {
  lastStatus = (await req("POST", "/api/v1/auth/login", { email: rlEmail, password: "wrong" })).status;
}
check("login rate-limited 429", lastStatus === 429, `got ${lastStatus}`);

console.log(failed === 0 ? "\nSMOKE RESULT: ALL PASS" : `\nSMOKE RESULT: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
