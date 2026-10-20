#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <memory>

#include "../main/board_config.h"
#include "../main/storage/nvs_manager.h"
#include "../main/ui/pairing_screen.h"
#include "../main/provisioning/provisioning_manager.h"
#include "../main/provisioning/pairing_client.h"
#include "../main/api_client/api_client.h"
#include "../main/api_client/http_transport.h"
#include "../main/epaper/epaper_interface.h"
#include "../main/epaper/epaper_display.h"
#include "../main/events/offline_event_queue.h"


using namespace kidboard;

// 模拟墨水屏
class MockEpaper : public IEpaperDisplay {
public:
    bool init() override { initialized = true; return true; }
    bool show(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect) override {
        (void)mode; (void)rect;
        last_frame.assign(frame, frame + len);
        show_count++;
        return true;
    }
    void sleep() override { sleep_count++; }

    bool initialized = false;
    std::vector<uint8_t> last_frame;
    int show_count = 0;
    int sleep_count = 0;
};

// 模拟 HTTP 传输层
class MockPairingTransport : public IHttpTransport {
public:
    HttpResponse get(const std::string& url, const std::string& auth_header) override {
        (void)auth_header;
        last_get_url = url;
        HttpResponse res;
        res.status_code = next_status_code;
        res.success = (next_status_code >= 200 && next_status_code < 300);
        res.body = next_get_body;
        return res;
    }

    HttpResponse post(const std::string& url, const std::string& auth_header, const std::string& body) override {
        (void)auth_header;
        last_post_url = url;
        last_post_body = body;
        HttpResponse res;
        res.status_code = next_status_code;
        res.success = (next_status_code >= 200 && next_status_code < 300);
        res.body = next_post_body;
        return res;
    }

    bool downloadBinary(const std::string& url, const std::string& auth_header,
                        uint8_t* out_buffer, size_t max_len, size_t* out_len) override {
        (void)url; (void)auth_header; (void)out_buffer; (void)max_len; (void)out_len;
        return true;
    }

    int next_status_code = 200;
    std::string next_get_body;
    std::string next_post_body;
    std::string last_get_url;
    std::string last_post_url;
    std::string last_post_body;
};

