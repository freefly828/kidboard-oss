#include "wifi_manager.h"
#include <string.h>

#ifdef ESP_PLATFORM
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
static const char* TAG = "WIFI_MGR";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#include <stdio.h>
#define LOGI(...) printf("[WIFI_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[WIFI_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[WIFI_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

namespace {
constexpr uint32_t kInitialBackoffMs = 1000;
constexpr uint32_t kMaxBackoffMs = 30000;
} // namespace

WifiManager::WifiManager()
    : m_state(WifiState::Disconnected),
      m_retry_pending(false),
      m_last_reason(0),
      m_next_retry_ms(0),
      m_callback(nullptr),
      m_rssi(-60),
      m_last_retry_ms(0),
      m_backoff_ms(kInitialBackoffMs),
      m_retry_count(0),
      m_initialized(false) {
    m_ssid[0] = '\0';
    m_password[0] = '\0';
}

WifiManager::~WifiManager() {
    disconnect();
}

/**
 * Wi-Fi / IP 事件（运行在默认事件循环任务中）。
 * 只有拿到 IP 才算 Connected——此前主循环永远等不到 Connected，配对/同步从不启动。
 * 非主动断开时标记待重连，由主循环 poll() 按指数退避发起 esp_wifi_connect()。
 */
void WifiManager::onEvent(void* arg, const char* base, int32_t id, void* data) {
#ifdef ESP_PLATFORM
    auto* self = static_cast<WifiManager*>(arg);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        // 只有 connect() 已给出凭证时才连，避免用空配置发起连接
        if (self->m_state == WifiState::Connecting && self->m_ssid[0] != '\0') {
            esp_wifi_connect();
        }
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const auto* ev = static_cast<const wifi_event_sta_disconnected_t*>(data);
        int reason = ev ? ev->reason : -1;
        self->m_last_reason = reason;
        if (self->m_state == WifiState::Disconnected) {
            return; // 主动 disconnect()，不重连
        }
        // 常见原因：201=找不到 AP（名称错/非 2.4GHz），15/204=握手失败（多为密码错）
        LOGW("Wi-Fi disconnected (reason=%d), will retry", reason);
        bool was_connected = (self->m_state == WifiState::Connected);
        self->m_state = WifiState::Connecting;
        self->m_retry_pending = true;
        if (was_connected && self->m_callback) self->m_callback(WifiState::Connecting);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const auto* ev = static_cast<const ip_event_got_ip_t*>(data);
        LOGI("Got IP: " IPSTR, IP2STR(&ev->ip_info.ip));
        self->m_retry_pending = false;
        self->m_last_reason = 0;
        self->m_state = WifiState::Connected;
        if (self->m_callback) self->m_callback(WifiState::Connected);
    }
#else
    (void)arg; (void)base; (void)id; (void)data;
#endif
}

bool WifiManager::init() {
    if (m_initialized) return true;

#ifdef ESP_PLATFORM
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_err_t ret = esp_wifi_init(&cfg);
    if (ret != ESP_OK) {
        LOGE("Failed to init Wi-Fi: %d", ret);
        return false;
    }

    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &WifiManager::onEvent, this, nullptr);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &WifiManager::onEvent, this, nullptr);

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();
#endif

    m_initialized = true;
    LOGI("Wi-Fi manager initialized");
    return true;
}

