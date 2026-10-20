/**
 * 专注计时（D-019）宿主机测试：状态机、显示取整、倒计时绘制只改动预留区、
 * 离线队列持久化专注事件、同步响应页类型与专注配置、不可重试 4xx 丢弃。
 */

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>

#include "api_client/api_client.h"
#include "api_client/http_transport.h"
#include "api_client/json_helper.h"
#include "board_config.h"
#include "events/offline_event_queue.h"
#include "focus/focus_renderer.h"
#include "focus/focus_timer.h"
#include "frame_store/frame_store.h"
#include "refresh_policy/refresh_policy.h"
#include "sync_engine/sync_engine.h"

using namespace kidboard;

class NullDisplay : public IEpaperDisplay {
public:
    bool init() override { return true; }
    bool show(const uint8_t*, size_t, RefreshMode, const DirtyRect*) override { return true; }
    void sleep() override {}
};

/** 记录上报请求；可设定返回码 */
class EventServer : public IHttpTransport {
public:
    int status = 200;
    std::string last_url, last_body;
    int posts = 0;
    HttpResponse post(const std::string& url, const std::string&, const std::string& body) override {
        ++posts;
        last_url = url;
        last_body = body;
        HttpResponse r;
        r.status_code = status;
        r.success = status == 200;
        r.body = "{\"status\":\"ok\",\"applied\":true,\"idempotent\":false}";
        return r;
    }
    HttpResponse get(const std::string&, const std::string&) override { return {}; }
    bool downloadBinary(const std::string&, const std::string&, uint8_t*, size_t, size_t*) override { return false; }
};

static int blackIn(const uint8_t* f, int x0, int y0, int w, int h) {
    int n = 0;
    for (int y = y0; y < y0 + h; ++y)
        for (int x = x0; x < x0 + w; ++x)
            if (!(f[y * 100 + (x >> 3)] & (0x80 >> (x & 7)))) ++n;
    return n;
}

