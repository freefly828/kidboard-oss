#include "nvs_manager.h"
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <map>
#include <fstream>
#include <sstream>
#include <random>

#ifdef ESP_PLATFORM
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_log.h"
static const char* TAG = "NVS_MGR";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[NVS_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[NVS_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[NVS_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

#ifdef ESP_PLATFORM
static const char* NVS_NAMESPACE = "kidboard";
#endif
static const char* KEY_HARDWARE_ID = "hw_id";
static const char* KEY_DEVICE_NONCE = "nonce";
static const char* KEY_WIFI_SSID = "wifi_ssid";
static const char* KEY_WIFI_PASS = "wifi_pass";
static const char* KEY_DEVICE_TOKEN = "dev_token";
static const char* KEY_CLOCK_OFFSET = "clk_off";

static std::string base64_encode(const uint8_t* data, size_t len) {
    static const char* table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t b = (static_cast<uint32_t>(data[i]) << 16);
        if (i + 1 < len) b |= (static_cast<uint32_t>(data[i + 1]) << 8);
        if (i + 2 < len) b |= static_cast<uint32_t>(data[i + 2]);

        out.push_back(table[(b >> 18) & 0x3F]);
        out.push_back(table[(b >> 12) & 0x3F]);
        out.push_back((i + 1 < len) ? table[(b >> 6) & 0x3F] : '=');
        out.push_back((i + 2 < len) ? table[b & 0x3F] : '=');
    }
    return out;
}

#ifndef ESP_PLATFORM
static std::map<std::string, std::string> s_host_kv;
#endif

NvsManager::NvsManager(const std::string& host_storage_path)
    : m_host_path(host_storage_path) {
}

NvsManager::~NvsManager() = default;

bool NvsManager::init() {
#ifdef ESP_PLATFORM
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        err = nvs_flash_init();
    }
    m_initialized = (err == ESP_OK);
#else
    m_initialized = true;
    if (!m_host_path.empty()) {
        std::ifstream f(m_host_path);
        if (f.is_open()) {
            std::string line;
            while (std::getline(f, line)) {
                size_t sep = line.find('=');
                if (sep != std::string::npos) {
                    s_host_kv[line.substr(0, sep)] = line.substr(sep + 1);
                }
            }
        }
    }
#endif
    return m_initialized;
}

std::string NvsManager::readString(const char* key, const std::string& default_val) {
#ifdef ESP_PLATFORM
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return default_val;

    size_t required_size = 0;
    err = nvs_get_str(handle, key, nullptr, &required_size);
    if (err != ESP_OK || required_size == 0) {
        nvs_close(handle);
        return default_val;
    }

    std::string val(required_size, '\0');
    err = nvs_get_str(handle, key, &val[0], &required_size);
    nvs_close(handle);

    if (err == ESP_OK) {
        if (!val.empty() && val.back() == '\0') val.pop_back();
        return val;
    }
    return default_val;
#else
    auto it = s_host_kv.find(key);
    if (it != s_host_kv.end()) {
        return it->second;
    }
    return default_val;
#endif
}

bool NvsManager::writeString(const char* key, const std::string& val) {
#ifdef ESP_PLATFORM
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return false;

    err = nvs_set_str(handle, key, val.c_str());
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return (err == ESP_OK);
#else
    s_host_kv[key] = val;
    if (!m_host_path.empty()) {
        std::ofstream f(m_host_path);
        if (f.is_open()) {
            for (const auto& kv : s_host_kv) {
                f << kv.first << "=" << kv.second << "\n";
            }
        }
    }
    return true;
#endif
}

bool NvsManager::eraseKey(const char* key) {
#ifdef ESP_PLATFORM
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return false;

    err = nvs_erase_key(handle, key);
    if (err == ESP_OK) {
        nvs_commit(handle);
    }
    nvs_close(handle);
    return (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND);
#else
    s_host_kv.erase(key);
    if (!m_host_path.empty()) {
        std::ofstream f(m_host_path);
        if (f.is_open()) {
            for (const auto& kv : s_host_kv) {
                f << kv.first << "=" << kv.second << "\n";
            }
        }
    }
    return true;
#endif
}

std::string NvsManager::generateHardwareId() {
#ifdef ESP_PLATFORM
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);
    char buf[32];
    snprintf(buf, sizeof(buf), "KB-S3-%02X%02X%02X%02X", mac[2], mac[3], mac[4], mac[5]);
    return std::string(buf);
#else
    return "KB-S3-A1B2C3D4";
#endif
}

