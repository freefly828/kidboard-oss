#pragma once

#include <atomic>

#include <stdint.h>
#include <stdbool.h>
#include <string>
#include <functional>


namespace kidboard {

enum class WifiState {
    Disconnected,
    Connecting,
    Connected,
    Failed
};

using WifiStateCallback = std::function<void(WifiState state)>;

class WifiManager {
public:
    WifiManager();
    ~WifiManager();

    bool init();
    bool connect(const char* ssid, const char* password);
    bool connect(const std::string& ssid, const std::string& password) {
        return connect(ssid.c_str(), password.c_str());
    }
    void disconnect();

    bool isConnected() const;
    WifiState getState() const;
    int getRssi() const;
    void setStateCallback(WifiStateCallback cb);

    // 轮询重试或状态更新
    void poll();

    /** 最近一次断开原因码（wifi_err_reason_t；0 = 无）。201=找不到 AP，15/204/2=认证失败 */
    int lastDisconnectReason() const;
    /** 已保存的 SSID（connect 时传入的） */
    const char* ssid() const { return m_ssid; }

    /**
     * 配网热点（D-014）：切到 APSTA，开放式热点 192.168.4.1；STA 连接不受影响。
     * stopAccessPoint() 切回纯 STA。
     */
    bool startAccessPoint(const char* ap_ssid);
    void stopAccessPoint();
    bool isAccessPointActive() const { return m_ap_active; }

private:
    // 由 Wi-Fi 事件任务写、主循环读，需原子
    std::atomic<WifiState> m_state;
    std::atomic<bool> m_retry_pending;
    std::atomic<int> m_last_reason;
    uint32_t m_next_retry_ms;
    WifiStateCallback m_callback;
    int m_rssi;
    uint32_t m_last_retry_ms;
    uint32_t m_backoff_ms;
    int m_retry_count;
    char m_ssid[33];
    char m_password[65];
    bool m_initialized;
    bool m_ap_active = false;

    static void onEvent(void* arg, const char* base, int32_t id, void* data);
};

} // namespace kidboard
