#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <memory>

#include "../main/board_config.h"
#include "../main/crypto/sha256.h"
#include "../main/ota/ota_manager.h"
#include "../main/diagnostics/diagnostics_manager.h"
#include "../main/api_client/api_client.h"
#include "../main/api_client/http_transport.h"
#include "../main/sync_engine/sync_engine.h"
#include "../main/frame_store/frame_store.h"
#include "../main/refresh_policy/refresh_policy.h"
#include "../main/epaper/epaper_interface.h"

using namespace kidboard;

// 模拟 OTA 分区存储，用于 Host 平台验证双 Slot 与 Rollback
class MockOtaPartitionStorage : public IOtaStorage {
public:
    MockOtaPartitionStorage()
        : m_running_slot("ota_0"), m_target_slot("ota_1") {}

    std::string getRunningSlotName() override { return m_running_slot; }
    std::string getTargetSlotName() override { return m_target_slot; }
    bool isPendingVerify() override { return m_pending_verify; }

    bool begin(size_t image_size) override {
        (void)image_size;
        m_buffer.clear();
        m_writing = true;
        begin_called = true;
        return true;
    }

    bool writeChunk(const uint8_t* data, size_t length) override {
        if (!m_writing) return false;
        m_buffer.insert(m_buffer.end(), data, data + length);
        write_chunk_count++;
        return true;
    }

    bool end() override {
        if (!m_writing) return false;
        m_writing = false;
        end_called = true;
        return true;
    }

    void abort() override {
        m_writing = false;
        m_buffer.clear();
        abort_called = true;
    }

    bool setBootPartition() override {
        set_boot_called = true;
        m_pending_verify = true;
        std::swap(m_running_slot, m_target_slot);
        return true;
    }

    bool markAppValid() override {
        mark_valid_called = true;
        m_pending_verify = false;
        return true;
    }

    bool rollbackAndReboot() override {
        rollback_called = true;
        m_pending_verify = false;
        std::swap(m_running_slot, m_target_slot);
        return true;
    }

    std::string m_running_slot;
    std::string m_target_slot;
    bool m_pending_verify = false;
    bool m_writing = false;
    std::vector<uint8_t> m_buffer;

    bool begin_called = false;
    bool end_called = false;
    bool abort_called = false;
    bool set_boot_called = false;
    bool mark_valid_called = false;
    bool rollback_called = false;
    int write_chunk_count = 0;
};

// 模拟 HTTP 传输层，用于提供固件二进制下载
class MockOtaTransport : public IHttpTransport {
public:
    HttpResponse get(const std::string& url, const std::string& auth_header) override {
        (void)url; (void)auth_header;
        HttpResponse res;
        res.status_code = 200;
        res.success = true;
        res.body = sync_response_json;
        return res;
    }

    HttpResponse post(const std::string& url, const std::string& auth_header, const std::string& body) override {
        (void)url; (void)auth_header; (void)body;
        HttpResponse res;
        res.status_code = 200;
        res.success = true;
        res.body = sync_response_json;
        return res;
    }

    bool downloadBinary(const std::string& url, const std::string& auth_header,
                        uint8_t* out_buffer, size_t max_len, size_t* out_len) override {
        (void)url; (void)auth_header;
        if (firmware_bin.empty()) return false;
        if (max_len < firmware_bin.size()) return false;
        memcpy(out_buffer, firmware_bin.data(), firmware_bin.size());
        if (out_len) *out_len = firmware_bin.size();
        return true;
    }

    std::string sync_response_json;
    std::vector<uint8_t> firmware_bin;
};

// 模拟墨水屏
class MockDisplay : public IEpaperDisplay {
public:
    bool init() override { return init_success; }
    bool show(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect) override {
        (void)frame; (void)len; (void)mode; (void)rect;
        return true;
    }
    void sleep() override {}

    bool init_success = true;
};

