#pragma once

#include <string>
#include <cstdint>

namespace kidboard {

class NvsManager {
public:
    explicit NvsManager(const std::string& host_storage_path = "");
    ~NvsManager();

    bool init();

    // 硬件与设备标识
    std::string getHardwareId();
    bool setHardwareId(const std::string& hw_id);

    std::string getDeviceNonce();
    bool setDeviceNonce(const std::string& nonce);

    // Wi-Fi 凭据
    std::string getWifiSsid();
    std::string getWifiPassword();
    bool setWifiCredentials(const std::string& ssid, const std::string& password);
    bool clearWifiCredentials();

    // 设备 Token
    std::string getDeviceToken();
    bool setDeviceToken(const std::string& token);
    bool clearPairing();

    // 通用整数键（D-019 专注页号、专注时长等）；无记录返回 false
    bool getInt(const char* key, int& value);
    bool setInt(const char* key, int value);

    // D-015 设备时钟：最近一次服务器下发的 UTC 偏移（分钟）；无记录返回 false
    bool getClockUtcOffset(int& minutes);
    bool setClockUtcOffset(int minutes);

    // 状态查询
    bool isProvisioned();
    bool isPaired();

    // 恢复出厂设置 (docs/07 §14)
    bool factoryReset();

private:
    std::string readString(const char* key, const std::string& default_val = "");
    bool writeString(const char* key, const std::string& val);
    bool eraseKey(const char* key);

    std::string generateHardwareId();
    std::string generateNonce();

    std::string m_host_path;
    bool m_initialized = false;
};

} // namespace kidboard
