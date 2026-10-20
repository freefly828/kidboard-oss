"use client";

/**
 * 看板密码输入（D-020）：大号数字键盘，方便孩子在平板 / 手机上输入 4 位密码。
 * 成功后服务端设置该孩子看板的访问凭证，刷新页面即进入看板。
 */

import * as React from "react";
import { useRouter } from "next/navigation";

export default function BoardPinGate({ childId, childName }: { childId: string; childName: string }) {
  const router = useRouter();
  const [pin, setPin] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = React.useCallback(
    async (value: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/v1/children/${childId}/board-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: value }),
        });
        if (res.ok) {
          router.refresh();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; remaining?: number };
        const base = data.error?.message ?? "密码不对，再试一次";
        setMsg(res.status === 401 && typeof data.remaining === "number" ? `${base}（还能试 ${data.remaining} 次）` : base);
        setPin("");
      } catch {
        setMsg("网络不太好，请稍后再试");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [childId, router],
  );

  const press = (d: string) => {
    if (busy) return;
    if (d === "del") return setPin((p) => p.slice(0, -1));
    setPin((p) => {
      if (p.length >= 4) return p;
      const next = p + d;
      if (next.length === 4) void submit(next);
      return next;
    });
  };

  // 实体键盘也能输入
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="pin">
      <style>{CSS}</style>
      <div className="card">
        <div className="title">{childName}的看板</div>
        <div className="sub">请输入 4 位密码</div>
        <div className="dots" aria-label={`已输入 ${pin.length} 位`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? "dot on" : "dot"} />
          ))}
        </div>
        <div className="msg" role="alert">{msg ?? (busy ? "验证中…" : " ")}</div>
        <div className="pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
            k === "" ? (
              <span key={i} />
            ) : (
              <button key={i} type="button" disabled={busy} onClick={() => press(k)} aria-label={k === "del" ? "删除" : k}>
                {k === "del" ? "⌫" : k}
              </button>
            ),
          )}
        </div>
        <div className="hint">忘记密码请找爸爸妈妈在后台"孩子管理"里重设</div>
      </div>
    </main>
  );
}

const CSS = `
.pin { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f3f4f6; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 16px; box-sizing: border-box; }
.pin .card { background: #fff; border-radius: 20px; padding: 28px 24px; width: 100%; max-width: 360px; box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }
.pin .title { font-size: 24px; font-weight: 800; color: #111827; }
.pin .sub { font-size: 16px; color: #6b7280; margin-top: 6px; }
.pin .dots { display: flex; justify-content: center; gap: 16px; margin: 24px 0 8px; }
.pin .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #9ca3af; }
.pin .dot.on { background: #111827; border-color: #111827; }
.pin .msg { min-height: 22px; font-size: 15px; color: #dc2626; margin-bottom: 12px; }
.pin .pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.pin .pad button { height: 64px; font-size: 26px; font-weight: 700; border-radius: 14px; border: 1px solid #e5e7eb; background: #f9fafb; color: #111827; cursor: pointer; }
.pin .pad button:active { background: #e5e7eb; }
.pin .pad button:disabled { opacity: .5; }
.pin .hint { font-size: 13px; color: #9ca3af; margin-top: 18px; }
`;
