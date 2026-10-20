#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string>
#include <vector>
#include "../epaper/epaper_interface.h"

namespace kidboard {

struct SyncTelemetry {
    std::string firmware_version = "1.0.0";
    int frame_version = 0;
    std::string last_refresh_mode = "full";
    std::string last_refresh_at = "";
    int partial_refresh_count = 0;
    int rssi = -60;
    uint32_t uptime_seconds = 0;
    uint32_t free_heap = 100000;
    std::string reset_reason = "power_on";
    std::string running_slot = "ota_0";
    int rollback_count = 0;
    // D-016 传感器（未读到时不上报）
    bool has_env = false;
    float temperature_c = 0.0f;
    float humidity_pct = 0.0f;
    bool has_battery = false;
    int battery_mv = 0;
    int battery_percent = 0;
};

struct DesiredFrame {
    int version = 0;
    int width = 800;
    int height = 480;
    size_t bytes = 48000;
    std::string sha256;
    std::string url;
    bool force_full_refresh = false;
    bool has_dirty_rect = false;
    DirtyRect dirty_rect = {0, 0, 0, 0};
};

struct RefreshPolicyConfig {
    bool partial_enabled = true;
    int partial_max_count = 5;
    int force_full_after_hours = 24;
    float partial_area_max_ratio = 0.25f;
};

struct InteractiveTask {
    std::string id;
    int slot = 0;
    std::string status = "pending";
};

struct OtaManifest {
    std::string version;
    std::string url;
    std::string sha256;
    bool mandatory = false;
};

/** D-018 附加页清单（当前 active 画面的第 1.. 页） */
struct PageRef {
    int index = 0;
    std::string kind;  // D-019 "week" | "points" | "focus"
    std::string sha256;
    std::string url;
};

/** D-017 服务端下发的设备命令（目前固件处理 beep） */
struct DeviceCommand {
    std::string id;
    std::string type;
    int beeps = 0;
};

struct SyncResponse {
    bool success = false;
    int status_code = 0;
    std::string server_time;
    /** D-015 孩子时区当前 UTC 偏移（分钟，含夏令时）；旧服务端无此字段 */
    bool has_utc_offset = false;
    int utc_offset_minutes = 0;
    int next_sync_seconds = 30;
    bool has_desired_frame = false;
    DesiredFrame desired_frame;
    RefreshPolicyConfig refresh_policy;
    std::vector<InteractiveTask> interactive_tasks;
    std::vector<DeviceCommand> commands;
    // D-019 专注计时配置（分钟、完成积分）
    bool has_focus = false;
    int focus_minutes = 0;
    bool has_pages = false;  // 旧服务端没有 pages 字段：不动本地页
    std::vector<PageRef> pages;
    bool has_ota = false;
    OtaManifest ota;
    std::string error_message;
};


struct TaskCompleteResponse {
    bool success = false;
    int status_code = 0;
    std::string status;
    bool applied = false;
    bool idempotent = false;
    std::string error_message;
};

struct PairInitResponse {
    bool success = false;
    int status_code = 0;
    std::string pairing_id;
    std::string code;
    std::string expires_at;
    std::string error_message;
};

struct PairStatusResponse {
    bool success = false;
    int status_code = 0;
    std::string status; // "pending" | "paired" | "expired"
    std::string token;
    std::string device_id;
    std::string error_message;
};

} // namespace kidboard

