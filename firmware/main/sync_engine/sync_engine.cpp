#include "sync_engine.h"
#include "../crypto/sha256.h"
#include "../ota/ota_manager.h"
#include <cstring>
#include <cstdio>

#ifdef ESP_PLATFORM
#include "esp_log.h"
static const char* TAG = "SYNC_ENGINE";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[SYNC_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[SYNC_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[SYNC_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

SyncEngine::SyncEngine(ApiClient& api_client,
                       FrameStore& frame_store,
                       RefreshPolicy& refresh_policy,
                       IEpaperDisplay& display,
                       TaskFocusManager* focus_mgr,
                       OfflineEventQueue* event_queue,
                       OtaManager* ota_mgr)
    : m_api_client(api_client),
      m_frame_store(frame_store),
      m_refresh_policy(refresh_policy),
      m_display(display),
      m_focus_mgr(focus_mgr),
      m_event_queue(event_queue),
      m_ota_mgr(ota_mgr),
      m_local_frame_version(0),
      m_last_sha256(""),
      m_error_count(0),
      m_staging_buffer(FRAME_BUFFER_BYTES, 0) {
}


SyncEngine::~SyncEngine() = default;

int SyncEngine::flushOfflineEvents() {
    if (!m_event_queue || m_event_queue->empty()) return 0;

    int flushed = 0;
    while (!m_event_queue->empty()) {
        QueuedTaskEvent ev;
        if (!m_event_queue->peek(ev)) break;

        TaskCompleteResponse resp;
        bool ok = ev.kind == "focus"
                      ? m_api_client.reportFocusComplete(ev.event_id, ev.minutes, ev.occurred_at, resp)
                      : m_api_client.reportTaskComplete(ev.event_id, ev.task_occurrence_id,
                                                        ev.frame_version, ev.occurred_at, resp);
        if (ok && resp.success) {
            LOGI("Flushed event %s (applied=%d, idempotent=%d)",
                 ev.event_id.c_str(), resp.applied, resp.idempotent);
            m_event_queue->pop();
            flushed++;
        } else if (resp.status_code >= 400 && resp.status_code < 500 && resp.status_code != 401 &&
                   resp.status_code != 408 && resp.status_code != 429) {
            // 服务端明确拒绝（如任务已被删除 404、参数非法 400）：重试也不会成功，丢弃以免堵住后面的事件
            LOGW("Dropping event %s rejected by server (HTTP %d)", ev.event_id.c_str(), resp.status_code);
            m_event_queue->pop();
        } else {
            LOGW("Failed to flush event %s: %s (stopping flush)",
                 ev.event_id.c_str(), resp.error_message.c_str());
            break;
        }
    }
    return flushed;
}

SyncStepResult SyncEngine::step(const SyncTelemetry& telemetry, int* out_next_sync_seconds) {
    // 0. 若存在离线排队事件，联网时优先排空重放 (C03 & PRD F11)
    if (m_event_queue && !m_event_queue->empty()) {
        flushOfflineEvents();
    }

    SyncResponse response;
    bool sync_ok = m_api_client.sync(telemetry, response);

    if (out_next_sync_seconds) {
        *out_next_sync_seconds = response.next_sync_seconds > 0 ? response.next_sync_seconds : 30;
    }

    if (!sync_ok) {
        m_error_count++;
        LOGW("Sync request failed, keeping current screen (error_count=%d)", m_error_count);
        return SyncStepResult::NetworkError;
    }

    for (const auto& cmd : response.commands) m_commands.push_back(cmd);

    if (m_time_cb && !response.server_time.empty()) {
        m_time_cb(response.server_time, response.utc_offset_minutes, response.has_utc_offset);
    }

    // 更新任务列表至 TaskFocusManager (docs/07 §8)
    // D-022 每次都同步（明日预览时服务端下发空列表，必须清空，否则会在明天的画面上画今天的焦点框）
    if (m_focus_mgr) {
        m_focus_mgr->updateTasks(response.interactive_tasks);
    }

    // 检查 OTA 固件空中更新 (docs/05 §7 & docs/07 §12)
    if (response.has_ota && m_ota_mgr) {
        if (m_ota_mgr->checkUpdate(response.ota, telemetry.firmware_version)) {
            LOGI("Found new OTA firmware version %s (current: %s). Starting download...",
                 response.ota.version.c_str(), telemetry.firmware_version.c_str());
            if (m_ota_mgr->executeOta(response.ota, m_api_client)) {
                LOGI("OTA successfully flashed! Target slot set as boot partition.");
                return SyncStepResult::OtaUpdated;
            }
        }
    }

    SyncStepResult result = applyDesiredFrame(response, telemetry);
    syncPages(response);
    return result;
}

SyncStepResult SyncEngine::applyDesiredFrame(const SyncResponse& response, const SyncTelemetry& telemetry) {
    if (!response.has_desired_frame) {
        LOGI("Sync succeeded: no new frame (screen is up to date)");
        return SyncStepResult::NoFrameServer;
    }


    const DesiredFrame& df = response.desired_frame;

    // C01 不变不下载：若版本未更新，不触发下载
    if (df.version <= m_local_frame_version) {
        LOGI("Sync succeeded: Local frame v%d is already up-to-date (desired v%d)",
             m_local_frame_version, df.version);
        return SyncStepResult::UpToDate;
    }

    LOGI("New frame available: v%d (size=%u, sha=%s). Downloading...",
         df.version, static_cast<unsigned>(df.bytes), df.sha256.c_str());

    // 1. 下载至 staging 缓冲区
    size_t downloaded_len = 0;
    bool download_ok = m_api_client.downloadFrame(df.url, m_staging_buffer.data(),
                                                  m_staging_buffer.size(), &downloaded_len);
    if (!download_ok || downloaded_len != FRAME_BUFFER_BYTES) {
        m_error_count++;
        LOGE("Download frame failed: got %u bytes (expected %u)",
             static_cast<unsigned>(downloaded_len), static_cast<unsigned>(FRAME_BUFFER_BYTES));
        return SyncStepResult::NetworkError;
    }

    // 2. SHA-256 校验 (C02 / D06 防篡改防损坏)
    std::string actual_sha256 = Sha256::hashHex(m_staging_buffer.data(), downloaded_len);
    if (actual_sha256 != df.sha256) {
        m_error_count++;
        LOGE("CHECKSUM MISMATCH! Expected: %s, Actual: %s. REJECTING new frame to protect display!",
             df.sha256.c_str(), actual_sha256.c_str());
        return SyncStepResult::ChecksumFailed;
    }

    LOGI("SHA-256 checksum verified OK: %s", actual_sha256.c_str());

    // 3. 暂存到 SPIFFS staging.bin
    if (!m_frame_store.saveStaging(m_staging_buffer.data(), downloaded_len)) {
        m_error_count++;
        LOGE("Failed to save frame into staging storage");
        return SyncStepResult::NetworkError;
    }

    // 4. 决策刷新模式 (docs/06 §8 & RefreshPolicy)
    RefreshDecisionInput r_in;
    r_in.boot_first_frame = false;
    r_in.force_full_refresh = df.force_full_refresh;
    r_in.changed_ratio = df.has_dirty_rect ? (static_cast<float>(df.dirty_rect.w * df.dirty_rect.h) / (SCREEN_WIDTH * SCREEN_HEIGHT)) : 1.0f;
    r_in.partial_supported = response.refresh_policy.partial_enabled;
    r_in.current_epoch_seconds = telemetry.uptime_seconds;

    RefreshMode mode = m_refresh_policy.decideMode(r_in);

    // 5. 刷新墨水屏显示（staging.bin 已存盘，装饰只影响本次显示）
    // D-018 正在看附加页时只存盘不上屏，翻回首页时显示
    const bool on_home = !m_active_page || m_active_page() == 0;
    bool show_ok = true;
    if (on_home) {
        if (m_decorator) m_decorator(m_staging_buffer.data(), downloaded_len);
        show_ok = m_display.show(m_staging_buffer.data(), downloaded_len, mode,
                                 df.has_dirty_rect ? &df.dirty_rect : nullptr);
        // 刷完立即休眠保护
        m_display.sleep();
    }

    if (!show_ok) {
        m_error_count++;
        LOGE("Failed to display frame onto e-paper");
        return SyncStepResult::NetworkError;
    }

    // 6. 刷新成功后原子提交 staging -> last.bin (docs/07 §5)
    if (!m_frame_store.commitStaging()) {
        m_error_count++;
        LOGE("Failed to commit staging frame to last.bin");
        return SyncStepResult::NetworkError;
    }

    // 7. 更新本地状态
    m_local_frame_version = df.version;
    m_last_sha256 = actual_sha256;
    if (on_home) m_refresh_policy.recordRefresh(mode, telemetry.uptime_seconds, m_local_frame_version);
    m_error_count = 0;

    LOGI("Frame v%d successfully displayed and committed to last.bin!", df.version);
    return SyncStepResult::FrameUpdated;
}

void SyncEngine::syncPages(const SyncResponse& response) {
    if (response.has_focus && response.focus_minutes > 0) m_focus_minutes = response.focus_minutes;
    if (!response.has_pages) return;
    m_focus_page = -1;
    for (const auto& p : response.pages) {
        if (p.kind == "focus") m_focus_page = p.index;
    }
    int max_index = 0;
    for (const auto& p : response.pages) {
        if (p.index > FrameStore::kMaxPages) continue;
        if (p.index > max_index) max_index = p.index;
        if (m_frame_store.pageSha(p.index) == p.sha256) continue;

        size_t len = 0;
        if (!m_api_client.downloadFrame(p.url, m_staging_buffer.data(), m_staging_buffer.size(), &len) ||
            len != FRAME_BUFFER_BYTES) {
            LOGW("Page %d download failed; will retry next sync", p.index);
            continue;
        }
        std::string sha = Sha256::hashHex(m_staging_buffer.data(), len);
        if (sha != p.sha256) {
            LOGE("Page %d checksum mismatch; rejected", p.index);
            continue;
        }
        if (!m_frame_store.savePage(p.index, m_staging_buffer.data(), len, sha)) {
            LOGW("Page %d save failed", p.index);
            continue;
        }
        if (m_active_page && m_active_page() == p.index) {
            if (m_decorator) m_decorator(m_staging_buffer.data(), len);
            m_display.show(m_staging_buffer.data(), len, RefreshMode::Full, nullptr);
            m_display.sleep();
        }
    }
    // 服务端页数变少：删掉多余的本地页
    m_frame_store.removePagesFrom(max_index + 1);
}

} // namespace kidboard