bool WifiManager::connect(const char* ssid, const char* password) {
    if (!ssid || ssid[0] == '\0') return false;

    strncpy(m_ssid, ssid, sizeof(m_ssid) - 1);
    m_ssid[sizeof(m_ssid) - 1] = '\0';

    if (password) {
        strncpy(m_password, password, sizeof(m_password) - 1);
        m_password[sizeof(m_password) - 1] = '\0';
    } else {
        m_password[0] = '\0';
    }

    m_retry_count = 0;
    m_backoff_ms = kInitialBackoffMs;
    m_next_retry_ms = 0;
    m_retry_pending = false;
    LOGI("Connecting to Wi-Fi SSID: %s", m_ssid);

#ifdef ESP_PLATFORM
    // 换网（配网门户提交新凭证）时先断开旧连接；断开事件按 Connecting 处理并由 poll() 重连到新配置
    bool was_active = (m_state != WifiState::Disconnected);
    m_state = WifiState::Connecting;
    if (was_active) esp_wifi_disconnect();
    wifi_config_t wifi_config = {};
    strncpy(reinterpret_cast<char*>(wifi_config.sta.ssid), m_ssid, sizeof(wifi_config.sta.ssid));
    strncpy(reinterpret_cast<char*>(wifi_config.sta.password), m_password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = (m_password[0] != '\0') ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_err_t err = esp_wifi_connect();
    if (err != ESP_OK) {
        // STA 尚未启动时由 STA_START 事件发起；其它错误交给 poll() 重试
        LOGW("esp_wifi_connect deferred: %s", esp_err_to_name(err));
        m_retry_pending = true;
    }
#else
    // Host simulation: transition to connected
    m_state = WifiState::Connected;
    if (m_callback) m_callback(WifiState::Connected);
#endif

    return true;
}

bool WifiManager::startAccessPoint(const char* ap_ssid) {
    if (!ap_ssid || ap_ssid[0] == '\0') return false;
#ifdef ESP_PLATFORM
    static esp_netif_t* s_ap_netif = nullptr;
    if (!s_ap_netif) s_ap_netif = esp_netif_create_default_wifi_ap();
    wifi_config_t ap = {};
    size_t n = strnlen(ap_ssid, sizeof(ap.ap.ssid));
    memcpy(ap.ap.ssid, ap_ssid, n);
    ap.ap.ssid_len = static_cast<uint8_t>(n);
    ap.ap.channel = 1; // STA 已连接时自动跟随路由器信道
    ap.ap.authmode = WIFI_AUTH_OPEN;
    ap.ap.max_connection = 4;
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_APSTA);
    if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_AP, &ap);
    if (err != ESP_OK) {
        LOGE("Failed to start AP: %s", esp_err_to_name(err));
        esp_wifi_set_mode(WIFI_MODE_STA);
        return false;
    }
#endif
    m_ap_active = true;
    LOGI("Setup hotspot started: %s", ap_ssid);
    return true;
}

void WifiManager::stopAccessPoint() {
    if (!m_ap_active) return;
#ifdef ESP_PLATFORM
    esp_wifi_set_mode(WIFI_MODE_STA);
#endif
    m_ap_active = false;
    LOGI("Setup hotspot stopped");
}

void WifiManager::disconnect() {
    if (m_state != WifiState::Disconnected) {
        // 先置 Disconnected，事件回调据此判断为主动断开、不再重连
        m_state = WifiState::Disconnected;
        m_retry_pending = false;
#ifdef ESP_PLATFORM
        esp_wifi_disconnect();
#endif
        LOGI("Wi-Fi disconnected");
        if (m_callback) m_callback(WifiState::Disconnected);
    }
}

bool WifiManager::isConnected() const {
    return m_state == WifiState::Connected;
}

int WifiManager::lastDisconnectReason() const {
    return m_last_reason;
}

WifiState WifiManager::getState() const {
    return m_state;
}

int WifiManager::getRssi() const {
#ifdef ESP_PLATFORM
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
        return ap_info.rssi;
    }
#endif
    return m_rssi;
}

void WifiManager::setStateCallback(WifiStateCallback cb) {
    m_callback = cb;
}

void WifiManager::poll() {
#ifdef ESP_PLATFORM
    if (m_state == WifiState::Connected && m_retry_count > 0) {
        m_retry_count = 0;
        m_backoff_ms = kInitialBackoffMs;
    }
    if (!m_retry_pending || m_state == WifiState::Disconnected) return;

    uint32_t now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
    if (m_next_retry_ms == 0) {
        m_next_retry_ms = now_ms + m_backoff_ms;
        return;
    }
    if (static_cast<int32_t>(now_ms - m_next_retry_ms) < 0) return;

    m_retry_pending = false;
    m_next_retry_ms = 0;
    m_last_retry_ms = now_ms;
    ++m_retry_count;
    LOGI("Wi-Fi reconnect attempt %d (backoff %u ms)", m_retry_count, static_cast<unsigned>(m_backoff_ms));
    m_backoff_ms = (m_backoff_ms * 2 > kMaxBackoffMs) ? kMaxBackoffMs : m_backoff_ms * 2;
    esp_wifi_connect();
#endif
}

} // namespace kidboard