int main() {
    // ---- 状态机 ----
    FocusTimer t;
    t.setMinutes(25);
    assert(t.state() == FocusTimer::State::Idle && t.remainingSec(0) == 1500 && !t.active());
    t.setMinutes(1);
    assert(t.minutes() == 5);  // 下限 5 分钟
    t.setMinutes(25);
    t.start(1000);
    assert(t.active() && t.remainingSec(1000) == 1500);
    assert(t.remainingSec(1000 + 61 * 1000) == 1439);
    t.pause(1000 + 600 * 1000);  // 进行 10 分钟后暂停
    assert(t.state() == FocusTimer::State::Paused && t.remainingSec(999999999) == 900);  // 暂停不走时
    t.setMinutes(40);                                                                     // 进行中改时长不影响本次
    t.resume(5000000);
    assert(t.remainingSec(5000000) == 900 && t.runMinutes() == 25);
    assert(!t.tick(5000000 + 899 * 1000));
    assert(t.tick(5000000 + 900 * 1000));   // 到点：只返回一次 true
    assert(!t.tick(5000000 + 901 * 1000));
    assert(t.state() == FocusTimer::State::Done && t.remainingSec(0) == 0);
    t.reset();
    assert(t.state() == FocusTimer::State::Idle && t.remainingSec(0) == 40 * 60);  // 下次用新时长

    // ---- 显示取整：>1 分钟按整分向上，最后一分钟按 15 秒 ----
    assert(FocusTimer::quantize(1500) == 1500 && FocusTimer::quantize(1499) == 1500 && FocusTimer::quantize(1441) == 1500);
    assert(FocusTimer::quantize(1440) == 1440 && FocusTimer::quantize(61) == 120);
    assert(FocusTimer::quantize(60) == 60 && FocusTimer::quantize(44) == 45 && FocusTimer::quantize(1) == 15 && FocusTimer::quantize(0) == 0);

    // ---- 绘制：只改动倒计时区；状态不同画面不同 ----
    static uint8_t frame[FRAME_BUFFER_BYTES];
    memset(frame, 0xFF, sizeof(frame));
    assert(FocusRenderer::drawIntoFrame(frame, sizeof(frame), FocusTimer::State::Running, 1500));
    const int in_slot = blackIn(frame, FocusRenderer::kSlotX, FocusRenderer::kSlotY, FocusRenderer::kSlotW, FocusRenderer::kSlotH);
    assert(in_slot > 3000 && in_slot == blackIn(frame, 0, 0, 800, 480));
    assert(FocusRenderer::kSlotX % 8 == 0 && FocusRenderer::kSlotW % 8 == 0);
    assert(FocusRenderer::kSlotX == 192 && FocusRenderer::kSlotY == 96 && FocusRenderer::kSlotW == 416 && FocusRenderer::kSlotH == 112);
    static uint8_t a[FocusRenderer::kRegionBytes], b[FocusRenderer::kRegionBytes], c[FocusRenderer::kRegionBytes];
    FocusRenderer::renderRegion(a, sizeof(a), FocusTimer::State::Running, 900);
    FocusRenderer::renderRegion(b, sizeof(b), FocusTimer::State::Paused, 900);
    FocusRenderer::renderRegion(c, sizeof(c), FocusTimer::State::Running, 840);
    assert(memcmp(a, b, sizeof(a)) != 0 && memcmp(a, c, sizeof(a)) != 0);

    // ---- 离线队列：专注事件持久化（含旧格式兼容） ----
    system("rm -rf /tmp/kb_focus_q && mkdir -p /tmp/kb_focus_q");
    {
        OfflineEventQueue q("/tmp/kb_focus_q");
        assert(q.init());
        QueuedTaskEvent ev;
        ev.kind = "focus";
        ev.minutes = 25;
        ev.event_id = "11111111-1111-4111-8111-111111111111";
        ev.occurred_at = "2026-10-10T08:25:00Z";
        assert(q.enqueue(ev));
    }
    {
        OfflineEventQueue q("/tmp/kb_focus_q");
        assert(q.init());
        q.loadFromFile();
        QueuedTaskEvent ev;
        assert(q.size() == 1 && q.peek(ev) && ev.kind == "focus" && ev.minutes == 25);
    }

    // ---- 上报：focus 走 focus-complete；不可重试的 4xx 丢弃，5xx 保留重试 ----
    auto server = std::make_shared<EventServer>();
    ApiClient api(server);
    api.setDeviceToken("t");
    FrameStore store("/tmp/kb_focus_store");
    store.init();
    RefreshPolicy policy;
    NullDisplay display;
    OfflineEventQueue q("/tmp/kb_focus_q");
    q.init();
    q.loadFromFile();
    SyncEngine engine(api, store, policy, display, nullptr, &q);
    server->status = 503;
    assert(engine.flushOfflineEvents() == 0 && q.size() == 1);  // 服务端故障：保留
    server->status = 200;
    assert(engine.flushOfflineEvents() == 1 && q.empty());
    assert(server->last_url.find("/api/v1/device/events/focus-complete") != std::string::npos);
    assert(server->last_body.find("\"minutes\":25") != std::string::npos);
    QueuedTaskEvent dead;
    dead.event_id = "22222222-2222-4222-8222-222222222222";
    dead.task_occurrence_id = "33333333-3333-4333-8333-333333333333";
    QueuedTaskEvent next = dead;
    next.event_id = "44444444-4444-4444-8444-444444444444";
    q.enqueue(dead);
    q.enqueue(next);
    server->status = 404;  // 任务已被删除：两条都被丢弃，不会堵住队列
    engine.flushOfflineEvents();
    assert(q.empty());

    // ---- 同步响应：页类型与专注配置 ----
    SyncResponse r;
    std::string sha(64, 'b');
    assert(JsonHelper::parseSyncResponseJson("{\"serverTime\":\"x\",\"nextSyncSeconds\":30,\"pages\":[{\"index\":3,\"kind\":\"focus\",\"sha256\":\"" +
                                                 sha + "\",\"url\":\"/p/3\"}],\"focus\":{\"minutes\":30,\"points\":5}}",
                                             r));
    assert(r.has_focus && r.focus_minutes == 30 && r.pages.size() == 1 && r.pages[0].kind == "focus");

    printf("FOCUS TESTS PASSED\n");
    return 0;
}
