#pragma once

#include <functional>

#include <stdint.h>
#include <stddef.h>
#include <string>
#include <vector>
#include "../api_client/api_client.h"
#include "../frame_store/frame_store.h"
#include "../refresh_policy/refresh_policy.h"
#include "../epaper/epaper_interface.h"
#include "../tasks/task_focus_manager.h"
#include "../events/offline_event_queue.h"

namespace kidboard {

class OtaManager;

enum class SyncStepResult {
    UpToDate,       // C01: 版本一致，无需下载
    FrameUpdated,   // 下载、校验、刷新、提交成功
    ChecksumFailed, // C02/D06: SHA-256 不匹配，拒绝显示，保留旧帧
    NetworkError,   // 网络异常或 HTTP 错误，保留旧帧
    NoFrameServer,  // 服务端尚无 active frame
    OtaUpdated      // OTA 更新成功
};

class SyncEngine {
public:
    SyncEngine(ApiClient& api_client,
               FrameStore& frame_store,
               RefreshPolicy& refresh_policy,
               IEpaperDisplay& display,
               TaskFocusManager* focus_mgr = nullptr,
               OfflineEventQueue* event_queue = nullptr,
               OtaManager* ota_mgr = nullptr);
    ~SyncEngine();

    SyncStepResult step(const SyncTelemetry& telemetry, int* out_next_sync_seconds = nullptr);

    // 排空重放离线队列中的任务完成事件 (PRD F11 / docs/07 §9)
    int flushOfflineEvents();

    int getLocalFrameVersion() const { return m_local_frame_version; }
    void setLocalFrameVersion(int version) { m_local_frame_version = version; }

    const std::string& getLastSha256() const { return m_last_sha256; }
    int getErrorCount() const { return m_error_count; }

    void setFocusManager(TaskFocusManager* mgr) { m_focus_mgr = mgr; }
    void setEventQueue(OfflineEventQueue* queue) { m_event_queue = queue; }
    void setOtaManager(OtaManager* mgr) { m_ota_mgr = mgr; }

    /** D-019 最近一次同步得知的专注页页号（-1 = 未知）与专注时长（0 = 未知） */
    int focusPageIndex() const { return m_focus_page; }
    int focusMinutes() const { return m_focus_minutes; }

    /** D-018 当前屏幕显示的页（0 = 首页）；非首页时新首页帧只存盘不上屏 */
    void setActivePageProvider(std::function<int()> fn) { m_active_page = std::move(fn); }

    /** D-015 新帧上屏前的装饰（在时钟区画时间）；只改显示缓冲，不改存盘的帧 */
    void setFrameDecorator(std::function<void(uint8_t*, size_t)> fn) { m_decorator = std::move(fn); }

    /** D-015 对时：同步成功后立即回调（服务器时间 ISO、UTC 偏移、是否带偏移），早于下载与刷屏 */
    using TimeCallback = std::function<void(const std::string&, int, bool)>;

    /** D-017 取走本次同步收到的命令（主循环在 step() 返回后处理，避免刷屏阻塞期间蜂鸣器常响） */
    std::vector<DeviceCommand> takeCommands() {
        std::vector<DeviceCommand> out;
        out.swap(m_commands);
        return out;
    }
    void setTimeCallback(TimeCallback fn) { m_time_cb = std::move(fn); }

private:
    ApiClient& m_api_client;
    FrameStore& m_frame_store;
    RefreshPolicy& m_refresh_policy;
    IEpaperDisplay& m_display;
    TaskFocusManager* m_focus_mgr;
    OfflineEventQueue* m_event_queue;
    OtaManager* m_ota_mgr;

    int m_local_frame_version;
    std::string m_last_sha256;
    int m_error_count;
    // 48KB 下载暂存区放堆上：SyncEngine 在 app_main 栈上构造，内嵌数组会撑爆主任务栈
    std::vector<uint8_t> m_staging_buffer;
    std::function<void(uint8_t*, size_t)> m_decorator;
    TimeCallback m_time_cb;
    std::vector<DeviceCommand> m_commands;
    std::function<int()> m_active_page;
    int m_focus_page = -1;
    int m_focus_minutes = 0;

    SyncStepResult applyDesiredFrame(const SyncResponse& response, const SyncTelemetry& telemetry);
    /** D-018 下载 SHA 有变化的附加页；当前显示的页有变化则上屏 */
    void syncPages(const SyncResponse& response);
};


} // namespace kidboard
