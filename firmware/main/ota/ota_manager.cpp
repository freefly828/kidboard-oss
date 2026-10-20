#include "ota_manager.h"
#include "../crypto/sha256.h"
#include <cstdio>
#include <cstring>

#ifdef ESP_PLATFORM
#include "esp_log.h"
#include "esp_system.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"
static const char* TAG = "OTA_MGR";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[OTA_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[OTA_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[OTA_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

#ifdef ESP_PLATFORM
class EspOtaStorage : public IOtaStorage {
public:
    EspOtaStorage() = default;

    std::string getRunningSlotName() override {
        const esp_partition_t* running = esp_ota_get_running_partition();
        return running ? running->label : "unknown";
    }

    std::string getTargetSlotName() override {
        const esp_partition_t* update = esp_ota_get_next_update_partition(nullptr);
        return update ? update->label : "unknown";
    }

    bool isPendingVerify() override {
        const esp_partition_t* running = esp_ota_get_running_partition();
        if (!running) return false;
        esp_ota_img_states_t ota_state;
        if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK) {
            return (ota_state == ESP_OTA_IMG_PENDING_VERIFY);
        }
        return false;
    }

    bool begin(size_t image_size) override {
        m_update_partition = esp_ota_get_next_update_partition(nullptr);
        if (!m_update_partition) {
            LOGE("No update partition found");
            return false;
        }
        esp_err_t err = esp_ota_begin(m_update_partition, image_size == 0 ? OTA_WITH_SEQUENTIAL_WRITES : image_size, &m_ota_handle);
        return (err == ESP_OK);
    }

    bool writeChunk(const uint8_t* data, size_t length) override {
        if (!m_ota_handle) return false;
        esp_err_t err = esp_ota_write(m_ota_handle, data, length);
        return (err == ESP_OK);
    }

    bool end() override {
        if (!m_ota_handle) return false;
        esp_err_t err = esp_ota_end(m_ota_handle);
        m_ota_handle = 0;
        return (err == ESP_OK);
    }

    void abort() override {
        if (m_ota_handle) {
            esp_ota_abort(m_ota_handle);
            m_ota_handle = 0;
        }
    }

    bool setBootPartition() override {
        if (!m_update_partition) return false;
        esp_err_t err = esp_ota_set_boot_partition(m_update_partition);
        return (err == ESP_OK);
    }

    bool markAppValid() override {
        esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
        return (err == ESP_OK);
    }

    bool rollbackAndReboot() override {
        esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
        return (err == ESP_OK);
    }

private:
    const esp_partition_t* m_update_partition = nullptr;
    esp_ota_handle_t m_ota_handle = 0;
};
#else
class MockOtaStorage : public IOtaStorage {
public:
    MockOtaStorage()
        : m_running_slot("ota_0"), m_target_slot("ota_1") {}

    std::string getRunningSlotName() override { return m_running_slot; }
    std::string getTargetSlotName() override { return m_target_slot; }
    bool isPendingVerify() override { return m_pending_verify; }

    bool begin(size_t image_size) override {
        (void)image_size;
        m_buffer.clear();
        m_writing = true;
        return true;
    }

    bool writeChunk(const uint8_t* data, size_t length) override {
        if (!m_writing) return false;
        m_buffer.insert(m_buffer.end(), data, data + length);
        return true;
    }

    bool end() override {
        m_writing = false;
        return true;
    }

    void abort() override {
        m_writing = false;
        m_buffer.clear();
    }

    bool setBootPartition() override {
        m_pending_verify = true;
        std::swap(m_running_slot, m_target_slot);
        return true;
    }

    bool markAppValid() override {
        m_pending_verify = false;
        return true;
    }

    bool rollbackAndReboot() override {
        m_pending_verify = false;
        // 回滚到上一分区
        std::swap(m_running_slot, m_target_slot);
        return true;
    }

    void setPendingVerify(bool pending) { m_pending_verify = pending; }
    const std::vector<uint8_t>& getWrittenData() const { return m_buffer; }

private:
    std::string m_running_slot;
    std::string m_target_slot;
    bool m_pending_verify = false;
    bool m_writing = false;
    std::vector<uint8_t> m_buffer;
};
#endif

OtaManager::OtaManager(std::shared_ptr<IOtaStorage> storage)
    : m_storage(storage) {
}

OtaManager::~OtaManager() = default;

bool OtaManager::init() {
    if (!m_storage) {
#ifdef ESP_PLATFORM
        m_storage = std::make_shared<EspOtaStorage>();
#else
        m_storage = std::make_shared<MockOtaStorage>();
#endif
    }
    m_state = OtaState::Idle;
    LOGI("OtaManager initialized. Running slot: %s, Target slot: %s",
         m_storage->getRunningSlotName().c_str(),
         m_storage->getTargetSlotName().c_str());
    return true;
}

bool OtaManager::performBootSelfCheck(bool nvs_ok, bool display_ok, bool store_ok) {
    if (!m_storage) return false;

    if (m_storage->isPendingVerify()) {
        LOGI("New OTA firmware slot (%s) in PENDING_VERIFY state! Running boot self-checks...",
             m_storage->getRunningSlotName().c_str());

        bool self_check_passed = nvs_ok && display_ok && store_ok;
        if (self_check_passed) {
            LOGI(">> All boot self-checks PASSED! Confirming firmware valid (canceling rollback)...");
            if (m_storage->markAppValid()) {
                m_state = OtaState::Valid;
                LOGI("Firmware marked VALID successfully. Rollback timer cancelled.");
                return true;
            } else {
                LOGE("Failed to mark app valid");
                m_state = OtaState::Failed;
                return false;
            }
        } else {
            LOGE(">> Boot self-checks FAILED (nvs=%d, display=%d, store=%d)! Triggering AUTOMATIC ROLLBACK...",
                 nvs_ok, display_ok, store_ok);
            m_rollback_count++;
            m_state = OtaState::RolledBack;
            m_storage->rollbackAndReboot();
            return false;
        }
    }

    m_state = OtaState::Idle;
    return true;
}

bool OtaManager::checkUpdate(const OtaManifest& manifest, const std::string& current_version) {
    if (manifest.url.empty() || manifest.version.empty() || manifest.sha256.empty()) {
        return false;
    }
    return (manifest.version != current_version);
}

bool OtaManager::executeOta(const OtaManifest& manifest, ApiClient& api_client) {
    if (!m_storage) {
        m_last_error = "No OTA storage initialized";
        return false;
    }

    m_state = OtaState::Downloading;
    LOGI("Initiating Dual-Slot OTA update to slot [%s]...", m_storage->getTargetSlotName().c_str());
    LOGI("Manifest: version=%s, url=%s, expected sha256=%s",
         manifest.version.c_str(), manifest.url.c_str(), manifest.sha256.c_str());

    if (!m_storage->begin(0)) {
        m_last_error = "Failed to begin OTA partition write";
        m_state = OtaState::Failed;
        LOGE("%s", m_last_error.c_str());
        return false;
    }

    // 下载并校验二进制
    static constexpr size_t CHUNK_SIZE = 4096;
    std::vector<uint8_t> buffer(CHUNK_SIZE);
    Sha256 sha256_calc;

    // 获取完整二进制
    std::vector<uint8_t> full_bin(4 * 1024 * 1024); // 最大 4MB 空间
    size_t actual_len = 0;

    if (!api_client.downloadFrame(manifest.url, full_bin.data(), full_bin.size(), &actual_len) || actual_len == 0) {
        m_last_error = "Failed to download OTA binary image";
        m_storage->abort();
        m_state = OtaState::Failed;
        LOGE("%s", m_last_error.c_str());
        return false;
    }

    m_state = OtaState::Writing;
    LOGI("Writing %u bytes to target slot in %u-byte chunks...", static_cast<unsigned>(actual_len), static_cast<unsigned>(CHUNK_SIZE));

    size_t written = 0;
    while (written < actual_len) {
        size_t to_write = (actual_len - written > CHUNK_SIZE) ? CHUNK_SIZE : (actual_len - written);
        sha256_calc.update(full_bin.data() + written, to_write);

        if (!m_storage->writeChunk(full_bin.data() + written, to_write)) {
            m_last_error = "Failed to write chunk to OTA partition";
            m_storage->abort();
            m_state = OtaState::Failed;
            LOGE("%s", m_last_error.c_str());
            return false;
        }
        written += to_write;
    }

    // 完整性与防篡改校验 (docs/05 §7 & docs/08 §5)
    m_state = OtaState::Verifying;
    std::string computed_hash = sha256_calc.finalizeHex();
    LOGI("OTA Download Complete. Computed SHA-256: %s, Expected: %s",

         computed_hash.c_str(), manifest.sha256.c_str());

    if (computed_hash != manifest.sha256) {
        m_last_error = "OTA SHA-256 mismatch! Image rejected to prevent bricking.";
        m_storage->abort();
        m_state = OtaState::Failed;
        LOGE(">> %s", m_last_error.c_str());
        return false;
    }

    if (!m_storage->end()) {
        m_last_error = "Failed to finalize OTA partition";
        m_state = OtaState::Failed;
        LOGE("%s", m_last_error.c_str());
        return false;
    }

    // 校验通过，原子切换 Boot 分区
    if (!m_storage->setBootPartition()) {
        m_last_error = "Failed to set boot partition";
        m_state = OtaState::Failed;
        LOGE("%s", m_last_error.c_str());
        return false;
    }

    m_state = OtaState::PendingReboot;
    LOGI(">> OTA update SUCCESSFUL! Target slot [%s] set as next boot partition.",
         m_storage->getTargetSlotName().c_str());
    return true;
}

OtaState OtaManager::getState() const {
    return m_state;
}

std::string OtaManager::getRunningSlot() const {
    return m_storage ? m_storage->getRunningSlotName() : "unknown";
}

std::string OtaManager::getTargetSlot() const {
    return m_storage ? m_storage->getTargetSlotName() : "unknown";
}

int OtaManager::getRollbackCount() const {
    return m_rollback_count;
}

const std::string& OtaManager::getLastError() const {
    return m_last_error;
}

void OtaManager::setStorage(std::shared_ptr<IOtaStorage> storage) {
    m_storage = storage;
}

} // namespace kidboard
