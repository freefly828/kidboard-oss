#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <memory>
#include "../api_client/device_api_types.h"
#include "../api_client/api_client.h"

namespace kidboard {

enum class OtaState {
    Idle,
    Checking,
    Downloading,
    Verifying,
    Writing,
    PendingReboot,
    PendingVerify,
    Valid,
    RolledBack,
    Failed
};

/**
 * 抽象 OTA 分区存储接口，解耦 ESP-IDF 底层分区 API 与 Host 模拟
 */
class IOtaStorage {
public:
    virtual ~IOtaStorage() = default;
    virtual std::string getRunningSlotName() = 0;
    virtual std::string getTargetSlotName() = 0;
    virtual bool isPendingVerify() = 0;
    virtual bool begin(size_t image_size) = 0;
    virtual bool writeChunk(const uint8_t* data, size_t length) = 0;
    virtual bool end() = 0;
    virtual void abort() = 0;
    virtual bool setBootPartition() = 0;
    virtual bool markAppValid() = 0;
    virtual bool rollbackAndReboot() = 0;
};

class OtaManager {
public:
    explicit OtaManager(std::shared_ptr<IOtaStorage> storage = nullptr);
    ~OtaManager();

    bool init();

    /**
     * 开机自检与 Rollback 判定 (docs/07 §12 & 冻结契约: OTA 必须支持 rollback)
     * @param nvs_ok NVS 存储是否正常
     * @param display_ok 墨水屏驱动是否正常
     * @param store_ok FrameStore 存储是否正常
     * @return 若自检通过且成功确认镜像有效返回 true；若自检失败触发回滚返回 false
     */
    bool performBootSelfCheck(bool nvs_ok, bool display_ok, bool store_ok);

    /**
     * 检查是否需要更新固件
     */
    bool checkUpdate(const OtaManifest& manifest, const std::string& current_version);

    /**
     * 执行双 Slot 安全 OTA 升级 (docs/05 §7 & docs/07 §12)
     * 流式下载、分块写入 inactive slot、全程计算 SHA-256、校验失败绝不切换 boot 分区
     */
    bool executeOta(const OtaManifest& manifest, ApiClient& api_client);

    OtaState getState() const;
    std::string getRunningSlot() const;
    std::string getTargetSlot() const;
    int getRollbackCount() const;
    const std::string& getLastError() const;

    void setStorage(std::shared_ptr<IOtaStorage> storage);

private:
    std::shared_ptr<IOtaStorage> m_storage;
    OtaState m_state = OtaState::Idle;
    std::string m_last_error;
    int m_rollback_count = 0;
};

} // namespace kidboard
