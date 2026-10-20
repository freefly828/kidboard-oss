/**
 * SyncEngine Unit & Integration Tests (Host)
 *
 * 验证目标：
 * 1. 正常同步：远端有新帧 -> 下载 48KB -> SHA-256 校验通过 -> FrameStore 提交 -> 屏幕刷新 -> 本地版本推进
 * 2. C01 契约：相同版本不变不下载，避免无效流量
 * 3. C02 / D06 契约：数据篡改或校验不符时必须拒绝显示，维持本地旧帧不变
 * 4. D01 / D04 / D05 契约：网络异常或服务端宕机时保留最后一帧
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <memory>
#include <string>

#include "crypto/sha256.h"
#include "api_client/api_client.h"
#include "frame_store/frame_store.h"
#include "refresh_policy/refresh_policy.h"
#include "epaper/epaper_interface.h"
#include "sync_engine/sync_engine.h"

using namespace kidboard;

// Mock 墨水屏
class MockDisplay : public IEpaperDisplay {
public:
    MockDisplay() : show_count(0), sleep_count(0), last_mode(RefreshMode::Full) {}
    bool init() override { return true; }
    bool show(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect) override {
        (void)rect;
        if (!frame || len != FRAME_BUFFER_BYTES) return false;
        show_count++;
        last_mode = mode;
        last_displayed_frame.assign(frame, frame + len);
        return true;
    }
    void sleep() override { sleep_count++; }

    int show_count;
    int sleep_count;
    RefreshMode last_mode;
    std::vector<uint8_t> last_displayed_frame;
};

// Mock HTTP 传输层，可精确控制网络行为与服务端返回
class MockHttpTransport : public IHttpTransport {
public:
    MockHttpTransport()
        : server_version(1),
          simulate_network_fail(false),
          simulate_bad_checksum(false),
          download_called(false),
          download_count(0) {
        // 生成默认 48KB 测试帧 (以 0x55 填充)
        server_frame_data.assign(FRAME_BUFFER_BYTES, 0x55);
        server_frame_data[0] = 0xAA;
        server_frame_data[FRAME_BUFFER_BYTES - 1] = 0xBB;
        server_sha256 = Sha256::hashHex(server_frame_data.data(), server_frame_data.size());
    }

    HttpResponse post(const std::string& url, const std::string& auth_header, const std::string& json_body) override {
        (void)url;
        (void)json_body;
        HttpResponse resp;
        if (simulate_network_fail) {
            resp.success = false;
            resp.status_code = 503;
            resp.error_msg = "Service Unavailable";
            return resp;
        }

        // 验证 Authorization 头
        assert(auth_header.rfind("Device ", 0) == 0);

        resp.success = true;
        resp.status_code = 200;

        std::string effective_sha = simulate_bad_checksum ?
            "0000000000000000000000000000000000000000000000000000000000000000" :
            server_sha256;

        char buf[1024];
        snprintf(buf, sizeof(buf),
            "{"
            "\"serverTime\":\"2026-09-16T12:00:00Z\","
            "\"nextSyncSeconds\":30,"
            "\"desiredFrame\":{"
                "\"version\":%d,"
                "\"width\":800,"
                "\"height\":480,"
                "\"bytes\":48000,"
                "\"sha256\":\"%s\","
                "\"url\":\"/api/v1/device/frames/%d/bin\","
                "\"forceFullRefresh\":false"
            "},"
            "\"refreshPolicy\":{"
                "\"partialEnabled\":true,"
                "\"partialMaxCount\":5,"
                "\"forceFullAfterHours\":24,"
                "\"partialAreaMaxRatio\":0.25"
            "}"
            "}",
            server_version,
            effective_sha.c_str(),
            server_version
        );
        resp.body = std::string(buf);
        return resp;
    }

    HttpResponse get(const std::string& url, const std::string& auth_header) override {
        (void)url;
        (void)auth_header;
        HttpResponse resp;
        resp.success = true;
        resp.status_code = 200;
        return resp;
    }

    bool downloadBinary(const std::string& url, const std::string& auth_header,
                        uint8_t* out_buffer, size_t max_len, size_t* out_len) override {
        (void)url;
        (void)auth_header;
        download_called = true;
        download_count++;

        if (simulate_network_fail || max_len < FRAME_BUFFER_BYTES) {
            return false;
        }

        memcpy(out_buffer, server_frame_data.data(), FRAME_BUFFER_BYTES);
        if (out_len) *out_len = FRAME_BUFFER_BYTES;
        return true;
    }

    int server_version;
    bool simulate_network_fail;
    bool simulate_bad_checksum;
    bool download_called;
    int download_count;
    std::vector<uint8_t> server_frame_data;
    std::string server_sha256;
};

int main() {
    printf("==================================================\n");
    printf("  KidBoard SyncEngine Unit & Integration Tests    \n");
    printf("==================================================\n");

    auto transport = std::make_shared<MockHttpTransport>();
    ApiClient api_client(transport);
    api_client.setBaseUrl("http://api.kidboard.local");
    api_client.setDeviceToken("test_token_123456");

    FrameStore frame_store("/tmp/test_kb_sync_frames");
    frame_store.init();

    RefreshPolicy refresh_policy;
    MockDisplay display;

    SyncEngine sync_engine(api_client, frame_store, refresh_policy, display);
    SyncTelemetry telemetry;
    telemetry.firmware_version = "1.0.0";
    telemetry.frame_version = 0;
    telemetry.uptime_seconds = 100;

    // ----------------------------------------------------
    // Test 1: 首次同步并下载 v1 帧
    // ----------------------------------------------------
    printf("\n--- Test 1: Initial Sync & Download v1 Frame ---\n");
    transport->download_called = false;
    int next_sync = 0;
    SyncStepResult r1 = sync_engine.step(telemetry, &next_sync);

    assert(r1 == SyncStepResult::FrameUpdated);
    assert(transport->download_called == true);
    assert(display.show_count == 1);
    assert(display.sleep_count == 1);
    assert(sync_engine.getLocalFrameVersion() == 1);
    assert(next_sync == 30);
    assert(frame_store.hasLastFrame());

    // 验证落盘数据与 SHA-256
    uint8_t read_back[FRAME_BUFFER_BYTES];
    size_t out_len = 0;
    assert(frame_store.loadLastFrame(read_back, sizeof(read_back), &out_len));
    assert(out_len == FRAME_BUFFER_BYTES);
    assert(read_back[0] == 0xAA && read_back[FRAME_BUFFER_BYTES - 1] == 0xBB);
    printf("Test 1 PASS: Frame v1 downloaded, verified, displayed and committed.\n");

    // ----------------------------------------------------
    // Test 2: C01 不变不下载 (相同版本不下载帧)
    // ----------------------------------------------------
    printf("\n--- Test 2: C01 Unchanged Version Does NOT Download ---\n");
    transport->download_called = false;
    int prev_show_count = display.show_count;
    telemetry.frame_version = 1; // 上报当前版本为 1

    SyncStepResult r2 = sync_engine.step(telemetry, &next_sync);
    assert(r2 == SyncStepResult::UpToDate);
    assert(transport->download_called == false); // 严格保证不调用下载
    assert(display.show_count == prev_show_count); // 屏幕不重复刷新
    assert(sync_engine.getLocalFrameVersion() == 1);
    printf("Test 2 PASS (C01): Version identical, download avoided successfully.\n");

    // ----------------------------------------------------
    // Test 3: C02 / D06 篡改拒绝防线 (SHA-256 不匹配拒绝显示并保持旧帧)
    // ----------------------------------------------------
    printf("\n--- Test 3: C02/D06 Tamper Protection & Reject on Mismatch ---\n");
    // 服务端推进至版本 2，但篡改 SHA-256 manifest
    transport->server_version = 2;
    transport->simulate_bad_checksum = true;
    transport->download_called = false;
    prev_show_count = display.show_count;

    SyncStepResult r3 = sync_engine.step(telemetry, &next_sync);
    assert(r3 == SyncStepResult::ChecksumFailed);
    assert(transport->download_called == true);
    assert(display.show_count == prev_show_count); // 拒绝刷新！屏幕保持不变
    assert(sync_engine.getLocalFrameVersion() == 1); // 本地版本不推进！
    assert(sync_engine.getErrorCount() == 1);

    // 验证本地磁盘上仍然是旧的 v1 帧
    assert(frame_store.loadLastFrame(read_back, sizeof(read_back), &out_len));
    assert(read_back[0] == 0xAA && read_back[FRAME_BUFFER_BYTES - 1] == 0xBB);
    printf("Test 3 PASS (C02/D06): Tampered checksum rejected! Old frame protected.\n");

    // ----------------------------------------------------
    // Test 4: D01 / D05 断网与服务端故障保护 (保持当前画面)
    // ----------------------------------------------------
    printf("\n--- Test 4: D01/D05 Network Failure Retains Screen ---\n");
    transport->simulate_network_fail = true;
    prev_show_count = display.show_count;

    SyncStepResult r4 = sync_engine.step(telemetry, &next_sync);
    assert(r4 == SyncStepResult::NetworkError);
    assert(display.show_count == prev_show_count); // 屏幕不被清空，不闪烁
    assert(sync_engine.getLocalFrameVersion() == 1);
    printf("Test 4 PASS (D01/D05): Network failure handled gracefully, screen preserved.\n");

    // ----------------------------------------------------
    // Test 5: 恢复网络后正常升级至 v2
    // ----------------------------------------------------
    printf("\n--- Test 5: Network Recovered & Upgrade to v2 ---\n");
    transport->simulate_network_fail = false;
    transport->simulate_bad_checksum = false;
    // 更新 v2 帧内容 (填充 0x77)
    transport->server_frame_data.assign(FRAME_BUFFER_BYTES, 0x77);
    transport->server_frame_data[0] = 0x11;
    transport->server_frame_data[FRAME_BUFFER_BYTES - 1] = 0x22;
    transport->server_sha256 = Sha256::hashHex(transport->server_frame_data.data(), FRAME_BUFFER_BYTES);

    SyncStepResult r5 = sync_engine.step(telemetry, &next_sync);
    assert(r5 == SyncStepResult::FrameUpdated);
    assert(display.show_count == prev_show_count + 1);
    assert(sync_engine.getLocalFrameVersion() == 2);
    assert(sync_engine.getErrorCount() == 0);

    // 验证本地落盘已更新为 v2
    assert(frame_store.loadLastFrame(read_back, sizeof(read_back), &out_len));
    assert(read_back[0] == 0x11 && read_back[FRAME_BUFFER_BYTES - 1] == 0x22);
    printf("Test 5 PASS: Upgraded cleanly to v2 after network recovery.\n");

    printf("\n==================================================\n");
    printf("ALL SYNC ENGINE TESTS PASSED!\n");
    printf("==================================================\n");
    return 0;
}
