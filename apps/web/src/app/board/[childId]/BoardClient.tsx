"use client";

/**
 * Web/H5 看板客户端 — 与墨水屏同一份 ScreenViewModel，自适应手机/平板/桌面。
 *
 * - 轮询 /api/v1/children/[childId]/screen，contentVersion 变化即更新；
 *   页面不可见时暂停，回到前台立即拉取。
 * - 网络/服务端异常时保留上一次内容并提示离线（对齐墨水屏 D04/D05 行为）。
 * - guardian+ 可点任务切换完成状态（复用 PATCH tasks/[occurrenceId]，
 *   服务端 bump content_version，墨水屏随后同步）；viewer 只读。
 * - "墨水屏"视图直接渲染共享 <Screen/> 模板并按容器宽度缩放。
 * - D-024 多页：今天 / 积分商城 / 本周课表 / 专注计时（与墨水屏 4 页对应，#hash 记住当前页）；
 *   附加页数据来自 /api/v1/children/[childId]/board-pages，墨水屏视图显示设备同款画面。
 */

import * as React from "react";
import { useClockText } from "@/lib/use-clock";
import { PAGE_ORDER } from "@kidboard/screen-template/pages";
import { FocusPanel, PageImage, PAGES_CSS, PointsPanel, WeekPanel, type BoardPagesData } from "./BoardPages";

type BoardPage = "home" | "points" | "week" | "focus";
const PAGE_TABS: { key: BoardPage; label: string }[] = [
  { key: "home", label: "🏠 今天" },
  { key: "points", label: "🏆 积分商城" },
  { key: "week", label: "📅 本周课表" },
  { key: "focus", label: "⏱️ 专注计时" },
];
import {
  Screen,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  bottomText,
  columnText,
  headerText,
  type ScreenViewModel,
  type TaskEntry,
} from "@kidboard/screen-template";

/** "kid" = 孩子用看板密码登录（D-020），可勾选任务 */
type Role = "owner" | "guardian" | "viewer" | "kid";

interface ScreenPayload {
  contentVersion: number;
  role: Role;
  vm: ScreenViewModel;
}

type Conn = "live" | "offline" | "unauthorized";
type View = "cards" | "ink";

const POLL_MS = 15_000;
const VIEW_KEY = "kidboard.board.view";

