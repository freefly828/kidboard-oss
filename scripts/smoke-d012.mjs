/* eslint-disable no-console */
/**
 * D-012 冒烟：积分 / 心愿商城 / 家庭邀请 / 统计 / 留言 / 设备管理 API 全链路。
 * 用独立测试账号与测试孩子，结束时删除测试孩子（级联清理积分、兑换等）。
 * 用法：BASE_URL=http://localhost:3001 node scripts/smoke-d012.mjs
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const stamp = Date.now();
let passed = 0;
let failed = 0;

function check(cond, name, detail) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
  }
}

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  };
}

const owner = client();
const guardian = client();
const outsider = client();
let childId = null;

try {
  // --- 注册 owner + 孩子 ---
  let r = await owner("POST", "/api/v1/auth/register", {
    email: `smoke-d012-owner-${stamp}@kidboard.test`,
    password: "smoke-pass-123",
    displayName: "冒烟家长",
    familyName: "冒烟之家",
  });
  check(r.status === 201, "owner register", r);
  r = await owner("POST", "/api/v1/children", { displayName: "冒烟孩子" });
  childId = r.json?.child?.id;
  check(r.status === 201 && childId, "create child", r);
  const C = `/api/v1/children/${childId}`;

  // --- 儿童档案扩展 ---
  r = await owner("PATCH", C, { profile: { gender: "girl", birthYear: 2019, grade: "一年级", interests: ["阅读", "画画"], wakeTime: "07:00", bedTime: "21:00" } });
  check(r.status === 200 && r.json.child.profile.grade === "一年级", "child profile saved", r);
  r = await owner("PATCH", C, { profile: { wakeTime: "25:00" } });
  check(r.status === 400, "invalid profile rejected (400)", r);

  // --- 任务分值 + 完成自动入账 + 取消完成撤销 ---
  r = await owner("POST", `${C}/tasks`, { title: "阅读 20 分钟", category: "学习", points: 10, estimatedMinutes: 20 });
  const taskId = r.json?.task?.id;
  check(r.status === 201 && r.json.task.points === 10 && r.json.task.category === "学习", "task with category/points", r);
  r = await owner("PATCH", `${C}/tasks/${taskId}`, { status: "completed" });
  check(r.status === 200, "complete task", r);
  r = await owner("GET", `${C}/points`);
  check(r.json.balance === 10 && r.json.ledger[0]?.kind === "task", "completion awards points", r.json);
  r = await owner("PATCH", `${C}/tasks/${taskId}`, { status: "completed" });
  r = await owner("GET", `${C}/points`);
  check(r.json.balance === 10, "re-complete does not double award", r.json);
  r = await owner("PATCH", `${C}/tasks/${taskId}`, { points: 15 });
  r = await owner("GET", `${C}/points`);
  check(r.json.balance === 15, "editing points of a completed task updates award", r.json);
  r = await owner("PATCH", `${C}/tasks/${taskId}`, { status: "pending" });
  r = await owner("GET", `${C}/points`);
  check(r.json.balance === 0, "un-complete reverts award", r.json);
  await owner("PATCH", `${C}/tasks/${taskId}`, { status: "completed" });

  // --- 手动奖惩 ---
  r = await owner("POST", `${C}/points`, { delta: 100, reason: "主动帮忙做家务" });
  check(r.status === 201 && r.json.balance === 115, "manual +100", r);
  r = await owner("POST", `${C}/points`, { delta: -1000, reason: "超额扣分" });
  check(r.status === 400, "cannot go negative", r);

  // --- 心愿商城：上架、兑换、驳回退分、核销 ---
  r = await owner("POST", `${C}/rewards`, { title: "周末去公园", icon: "🌳", cost: 50, stock: 1 });
  const rewardId = r.json?.reward?.id;
  check(r.status === 201, "create reward", r);
  r = await owner("POST", `${C}/redemptions`, { rewardId });
  const red1 = r.json?.redemption?.id;
  check(r.status === 201 && r.json.balance === 65, "redeem deducts points", r);
  r = await owner("POST", `${C}/redemptions`, { rewardId });
  check(r.status === 409, "stock exhausted -> 409", r);
  r = await owner("PATCH", `${C}/redemptions/${red1}`, { status: "rejected" });
  check(r.status === 200 && r.json.balance === 115, "reject refunds points", r);
  r = await owner("POST", `${C}/redemptions`, { rewardId });
  const red2 = r.json?.redemption?.id;
  check(r.status === 201, "stock restored after reject", r);
  r = await owner("PATCH", `${C}/redemptions/${red2}`, { status: "fulfilled" });
  check(r.status === 200 && r.json.redemption.status === "fulfilled", "fulfill redemption", r);
  r = await owner("PATCH", `${C}/redemptions/${red2}`, { status: "rejected" });
  check(r.status === 409, "decided redemption is final", r);
  r = await owner("POST", `${C}/rewards`, { title: "超贵奖品", cost: 99999 });
  r = await owner("POST", `${C}/redemptions`, { rewardId: r.json.reward.id });
  check(r.status === 400, "insufficient points -> 400", r);

  // --- 家庭邀请：创建、带码注册加入、角色、撤销、权限 ---
  r = await owner("POST", "/api/v1/family/invitations", { role: "guardian" });
  const code = r.json?.code;
  check(r.status === 201 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code ?? ""), "create invitation code", r);
  r = await guardian("POST", "/api/v1/auth/register", {
    email: `smoke-d012-guardian-${stamp}@kidboard.test`,
    password: "smoke-pass-123",
    displayName: "冒烟爷爷",
    inviteCode: code.toLowerCase(),
  });
  check(r.status === 201 && r.json.family.name === "冒烟之家", "register with invite joins family", r);
  r = await guardian("GET", `${C}/points`);
  check(r.status === 200, "guardian can access child", r);
  r = await outsider("POST", "/api/v1/auth/register", {
    email: `smoke-d012-outsider-${stamp}@kidboard.test`,
    password: "smoke-pass-123",
    displayName: "外人",
    inviteCode: code,
  });
  check(r.status === 400, "invite code is single-use", r);
  r = await outsider("POST", "/api/v1/auth/register", {
    email: `smoke-d012-outsider2-${stamp}@kidboard.test`,
    password: "smoke-pass-123",
    displayName: "外人",
  });
  r = await outsider("GET", `${C}/points`);
  check(r.status === 403, "outsider cannot access child (403)", r);
  r = await owner("GET", "/api/v1/family");
  check(r.status === 200 && r.json.members.length === 2 && r.json.myRole === "owner", "family members listed", r.json);
  const guardianId = r.json.members.find((m) => !m.isMe)?.userId;
  r = await guardian("POST", "/api/v1/family/invitations", { role: "guardian" });
  check(r.status === 403, "guardian cannot invite", r);
  r = await owner("PATCH", `/api/v1/family/members/${guardianId}`, { role: "viewer" });
  check(r.status === 200, "owner changes role", r);
  r = await guardian("POST", `${C}/points`, { delta: 5, reason: "viewer 试图加分" });
  check(r.status === 403, "viewer cannot write", r);
  const meId = (await owner("GET", "/api/v1/family")).json.members.find((m) => m.isMe).userId;
  r = await owner("PATCH", `/api/v1/family/members/${meId}`, { role: "guardian" });
  check(r.status === 409, "last owner cannot be demoted", r);
  r = await owner("POST", "/api/v1/family/invitations", { role: "viewer" });
  const invId = r.json.invitation.id;
  r = await owner("DELETE", `/api/v1/family/invitations/${invId}`);
  check(r.status === 200, "revoke invitation", r);
  r = await owner("PATCH", "/api/v1/family", { name: "冒烟新家" });
  check(r.status === 200 && r.json.family.name === "冒烟新家", "rename family", r);

  // --- 留言历史 / 撤下 ---
  await owner("PUT", `${C}/message`, { body: "冒烟留言" });
  r = await owner("GET", `${C}/messages?days=7`);
  check(r.status === 200 && r.json.messages[0]?.body === "冒烟留言", "message history", r.json);
  r = await owner("DELETE", `${C}/message`);
  check(r.status === 200 && r.json.removed === 1, "remove today's message", r);

  // --- 统计 ---
  r = await owner("GET", `${C}/stats?days=7`);
  check(
    r.status === 200 && r.json.daily.length === 7 && r.json.totals.completed === 1 && r.json.streakDays === 1 && r.json.totals.balance === 65,
    "stats computed",
    r.json,
  );

  // --- 个人资料 / 密码 ---
  r = await owner("PATCH", "/api/v1/auth/me", { displayName: "冒烟妈妈" });
  check(r.status === 200 && r.json.user.displayName === "冒烟妈妈", "update display name", r);
  r = await owner("POST", "/api/v1/auth/password", { currentPassword: "wrong", newPassword: "smoke-pass-456" });
  check(r.status === 400, "wrong current password rejected", r);
  r = await owner("POST", "/api/v1/auth/password", { currentPassword: "smoke-pass-123", newPassword: "smoke-pass-456" });
  check(r.status === 200, "change password", r);
  r = await owner("GET", "/api/v1/auth/me");
  check(r.status === 200, "current session survives password change", r);
} catch (err) {
  failed++;
  console.log("FAIL unexpected error", err);
} finally {
  if (childId) {
    const r = await owner("DELETE", `/api/v1/children/${childId}`);
    console.log(`cleanup child: ${r.status}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
