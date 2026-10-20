#include "diagnostics_manager.h"
#include <cstdio>

#ifdef ESP_PLATFORM
#include "esp_log.h"
static const char* TAG = "DIAG_MGR";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[DIAG_INFO] " __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

DiagnosticsManager::DiagnosticsManager() = default;
DiagnosticsManager::~DiagnosticsManager() = default;

bool DiagnosticsManager::init(const std::string& firmware_version) {
    m_firmware_version = firmware_version;
    m_wifi_reconnect_count = 0;
    m_refresh_error_count = 0;
    m_logs.clear();
    logEvent("BOOT", "Device booted with firmware " + m_firmware_version, 0);
    return true;
}

void DiagnosticsManager::logEvent(const std::string& type, const std::string& message, uint32_t timestamp_s) {
    if (m_logs.size() >= MAX_LOG_ENTRIES) {
        m_logs.erase(m_logs.begin());
    }
    DiagnosticLogEntry entry;
    entry.timestamp_s = timestamp_s;
    entry.type = type;
    entry.message = message;
    m_logs.push_back(entry);
    LOGI("[%s] %s", type.c_str(), message.c_str());
}

void DiagnosticsManager::populateTelemetry(SyncTelemetry& out_telemetry,
                                           const std::string& running_slot,
                                           int rollback_count,
                                           int rssi,
                                           uint32_t uptime_s,
                                           uint32_t free_heap,
                                           const std::string& reset_reason) {
    out_telemetry.firmware_version = m_firmware_version;
    out_telemetry.running_slot = running_slot;
    out_telemetry.rollback_count = rollback_count;
    out_telemetry.rssi = rssi;
    out_telemetry.uptime_seconds = uptime_s;
    out_telemetry.free_heap = free_heap;
    out_telemetry.reset_reason = reset_reason;
}

const std::vector<DiagnosticLogEntry>& DiagnosticsManager::getLogEntries() const {
    return m_logs;
}

void DiagnosticsManager::incrementWifiReconnect() {
    m_wifi_reconnect_count++;
}

void DiagnosticsManager::incrementRefreshError() {
    m_refresh_error_count++;
}

int DiagnosticsManager::getWifiReconnectCount() const {
    return m_wifi_reconnect_count;
}

int DiagnosticsManager::getRefreshErrorCount() const {
    return m_refresh_error_count;
}

} // namespace kidboard
