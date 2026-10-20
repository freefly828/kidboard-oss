#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include "../api_client/device_api_types.h"

namespace kidboard {

struct DiagnosticLogEntry {
    uint32_t timestamp_s = 0;
    std::string type;
    std::string message;
};

class DiagnosticsManager {
public:
    static constexpr size_t MAX_LOG_ENTRIES = 50;

    DiagnosticsManager();
    ~DiagnosticsManager();

    bool init(const std::string& firmware_version);

    // 记录结构化诊断事件 (docs/10: structured event log)
    void logEvent(const std::string& type, const std::string& message, uint32_t timestamp_s = 0);

    // 填充心跳遥测结构体
    void populateTelemetry(SyncTelemetry& out_telemetry,
                           const std::string& running_slot,
                           int rollback_count,
                           int rssi,
                           uint32_t uptime_s,
                           uint32_t free_heap,
                           const std::string& reset_reason);

    const std::vector<DiagnosticLogEntry>& getLogEntries() const;
    void incrementWifiReconnect();
    void incrementRefreshError();
    int getWifiReconnectCount() const;
    int getRefreshErrorCount() const;

private:
    std::string m_firmware_version;
    int m_wifi_reconnect_count = 0;
    int m_refresh_error_count = 0;
    std::vector<DiagnosticLogEntry> m_logs;
};

} // namespace kidboard
