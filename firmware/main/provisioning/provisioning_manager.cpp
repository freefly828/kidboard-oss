#include "provisioning_manager.h"
#include <cstdio>
#include <cstring>

#ifdef ESP_PLATFORM
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_wifi.h"
#include "esp_event.h"
// ESP-IDF 6.x 已移除内置 wifi_provisioning，改用组件 espressif/network_provisioning
#include "network_provisioning/manager.h"
#include "network_provisioning/scheme_ble.h"
#include "network_provisioning/scheme_softap.h"
static const char* TAG = "PROV_MGR";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[PROV_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[PROV_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[PROV_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

ProvisioningManager::ProvisioningManager() = default;

ProvisioningManager::~ProvisioningManager() {
    stopProvisioning();
}

bool ProvisioningManager::init() {
    // 预先生成服务名：配网提示页在 startProvisioning() 之前绘制，需要显示它
    m_service_name = generateDefaultServiceName();
    m_initialized = true;
    m_state = ProvisioningState::Idle;
    return true;
}

std::string ProvisioningManager::generateDefaultServiceName() {
#ifdef ESP_PLATFORM
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);
    char buf[32];
    snprintf(buf, sizeof(buf), "PROV_KB_%02X%02X%02X", mac[3], mac[4], mac[5]);
    return std::string(buf);
#else
    return "PROV_KB_A1B2C3";
#endif
}

bool ProvisioningManager::startProvisioning(ProvisioningScheme scheme, const std::string& service_name) {
    if (m_state == ProvisioningState::Active) {
        stopProvisioning();
    }

    m_scheme = scheme;
    m_service_name = service_name.empty() ? generateDefaultServiceName() : service_name;
    m_state = ProvisioningState::Starting;

    LOGI("Starting provisioning: scheme=%s, service=%s",
         (m_scheme == ProvisioningScheme::BLE ? "BLE" : "SoftAP"),
         m_service_name.c_str());

#ifdef ESP_PLATFORM
    network_prov_mgr_config_t config = {};
    if (m_scheme == ProvisioningScheme::BLE) {
        config.scheme = network_prov_scheme_ble;
        config.scheme_event_handler = NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM;
    } else {
        config.scheme = network_prov_scheme_softap;
        config.scheme_event_handler = NETWORK_PROV_EVENT_HANDLER_NONE;
    }

    if (!m_handler_registered) {
        esp_event_handler_register(NETWORK_PROV_EVENT, ESP_EVENT_ANY_ID, &ProvisioningManager::onProvEvent, this);
        m_handler_registered = true;
    }

    esp_err_t err = network_prov_mgr_init(config);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        LOGE("network_prov_mgr_init failed: %d", err);
        m_state = ProvisioningState::Failed;
        return false;
    }

    network_prov_security_t security = NETWORK_PROV_SECURITY_0; // V1 开发开放配网，可升级为 SECURITY_1
    const char* pop = nullptr;

    err = network_prov_mgr_start_provisioning(security, pop, m_service_name.c_str(), nullptr);
    if (err != ESP_OK) {
        LOGE("network_prov_mgr_start_provisioning failed: %d", err);
        m_state = ProvisioningState::Failed;
        return false;
    }
#endif

    m_state = ProvisioningState::Active;
    LOGI("Provisioning active and ready for mobile connection");
    return true;
}

void ProvisioningManager::onProvEvent(void* arg, const char* base, int32_t id, void* data) {
#ifdef ESP_PLATFORM
    auto* self = static_cast<ProvisioningManager*>(arg);
    if (base != NETWORK_PROV_EVENT) return;
    if (id == NETWORK_PROV_WIFI_CRED_RECV && data != nullptr) {
        const auto* sta = static_cast<const wifi_sta_config_t*>(data);
        self->m_pending_ssid.assign(reinterpret_cast<const char*>(sta->ssid),
                                    strnlen(reinterpret_cast<const char*>(sta->ssid), sizeof(sta->ssid)));
        self->m_pending_password.assign(reinterpret_cast<const char*>(sta->password),
                                        strnlen(reinterpret_cast<const char*>(sta->password), sizeof(sta->password)));
        self->m_state = ProvisioningState::CredentialsReceived;
        LOGI("Provisioning credentials received: ssid=%s", self->m_pending_ssid.c_str());
    } else if (id == NETWORK_PROV_WIFI_CRED_SUCCESS) {
        self->m_state = ProvisioningState::Success;
        if (self->m_callback) self->m_callback(self->m_pending_ssid, self->m_pending_password);
    } else if (id == NETWORK_PROV_WIFI_CRED_FAIL) {
        LOGW("Provisioning credentials failed to connect, waiting for retry");
    }
#else
    (void)arg; (void)base; (void)id; (void)data;
#endif
}

void ProvisioningManager::stopProvisioning() {
    if (m_state == ProvisioningState::Idle) return;

    LOGI("Stopping provisioning manager");
#ifdef ESP_PLATFORM
    network_prov_mgr_stop_provisioning();
    network_prov_mgr_deinit();
#endif
    m_state = ProvisioningState::Idle;
}

bool ProvisioningManager::fallbackToSoftAP() {
    LOGW("Initiating SoftAP provisioning fallback...");
    stopProvisioning();
    return startProvisioning(ProvisioningScheme::SoftAP, m_service_name);
}

ProvisioningState ProvisioningManager::getState() const {
    return m_state;
}

ProvisioningScheme ProvisioningManager::getScheme() const {
    return m_scheme;
}

const std::string& ProvisioningManager::getServiceName() const {
    return m_service_name;
}

bool ProvisioningManager::isProvisioningActive() const {
    return m_state == ProvisioningState::Active;
}

void ProvisioningManager::setOnCredentialsCallback(OnCredentialsCallback cb) {
    m_callback = cb;
}

void ProvisioningManager::simulateCredentials(const std::string& ssid, const std::string& password) {
    LOGI("Simulating received Wi-Fi credentials: ssid=%s", ssid.c_str());
    m_state = ProvisioningState::CredentialsReceived;
    if (m_callback) {
        m_callback(ssid, password);
    }
    m_state = ProvisioningState::Success;
}

} // namespace kidboard
