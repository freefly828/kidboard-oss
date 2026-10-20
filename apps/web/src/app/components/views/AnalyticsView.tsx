"use client";

/** 统计分析（D-012）：全部来自 GET /stats，由任务与积分数据实时计算 */

import * as React from "react";
import { api } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import { BarChart, CATEGORY_COLORS, Card, Empty, ErrorBox, PageHeader, StatCard, useLoad } from "../ui";

interface Stats {
  today: string;
  days: number;
  daily: { date: string; planned: number; completed: number; points: number }[];
  byCategory: { category: string; planned: number; completed: number }[];
  totals: { planned: number; completed: number; completionRate: number | null; pointsEarned: number; pointsSpent: number; balance: number };
  streakDays: number;
  topTasks: { title: string; completed: number }[];
}

export default function AnalyticsView() {
  const child = useChild();
  const { dataVersion } = useDashboard();
  const [days, setDays] = React.useState(7);
  const { data, error, reload } = useLoad(() => api<Stats>(`/api/v1/children/${child.id}/stats?days=${days}`), [child.id, days, dataVersion], `stats:${child.id}:${days}`);

  const label = (date: string, today: string) => (date === today ? "今天" : `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`);
  // 30/90 天按周汇总，避免柱子过密
  const series = React.useMemo(() => {
    if (!data) return [];
    if (data.days <= 14) return data.daily.map((d) => ({ ...d, label: label(d.date, data.today) }));
    const weeks: { label: string; planned: number; completed: number; points: number }[] = [];
    data.daily.forEach((d, i) => {
      if (i % 7 === 0) weeks.push({ label: `${label(d.date, data.today)}起`, planned: 0, completed: 0, points: 0 });
      const w = weeks[weeks.length - 1]!;
      w.planned += d.planned;
      w.completed += d.completed;
      w.points += d.points;
    });
    return weeks;
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        icon="📊"
        title={`统计分析 · ${child.displayName}`}
        subtitle="由每天的任务完成情况与积分记录实时计算"
        actions={[7, 30, 90].map((d) => (
          <button key={d} type="button" className="btn btn-sm" onClick={() => setDays(d)} style={{ background: days === d ? "var(--primary)" : "#fff", color: days === d ? "#fff" : "var(--text-sub)", border: "1px solid var(--border)" }}>
            近 {d} 天
          </button>
        ))}
      />

      {error && <ErrorBox text={error} onRetry={reload} />}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "1rem" }}>
            <StatCard icon="✅" label="任务完成率" value={data.totals.completionRate === null ? "—" : `${data.totals.completionRate}%`} sub={`计划 ${data.totals.planned} 项，完成 ${data.totals.completed} 项`} color="#059669" />
            <StatCard icon="🔥" label="连续完成" value={`${data.streakDays} 天`} sub="每天至少完成 1 项任务" color="#dc2626" />
            <StatCard icon="📈" label="获得积分" value={`+${data.totals.pointsEarned}`} sub={`期间兑换消耗 ${data.totals.pointsSpent} 分`} color="#d97706" />
            <StatCard icon="🏆" label="当前余额" value={`${data.totals.balance} 分`} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem" }}>
            <Card title={data.days <= 14 ? "每天任务完成情况" : "每周任务完成情况"}>
              {data.totals.planned === 0 ? (
                <Empty text="这段时间没有任务记录" />
              ) : (
                <BarChart
                  data={series.map((s) => ({ label: s.label, values: [s.planned, s.completed] }))}
                  series={[
                    { name: "计划任务", color: "#bfdbfe" },
                    { name: "实际完成", color: "#2563eb" },
                  ]}
                />
              )}
            </Card>
            <Card title={data.days <= 14 ? "每天获得积分" : "每周获得积分"}>
              {data.totals.pointsEarned === 0 ? (
                <Empty text="这段时间没有获得积分" />
              ) : (
                <BarChart data={series.map((s) => ({ label: s.label, values: [s.points] }))} series={[{ name: "获得积分", color: "#f59e0b" }]} />
              )}
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem" }}>
            <Card title="各分类完成情况">
              {data.byCategory.length === 0 ? (
                <Empty text="暂无数据" />
              ) : (
                data.byCategory.map((c) => {
                  const color = (CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS["未分类"]!).bar;
                  return (
                    <div key={c.category} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
                        <span>{c.category}</span>
                        <span style={{ color: "var(--text-muted)" }}>
                          完成 {c.completed} / {c.planned}（{Math.round((c.completed / Math.max(1, c.planned)) * 100)}%）
                        </span>
                      </div>
                      <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${(c.completed / Math.max(1, c.planned)) * 100}%`, height: "100%", background: color }} />
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
            <Card title="完成次数最多的任务">
              {data.topTasks.length === 0 ? (
                <Empty text="暂无数据" />
              ) : (
                data.topTasks.map((t, i) => (
                  <div key={t.title} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0", borderTop: "1px solid var(--border-subtle)", fontSize: "0.88rem" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: i < 3 ? "#fef3c7" : "#f1f5f9", color: i < 3 ? "#b45309" : "var(--text-sub)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700 }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1 }}>{t.title}</span>
                    <span style={{ color: "var(--text-muted)" }}>{t.completed} 次</span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
