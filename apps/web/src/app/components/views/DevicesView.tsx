"use client";

/**
 * 设备管理 — 展示孩子绑定设备的真实上报状态（GET /api/v1/children/[childId]/devices）。
 * 只显示设备实际上报的指标；电量、存储等设备未上报的数据不展示。
 * 每 15 秒刷新；认领成功后立即刷新。
 */

import * as React from "react";
import { PAGE_ORDER } from "@kidboard/screen-template/pages";
import { api, errorMessage } from "../api";
import { useChild, useDashboard } from "../DashboardContext";
import { Field, InkPreview, Modal, inputStyle } from "../ui";

interface DeviceEvent {
  id: string;
  type: string;
  taskTitle: string | null;
  occurredAt: string | null;
  receivedAt: string;
}

interface DeviceInfo {
  id: string;
  name: string | null;
  hardwareId: string;
  firmwareVersion: string | null;
  reportedFrameVersion: number;
  rssi: number | null;
  freeHeap: number | null;
  uptimeSeconds: number | null;
  lastSeenAt: string | null;
  lastRefreshAt: string | null;
  lastRefreshMode: string | null;
  syncIntervalSeconds: number;
  batteryPercent: number | null;
  batteryMv: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  temperatureOffset: number;
  sensorAt: string | null;
  createdAt: string;
  online: boolean;
  events: DeviceEvent[];
}

interface DevicesPayload {
  latestFrameVersion: number | null;
  devices: DeviceInfo[];
}

const POLL_MS = 15_000;

