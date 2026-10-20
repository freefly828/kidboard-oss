/**
 * 提醒与蜂鸣（D-017）宿主机测试：同步响应 commands 解析、蜂鸣节拍推进。
 */

#include <cassert>
#include <cstdio>
#include <string>

#include "api_client/json_helper.h"
#include "buzzer/buzzer.h"

using namespace kidboard;

int main() {
    // commands 解析：beep 带次数；未知命令也保留类型；空数组
    SyncResponse r;
    assert(JsonHelper::parseSyncResponseJson(
        "{\"serverTime\":\"2026-10-10T07:20:05Z\",\"nextSyncSeconds\":30,\"desiredFrame\":null,"
        "\"commands\":[{\"id\":\"c1\",\"type\":\"beep\",\"payload\":{\"alertId\":\"a1\",\"beeps\":3}},"
        "{\"id\":\"c2\",\"type\":\"reboot\",\"payload\":{}}]}",
        r));
    assert(r.commands.size() == 2);
    assert(r.commands[0].id == "c1" && r.commands[0].type == "beep" && r.commands[0].beeps == 3);
    assert(r.commands[1].type == "reboot" && r.commands[1].beeps == 0);
    SyncResponse empty;
    assert(JsonHelper::parseSyncResponseJson("{\"serverTime\":\"x\",\"nextSyncSeconds\":30,\"commands\":[]}", empty));
    assert(empty.commands.empty());

    // 蜂鸣：3 声 = 6 次开关切换，开 150 ms / 关 150 ms
    Buzzer b;
    assert(b.init());
    assert(!b.isBusy());
    b.beep(3);
    assert(b.isBusy());
    uint32_t t = 1000;
    for (int i = 0; i < 100 && b.isBusy(); ++i) {
        b.poll(t);
        t += 50;
    }
    assert(!b.isBusy());
    // 开-关-开-关-开-关：最后一次"关"之后即结束，总时长 = 5 段 × 150 ms（+ 轮询粒度 50 ms）
    assert(t - 1000 >= 5 * 150 && t - 1000 <= 5 * 150 + 100);
    assert(Buzzer::segmentMs(Buzzer::Pattern::Long, true) == 600);
    assert(Buzzer::segmentMs(Buzzer::Pattern::Short, false) == 150);

    // stop()：响铃中立即静音并取消剩余节拍
    b.beep(5, Buzzer::Pattern::Long);
    b.poll(2000);
    assert(b.isBusy());
    b.stop();
    assert(!b.isBusy());
    b.poll(5000);
    assert(!b.isBusy());

    // 次数为 0 / 负数：不响
    b.beep(0);
    assert(!b.isBusy());
    b.beep(-2);
    assert(!b.isBusy());

    printf("ALERT TESTS PASSED\n");
    return 0;
}
