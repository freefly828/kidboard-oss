/**
 * 设备时钟（D-015）宿主机测试：时间解析与换算、时钟区绘制只影响预留区域、
 * 同步响应 utcOffsetMinutes 解析、对时与偏移持久化。
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

#include "api_client/json_helper.h"
#include "board_config.h"
#include "clock/clock_renderer.h"
#include "clock/device_clock.h"
#include "storage/nvs_manager.h"

using namespace kidboard;

static int blackIn(const uint8_t* frame, int x0, int y0, int w, int h) {
    int n = 0;
    for (int y = y0; y < y0 + h; ++y)
        for (int x = x0; x < x0 + w; ++x)
            if (!(frame[y * 100 + (x >> 3)] & (0x80 >> (x & 7)))) ++n;
    return n;
}

int main() {
    // ---- 日期换算 ----
    assert(DeviceClock::daysFromCivil(1970, 1, 1) == 0);
    assert(DeviceClock::daysFromCivil(2000, 3, 1) == 11017);
    for (int64_t z : {0LL, 11016LL, 11017LL, 20000LL, 20736LL, 47482LL}) {
        int y, m, d;
        DeviceClock::civilFromDays(z, y, m, d);
        assert(DeviceClock::daysFromCivil(y, m, d) == z);
    }

    // ---- ISO 解析 ----
    int64_t t = DeviceClock::parseIsoUtc("2026-10-09T17:56:26.878Z");
    assert(t == DeviceClock::daysFromCivil(2026, 10, 9) * 86400 + 17 * 3600 + 56 * 60 + 26);
    assert(DeviceClock::parseIsoUtc("2026-10-09T17:56:26Z") == t);
    assert(DeviceClock::parseIsoUtc("2026-10-09T17:56:26+08:00") == -1);  // 只接受 UTC
    assert(DeviceClock::parseIsoUtc("garbage") == -1);
    assert(DeviceClock::parseIsoUtc("") == -1);
    assert(DeviceClock::plausible(t));
    assert(!DeviceClock::plausible(0));

    // ---- 本地时分：北京 +480，跨午夜；纽约 -240；印度 +330 ----
    int h, m;
    DeviceClock::hourMinuteOf(t, 480, h, m);
    assert(h == 1 && m == 56);  // 17:56Z → 次日 01:56
    DeviceClock::hourMinuteOf(t, -240, h, m);
    assert(h == 13 && m == 56);
    DeviceClock::hourMinuteOf(t, 330, h, m);
    assert(h == 23 && m == 26);
    DeviceClock::hourMinuteOf(DeviceClock::daysFromCivil(2026, 1, 1) * 86400, -300, h, m);
    assert(h == 19 && m == 0);  // 前一天 19:00

    // ---- 同步响应 utcOffsetMinutes（含负数、缺省） ----
    SyncResponse r1;
    assert(JsonHelper::parseSyncResponseJson(
        "{\"serverTime\":\"2026-10-09T17:56:26.878Z\",\"utcOffsetMinutes\":-300,\"nextSyncSeconds\":30,\"desiredFrame\":null}", r1));
    assert(r1.has_utc_offset && r1.utc_offset_minutes == -300);
    SyncResponse r2;
    assert(JsonHelper::parseSyncResponseJson("{\"serverTime\":\"2026-10-09T17:56:26.878Z\",\"nextSyncSeconds\":30}", r2));
    assert(!r2.has_utc_offset);

    // ---- 对时：偏移变化返回 true，之后本地时间按服务器时间 + 偏移 ----
    DeviceClock clk;
    clk.init(480);
    assert(clk.syncFromServer("2026-10-09T17:56:26.878Z", 480, true) == false);
    assert(clk.isValid());
    assert(clk.localHourMinute(h, m) && h == 1 && (m == 56 || m == 57));
    assert(clk.syncFromServer("2026-10-09T17:56:30Z", 540, true) == true);
    assert(clk.utcOffsetMinutes() == 540);
    assert(clk.localHourMinute(h, m) && h == 2);
    assert(clk.syncFromServer("2026-10-09T17:56:30Z", 0, false) == false);  // 无偏移字段时保持
    assert(clk.utcOffsetMinutes() == 540);
    assert(clk.syncFromServer("not-a-time", 9999, true) == false);           // 非法偏移被忽略

    // ---- 偏移持久化（NVS） ----
    NvsManager nvs("/tmp/kb_clock_nvs.txt");
    assert(nvs.init());
    assert(nvs.setClockUtcOffset(-330));
    int off = 0;
    assert(nvs.getClockUtcOffset(off) && off == -330);

    // ---- 时钟区绘制 ----
    uint8_t region[ClockRenderer::kRegionBytes];
    assert(ClockRenderer::renderRegion(region, sizeof(region), 21, 35));
    int ink = 0;
    for (size_t i = 0; i < sizeof(region); ++i)
        for (int b = 0; b < 8; ++b)
            if (!(region[i] & (0x80 >> b))) ++ink;
    assert(ink > 300);  // 有字
    uint8_t region2[ClockRenderer::kRegionBytes];
    ClockRenderer::renderRegion(region2, sizeof(region2), 21, 36);
    assert(memcmp(region, region2, sizeof(region)) != 0);  // 分钟变化 → 画面不同
    assert(!ClockRenderer::renderRegion(region, sizeof(region), 24, 0));  // 越界 → 空白
    for (size_t i = 0; i < sizeof(region); ++i) assert(region[i] == 0xFF);

    // 整帧：只改时钟区，其余像素不变
    static uint8_t frame[FRAME_BUFFER_BYTES];
    memset(frame, 0xFF, sizeof(frame));
    assert(ClockRenderer::drawIntoFrame(frame, sizeof(frame), 23, 59));
    int in_slot = blackIn(frame, ClockRenderer::kSlotX, ClockRenderer::kSlotY, ClockRenderer::kSlotW, ClockRenderer::kSlotH);
    int total = blackIn(frame, 0, 0, 800, 480);
    assert(in_slot > 300 && in_slot == total);
    // 槽位与服务端 CLOCK_SLOT 一致且按字节对齐
    assert(ClockRenderer::kSlotX % 8 == 0 && ClockRenderer::kSlotW % 8 == 0);
    assert(ClockRenderer::kSlotX == 16 && ClockRenderer::kSlotY == 8 &&
           ClockRenderer::kSlotW == 104 && ClockRenderer::kSlotH == 38);
    assert(!ClockRenderer::drawIntoFrame(frame, 100, 1, 1));

    printf("CLOCK TESTS PASSED\n");
    return 0;
}