function relativeTime(iso: string | null): string {
  if (!iso) return "从未";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function rssiLabel(rssi: number | null): { text: string; color: string } {
  if (rssi === null) return { text: "未上报", color: "var(--text-muted)" };
  if (rssi >= -55) return { text: "信号极佳", color: "#10b981" };
  if (rssi >= -67) return { text: "信号良好", color: "#10b981" };
  if (rssi >= -75) return { text: "信号一般", color: "#d97706" };
  return { text: "信号较弱", color: "#ef4444" };
}

function uptimeLabel(sec: number | null): string {
  if (sec === null) return "未上报";
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时 ${m % 60} 分`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
}

function eventLabel(e: DeviceEvent): { title: string; desc: string } {
  if (e.type === "task_complete") {
    return { title: "按键完成任务", desc: e.taskTitle ? `「${e.taskTitle}」` : "任务已从设备端标记完成" };
  }
  return { title: e.type, desc: "设备上报事件" };
}

function Tile({
  icon,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="card" style={{ padding: "1.1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "var(--text-sub)", fontSize: "0.8rem" }}>
        <span style={{ fontSize: "1.2rem" }}>{icon}</span> {label}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: valueColor, margin: "0.4rem 0" }}>{value}</div>
      <div style={{ fontSize: "0.725rem", color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}

export default function DevicesView() {
  const child = useChild();
  const { role, canEdit, notify, bumpData, dataVersion } = useDashboard();
  const selectedChildId = child.id;
  const selectedChildName = child.displayName;
  const [pairingCode, setPairingCode] = React.useState("");
  const [loadingPair, setLoadingPair] = React.useState(false);
  const [pairStatus, setPairStatus] = React.useState<{ ok?: boolean; msg?: string } | null>(null);
  const [previewPage, setPreviewPage] = React.useState(0);
  const [manage, setManage] = React.useState<{ name: string; interval: number; offset: number } | null>(null);
  const [data, setData] = React.useState<DevicesPayload | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!selectedChildId) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v1/children/${selectedChildId}/devices`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DevicesPayload);
      setLoadError(null);
    } catch {
      setLoadError("设备状态加载失败，请稍后重试");
    } finally {
      setRefreshing(false);
    }
  }, [selectedChildId]);

  React.useEffect(() => {
    setData(null);
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, dataVersion]);

  async function onClaimDevice(e: React.FormEvent) {
    e.preventDefault();
    setLoadingPair(true);
    setPairStatus(null);
    try {
      const res = await api<{ hardwareId?: string }>("/api/v1/pairings/claim", {
        method: "POST",
        body: { code: pairingCode.trim(), childId: selectedChildId, deviceName: "墨水屏" },
      });
      setPairStatus({ ok: true, msg: `✓ 绑定成功${res.hardwareId ? `（${res.hardwareId}）` : ""}，设备约 30 秒内显示内容` });
      setPairingCode("");
      bumpData();
      await load();
    } catch (err) {
      setPairStatus({ ok: false, msg: `✗ ${errorMessage(err)}` });
    } finally {
      setLoadingPair(false);
    }
  }

  async function saveDevice() {
    if (!manage || !device) return;
    try {
      await api(`/api/v1/children/${selectedChildId}/devices/${device.id}`, { method: "PATCH", body: { name: manage.name.trim() || "墨水屏", syncIntervalSeconds: manage.interval, temperatureOffset: manage.offset } });
      notify("设备设置已保存，下次同步生效");
      setManage(null);
      await load();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  async function unbind() {
    if (!device) return;
    if (!window.confirm(`确定解绑「${device.name || "墨水屏"}」？解绑后设备停止更新（屏幕保留最后画面）。如需重新绑定，在设备上长按 DONE 键 10 秒恢复出厂设置，再输入新的配对码。`)) return;
    try {
      await api(`/api/v1/children/${selectedChildId}/devices/${device.id}`, { method: "DELETE" });
      notify("设备已解绑");
      setManage(null);
      bumpData();
      await load();
    } catch (err) {
      notify(errorMessage(err), false);
    }
  }

  const device = data?.devices[0] ?? null;
  const latest = data?.latestFrameVersion ?? null;
  const frameSynced = device !== null && latest !== null && device.reportedFrameVersion >= latest;
  const rssi = rssiLabel(device?.rssi ?? null);

  const timeline: { key: string; at: string; title: string; desc: string; level: "info" | "warn" }[] = [];
  if (device) {
    for (const e of device.events) {
      const l = eventLabel(e);
      timeline.push({ key: e.id, at: e.receivedAt, title: l.title, desc: l.desc, level: "info" });
    }
    if (device.lastSeenAt) {
      timeline.push({
        key: "last-sync",
        at: device.lastSeenAt,
        title: device.online ? "最近一次同步" : "设备已离线",
        desc: device.online
          ? `画面版本 ${device.reportedFrameVersion} · 信号 ${device.rssi ?? "-"} dBm`
          : `超过 ${Math.max(90, device.syncIntervalSeconds * 3)} 秒未同步，屏幕保持最后一帧`,
        level: device.online ? "info" : "warn",
      });
    }
    timeline.push({ key: "paired", at: device.createdAt, title: "设备绑定", desc: `${device.hardwareId} 绑定到 ${selectedChildName}`, level: "info" });
    timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  const statusBadge = !device
    ? { text: "未绑定设备", bg: "#f1f5f9", fg: "var(--text-muted)", border: "var(--border)" }
    : device.online
      ? { text: "● 在线", bg: "#ecfdf5", fg: "#059669", border: "#a7f3d0" }
      : { text: "● 离线", bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Header Bar */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>📱 {device?.name || "电子墨水屏"}</h1>
            <span
              className="badge"
              style={{ background: statusBadge.bg, color: statusBadge.fg, border: `1px solid ${statusBadge.border}` }}
            >
              {statusBadge.text}
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "3px" }}>
            {device ? `设备 ID: ${device.hardwareId} · ` : ""}800×480 1-bit 黑白 · 绑定儿童: {selectedChildName}
          </div>
        </div>

        <span style={{ display: "flex", gap: 8 }}>
          {device && canEdit && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setManage({ name: device.name ?? "", interval: device.syncIntervalSeconds, offset: device.temperatureOffset })}>
              ⚙️ 设备设置
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "刷新中..." : "🔄 刷新状态"}
          </button>
        </span>
      </div>

      {loadError && (
        <div style={{ padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#b91c1c", fontSize: "0.85rem" }}>
          {loadError}
        </div>
      )}

      {/* 2. Preview & real telemetry */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem" }}>
        <div className="card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.75rem" }}>📺 墨水屏当前内容预览</div>
          <div
            style={{
              background: "#23272a",
              borderRadius: "16px",
              padding: "12px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 10, alignSelf: "stretch" }}>
              {["首页", ...PAGE_ORDER.map((k) => ({ week: "本周课表", points: "积分", focus: "专注" })[k])].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setPreviewPage(i)}
                  style={{ background: previewPage === i ? "#fff" : "transparent", color: previewPage === i ? "#111" : "#cbd5e1", border: "1px solid #475569" }}
                >
                  {label}
                </button>
              ))}
            </div>
            {previewPage === 0 ? (
              <InkPreview childId={selectedChildId} refreshKey={dataVersion} />
            ) : (
              // D-018 附加页：直接显示 renderer 生成的帧预览（与设备翻页看到的一致）
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/v1/children/${selectedChildId}/screen/pages/${previewPage}?v=${dataVersion}-${latest ?? 0}`}
                alt="墨水屏附加页预览"
                style={{ width: "100%", maxWidth: 800, aspectRatio: "800 / 480", background: "#fff", outline: "3px solid #1f2937" }}
              />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "0.775rem", color: "var(--text-muted)" }}>
            <span>与墨水屏同一模板渲染</span>
            <a href={`/preview/${selectedChildId}`} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", textDecoration: "none" }}>
              ⤢ 独立窗口全屏查看
            </a>
          </div>
        </div>

        {device ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
            <Tile
              icon="☁️"
              label="最后同步"
              value={relativeTime(device.lastSeenAt)}
              sub={
                child.profile.bedTime && child.profile.wakeTime && child.profile.bedTime !== child.profile.wakeTime
                  ? `每 ${device.syncIntervalSeconds} 秒同步一次；睡觉时段 ${child.profile.bedTime}~${child.profile.wakeTime} 放慢为 5 分钟`
                  : `每 ${device.syncIntervalSeconds} 秒同步一次`
              }
              valueColor={device.online ? undefined : "#dc2626"}
            />
            <Tile
              icon="📶"
              label="Wi-Fi 信号"
              value={device.rssi === null ? "—" : `${device.rssi} dBm`}
              sub={<span style={{ color: rssi.color }}>{rssi.text}</span>}
              valueColor="var(--primary)"
            />
            <Tile
              icon="🖼️"
              label="屏幕画面"
              value={`第 ${device.reportedFrameVersion} 帧`}
              sub={
                latest === null ? (
                  "服务器尚未生成画面"
                ) : frameSynced ? (
                  <span style={{ color: "#10b981" }}>已是最新画面</span>
                ) : (
                  <span style={{ color: "#d97706" }}>最新为第 {latest} 帧，等待设备下次同步</span>
                )
              }
            />
            <Tile icon="⚙️" label="固件版本" value={device.firmwareVersion ? `v${device.firmwareVersion}` : "—"} sub="由设备启动时上报" valueColor="#8b5cf6" />
            <Tile icon="⏱️" label="本次运行时长" value={uptimeLabel(device.uptimeSeconds)} sub="设备重启后从 0 计时" />
            <Tile
              icon="🔋"
              label="电量"
              value={device.batteryPercent === null ? "—" : `${device.batteryPercent}%`}
              sub={
                device.batteryPercent === null ? (
                  "暂无有效读数"
                ) : device.batteryPercent <= 20 ? (
                  <span style={{ color: "#dc2626" }}>电量低，请给设备充电</span>
                ) : (
                  `${((device.batteryMv ?? 0) / 1000).toFixed(2)} V · ${relativeTime(device.sensorAt)}`
                )
              }
              valueColor={device.batteryPercent !== null && device.batteryPercent <= 20 ? "#dc2626" : "#10b981"}
            />
            <Tile
              icon="🌡️"
              label="室内温湿度"
              value={device.temperatureC === null ? "—" : `${device.temperatureC}℃ · ${device.humidityPct}%`}
              sub={
                device.temperatureC === null
                  ? "设备尚未上报（需新固件）"
                  : device.temperatureOffset
                    ? `已校准 ${device.temperatureOffset > 0 ? "+" : ""}${device.temperatureOffset}℃ · ${relativeTime(device.sensorAt)}`
                    : `可在设备设置中校准 · ${relativeTime(device.sensorAt)}`
              }
            />
            <Tile
              icon="🧠"
              label="可用内存"
              value={device.freeHeap === null ? "—" : `${(device.freeHeap / 1024 / 1024).toFixed(1)} MB`}
              sub="含 PSRAM；持续下降可能有内存泄漏"
            />
          </div>
        ) : (
          <div className="card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.5rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>{data ? "还没有绑定设备" : "正在加载设备状态..."}</div>
            {data && (
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                墨水屏联网后会在屏幕上显示 6 位配对码，在右下方输入即可绑定到 {selectedChildName}。
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Real event log + claim */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: "1.5rem" }}>
        <div className="card" style={{ padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 1rem" }}>设备日志</h3>
          {timeline.length === 0 ? (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>暂无记录</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {timeline.map((log) => (
                <div
                  key={log.key}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "flex-start",
                    padding: "0.6rem 0.75rem",
                    borderRadius: "8px",
                    background: log.level === "warn" ? "#fffbeb" : "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", minWidth: "92px" }}>{clockTime(log.at)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.825rem", fontWeight: 700, color: log.level === "warn" ? "#b45309" : "#0f172a" }}>
                      {log.title}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "2px" }}>{log.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "1.5rem", alignSelf: "start" }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.5rem" }}>🔗 认领新设备</h3>
          <p style={{ fontSize: "0.775rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
            新开机的墨水屏联网后会显示 6 位数字配对码，在此输入即可将设备与当前孩子绑定。
          </p>

          <form onSubmit={onClaimDevice} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>设备屏幕配对码</label>
              <input
                type="text"
                inputMode="numeric"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, ""))}
                placeholder="例如：482913"
                maxLength={6}
                style={{
                  width: "100%",
                  padding: "0.6rem 0.75rem",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  fontSize: "1rem",
                  letterSpacing: "3px",
                  fontWeight: 700,
                }}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loadingPair || pairingCode.length !== 6 || !canEdit} style={{ borderRadius: "8px" }}>
              {loadingPair ? "正在认证..." : "立即认领绑定"}
            </button>

            {pairStatus && (
              <div style={{ fontSize: "0.75rem", color: pairStatus.ok ? "#10b981" : "#ef4444", textAlign: "center" }}>{pairStatus.msg}</div>
            )}
          </form>
        </div>
      </div>
      {manage && device && (
        <Modal title="设备设置" onClose={() => setManage(null)}>
          <Field label="设备名称">
            <input style={inputStyle} value={manage.name} maxLength={30} onChange={(e) => setManage({ ...manage, name: e.target.value })} placeholder="例如：书桌墨水屏" />
          </Field>
          <Field label="同步间隔" hint="间隔越短，后台修改后屏幕更新越快，耗电与网络请求也越多。孩子档案里填了睡觉/起床时间时，睡觉时段自动放慢为 5 分钟一次（定时提醒仍准时）">
            <select style={inputStyle} value={manage.interval} onChange={(e) => setManage({ ...manage, interval: Number(e.target.value) })}>
              {[15, 30, 60, 120, 300].map((s) => (
                <option key={s} value={s}>
                  {s < 60 ? `${s} 秒` : `${s / 60} 分钟`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="温度校准" hint="设备机壳内的温度传感器受主板发热影响，读数通常偏高；对照室内温度计调整">
            <select style={inputStyle} value={manage.offset} onChange={(e) => setManage({ ...manage, offset: Number(e.target.value) })}>
              {Array.from({ length: 21 }, (_, i) => (i - 16) / 2).map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "不校准" : `${v > 0 ? "+" : ""}${v}℃`}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            {role === "owner" ? (
              <button type="button" className="btn btn-outline" style={{ color: "#dc2626" }} onClick={unbind}>
                解除绑定
              </button>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", alignSelf: "center" }}>解除绑定需管理员操作</span>
            )}
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setManage(null)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={saveDevice}>保存</button>
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
