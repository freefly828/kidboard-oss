"use client";

/**
 * 家长后台通用组件与工具。沿用 globals.css 的 card / btn / badge 与颜色变量，
 * 让各视图风格一致、错误处理一致。
 */

import * as React from "react";
import { useClockText } from "@/lib/use-clock";
import { Screen, SCREEN_HEIGHT, SCREEN_WIDTH, type ScreenViewModel } from "@kidboard/screen-template";
import { api, errorMessage } from "./api";

export const TASK_CATEGORIES = ["学习", "运动", "生活", "亲子", "兴趣"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const CATEGORY_COLORS: Record<string, { bg: string; fg: string; bar: string }> = {
  学习: { bg: "#eff6ff", fg: "#2563eb", bar: "#3b82f6" },
  运动: { bg: "#ecfdf5", fg: "#059669", bar: "#10b981" },
  生活: { bg: "#fffbeb", fg: "#b45309", bar: "#f59e0b" },
  亲子: { bg: "#fdf2f8", fg: "#be185d", bar: "#ec4899" },
  兴趣: { bg: "#f5f3ff", fg: "#7c3aed", bar: "#8b5cf6" },
  未分类: { bg: "#f1f5f9", fg: "#475569", bar: "#94a3b8" },
};

export const WEEKDAY_ZH = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 孩子时区的今天 YYYY-MM-DD */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isoWeekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日 ${WEEKDAY_ZH[isoWeekdayOf(date)]}`;
}

export function minuteToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hhmmToMinute(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "从未";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 页面数据缓存（内存，随页面刷新清空）：回到看过的页面先显示上次内容、后台刷新，
 * 避免高延迟网络（如远程端口映射）下每次切页都整页"加载中"。
 */
const loadCache = new Map<string, unknown>();

/**
 * 加载数据：返回 data / error / loading / reload；deps 变化自动重新加载。
 * 传 cacheKey 时先用缓存渲染（stale-while-revalidate），成功后更新缓存。
 */
export function useLoad<T>(loader: () => Promise<T>, deps: React.DependencyList, cacheKey?: string) {
  const [data, setDataState] = React.useState<T | null>(() => (cacheKey ? ((loadCache.get(cacheKey) as T | undefined) ?? null) : null));
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const loaderRef = React.useRef(loader);
  loaderRef.current = loader;
  const keyRef = React.useRef(cacheKey);
  keyRef.current = cacheKey;

  const setData = React.useCallback((value: React.SetStateAction<T | null>) => {
    setDataState((prev) => {
      const next = typeof value === "function" ? (value as (p: T | null) => T | null)(prev) : value;
      if (keyRef.current && next !== null) loadCache.set(keyRef.current, next);
      return next;
    });
  }, []);

  const reload = React.useCallback(async () => {
    setLoading(true);
    const key = keyRef.current;
    try {
      const result = await loaderRef.current();
      // 期间切换了孩子/日期（key 变了）则丢弃过期结果
      if (key !== keyRef.current) return;
      if (key) loadCache.set(key, result);
      setDataState(result);
      setError(null);
    } catch (err) {
      if (key === keyRef.current) setError(errorMessage(err));
    } finally {
      if (key === keyRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (cacheKey) setDataState((loadCache.get(cacheKey) as T | undefined) ?? null);
    void reload();
    // deps 由调用方显式给出（loader 每次渲染都是新函数，故不放入依赖）
  }, deps);

  return { data, error, loading, reload, setData };
}

export function PageHeader({ icon, title, subtitle, actions }: { icon: string; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "1rem",
        background: "#ffffff",
        padding: "1rem 1.5rem",
        borderRadius: "16px",
        border: "1px solid var(--border)",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>
          {icon} {title}
        </h1>
        {subtitle && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function Card({ title, extra, children, style }: { title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: "1.25rem 1.5rem", ...style }}>
      {(title || extra) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem", gap: "0.5rem" }}>
          <h3 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-sub)", fontSize: "0.82rem" }}>
        <span style={{ fontSize: "1.15rem" }}>{icon}</span> {label}
      </div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: color ?? "var(--text-main)", margin: "0.35rem 0 0.15rem" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: "1.5rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.88rem" }}>
      <div>{text}</div>
      {action && <div style={{ marginTop: "0.75rem" }}>{action}</div>}
    </div>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#b91c1c", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
      <span>{text}</span>
      {onRetry && (
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}
    >
      <div className="card" style={{ width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: "1.5rem", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ border: "none", background: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--text-muted)" }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.55rem 0.7rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  fontSize: "0.9rem",
  background: "#fff",
  boxSizing: "border-box",
};

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: "0.8rem" }}>
      <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--text-sub)" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 3 }}>{hint}</span>}
    </label>
  );
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  const key = category ?? "未分类";
  const c = CATEGORY_COLORS[key] ?? CATEGORY_COLORS["未分类"]!;
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg, fontSize: "0.7rem" }}>
      {key}
    </span>
  );
}

/** 简单分组柱状图（无外部依赖） */
export function BarChart({
  data,
  series,
  height = 160,
}: {
  data: { label: string; values: number[] }[];
  series: { name: string; color: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.72rem", color: "var(--text-sub)", marginBottom: 8 }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, borderBottom: "1px solid var(--border)" }}>
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, height: "100%" }} title={`${d.label}：${d.values.join(" / ")}`}>
            {d.values.map((v, i) => (
              <div
                key={i}
                style={{ width: `${Math.max(6, 70 / d.values.length)}%`, maxWidth: 18, height: `${(v / max) * 100}%`, minHeight: v > 0 ? 3 : 0, background: series[i]?.color, borderRadius: "3px 3px 0 0" }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, textAlign: "center", fontSize: "0.68rem", color: "var(--text-muted)", overflow: "hidden", whiteSpace: "nowrap" }}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 墨水屏原样预览：共享 <Screen/> 模板按容器宽度缩放（与设备帧同源） */
export function InkPreview({ childId, refreshKey }: { childId: string; refreshKey?: unknown }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.5);
  const { data, error } = useLoad(() => api<{ vm: ScreenViewModel; contentVersion: number }>(`/api/v1/children/${childId}/screen`), [childId, refreshKey], `screen:${childId}`);
  const clockText = useClockText();

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setScale(Math.min(1, entry.contentRect.width / SCREEN_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} style={{ width: "100%" }}>
      <div style={{ width: SCREEN_WIDTH * scale, height: SCREEN_HEIGHT * scale, overflow: "hidden", background: "#fff", outline: "3px solid #1f2937", borderRadius: 2, margin: "0 auto" }}>
        {data ? (
          <div style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <Screen vm={{ ...data.vm, clockText }} />
          </div>
        ) : (
          <div style={{ padding: 16, fontSize: 12, color: "var(--text-muted)" }}>{error ?? "加载中..."}</div>
        )}
      </div>
    </div>
  );
}
