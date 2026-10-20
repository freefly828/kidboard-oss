#pragma once

#include <string>
#include <functional>
#include <cstdint>

namespace kidboard {

enum class ProvisioningState {
    Idle,
    Starting,
    Active,
    CredentialsReceived,
    Success,
    Failed
};

enum class ProvisioningScheme {
    BLE,
    SoftAP
};

class ProvisioningManager {
public:
    using OnCredentialsCallback = std::function<void(const std::string& ssid, const std::string& password)>;

    ProvisioningManager();
    ~ProvisioningManager();

    bool init();

    /**
     * 启动配网流程 (docs/10 Phase 8: BLE provisioning 与 SoftAP fallback)
     * @param scheme 配网模式 (默认 BLE，可指定 SoftAP)
     * @param service_name 广播名称或 SSID (如 PROV_KB_XXXXXX)
     */
    bool startProvisioning(ProvisioningScheme scheme = ProvisioningScheme::BLE,
                           const std::string& service_name = "");

    void stopProvisioning();

    /**
     * 降级切换到 SoftAP 模式 (docs/10: SoftAP fallback)
     */
    bool fallbackToSoftAP();

    ProvisioningState getState() const;
    ProvisioningScheme getScheme() const;
    const std::string& getServiceName() const;
    bool isProvisioningActive() const;

    void setOnCredentialsCallback(OnCredentialsCallback cb);

    // 辅助仿真方法 (用于 Host 单测与自动化验证)
    void simulateCredentials(const std::string& ssid, const std::string& password);

private:
    std::string generateDefaultServiceName();
    /** 真机 network_provisioning 事件：CRED_RECV 暂存凭证，CRED_SUCCESS 后回调 */
    static void onProvEvent(void* arg, const char* base, int32_t id, void* data);

    std::string m_pending_ssid;
    std::string m_pending_password;
    bool m_handler_registered = false;

    ProvisioningState m_state = ProvisioningState::Idle;
    ProvisioningScheme m_scheme = ProvisioningScheme::BLE;
    std::string m_service_name;
    OnCredentialsCallback m_callback;
    bool m_initialized = false;
};

} // namespace kidboard