int main() {
    printf("==================================================\n");
    printf("  Running Phase 9 Test Suite (OTA & Rollback)     \n");
    printf("==================================================\n\n");

    // ----------------------------------------------------
    // Test 1: 双 Slot 识别与版本比对
    // ----------------------------------------------------
    printf("--- Test 1: Dual-Slot & Version Checking ---\n");
    {
        auto storage = std::make_shared<MockOtaPartitionStorage>();
        OtaManager ota(storage);
        assert(ota.init());

        assert(ota.getRunningSlot() == "ota_0");
        assert(ota.getTargetSlot() == "ota_1");
        assert(ota.getState() == OtaState::Idle);

        OtaManifest m;
        m.version = "1.0.2";
        m.url = "/api/v1/device/firmware/1.0.2/bin";
        m.sha256 = "dummy_sha256";

        // 当前 1.0.0，目标 1.0.2 -> 应当需要更新
        assert(ota.checkUpdate(m, "1.0.0"));
        // 当前 1.0.2，目标 1.0.2 -> 相同版本不更新
        assert(!ota.checkUpdate(m, "1.0.2"));

        printf("Test 1 PASS: Dual-slot discovery and version check verified.\n\n");
    }

    // ----------------------------------------------------
    // Test 2: 固件分块写入与 SHA-256 完整性验证
    // ----------------------------------------------------
    printf("--- Test 2: Chunked Write & SHA-256 Verification ---\n");
    {
        auto storage = std::make_shared<MockOtaPartitionStorage>();
        OtaManager ota(storage);
        ota.init();

        // 构造 16KB 模拟有效固件镜像
        std::vector<uint8_t> valid_image(16 * 1024);
        for (size_t i = 0; i < valid_image.size(); ++i) {
            valid_image[i] = static_cast<uint8_t>((i * 7 + 13) & 0xFF);
        }

        // 计算真实 SHA-256
        std::string expected_sha256 = Sha256::hashHex(valid_image.data(), valid_image.size());


        auto transport = std::make_shared<MockOtaTransport>();
        transport->firmware_bin = valid_image;
        ApiClient client(transport);
        client.setBaseUrl("http://localhost:3000");

        OtaManifest manifest;
        manifest.version = "1.0.1";
        manifest.url = "/api/v1/device/firmware/1.0.1/bin";
        manifest.sha256 = expected_sha256;

        // 执行 OTA
        bool ok = ota.executeOta(manifest, client);
        assert(ok);
        assert(ota.getState() == OtaState::PendingReboot);
        assert(storage->begin_called);
        assert(storage->end_called);
        assert(!storage->abort_called);
        assert(storage->set_boot_called);
        assert(storage->write_chunk_count == 4); // 16KB / 4KB = 4 chunks
        assert(storage->getRunningSlotName() == "ota_1"); // Boot slot 切换

        printf("Test 2 PASS: Valid OTA image flashed, verified, and boot partition switched.\n\n");
    }

    // ----------------------------------------------------
    // Test 3: SHA-256 篡改拒绝防线 (防变砖保护)
    // ----------------------------------------------------
    printf("--- Test 3: SHA-256 Tamper Rejection Guard ---\n");
    {
        auto storage = std::make_shared<MockOtaPartitionStorage>();
        OtaManager ota(storage);
        ota.init();

        std::vector<uint8_t> tampered_image(8 * 1024, 0xAA);
        auto transport = std::make_shared<MockOtaTransport>();
        transport->firmware_bin = tampered_image;
        ApiClient client(transport);
        client.setBaseUrl("http://localhost:3000");

        OtaManifest manifest;
        manifest.version = "1.0.2";
        manifest.url = "/api/v1/device/firmware/1.0.2/bin";
        manifest.sha256 = "0000000000000000000000000000000000000000000000000000000000000000"; // 故意不匹配

        bool ok = ota.executeOta(manifest, client);
        assert(!ok);
        assert(ota.getState() == OtaState::Failed);
        assert(storage->abort_called);
        assert(!storage->set_boot_called); // 严禁切换 Boot 分区
        assert(storage->getRunningSlotName() == "ota_0"); // 保持原有稳定 Slot

        printf("Test 3 PASS: Tampered/mismatched OTA image rejected, boot slot protected.\n\n");
    }

    // ----------------------------------------------------
    // Test 4: 开机自检通过与 Rollback 取消
    // ----------------------------------------------------
    printf("--- Test 4: Boot Self-Check & Cancel Rollback ---\n");
    {
        auto storage = std::make_shared<MockOtaPartitionStorage>();
        storage->m_pending_verify = true; // 模拟升级重启后处于待验证状态

        OtaManager ota(storage);
        ota.init();

        // 模拟各子系统自检全通过
        bool nvs_ok = true;
        bool display_ok = true;
        bool store_ok = true;

        bool check_ok = ota.performBootSelfCheck(nvs_ok, display_ok, store_ok);
        assert(check_ok);
        assert(ota.getState() == OtaState::Valid);
        assert(storage->mark_valid_called); // 确认镜像有效
        assert(!storage->rollback_called);

        printf("Test 4 PASS: App self-check passed, firmware marked VALID, rollback cancelled.\n\n");
    }

    // ----------------------------------------------------
    // Test 5: 开机自检失败自动回滚 (Automatic Rollback)
    // ----------------------------------------------------
    printf("--- Test 5: Self-Check Failure & Automatic Rollback ---\n");
    {
        auto storage = std::make_shared<MockOtaPartitionStorage>();
        storage->m_running_slot = "ota_1";
        storage->m_target_slot = "ota_0";
        storage->m_pending_verify = true;

        OtaManager ota(storage);
        ota.init();

        // 模拟墨水屏驱动初始化失败 (display_ok = false)
        bool nvs_ok = true;
        bool display_ok = false;
        bool store_ok = true;

        bool check_ok = ota.performBootSelfCheck(nvs_ok, display_ok, store_ok);
        assert(!check_ok);
        assert(ota.getState() == OtaState::RolledBack);
        assert(storage->rollback_called); // 触发自动回滚
        assert(storage->getRunningSlotName() == "ota_0"); // 回滚到旧稳定 slot
        assert(ota.getRollbackCount() == 1);

        printf("Test 5 PASS: Driver init failure triggered automatic rollback to stable slot.\n\n");
    }

    // ----------------------------------------------------
    // Test 6: 结构化运维诊断 (DiagnosticsManager)
    // ----------------------------------------------------
    printf("--- Test 6: Diagnostics Telemetry & Event Logging ---\n");
    {
        DiagnosticsManager diag;
        assert(diag.init("1.0.0"));

        diag.logEvent("OTA", "Firmware update to 1.0.1 scheduled", 100);
        diag.incrementWifiReconnect();
        diag.incrementRefreshError();

        assert(diag.getWifiReconnectCount() == 1);
        assert(diag.getRefreshErrorCount() == 1);
        assert(diag.getLogEntries().size() == 2); // BOOT + OTA

        SyncTelemetry telem;
        diag.populateTelemetry(telem, "ota_0", 0, -55, 3600, 145000, "power_on");
        assert(telem.firmware_version == "1.0.0");
        assert(telem.running_slot == "ota_0");
        assert(telem.rollback_count == 0);
        assert(telem.rssi == -55);
        assert(telem.uptime_seconds == 3600);

        printf("Test 6 PASS: Diagnostics telemetry and structured logs verified.\n\n");
    }

    // ----------------------------------------------------
    // Test 7: 端到端 SyncEngine 触发 OTA 更新与重启全流程
    // ----------------------------------------------------
    printf("--- Test 7: E2E SyncEngine OTA Trigger & Flashing ---\n");
    {
        auto ota_storage = std::make_shared<MockOtaPartitionStorage>();
        OtaManager ota(ota_storage);
        ota.init();

        // 构造有效固件
        std::vector<uint8_t> fw_bin(8192, 0x42);
        std::string fw_sha = Sha256::hashHex(fw_bin.data(), fw_bin.size());


        auto transport = std::make_shared<MockOtaTransport>();
        transport->firmware_bin = fw_bin;
        // 构造返回 OTA manifest 的 sync JSON
        transport->sync_response_json =
            "{"
            "\"serverTime\":\"2026-09-16T18:30:00Z\","
            "\"nextSyncSeconds\":30,"
            "\"desiredFrame\":null,"
            "\"refreshPolicy\":{\"partialEnabled\":true,\"partialMaxCount\":5,\"forceFullAfterHours\":24,\"partialAreaMaxRatio\":0.25},"
            "\"interactiveTasks\":[],"
            "\"ota\":{"
            "\"version\":\"1.1.0\","
            "\"url\":\"/api/v1/device/firmware/1.1.0/bin\","
            "\"sha256\":\"" + fw_sha + "\","
            "\"mandatory\":false"
            "},"
            "\"commands\":[]"
            "}";

        ApiClient client(transport);
        client.setBaseUrl("http://localhost:3000");

        FrameStore store("scratch");
        store.init();
        RefreshPolicy policy;
        MockDisplay display;

        SyncEngine sync_engine(client, store, policy, display, nullptr, nullptr, &ota);

        SyncTelemetry telem;
        telem.firmware_version = "1.0.0"; // 当前 1.0.0，服务端下发 1.1.0

        int next_sync = 30;
        SyncStepResult res = sync_engine.step(telem, &next_sync);

        // 验证 OTA 被触发并成功写入
        assert(res == SyncStepResult::OtaUpdated);
        assert(ota.getState() == OtaState::PendingReboot);
        assert(ota_storage->set_boot_called);
        assert(ota_storage->getRunningSlotName() == "ota_1");

        // 模拟重启进入 ota_1 并执行自检
        bool reboot_check = ota.performBootSelfCheck(true, true, true);
        assert(reboot_check);
        assert(ota.getState() == OtaState::Valid);

        printf("Test 7 PASS: E2E Sync -> OTA detect -> Flash -> Verify -> Boot Self-Check PASSED.\n\n");
    }

    printf("==================================================\n");
    printf("  ALL PHASE 9 TESTS PASSED SUCCESSFULLY!          \n");
    printf("==================================================\n");
    return 0;
}