std::string NvsManager::generateNonce() {
    uint8_t bytes[32];
#ifdef ESP_PLATFORM
    esp_fill_random(bytes, sizeof(bytes));
#else
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<uint32_t> dist(0, 255);
    for (size_t i = 0; i < sizeof(bytes); ++i) {
        bytes[i] = static_cast<uint8_t>(dist(gen));
    }
#endif
    return base64_encode(bytes, sizeof(bytes));
}

std::string NvsManager::getHardwareId() {
    std::string hw = readString(KEY_HARDWARE_ID);
    if (hw.empty()) {
        hw = generateHardwareId();
        writeString(KEY_HARDWARE_ID, hw);
    }
    return hw;
}

bool NvsManager::setHardwareId(const std::string& hw_id) {
    return writeString(KEY_HARDWARE_ID, hw_id);
}

std::string NvsManager::getDeviceNonce() {
    std::string nonce = readString(KEY_DEVICE_NONCE);
    if (nonce.empty()) {
        nonce = generateNonce();
        writeString(KEY_DEVICE_NONCE, nonce);
    }
    return nonce;
}

bool NvsManager::setDeviceNonce(const std::string& nonce) {
    return writeString(KEY_DEVICE_NONCE, nonce);
}

std::string NvsManager::getWifiSsid() {
    return readString(KEY_WIFI_SSID);
}

std::string NvsManager::getWifiPassword() {
    return readString(KEY_WIFI_PASS);
}

bool NvsManager::setWifiCredentials(const std::string& ssid, const std::string& password) {
    bool ok = writeString(KEY_WIFI_SSID, ssid);
    ok = writeString(KEY_WIFI_PASS, password) && ok;
    return ok;
}

bool NvsManager::clearWifiCredentials() {
    bool ok = eraseKey(KEY_WIFI_SSID);
    ok = eraseKey(KEY_WIFI_PASS) && ok;
    return ok;
}

std::string NvsManager::getDeviceToken() {
    return readString(KEY_DEVICE_TOKEN);
}

bool NvsManager::setDeviceToken(const std::string& token) {
    return writeString(KEY_DEVICE_TOKEN, token);
}

bool NvsManager::clearPairing() {
    return eraseKey(KEY_DEVICE_TOKEN);
}

bool NvsManager::isProvisioned() {
    return !getWifiSsid().empty();
}

bool NvsManager::isPaired() {
    return !getDeviceToken().empty();
}

bool NvsManager::getClockUtcOffset(int& minutes) {
    std::string v = readString(KEY_CLOCK_OFFSET);
    if (v.empty()) return false;
    char* end = nullptr;
    long n = strtol(v.c_str(), &end, 10);
    if (end == v.c_str() || n < -840 || n > 840) return false;
    minutes = static_cast<int>(n);
    return true;
}

bool NvsManager::getInt(const char* key, int& value) {
    std::string v = readString(key);
    if (v.empty()) return false;
    char* end = nullptr;
    long n = strtol(v.c_str(), &end, 10);
    if (end == v.c_str()) return false;
    value = static_cast<int>(n);
    return true;
}

bool NvsManager::setInt(const char* key, int value) {
    return writeString(key, std::to_string(value));
}

bool NvsManager::setClockUtcOffset(int minutes) {
    return writeString(KEY_CLOCK_OFFSET, std::to_string(minutes));
}

bool NvsManager::factoryReset() {
    LOGW("Performing FACTORY RESET: clearing Wi-Fi, pairing token, and credentials...");
#ifdef ESP_PLATFORM
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_all(handle);
        nvs_commit(handle);
        nvs_close(handle);
    }
#else
    s_host_kv.clear();
    if (!m_host_path.empty()) {
        remove(m_host_path.c_str());
    }
#endif
    return true;
}

} // namespace kidboard
