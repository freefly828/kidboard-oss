"use client";

/**
 * H5 看板附加页（D-024）：积分商城、本周课表、专注计时 —— 与墨水屏第 2~4 页同源数据，
 * 按手机 / 平板排版。专注计时可直接在看板上进行（服务器校验实际经过时间后发积分）。
 */

import * as React from "react";
import type { FocusPageVM, WeekPageVM } from "@kidboard/screen-template/pages";

export interface BoardPagesData {
  points: {
    balance: number;
    weekEarned: number;
    available: number;
    rewards: { title: string; cost: number }[];
    recent: { date: string; reason: string; delta: number }[];
  };
  week: WeekPageVM;
  focus: FocusPageVM;
}

/* ---------------- 积分商城 ---------------- */

export function PointsPanel({ data }: { data: BoardPagesData["points"] }) {
  return (
    <div className="kbb-grid">
      <section className="kbb-card kbb-balance">
        <h2>我的积分</h2>
        <div className="kbb-big">{data.balance}</div>
        <div className="kbb-sub">本周 +{data.weekEarned}</div>
        {data.available > 0 && <div className="kbb-avail">做完今天的任务还能得 +{data.available} 分</div>}
      </section>

      <section className="kbb-card">
        <h2>积分商城</h2>
        {data.rewards.length === 0 ? (
          <p className="kbb-empty">爸爸妈妈还没有上架奖励</p>
        ) : (
          <ul className="kbb-wishes">
            {data.rewards.map((w, i) => {
              const pct = Math.max(0, Math.min(100, Math.round((data.balance / w.cost) * 100)));
              const enough = data.balance >= w.cost;
              return (
                <li key={`${w.title}-${i}`}>
                  <div className="kbb-wish-row">
                    <span className="kbb-wish-title">{w.title}</span>
                    <span className="kbb-wish-cost">{w.cost} 分</span>
                  </div>
                  <div className="kbb-bar">
                    <i style={{ width: `${pct}%` }} className={enough ? "full" : ""} />
                  </div>
                  <div className={enough ? "kbb-wish-hint ok" : "kbb-wish-hint"}>
                    {enough ? "🎉 积分够了，可以找爸爸妈妈兑换！" : `还差 ${w.cost - data.balance} 分`}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="kbb-card kbb-msg">
        <h2>积分明细</h2>
        {data.recent.length === 0 ? (
          <p className="kbb-empty">还没有积分记录，完成任务就能得分</p>
        ) : (
          <ul className="kbb-ledger">
            {data.recent.map((r, i) => (
              <li key={i}>
                <span className="kbb-ledger-date">{r.date.slice(5).replace("-", "/")}</span>
                <span className="kbb-ledger-reason">{r.reason}</span>
                <span className={r.delta > 0 ? "kbb-ledger-delta plus" : "kbb-ledger-delta"}>
                  {r.delta > 0 ? "+" : ""}
                  {r.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- 墨水屏视图：设备同款附加页 ---------------- */

export function PageImage({ src }: { src: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <div className="kbb-page-img">
      {failed ? (
        <p className="kbb-empty" style={{ textAlign: "center" }}>墨水屏画面还在生成，稍后会自动出现</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="墨水屏画面" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/* ---------------- 本周课表 ---------------- */

export function WeekPanel({ data }: { data: WeekPageVM }) {
  return (
    <div className="kbb-week">
      {data.days.map((d) => (
        <section key={d.label} className={d.isToday ? "kbb-card kbb-day today" : "kbb-card kbb-day"}>
          <h2>
            {d.label}
            <span className="kbb-day-date">{d.dateLabel}</span>
            {d.isToday && <span className="kbb-next">今天</span>}
          </h2>
          {d.entries.length === 0 ? (
            <p className="kbb-empty">无课</p>
          ) : (
            <ul className="kbb-sched">
              {d.entries.map((e, i) => (
                <li key={`${e.time}-${i}`} className={e.title === "放学" ? "kbb-dismiss" : ""}>
                  <span className="kbb-time">{e.time}</span>
                  <span>{e.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/* ---------------- 专注计时 ---------------- */

interface FocusRun {
  id: string;
  minutes: number;
  /** 本地开始时间（ms）；暂停期间的时长累计在 pausedMs */
  startedMs: number;
  pausedMs: number;
  pausedAt: number | null;
}

function beep(times = 3) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.8;
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.setValueAtTime(0, t0 + 0.5);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    }
  } catch {
    // 浏览器不支持或未允许播放声音：忽略
  }
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function FocusPanel({ childId, data, canRun, onDone }: { childId: string; data: FocusPageVM; canRun: boolean; onDone: () => void }) {
  const storeKey = `kidboard.focus.${childId}`;
  const [run, setRun] = React.useState<FocusRun | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [result, setResult] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const completing = React.useRef(false);

  // 刷新页面后恢复进行中的计时
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved) setRun(JSON.parse(saved) as FocusRun);
    } catch {
      // 忽略
    }
  }, [storeKey]);
  const persist = (r: FocusRun | null) => {
    setRun(r);
    try {
      if (r) localStorage.setItem(storeKey, JSON.stringify(r));
      else localStorage.removeItem(storeKey);
    } catch {
      // 忽略
    }
  };

  React.useEffect(() => {
    if (!run || run.pausedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [run]);

  const remaining = run
    ? run.minutes * 60 - ((run.pausedAt ?? now) - run.startedMs - run.pausedMs) / 1000
    : data.minutes * 60;

  const complete = React.useCallback(
    async (r: FocusRun) => {
      if (completing.current) return;
      completing.current = true;
      try {
        const res = await fetch(`/api/v1/children/${childId}/focus-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", id: r.id }),
        });
        const body = (await res.json().catch(() => ({}))) as { awarded?: number; remainingSeconds?: number };
        if (res.status === 409 && body.remainingSeconds) {
          // 与服务器时钟有偏差：稍后再提交
          setTimeout(() => {
            completing.current = false;
            void complete(r);
          }, (body.remainingSeconds + 1) * 1000);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        beep(3);
        setResult(body.awarded ? `🎉 专注 ${r.minutes} 分钟完成！+${body.awarded} 积分` : `🎉 专注 ${r.minutes} 分钟完成！（今天的专注积分已领满）`);
        persist(null);
        onDone();
      } catch {
        setResult("网络不太好，完成记录稍后再试");
      } finally {
        completing.current = false;
      }
    },
    // persist 每次渲染重建，内容只依赖 storeKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childId, onDone],
  );

  React.useEffect(() => {
    if (run && !run.pausedAt && remaining <= 0) void complete(run);
  }, [run, remaining, complete]);

  async function start() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/children/${childId}/focus-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const s = (await res.json()) as { id: string; minutes: number };
      persist({ id: s.id, minutes: s.minutes, startedMs: Date.now(), pausedMs: 0, pausedAt: null });
      setNow(Date.now());
    } catch {
      setResult("开始失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

  const pause = () => run && persist({ ...run, pausedAt: Date.now() });
  const resume = () => run?.pausedAt && persist({ ...run, pausedMs: run.pausedMs + (Date.now() - run.pausedAt), pausedAt: null });
  const stop = () => {
    if (window.confirm("结束这次专注？结束后不会得积分。")) persist(null);
  };

  const pct = run ? Math.min(100, Math.max(0, 100 - (remaining / (run.minutes * 60)) * 100)) : 0;
  const rule =
    data.points > 0 && data.dailyCap > 0
      ? `每次 ${data.minutes} 分钟，完成得 ${data.points} 积分（每天最多 ${data.dailyCap} 次）`
      : `每次 ${data.minutes} 分钟`;

  return (
    <div className="kbb-grid">
      <section className="kbb-card kbb-focus">
        <h2>专注计时</h2>
        <div className={run?.pausedAt ? "kbb-timer paused" : "kbb-timer"}>{mmss(remaining)}</div>
        <div className="kbb-bar big">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="kbb-focus-actions">
          {!run && (
            <button className="kbb-btn primary" disabled={!canRun || busy} onClick={start}>
              ▶ 开始专注
            </button>
          )}
          {run && !run.pausedAt && (
            <button className="kbb-btn" onClick={pause}>
              ❚❚ 暂停
            </button>
          )}
          {run?.pausedAt && (
            <button className="kbb-btn primary" onClick={resume}>
              ▶ 继续
            </button>
          )}
          {run && (
            <button className="kbb-btn ghost" onClick={stop}>
              结束
            </button>
          )}
        </div>
        {result && <p className="kbb-focus-result">{result}</p>}
        {!canRun && <p className="kbb-hint">只读权限，不能开始专注</p>}
        <p className="kbb-hint">{rule}</p>
      </section>
      <section className="kbb-card">
        <h2>今天</h2>
        <div className="kbb-big">{data.todayCount}</div>
        <div className="kbb-sub">次专注，共 {data.todayMinutes} 分钟</div>
        <p className="kbb-hint">墨水屏上的专注（第 4 页）也会计入</p>
      </section>
    </div>
  );
}

export const PAGES_CSS = `
.kbb-tabs { max-width: 1100px; margin: 0 auto 16px; display: flex; gap: 8px; overflow-x: auto; }
.kbb-tabs button { flex: none; border: 1px solid var(--kbb-line); background: var(--kbb-card); color: var(--kbb-text);
  border-radius: 999px; padding: 8px 16px; font-size: 16px; font-weight: 600; cursor: pointer; }
.kbb-tabs button.on { background: var(--kbb-accent); border-color: var(--kbb-accent); color: #fff; }
@media (max-width: 560px) {
  .kbb-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; overflow: visible; }
  .kbb-tabs button { padding: 8px 2px; font-size: 14px; border-radius: 12px; white-space: nowrap; }
}
.kbb-balance .kbb-big, .kbb-card .kbb-big { font-size: 64px; font-weight: 800; line-height: 1.1; letter-spacing: -1px; }
.kbb-sub { color: var(--kbb-muted); font-size: 16px; margin-top: 4px; }
.kbb-avail { margin-top: 12px; display: inline-block; background: var(--kbb-warn-soft); color: var(--kbb-warn);
  font-weight: 700; border-radius: 10px; padding: 6px 12px; }
.kbb-wishes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.kbb-wish-row { display: flex; justify-content: space-between; gap: 8px; font-size: 17px; }
.kbb-wish-title { font-weight: 700; }
.kbb-wish-cost { color: var(--kbb-muted); flex: none; }
.kbb-bar { height: 10px; border-radius: 999px; background: var(--kbb-line); overflow: hidden; margin-top: 6px; }
.kbb-bar.big { height: 14px; margin: 12px 0 16px; }
.kbb-bar i { display: block; height: 100%; background: var(--kbb-accent); border-radius: 999px; transition: width .5s; }
.kbb-bar i.full { background: var(--kbb-warn); }
.kbb-wish-hint { font-size: 13px; color: var(--kbb-muted); margin-top: 4px; }
.kbb-wish-hint.ok { color: var(--kbb-warn); font-weight: 700; }
.kbb-ledger { list-style: none; margin: 0; padding: 0; }
.kbb-ledger li { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--kbb-line); font-size: 15px; }
.kbb-ledger li:first-child { border-top: 0; }
.kbb-ledger-date { color: var(--kbb-muted); flex: none; width: 44px; }
.kbb-ledger-reason { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kbb-ledger-delta { flex: none; font-weight: 700; color: var(--kbb-muted); }
.kbb-ledger-delta.plus { color: var(--kbb-accent); }
.kbb-week { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.kbb-day h2 { display: flex; align-items: baseline; gap: 8px; }
.kbb-day-date { font-size: 13px; color: var(--kbb-muted); font-weight: 400; }
.kbb-day.today { outline: 2px solid var(--kbb-accent); }
.kbb-day .kbb-sched li { font-size: 15px; }
.kbb-dismiss { color: var(--kbb-muted); }
.kbb-focus { text-align: center; }
.kbb-timer { font-size: 72px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
.kbb-timer.paused { color: var(--kbb-muted); }
.kbb-focus-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.kbb-btn { border: 1px solid var(--kbb-line); background: var(--kbb-card); color: var(--kbb-text); border-radius: 12px;
  padding: 12px 22px; font-size: 18px; font-weight: 700; cursor: pointer; }
.kbb-btn.primary { background: var(--kbb-accent); border-color: var(--kbb-accent); color: #fff; }
.kbb-btn.ghost { color: var(--kbb-muted); }
.kbb-btn:disabled { opacity: .5; cursor: default; }
.kbb-focus-result { font-size: 18px; font-weight: 700; color: var(--kbb-accent); }
.kbb-page-img { max-width: 1100px; margin: 0 auto; }
.kbb-page-img img { width: 100%; max-width: 800px; display: block; margin: 0 auto; aspect-ratio: 800 / 480; background: #fff; border-radius: 8px; }
`;
