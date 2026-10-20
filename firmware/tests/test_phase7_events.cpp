/**
 * Phase 7 Unit & Integration Tests (Host)
 *
 * 验证目标：
 * 1. RFC 4122 v4 UUID 生成器格式与唯一性断言
 * 2. TaskFocusManager 环形焦点导航 (NEXT / BACK) 与完成标记
 * 3. OfflineEventQueue 本地 SPIFFS 持久化断电恢复与 100 条上限保护
 * 4. 断网离线入队 -> 联网排空重放 -> C03 服务端 UUID 幂等校验
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <string>
#include <set>
#include <memory>

#include "utils/uuid.h"
#include "tasks/task_focus_manager.h"
#include "events/offline_event_queue.h"
#include "api_client/device_api_types.h"
#include "api_client/json_helper.h"
#include "api_client/api_client.h"
#include "frame_store/frame_store.h"
#include "refresh_policy/refresh_policy.h"
#include "epaper/epaper_interface.h"
#include "sync_engine/sync_engine.h"

using namespace kidboard;

class DummyDisplay : public IEpaperDisplay {
public:
    bool init() override { return true; }
    bool show(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect) override {
        (void)frame; (void)len; (void)mode; (void)rect;
        return true;
    }
    void sleep() override {}
};

class EventTrackingTransport : public IHttpTransport {
public:
    EventTrackingTransport()
        : network_up(true), complete_request_count(0) {}

    HttpResponse post(const std::string& url, const std::string& auth_header, const std::string& json_body) override {
        (void)auth_header;
        HttpResponse res;

        if (!network_up) {
            res.success = false;
            res.status_code = 503;
            res.error_msg = "Network Offline";
            return res;
        }

        if (url.find("/api/v1/device/events/task-complete") != std::string::npos) {
            complete_request_count++;
            last_event_body = json_body;

            // 提取 eventId
            std::string event_id;
            JsonHelper::extractStringField(json_body, "eventId", event_id);

            // 仿真服务端唯一索引与幂等 (C03)
            bool is_duplicate = (received_events.find(event_id) != received_events.end());
            received_events.insert(event_id);

            res.success = true;
            res.status_code = 200;
            if (is_duplicate) {
                res.body = "{\"status\":\"ok\",\"applied\":false,\"idempotent\":true}";
            } else {
                res.body = "{\"status\":\"ok\",\"applied\":true,\"idempotent\":false}";
            }
            return res;
        }

        // 默认 sync 成功
        res.success = true;
        res.status_code = 200;
        res.body = "{\"serverTime\":\"2026-09-16T12:00:00Z\",\"nextSyncSeconds\":30,\"desiredFrame\":null}";
        return res;
    }

    HttpResponse get(const std::string& url, const std::string& auth_header) override {
        (void)url; (void)auth_header;
        HttpResponse res;
        res.success = true;
        res.status_code = 200;
        return res;
    }

    bool downloadBinary(const std::string& url, const std::string& auth_header,
                        uint8_t* out_buffer, size_t max_len, size_t* out_len) override {
        (void)url; (void)auth_header; (void)out_buffer; (void)max_len; (void)out_len;
        return true;
    }

    bool network_up;
    int complete_request_count;
    std::string last_event_body;
    std::set<std::string> received_events;
};

void test_uuid() {
    printf("\n--- Test 1: UUIDv4 RFC 4122 Generator & Validator ---\n");
    std::set<std::string> uuids;
    for (int i = 0; i < 100; i++) {
        std::string u = Uuid::generateV4();
        assert(Uuid::isValidV4(u));
        assert(u.length() == 36);
        assert(u[14] == '4'); // Version 4
        char var = u[19];
        assert(var == '8' || var == '9' || var == 'a' || var == 'b'); // Variant 1
        uuids.insert(u);
    }
    assert(uuids.size() == 100); // 100 个各不相同
    printf("Test 1 PASS: 100 distinct valid RFC 4122 v4 UUIDs generated.\n");
}

void test_task_focus() {
    printf("\n--- Test 2: Task Focus Navigation ---\n");
    TaskFocusManager mgr;

    // 空任务列表保护
    assert(mgr.getFocusedTask() == nullptr);
    assert(!mgr.focusNext());
    assert(!mgr.focusPrevious());

    // 填充 3 个任务 (slot 0, 1, 2)
    std::vector<InteractiveTask> tasks = {
        {"uuid-task-0", 0, "pending"},
        {"uuid-task-1", 1, "pending"},
        {"uuid-task-2", 2, "pending"}
    };
    mgr.updateTasks(tasks);
    assert(mgr.getTaskCount() == 3);
    assert(mgr.getFocusIndex() == 0);
    assert(mgr.getFocusedTask()->id == "uuid-task-0");

    // NEXT 循环
    assert(mgr.focusNext());
    assert(mgr.getFocusIndex() == 1);
    assert(mgr.focusNext());
    assert(mgr.getFocusIndex() == 2);
    assert(mgr.focusNext()); // 回到 0
    assert(mgr.getFocusIndex() == 0);

    // BACK 循环
    assert(mgr.focusPrevious()); // 0 -> 2
    assert(mgr.getFocusIndex() == 2);
    assert(mgr.focusPrevious()); // 2 -> 1
    assert(mgr.getFocusIndex() == 1);

    // 标记完成
    assert(mgr.markTaskCompleted("uuid-task-1"));
    assert(mgr.getFocusedTask()->status == "completed");
    printf("Test 2 PASS: Focus circular navigation (NEXT/BACK) and status updates OK.\n");
}

void test_offline_queue_persistence() {
    printf("\n--- Test 3: OfflineEventQueue Persistence & Capacity ---\n");
    const char* test_dir = "/tmp/test_kb_phase7_queue";
    system("rm -rf /tmp/test_kb_phase7_queue && mkdir -p /tmp/test_kb_phase7_queue");

    {
        OfflineEventQueue queue(test_dir);
        queue.init();
        assert(queue.empty());

        // 插入 2 个事件
        QueuedTaskEvent ev1 = {"event-111", "task-101", 1, "2026-09-16T12:00:00Z"};
        QueuedTaskEvent ev2 = {"event-222", "task-102", 1, "2026-09-16T12:01:00Z"};
        assert(queue.enqueue(ev1));
        assert(queue.enqueue(ev2));
        assert(queue.size() == 2);
    } // 模拟掉电，析构

    // 模拟重新上电初始化，从磁盘恢复
    {
        OfflineEventQueue queue(test_dir);
        queue.init();
        assert(queue.size() == 2);

        QueuedTaskEvent peek_ev;
        assert(queue.peek(peek_ev));
        assert(peek_ev.event_id == "event-111");
        assert(peek_ev.task_occurrence_id == "task-101");

        assert(queue.pop());
        assert(queue.size() == 1);
        assert(queue.peek(peek_ev));
        assert(peek_ev.event_id == "event-222");

        assert(queue.pop());
        assert(queue.empty());
    }

    // 验证上限 100 条
    {
        OfflineEventQueue queue(test_dir);
        queue.init();
        for (int i = 0; i < 100; i++) {
            QueuedTaskEvent ev = {"evt-" + std::to_string(i), "task-" + std::to_string(i), 1, ""};
            assert(queue.enqueue(ev));
        }
        assert(queue.size() == 100);
        // 第 101 条必须拒绝入队
        QueuedTaskEvent overflow_ev = {"overflow", "task-999", 1, ""};
        assert(!queue.enqueue(overflow_ev));
        assert(queue.size() == 100);
    }
    printf("Test 3 PASS: Offline queue persistence through power-loss and 100-item cap verified.\n");
}

void test_e2e_offline_and_idempotency() {
    printf("\n--- Test 4: E2E Offline Queue, Replay & C03 Idempotency ---\n");
    const char* test_dir = "/tmp/test_kb_phase7_e2e";
    system("rm -rf /tmp/test_kb_phase7_e2e && mkdir -p /tmp/test_kb_phase7_e2e");

    auto transport = std::make_shared<EventTrackingTransport>();
    ApiClient api_client(transport);
    api_client.setBaseUrl("http://api.kidboard.local");
    api_client.setDeviceToken("kb_dev_token_phase7");

    FrameStore frame_store(test_dir);
    frame_store.init();
    RefreshPolicy refresh_policy;
    DummyDisplay display;
    TaskFocusManager focus_mgr;
    OfflineEventQueue event_queue(test_dir);
    event_queue.init();

    SyncEngine sync_engine(api_client, frame_store, refresh_policy, display, &focus_mgr, &event_queue);

    // 1. 设置当前待办任务
    std::vector<InteractiveTask> tasks = {
        {"task-math-hw-001", 0, "pending"}
    };
    focus_mgr.updateTasks(tasks);

    // 2. 模拟断网环境下按键触发任务完成 (PRD F11 / docs/07 §9)
    transport->network_up = false;

    std::string event_id_1 = Uuid::generateV4();
    QueuedTaskEvent ev1;
    ev1.event_id = event_id_1;
    ev1.task_occurrence_id = focus_mgr.getFocusedTask()->id;
    ev1.frame_version = 1;
    ev1.occurred_at = "2026-09-16T12:30:00Z";

    assert(event_queue.enqueue(ev1));
    assert(event_queue.size() == 1);

    // 尝试重放 -> 因断网失败，事件完好保留在队列中
    int flushed = sync_engine.flushOfflineEvents();
    assert(flushed == 0);
    assert(event_queue.size() == 1);
    printf("Offline action correctly preserved in local queue during network outage.\n");

    // 3. 模拟恢复网络 -> 自动重放成功排空
    transport->network_up = true;
    flushed = sync_engine.flushOfflineEvents();
    assert(flushed == 1);
    assert(event_queue.empty());
    assert(transport->complete_request_count == 1);
    assert(transport->received_events.count(event_id_1) == 1);
    printf("Network restored: offline event successfully flushed to cloud.\n");

    // 4. 验证 C03 幂等防线：相同 eventId 再次上报，服务端返回 idempotent=true，固件正常处理
    TaskCompleteResponse idem_resp;
    assert(api_client.reportTaskComplete(event_id_1, "task-math-hw-001", 1, "", idem_resp));
    assert(idem_resp.success == true);
    assert(idem_resp.idempotent == true);
    assert(idem_resp.applied == false);
    printf("Test 4 PASS: Replay idempotency (C03) verified with idempotent=true.\n");
}

int main() {
    printf("==================================================\n");
    printf("  KidBoard Phase 7 Buttons & Events Tests         \n");
    printf("==================================================\n");

    test_uuid();
    test_task_focus();
    test_offline_queue_persistence();
    test_e2e_offline_and_idempotency();

    printf("\n==================================================\n");
    printf("ALL PHASE 7 TESTS PASSED!\n");
    printf("==================================================\n");
    return 0;
}