export default function BoardClient({
  childId,
  initial,
}: {
  childId: string;
  initial: ScreenPayload;
}) {
  const [data, setData] = React.useState(initial);
  const [conn, setConn] = React.useState<Conn>("live");
  const [syncedAt, setSyncedAt] = React.useState(() => new Date());
  const [view, setView] = React.useState<View>("cards");
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  // D-024 当前页（#points / #week / #focus），附加页数据
  const [page, setPage] = React.useState<BoardPage>("home");
  const [pages, setPages] = React.useState<BoardPagesData | null>(null);
  const pageRef = React.useRef<BoardPage>("home");

  React.useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as BoardPage;
      const next = PAGE_TABS.some((t) => t.key === h) ? h : "home";
      pageRef.current = next;
      setPage(next);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const loadPages = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/children/${childId}/board-pages`, { cache: "no-store" });
      if (res.ok) setPages((await res.json()) as BoardPagesData);
    } catch {
      // 保留上次内容
    }
  }, [childId]);

  const choosePage = (p: BoardPage) => {
    pageRef.current = p;
    setPage(p);
    history.replaceState(null, "", p === "home" ? window.location.pathname : `#${p}`);
    if (p !== "home") void loadPages();
  };

  React.useEffect(() => {
    if (page !== "home" && !pages) void loadPages();
  }, [page, pages, loadPages]);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "cards" || saved === "ink") setView(saved);
    } catch {
      // 隐私模式等场景 storage 不可用，使用默认视图
    }
  }, []);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 同上，忽略
    }
  };

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/children/${childId}/screen`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setConn("unauthorized");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as ScreenPayload;
      setData(next);
      setConn("live");
      setSyncedAt(new Date());
      if (pageRef.current !== "home") void loadPages();
    } catch {
      // 保留最后一次内容，仅提示离线
      setConn("offline");
    }
  }, [childId, loadPages]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(refresh, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", refresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  // 文案与墨水屏共用同一规则（D-013）
  const head = headerText(data.vm);
  const clockText = useClockText();
  const cols = columnText(data.vm);
  const bottom = bottomText(data.vm);
  const isPreview = data.vm.mode === "tomorrow";
  const canEdit = data.role !== "viewer" && !isPreview;

  const toggleTask = async (task: TaskEntry) => {
    if (!canEdit || !task.id || busyTaskId) return;
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    setBusyTaskId(task.id);
    setActionError(null);
    // 乐观更新；焦点由服务端重新组装，refresh 后校正
    setData((d) => ({
      ...d,
      vm: {
        ...d.vm,
        tasks: d.vm.tasks.map((t) =>
          t.id === task.id ? { ...t, status: nextStatus } : t,
        ),
      },
    }));
    try {
      const res = await fetch(
        `/api/v1/children/${childId}/tasks/${task.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setActionError("更新失败，请检查网络后重试");
    } finally {
      setBusyTaskId(null);
      setPages(null);
      await refresh();
    }
  };

  const { vm } = data;
  const doneCount = vm.tasks.filter((t) => t.status === "completed").length;

  return (
    <main className="kbb">
      <style>{CSS + PAGES_CSS}</style>

      <header className="kbb-top">
        <div className="kbb-title">
          {clockText && <span className="kbb-clock">{clockText}</span>}
          <span className="kbb-name">{head.middle}</span>
          <span className="kbb-date">{head.left}</span>
          {head.weather && (
            <span className="kbb-weather">
              🌤 {head.weather.summary}
              {head.weather.advice && ` · ${head.weather.advice}`}
            </span>
          )}
        </div>
        <div className="kbb-tools">
          <SyncBadge conn={conn} syncedAt={syncedAt} />
          <div className="kbb-seg" role="tablist" aria-label="显示方式">
            <button
              role="tab"
              aria-selected={view === "cards"}
              className={view === "cards" ? "on" : ""}
              onClick={() => chooseView("cards")}
            >
              卡片
            </button>
            <button
              role="tab"
              aria-selected={view === "ink"}
              className={view === "ink" ? "on" : ""}
              onClick={() => chooseView("ink")}
            >
              墨水屏
            </button>
          </div>
        </div>
      </header>

      {conn === "unauthorized" && (
        <div className="kbb-alert">
          {data.role === "kid" ? "密码已更换或登录已过期，当前显示的是上次的内容。" : "登录已过期，当前显示的是上次的内容。"}
          {data.role === "kid" ? (
            <a href={`/board/${childId}`}>重新输入密码</a>
          ) : (
            <a href={`/login?redirect=${encodeURIComponent(`/board/${childId}`)}`}>重新登录</a>
          )}
        </div>
      )}
      {actionError && <div className="kbb-alert">{actionError}</div>}

      <nav className="kbb-tabs" role="tablist" aria-label="看板页面">
        {PAGE_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={page === t.key} className={page === t.key ? "on" : ""} onClick={() => choosePage(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {page !== "home" ? (
        view === "ink" ? (
          // 墨水屏视图：与设备第 2~4 页同一帧
          <PageImage
            src={`/api/v1/children/${childId}/screen/pages/${PAGE_ORDER.indexOf(page as (typeof PAGE_ORDER)[number]) + 1}?v=${data.contentVersion}`}
          />
        ) : !pages ? (
          <p className="kbb-empty" style={{ textAlign: "center" }}>加载中…</p>
        ) : page === "points" ? (
          <PointsPanel data={pages.points} />
        ) : page === "week" ? (
          <WeekPanel data={pages.week} />
        ) : (
          <FocusPanel childId={childId} data={pages.focus} canRun={data.role !== "viewer"} onDone={() => void loadPages()} />
        )
      ) : view === "ink" ? (
        <InkView vm={vm} />
      ) : (
        <div className="kbb-grid">
          <section className="kbb-card">
            <h2>{cols.scheduleTitle}</h2>
            {vm.schedule.length === 0 ? (
              <p className="kbb-empty">{cols.scheduleEmpty.replace(/— /g, "").replace(/ —/g, "")}</p>
            ) : (
              <ul className="kbb-sched">
                {vm.schedule.map((s, i) => (
                  <li key={`${s.time}-${i}`}>
                    <span className="kbb-time">{s.time}</span>
                    <span>{s.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="kbb-card">
            <h2>
              {cols.tasksTitle}
              {vm.tasks.length > 0 && (
                <span className="kbb-count">
                  {doneCount}/{vm.tasks.length}
                </span>
              )}
            </h2>
            {vm.tasks.length === 0 ? (
              <p className="kbb-empty">{cols.tasksEmpty.replace(/— /g, "").replace(/ —/g, "")}</p>
            ) : (
              <ul className="kbb-tasks">
                {vm.tasks.map((t, i) => (
                  <li key={t.id ?? i}>
                    <button
                      className={[
                        "kbb-task",
                        t.status,
                        t.focused ? "focused" : "",
                      ].join(" ")}
                      disabled={!canEdit || !t.id || busyTaskId !== null}
                      onClick={() => toggleTask(t)}
                      aria-pressed={t.status === "completed"}
                    >
                      <span className="kbb-check" aria-hidden>
                        {t.status === "completed" ? "✓" : ""}
                      </span>
                      <span className="kbb-task-title">{t.title}</span>
                      {t.focused && <span className="kbb-next">下一个</span>}
                      {t.points ? <span className={t.status === "completed" ? "kbb-pts got" : "kbb-pts"}>+{t.points} 分</span> : null}
                      {t.estimate && (
                        <span className="kbb-est">{t.estimate}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!canEdit && vm.tasks.length > 0 && (
              <p className="kbb-hint">只读权限，无法修改任务状态</p>
            )}
          </section>

          <section className="kbb-card kbb-msg">
            <h2>{bottom.kind === "alert" ? "提醒" : bottom.kind === "prepare" ? "明天需准备" : bottom.kind === "poem" ? "每日古诗" : "今日留言"}</h2>
            {bottom.kind === "empty" ? (
              <p className="kbb-empty">{bottom.text.replace(/[（）]/g, "")}</p>
            ) : bottom.kind === "poem" ? (
              <p className="kbb-msg-body">
                <b>{bottom.label.trim()}</b>
                <br />
                {bottom.text}
              </p>
            ) : (
              <p className="kbb-msg-body">{bottom.text}</p>
            )}
            {isPreview && <p className="kbb-hint">明日预览中 · 0 点自动切回今天</p>}
          </section>
        </div>
      )}
    </main>
  );
}

function SyncBadge({ conn, syncedAt }: { conn: Conn; syncedAt: Date }) {
  const hhmm = syncedAt.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (conn === "live") {
    return <span className="kbb-sync live">● 已同步 {hhmm}</span>;
  }
  return (
    <span className="kbb-sync off">
      ● 离线 · 显示 {hhmm} 的内容
    </span>
  );
}

/** 共享模板原样渲染，按容器宽度等比缩放（不放大超过 1:1） */
function InkView({ vm }: { vm: ScreenViewModel }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const clockText = useClockText();

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / SCREEN_WIDTH));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="kbb-ink">
      <div
        className="kbb-ink-frame"
        style={{
          width: SCREEN_WIDTH * scale,
          height: SCREEN_HEIGHT * scale,
        }}
      >
        <div
          style={{
            width: SCREEN_WIDTH,
            height: SCREEN_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <Screen vm={{ ...vm, clockText }} />
        </div>
      </div>
    </div>
  );
}

const CSS = `
.kbb {
  --kbb-bg: #f4f2ec;
  --kbb-card: #ffffff;
  --kbb-text: #1f2328;
  --kbb-muted: #6b7280;
  --kbb-line: #e5e2d9;
  --kbb-accent: #2f7d5b;
  --kbb-accent-soft: #e3f1ea;
  --kbb-warn: #b45309;
  --kbb-warn-soft: #fdf3e2;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--kbb-bg);
  color: var(--kbb-text);
  font-family: system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  padding: 16px;
  padding-top: max(16px, env(safe-area-inset-top));
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .kbb {
    --kbb-bg: #16181b;
    --kbb-card: #202327;
    --kbb-text: #e8e6e1;
    --kbb-muted: #9aa0a6;
    --kbb-line: #33373c;
    --kbb-accent: #5fbf8f;
    --kbb-accent-soft: #1f3a2d;
    --kbb-warn: #f0b35a;
    --kbb-warn-soft: #3a2d17;
  }
}
.kbb *, .kbb *::before, .kbb *::after { box-sizing: border-box; }
.kbb-top {
  max-width: 1100px; margin: 0 auto 16px;
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; justify-content: space-between;
}
.kbb-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.kbb-name { font-size: 26px; font-weight: 700; }
.kbb-date { font-size: 17px; color: var(--kbb-muted); }
.kbb-clock { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 0.5px; }
.kbb-weather { font-size: 15px; color: var(--kbb-text); background: var(--kbb-card); border: 1px solid var(--kbb-line); border-radius: 999px; padding: 2px 10px; }
.kbb-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.kbb-sync { font-size: 13px; }
.kbb-sync.live { color: var(--kbb-accent); }
.kbb-sync.off { color: var(--kbb-warn); }
.kbb-seg {
  display: inline-flex; border: 1px solid var(--kbb-line);
  border-radius: 999px; background: var(--kbb-card); padding: 3px;
}
.kbb-seg button {
  border: 0; background: transparent; color: var(--kbb-muted);
  font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 999px;
  cursor: pointer; min-height: 32px;
}
.kbb-seg button.on { background: var(--kbb-text); color: var(--kbb-card); }
.kbb-alert {
  max-width: 1100px; margin: 0 auto 12px; padding: 10px 14px;
  border-radius: 10px; background: var(--kbb-warn-soft); color: var(--kbb-warn);
  font-size: 14px;
}
.kbb-alert a { color: inherit; font-weight: 600; margin-left: 8px; }
.kbb-grid {
  max-width: 1100px; margin: 0 auto;
  display: grid; gap: 16px; grid-template-columns: 1fr;
}
@media (min-width: 760px) {
  .kbb-grid { grid-template-columns: 1fr 1fr; }
  .kbb-msg { grid-column: 1 / -1; }
}
.kbb-card {
  background: var(--kbb-card); border: 1px solid var(--kbb-line);
  border-radius: 16px; padding: 18px 18px 14px;
}
.kbb-card h2 {
  margin: 0 0 12px; font-size: 18px; font-weight: 700;
  display: flex; align-items: center; gap: 8px;
}
.kbb-count {
  font-size: 13px; font-weight: 600; color: var(--kbb-accent);
  background: var(--kbb-accent-soft); padding: 2px 8px; border-radius: 999px;
}
.kbb-empty, .kbb-hint { margin: 4px 0; color: var(--kbb-muted); font-size: 15px; }
.kbb-hint { font-size: 13px; margin-top: 10px; }
.kbb ul { list-style: none; margin: 0; padding: 0; }
.kbb-sched li {
  display: flex; gap: 14px; padding: 10px 0;
  border-top: 1px solid var(--kbb-line); font-size: 18px;
}
.kbb-sched li:first-child { border-top: 0; }
.kbb-time {
  font-variant-numeric: tabular-nums; color: var(--kbb-muted);
  min-width: 52px; font-weight: 600;
}
.kbb-tasks li + li { margin-top: 8px; }
.kbb-task {
  width: 100%; display: flex; align-items: center; gap: 12px;
  min-height: 52px; padding: 10px 12px; text-align: left;
  font: inherit; font-size: 18px; color: var(--kbb-text);
  background: transparent; border: 2px solid var(--kbb-line); border-radius: 12px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.kbb-task:disabled { cursor: default; }
.kbb-task.focused { border-color: var(--kbb-text); font-weight: 700; }
.kbb-task.completed { background: var(--kbb-accent-soft); border-color: transparent; }
.kbb-task.completed .kbb-task-title { color: var(--kbb-muted); text-decoration: line-through; }
.kbb-task.skipped .kbb-task-title { color: var(--kbb-muted); }
.kbb-check {
  flex: none; width: 26px; height: 26px; border-radius: 8px;
  border: 2px solid var(--kbb-muted); display: inline-flex;
  align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800; color: #fff;
}
.kbb-task.completed .kbb-check { background: var(--kbb-accent); border-color: var(--kbb-accent); }
.kbb-task-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.kbb-next {
  flex: none; font-size: 12px; font-weight: 700; padding: 2px 8px;
  border-radius: 999px; background: var(--kbb-text); color: var(--kbb-card);
}
.kbb-est { flex: none; font-size: 14px; color: var(--kbb-muted); font-weight: 400; }
.kbb-pts { flex: none; font-size: 14px; font-weight: 800; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 2px 8px; }
.kbb-pts.got { color: #fff; background: #d97706; }
.kbb-msg-body { margin: 0; font-size: 20px; line-height: 1.6; white-space: pre-wrap; }
.kbb-ink { max-width: 1100px; margin: 0 auto; display: flex; justify-content: center; }
.kbb-ink-frame {
  overflow: hidden; background: #fff;
  outline: 4px solid #1a1a1a; box-shadow: 0 8px 30px rgba(0,0,0,0.15);
}
`;
