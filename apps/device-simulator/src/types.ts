/**
 * Device Simulator 类型定义 — 契约对齐 docs/05 与 openapi.yaml
 */

export interface SimulatorNvsState {
  hardwareId: string;
  deviceNonce: string;
  firmwareVersion: string;
  deviceToken: string | null;
  frameVersion: number;
  lastRefreshMode: "full" | "fast_full" | "partial" | null;
  lastRefreshAt: string | null;
  partialRefreshCount: number;
  uptimeSeconds: number;
  freeHeap: number;
  rssi: number;
  resetReason: string;
}

export interface SimulatorPendingEvent {
  eventId: string;
  frameVersion: number;
  taskOccurrenceId: string;
  occurredAt: string;
  retryCount: number;
}

export interface InteractiveTaskItem {
  id: string;
  slot: number;
  status: "pending" | "completed" | "skipped";
}

export interface SimulatorOptions {
  apiBaseUrl: string;
  hardwareId?: string;
  firmwareVersion?: string;
  storageDir?: string;
  networkOnline?: boolean;
  simulateTamperedFrame?: boolean;
}

export interface SyncOutcome {
  action: "downloaded" | "up_to_date" | "rejected" | "offline" | "server_error" | "unpaired";
  frameVersion: number;
  desiredVersion?: number;
  sha256?: string;
  refreshMode?: "full" | "partial";
  error?: string;
  replayedEventsCount: number;
}