int main() {
    printf("==================================================\n");
    printf("  Running Phase 8 Test Suite (Prov / Pairing)     \n");
    printf("==================================================\n\n");

    // ----------------------------------------------------
    // Test 1: NvsManager 存储与持久化
    // ----------------------------------------------------
    printf("--- Test 1: NvsManager Key-Value & Factory Reset ---\n");
    {
        NvsManager nvs("scratch/test_nvs.txt");
        assert(nvs.init());

        // 默认生成 Hardware ID 与 Nonce
        std::string hw = nvs.getHardwareId();
        assert(!hw.empty());
        std::string nonce = nvs.getDeviceNonce();
        assert(!nonce.empty());
        assert(nonce.length() >= 32);

        // 初始未配网、未配对
        assert(!nvs.isProvisioned());
        assert(!nvs.isPaired());

        // 写入 Wi-Fi
        assert(nvs.setWifiCredentials("Home-WiFi-5G", "supersecret123"));
        assert(nvs.isProvisioned());
        assert(nvs.getWifiSsid() == "Home-WiFi-5G");
        assert(nvs.getWifiPassword() == "supersecret123");

        // 写入 Device Token
        assert(nvs.setDeviceToken("kb-token-abc-98765"));
        assert(nvs.isPaired());
        assert(nvs.getDeviceToken() == "kb-token-abc-98765");

        // 恢复出厂设置
        assert(nvs.factoryReset());
        assert(!nvs.isProvisioned());
        assert(!nvs.isPaired());
        assert(nvs.getWifiSsid().empty());
        assert(nvs.getDeviceToken().empty());

        printf("Test 1 PASS: NvsManager storage, retrieval, and factory reset verified.\n\n");
    }

    // ----------------------------------------------------
    // Test 2: PairingScreen 48,000 字节点阵生成
    // ----------------------------------------------------
    printf("--- Test 2: PairingScreen 800x480 1-bit Render ---\n");
    {
        std::vector<uint8_t> buf(48000, 0);

        // 1. 配对码界面
        bool ok = PairingScreen::renderPairingScreen(buf.data(), buf.size(),
                                                     "KB-S3-A1B2C3D4", "482913", "2026-09-16T12:00:00Z");
        assert(ok);

        // 验证 1-bit 规范：1=white, 0=black
        // 界面大部分为白色，有黑线边框和黑字
        size_t white_count = 0;
        size_t black_count = 0;
        for (uint8_t byte : buf) {
            for (int b = 0; b < 8; ++b) {
                if ((byte >> b) & 1) white_count++;
                else black_count++;
            }
        }
        assert(white_count > black_count); // 白底黑字，白色占多数
        assert(black_count > 1000);        // 有大量黑色字符和边框像素

        // 2. 恢复出厂界面
        ok = PairingScreen::renderResetScreen(buf.data(), buf.size());
        assert(ok);

        // 3. 配网界面
        ok = PairingScreen::renderProvisioningScreen(buf.data(), buf.size(), "PROV_KB_A1B2C3", false);
        assert(ok);

        printf("Test 2 PASS: 48,000-byte 1-bit screen renders verified (Pairing/Reset/Prov).\n\n");
    }

    // ----------------------------------------------------
    // Test 3: ProvisioningManager 状态机与 SoftAP 降级
    // ----------------------------------------------------
    printf("--- Test 3: ProvisioningManager & SoftAP Fallback ---\n");
    {
        ProvisioningManager prov;
        assert(prov.init());
        assert(prov.getState() == ProvisioningState::Idle);

        // 启动 BLE 配网
        assert(prov.startProvisioning(ProvisioningScheme::BLE, "PROV_KB_TEST"));
        assert(prov.getState() == ProvisioningState::Active);
        assert(prov.getScheme() == ProvisioningScheme::BLE);
        assert(prov.getServiceName() == "PROV_KB_TEST");

        // 降级到 SoftAP 模式
        assert(prov.fallbackToSoftAP());
        assert(prov.getState() == ProvisioningState::Active);
        assert(prov.getScheme() == ProvisioningScheme::SoftAP);

        // 模拟捕获手机配网发送的 Wi-Fi 凭证
        std::string rec_ssid, rec_pass;
        prov.setOnCredentialsCallback([&](const std::string& s, const std::string& p) {
            rec_ssid = s;
            rec_pass = p;
        });

        prov.simulateCredentials("LivingRoom-WiFi", "mysecurepass");
        assert(prov.getState() == ProvisioningState::Success);
        assert(rec_ssid == "LivingRoom-WiFi");
        assert(rec_pass == "mysecurepass");

        prov.stopProvisioning();
        assert(prov.getState() == ProvisioningState::Idle);

        printf("Test 3 PASS: BLE provisioning, SoftAP fallback, and credentials callback verified.\n\n");
    }

    // ----------------------------------------------------
    // Test 4: ApiClient 配对接口与 JSON 解析
    // ----------------------------------------------------
    printf("--- Test 4: ApiClient initPairing & pollPairingStatus ---\n");
    {
        auto transport = std::make_shared<MockPairingTransport>();
        ApiClient client(transport);
        client.setBaseUrl("http://localhost:3000");

        // 1. initPairing 成功
        transport->next_status_code = 200;
        transport->next_post_body = "{\"pairingId\":\"pair-uuid-001\",\"code\":\"482913\",\"expiresAt\":\"2026-09-16T15:30:00Z\"}";

        PairInitResponse init_resp;
        bool ok = client.initPairing("KB-S3-A1B2C3D4", "dGVzdC1ub25jZQ==", "1.0.0", init_resp);
        assert(ok);
        assert(init_resp.success);
        assert(init_resp.pairing_id == "pair-uuid-001");
        assert(init_resp.code == "482913");
        assert(init_resp.expires_at == "2026-09-16T15:30:00Z");
        assert(transport->last_post_body.find("\"hardwareId\":\"KB-S3-A1B2C3D4\"") != std::string::npos);

        // 2. pollPairingStatus -> pending
        transport->next_status_code = 200;
        transport->next_get_body = "{\"status\":\"pending\"}";

        PairStatusResponse status_resp;
        ok = client.pollPairingStatus("pair-uuid-001", "dGVzdC1ub25jZQ==", status_resp);
        assert(ok);
        assert(status_resp.status == "pending");
        assert(status_resp.token.empty());

        // 3. pollPairingStatus -> paired
        transport->next_status_code = 200;
        transport->next_get_body = "{\"status\":\"paired\",\"token\":\"device-jwt-token-xyz\",\"deviceId\":\"dev-123\"}";

        ok = client.pollPairingStatus("pair-uuid-001", "dGVzdC1ub25jZQ==", status_resp);
        assert(ok);
        assert(status_resp.status == "paired");
        assert(status_resp.token == "device-jwt-token-xyz");
        assert(status_resp.device_id == "dev-123");

        // 4. pollPairingStatus -> expired
        transport->next_status_code = 200;
        transport->next_get_body = "{\"status\":\"expired\"}";

        ok = client.pollPairingStatus("pair-uuid-001", "dGVzdC1ub25jZQ==", status_resp);
        assert(ok);
        assert(status_resp.status == "expired");

        printf("Test 4 PASS: ApiClient pair/init and pair/status polling verified.\n\n");
    }

    // ----------------------------------------------------
    // Test 5: 端到端配网、配对认领与 10 秒恢复出厂全流程
    // ----------------------------------------------------
    printf("--- Test 5: Full E2E Lifecycle: Prov -> Pair -> Claim -> 10s Reset ---\n");
    {
        NvsManager nvs("scratch/test_e2e_nvs.txt");
        assert(nvs.init());
        nvs.factoryReset(); // 从干净状态开始

        MockEpaper mock_display;
        mock_display.init();

        auto transport = std::make_shared<MockPairingTransport>();
        ApiClient client(transport);
        client.setBaseUrl("http://localhost:3000");

        PairingClient pairing_client(client, nvs, mock_display);
        assert(pairing_client.init());
        assert(!pairing_client.isPaired());
        assert(pairing_client.getState() == PairingClientState::Unpaired);

        // Step 1: 配网阶段获取 Wi-Fi 凭证
        ProvisioningManager prov;
        prov.init();
        prov.startProvisioning(ProvisioningScheme::BLE, "PROV_KB_E2E");
        prov.setOnCredentialsCallback([&](const std::string& s, const std::string& p) {
            nvs.setWifiCredentials(s, p);
        });
        prov.simulateCredentials("StudyRoom-WiFi", "kidboard2026");
        assert(nvs.isProvisioned());
        assert(nvs.getWifiSsid() == "StudyRoom-WiFi");

        // Step 2: 申请配对码并在屏幕显示
        transport->next_status_code = 200;
        transport->next_post_body = "{\"pairingId\":\"p-e2e-01\",\"code\":\"654321\",\"expiresAt\":\"2026-09-16T18:00:00Z\"}";

        // 驱动 pairing step 触发 initPairing
        bool paired = pairing_client.step(1000);
        assert(!paired);
        assert(pairing_client.getState() == PairingClientState::Polling);
        assert(pairing_client.getPairingCode() == "654321");
        assert(mock_display.show_count >= 1); // 屏幕已刷新配对码
        assert(mock_display.last_frame.size() == 48000);


        // Step 3: 家长认领前轮询 (返回 pending)
        transport->next_status_code = 200;
        transport->next_get_body = "{\"status\":\"pending\"}";

        paired = pairing_client.step(4500); // 间隔 > 3000ms
        assert(!paired);
        assert(pairing_client.getState() == PairingClientState::Polling);

        // Step 4: 家长认领后轮询 (返回 paired + token)
        transport->next_status_code = 200;
        transport->next_get_body = "{\"status\":\"paired\",\"token\":\"jwt-claimed-token-555\"}";

        paired = pairing_client.step(8000);
        assert(paired);
        assert(pairing_client.isPaired());
        assert(pairing_client.getState() == PairingClientState::Paired);

        // 验证 Token 已写入 NVS
        assert(nvs.isPaired());
        assert(nvs.getDeviceToken() == "jwt-claimed-token-555");
        assert(client.getDeviceToken() == "jwt-claimed-token-555");

        // Step 5: 本地 10 秒长按恢复出厂 (docs/07 §8 & §14)
        OfflineEventQueue queue("scratch");
        queue.init();

        QueuedTaskEvent ev;
        ev.event_id = "test-ev-1";
        ev.task_occurrence_id = "t-1";
        queue.enqueue(ev);
        assert(queue.size() == 1);

        // 模拟触发 10s VeryLongPress
        nvs.factoryReset();
        queue.clear();
        pairing_client.resetPairing();

        // 验证状态重置
        assert(!nvs.isProvisioned());
        assert(!nvs.isPaired());
        assert(queue.empty());
        assert(!pairing_client.isPaired());
        assert(pairing_client.getState() == PairingClientState::Unpaired);

        printf("Test 5 PASS: Complete E2E lifecycle (Prov -> Pair -> Claim -> 10s Factory Reset) verified.\n\n");
    }

    printf("==================================================\n");
    printf("  ALL PHASE 8 TESTS PASSED SUCCESSFULLY!          \n");
    printf("==================================================\n");
    return 0;
}
