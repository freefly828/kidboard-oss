"use client";

/** 天气城市设置（D-013）：墨水屏顶栏显示该城市天气与穿衣/带伞提醒 */

import * as React from "react";
import { api, errorMessage } from "../api";
import { useDashboard } from "../DashboardContext";
import { Card, inputStyle, useLoad } from "../ui";

interface LocationInfo {
  location: { id: string; name: string };
  isDefault: boolean;
  configured: boolean;
  today: string | null;
  tomorrow: string | null;
}

interface CityResult {
  id: string;
  name: string;
  lat: string;
  lon: string;
  adm1: string;
  adm2: string;
}

export default function WeatherCityCard() {
  const { canEdit, notify, bumpData } = useDashboard();
  const { data, error, reload } = useLoad(() => api<LocationInfo>("/api/v1/family/location"), [], "family-location");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CityResult[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ configured: boolean; results: CityResult[] }>(`/api/v1/family/location/search?q=${encodeURIComponent(query.trim())}`);
      setResults(res.results);
      if (res.results.length === 0) notify("没有找到这个城市，换个名称试试", false);
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function choose(c: CityResult) {
    setBusy(true);
    try {
      const res = await api<{ weatherUpdated: boolean }>("/api/v1/family/location", { method: "PUT", body: { id: c.id, name: c.name, lat: c.lat, lon: c.lon } });
      setResults(null);
      setQuery("");
      notify(res.weatherUpdated ? `天气城市已设为「${c.name}」，墨水屏将在下次同步时更新` : `已设为「${c.name}」，天气稍后更新`);
      bumpData();
      await reload();
    } catch (err) {
      notify(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="🌤 天气城市（墨水屏顶栏）">
      {error && <div style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</div>}
      {data && (
        <>
          {!data.configured && (
            <div style={{ padding: "0.6rem 0.75rem", background: "#fffbeb", borderRadius: 8, fontSize: "0.8rem", color: "#b45309", marginBottom: 10 }}>
              服务器还没有配置和风天气的 API Key，暂时不会显示天气。
            </div>
          )}
          <div style={{ fontSize: "0.88rem", lineHeight: 1.9 }}>
            <div>
              当前城市：<b>{data.location.name}</b>
              {data.isDefault && <span style={{ color: "var(--text-muted)" }}>（默认）</span>}
            </div>
            <div>今天：{data.today ?? <span style={{ color: "var(--text-muted)" }}>暂无数据</span>}</div>
            <div>明天：{data.tomorrow ?? <span style={{ color: "var(--text-muted)" }}>暂无数据</span>}</div>
          </div>
          {canEdit && data.configured && (
            <form onSubmit={search} style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input style={inputStyle} value={query} maxLength={30} onChange={(e) => setQuery(e.target.value)} placeholder="搜索城市或区县，如：杭州、海淀" />
              <button type="submit" className="btn btn-outline" disabled={busy || !query.trim()} style={{ whiteSpace: "nowrap" }}>
                {busy ? "搜索中..." : "搜索"}
              </button>
            </form>
          )}
          {results && results.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(c)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "1px solid var(--border-subtle)", background: "#fff", borderRadius: 8, padding: "0.5rem 0.7rem", marginBottom: 6, cursor: "pointer", fontSize: "0.85rem" }}
                >
                  <b>{c.name}</b>
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}
                    · {c.adm2 === c.name ? c.adm1 : `${c.adm1} ${c.adm2}`}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "10px 0 0" }}>
            每小时更新；穿衣、带伞、温差、大风提醒根据当天预报自动生成。
          </p>
        </>
      )}
    </Card>
  );
}
