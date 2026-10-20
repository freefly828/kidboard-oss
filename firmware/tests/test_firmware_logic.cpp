/**
 * Firmware Logic Host Unit Tests — 跨平台固件核心逻辑与冻结契约验证。
 *
 * 验证目标：
 * 1. 冻结引脚与尺寸契约：800×480、48,000 bytes、GPIO4/5/6/7/8/9/10/11/12。
 * 2. 刷新模式决策树（docs/06 §8）：
 *    - 开机首帧 -> Full
 *    - 强制刷新 -> Full
 *    - 24h 超时 -> Full
 *    - 局刷 >= 5 次 -> Full
 *    - 局刷面积 <= 0.25 且硬件支持 -> Partial
 *    - 局刷面积 > 0.25 -> FastFull
 * 3. FrameStore 存储管理与 48,000 字节强制校验。
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

#include "../main/board_config.h"
#include "../main/refresh_policy/refresh_policy.h"
#include "../main/frame_store/frame_store.h"
#include "../main/api_client/json_helper.h"
#include "../main/tasks/task_focus_manager.h"

using namespace kidboard;

static int tests_passed = 0;

#define TEST_CHECK(cond, msg) \
    do { \
        if (cond) { \
            tests_passed++; \
            printf("PASS %s\n", msg); \
        } else { \
            fprintf(stderr, "FAIL %s (line %d)\n", msg, __LINE__); \
            assert(false); \
        } \
    } while (0)

void test_board_config_contracts() {
    printf("\n--- Testing Board Config & Pin Contracts ---\n");
    const auto& pins = BoardConfig::getPins();

    // 验证 SPI 引脚（docs/11 §3）
    TEST_CHECK(pins.epaper_mosi == 9, "MOSI pin is GPIO9 (reTerminal E1001)");
    TEST_CHECK(pins.epaper_sclk == 7, "SCLK pin is GPIO7 (reTerminal E1001)");
    TEST_CHECK(pins.epaper_cs == 10, "CS pin is GPIO10");
    TEST_CHECK(pins.epaper_dc == 11, "DC pin is GPIO11 (reTerminal E1001)");
    TEST_CHECK(pins.epaper_rst == 12, "RST pin is GPIO12 (reTerminal E1001)");
    TEST_CHECK(pins.epaper_busy == 13, "BUSY pin is GPIO13 (reTerminal E1001)");
    TEST_CHECK(pins.epaper_busy_active_level == 0 || pins.epaper_busy_active_level == 1, "BUSY active level is 0 or 1");
    TEST_CHECK(pins.sd_cs == 14, "SD CS pin is GPIO14 (shared SPI bus)");

    // 验证按键引脚（docs/11 §3；D-021 按用户习惯对调 NEXT/BACK）
    TEST_CHECK(pins.button_done == 3, "DONE button is GPIO3 (Refresh key)");
    TEST_CHECK(pins.button_next == 4, "NEXT button is GPIO4 (white key next to green, D-021)");
    TEST_CHECK(pins.button_back == 5, "BACK button is GPIO5 (outer white key, D-021)");
    TEST_CHECK(pins.button_debounce_ms == 40, "Button debounce is 40ms (30~50ms range)");

    // 验证屏幕尺寸与缓冲区契约（docs/06 §5 冻结项）
    TEST_CHECK(SCREEN_WIDTH == 800, "SCREEN_WIDTH is exactly 800");
    TEST_CHECK(SCREEN_HEIGHT == 480, "SCREEN_HEIGHT is exactly 480");
    TEST_CHECK(FRAME_BUFFER_BYTES == 48000, "FRAME_BUFFER_BYTES is exactly 48000 (800*480/8)");
}

void test_refresh_policy() {
    printf("\n--- Testing Refresh Policy (docs/06 §8) ---\n");
    RefreshPolicy policy;

    // 1. 开机首帧必须 Full
    RefreshDecisionInput in1 = {
        .boot_first_frame = true,
        .force_full_refresh = false,
        .changed_ratio = 0.05f,
        .partial_supported = true,
        .current_epoch_seconds = 1000,
    };
    TEST_CHECK(policy.decideMode(in1) == RefreshMode::Full, "Boot initial frame must trigger Full refresh");

    // 记录一次 Full 刷新
    policy.recordRefresh(RefreshMode::Full, 1000, 1);
    TEST_CHECK(policy.getPartialCount() == 0, "Full refresh resets partial_count to 0");
    TEST_CHECK(policy.getLastFullRefreshEpoch() == 1000, "Last full epoch recorded");

    // 2. 小区域局部变化 -> Partial
    RefreshDecisionInput in2 = {
        .boot_first_frame = false,
        .force_full_refresh = false,
        .changed_ratio = 0.10f,
        .partial_supported = true,
        .current_epoch_seconds = 1050,
    };
    TEST_CHECK(policy.decideMode(in2) == RefreshMode::Partial, "Changed ratio 0.10 <= 0.25 triggers Partial");

    // 连续执行 4 次 Partial 刷新
    for (int i = 0; i < 4; i++) {
        policy.recordRefresh(RefreshMode::Partial, 1050 + i * 10, 2 + i);
    }
    TEST_CHECK(policy.getPartialCount() == 4, "Partial count reaches 4");

    // 第 5 次 Partial 后再次刷新 -> 次数累积至 5 次
    policy.recordRefresh(RefreshMode::Partial, 1100, 6);
    TEST_CHECK(policy.getPartialCount() == 5, "Partial count reaches 5");

    // 3. 次数 >= 5 次必须强制 Full
    TEST_CHECK(policy.decideMode(in2) == RefreshMode::Full, "Partial count >= 5 enforces Full refresh");

    // 记录 Full 刷新后计数清零
    policy.recordRefresh(RefreshMode::Full, 1150, 7);
    TEST_CHECK(policy.getPartialCount() == 0, "Full refresh resets partial count");

    // 4. 大区域变化 (ratio = 0.4 > 0.25) -> FastFull
    RefreshDecisionInput in3 = {
        .boot_first_frame = false,
        .force_full_refresh = false,
        .changed_ratio = 0.40f,
        .partial_supported = true,
        .current_epoch_seconds = 1200,
    };
    TEST_CHECK(policy.decideMode(in3) == RefreshMode::FastFull, "Changed ratio 0.40 > 0.25 triggers FastFull");

    // 5. 超过 24 小时未全刷 -> Full
    RefreshDecisionInput in4 = {
        .boot_first_frame = false,
        .force_full_refresh = false,
        .changed_ratio = 0.05f,
        .partial_supported = true,
        .current_epoch_seconds = 1150 + 25 * 3600, // 25 hours later
    };
    TEST_CHECK(policy.decideMode(in4) == RefreshMode::Full, "24h timeout enforces Full refresh");

    // 6. 远端命令强制全刷 -> Full
    RefreshDecisionInput in5 = {
        .boot_first_frame = false,
        .force_full_refresh = true,
        .changed_ratio = 0.05f,
        .partial_supported = true,
        .current_epoch_seconds = 1200,
    };
    TEST_CHECK(policy.decideMode(in5) == RefreshMode::Full, "Remote forceFullRefresh enforces Full refresh");
}

void test_frame_store() {
    printf("\n--- Testing FrameStore & Size Assertion ---\n");
    FrameStore store("/tmp/kb_test_frames");
    store.init();

    // 1. 非 48,000 字节必须拒绝存储
    std::vector<uint8_t> bad_buf(47999, 0xFF);
    TEST_CHECK(!store.saveStaging(bad_buf.data(), bad_buf.size()), "Staging rejects 47,999 bytes");

    // 2. 48,000 字节合法存储与原子提交
    std::vector<uint8_t> valid_buf(FRAME_BUFFER_BYTES, 0xAA);
    valid_buf[0] = 0x12;
    valid_buf[FRAME_BUFFER_BYTES - 1] = 0x34;

    TEST_CHECK(store.saveStaging(valid_buf.data(), valid_buf.size()), "Staging accepts 48,000 bytes");
    TEST_CHECK(store.commitStaging(), "Commit staging renames staging -> last");
    TEST_CHECK(store.hasLastFrame(), "hasLastFrame returns true after commit");

    // 3. 读取已落盘的 last 帧
    std::vector<uint8_t> read_buf(FRAME_BUFFER_BYTES, 0x00);
    size_t out_len = 0;
    TEST_CHECK(store.loadLastFrame(read_buf.data(), read_buf.size(), &out_len), "loadLastFrame succeeded");
    TEST_CHECK(out_len == FRAME_BUFFER_BYTES, "Read length is exactly 48,000 bytes");
    TEST_CHECK(read_buf[0] == 0x12 && read_buf[FRAME_BUFFER_BYTES - 1] == 0x34, "Content matches written data");
}

void test_sync_request_json_contract() {
    printf("\n--- Testing Sync Request JSON vs server schema ---\n");
    // 真机实测：设备无时钟，lastRefreshAt 为空串时服务端 400（Invalid ISO datetime），必须发 null
    SyncTelemetry t;
    t.last_refresh_at = "";
    std::string json = JsonHelper::buildSyncRequestJson(t);
    TEST_CHECK(json.find("\"lastRefreshAt\":null") != std::string::npos, "empty lastRefreshAt is sent as null");
    TEST_CHECK(json.find("\"lastRefreshAt\":\"\"") == std::string::npos, "never sends empty-string lastRefreshAt");

    t.last_refresh_at = "2026-10-09T08:10:02Z";
    t.last_refresh_mode = "partial";
    json = JsonHelper::buildSyncRequestJson(t);
    TEST_CHECK(json.find("\"lastRefreshAt\":\"2026-10-09T08:10:02Z\"") != std::string::npos, "non-empty lastRefreshAt kept as string");
    TEST_CHECK(json.find("\"lastRefreshMode\":\"partial\"") != std::string::npos, "lastRefreshMode kept as string");
}

void test_interactive_tasks_and_focus() {
    printf("\n--- Testing interactiveTasks parsing & focus alignment ---\n");
    // 与 apps/web device/sync 响应同构（含嵌套对象与字符串内括号）
    const std::string resp =
        "{\"serverTime\":\"2026-10-09T00:40:00.000Z\",\"nextSyncSeconds\":30,\"desiredFrame\":null,"
        "\"refreshPolicy\":{\"partialEnabled\":true,\"partialMaxCount\":5,\"forceFullAfterHours\":24,\"partialAreaMaxRatio\":0.25},"
        "\"interactiveTasks\":["
        "{\"id\":\"11111111-1111-4111-8111-111111111111\",\"slot\":0,\"status\":\"completed\"},"
        "{\"id\":\"22222222-2222-4222-8222-222222222222\",\"slot\":1,\"status\":\"pending\"},"
        "{\"id\":\"33333333-3333-4333-8333-333333333333\",\"slot\":2,\"status\":\"pending\"}"
        "],\"ota\":null,\"commands\":[{\"id\":\"c1\",\"type\":\"noop {x}\"}]}";
    SyncResponse out;
    TEST_CHECK(JsonHelper::parseSyncResponseJson(resp, out), "sync response parses");
    TEST_CHECK(out.interactive_tasks.size() == 3, "interactiveTasks parsed (3 tasks)");
    TEST_CHECK(out.interactive_tasks[1].slot == 1 && out.interactive_tasks[1].status == "pending", "task slot/status parsed");

    TaskFocusManager focus;
    focus.updateTasks(out.interactive_tasks);
    const InteractiveTask* f = focus.getFocusedTask();
    TEST_CHECK(f && f->id == "22222222-2222-4222-8222-222222222222",
               "focus defaults to first pending (matches '>' on server-rendered frame)");
}

int main() {
    printf("========================================\n");
    printf("  KidBoard Firmware Unit Tests (Host)   \n");
    printf("========================================\n");

    test_board_config_contracts();
    test_refresh_policy();
    test_frame_store();
    test_sync_request_json_contract();
    test_interactive_tasks_and_focus();

    printf("\n========================================\n");
    printf("ALL TESTS PASSED (%d assertions)\n", tests_passed);
    printf("========================================\n");
    return 0;
}
