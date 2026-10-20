/**
 * KidBoard ESP32-S3 固件主入口 — Phase 8 配网 (Provisioning) 与配对认领 (Pairing)。
 *
 * 遵循 docs/05 设备协议与 docs/07 启动状态机：
 * 1. NVS 初始化 (NvsManager 加载 hardwareId, deviceNonce, Wi-Fi 凭证, deviceToken)
 * 2. 挂载 FrameStore 本地存储 (SPIFFS /spiffs/frame/last.bin)
 * 3. 先显示后联网 (docs/07 §4 & D01 冷启动)：优先从本地 last.bin 恢复显示，冷启动绝不清空画面
 * 4. 配网检查 (Provisioning Check，D-014 热点 + 网页)：
 *    - 若 NVS 无 Wi-Fi 凭证，自动开热点 KIDBOARD-XXXX，手机浏览器打开 192.168.4.1 填写 Wi-Fi
 *    - 任何时候长按 BACK 5 秒 → 确认画面 → DONE 开始换网（绑定关系保留）
 *    - 已配网但长时间连不上时，在按键栏覆盖"WI-FI OFFLINE"提示，其余画面保留
 * 5. 配对检查 (Pairing Check)：
 *    - 若 NVS 无 Device Token，启动 PairingClient
 *    - Step B: POST /api/v1/device/pair/init 获取 6 位配对码
 *    - 在 800x480 墨水屏高对比度居中显示 6 位码
 *    - Step D: 周期轮询 GET /api/v1/device/pair/{pairingId}/status?nonce=...
 *    - 家长在 Web 认领后，单次拉取 Token 并持久化至 NVS
 * 6. 在线主循环 (Online Sync Loop)：
 *    - ApiClient & SyncEngine 周期同步、TaskFocusManager 按键交互、离线队列重放
 * 7. 恢复出厂设置 (Reset Flow, docs/07 §8 & §14)：
 *    - DONE 键长按 10 秒 (VeryLongPress) 触发 Factory Reset
 *    - 清空 NVS Wi-Fi、Token 及本地事件，进入热点配网，联网后重新配对
 */

#include <stdio.h>
#include <string.h>

#include "board_config.h"
#include "epaper/epaper_display.h"
#include "frame_store/frame_store.h"
#include "refresh_policy/refresh_policy.h"
#include "buttons/button_handler.h"
#include "network/wifi_manager.h"
#include "network/wifi_portal.h"
#include "api_client/api_client.h"
#include "sync_engine/sync_engine.h"
#include "tasks/task_focus_manager.h"
#include "events/offline_event_queue.h"
#include "storage/nvs_manager.h"
#include "ui/pairing_screen.h"
#include "provisioning/pairing_client.h"
#include "ota/ota_manager.h"
#include "diagnostics/diagnostics_manager.h"
#include "utils/uuid.h"
#include "status_led/status_led.h"
#include "clock/clock_renderer.h"
#include "clock/device_clock.h"
#include "sensors/env_sensor.h"
#include "sensors/battery_monitor.h"
#include "buzzer/buzzer.h"
#include "focus/focus_timer.h"
#include "focus/focus_renderer.h"
#include "tasks/focus_box.h"

#ifdef ESP_PLATFORM
#include "nvs_flash.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static const char* TAG = "KIDBOARD_MAIN";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#include <unistd.h>
#define LOGI(...) printf("[MAIN_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[MAIN_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[MAIN_ERR] "  __VA_ARGS__); printf("\n")
#endif

using namespace kidboard;

extern "C" void app_main(void) {
    // 状态灯：固件一开始运行即常亮；屏幕故障时由 EpaperDisplay 切换为快闪
    StatusLed::init();
    LOGI("==================================================");
    LOGI("  KidBoard Firmware Boot (Phase 9 OTA & Diag)     ");
#ifdef CONFIG_KB_BOARD_DEVKITC_WAVESHARE
    LOGI("  Target: ESP32-S3-DevKitC-1-N8R8 + Waveshare 7.5 ");
#else
    LOGI("  Target: Seeed reTerminal E1001                  ");
#endif
    LOGI("==================================================");

    // 1. 初始化 OTA 管理器与诊断系统
    OtaManager ota_mgr;
    ota_mgr.init();

    DiagnosticsManager diag_mgr;
    diag_mgr.init(BoardConfig::firmwareVersion());
    LOGI("Firmware version %s", BoardConfig::firmwareVersion());

    // 2. 初始化 NVS 存储管理器 (docs/05 §2 & docs/07 §1)
    NvsManager nvs_mgr;
    bool nvs_ok = nvs_mgr.init();

    std::string hardware_id = nvs_mgr.getHardwareId();
    std::string device_nonce = nvs_mgr.getDeviceNonce();
    LOGI("Device Identity: HardwareID=%s, RunningSlot=%s",
         hardware_id.c_str(), ota_mgr.getRunningSlot().c_str());

    // 3. 初始化 FrameStore
    FrameStore store;
    bool store_ok = store.init();
    if (!store_ok) {
        LOGW("FrameStore mount failed, continue with default buffer");
    }

    // 4. 初始化墨水屏驱动 (Waveshare 7.5inch V2 800x480)
    EpaperDisplay display;
    bool display_ok = display.init();
    if (!display_ok) {
        LOGE("Failed to initialize EpaperDisplay!");
    } else {
        LOGI("EpaperDisplay initialized successfully");
    }

    // 5. 开机自检与自动 Rollback (docs/07 §12: OTA 必须支持 rollback)
    ota_mgr.performBootSelfCheck(nvs_ok, display_ok, store_ok);

    RefreshPolicy policy;

    // 设备时钟 (D-015)：开机先从板载 RTC 恢复时间，时区偏移用上次服务器下发的值
    DeviceClock dev_clock;
    {
        int offset = CONFIG_KB_CLOCK_DEFAULT_UTC_OFFSET_MIN;
        nvs_mgr.getClockUtcOffset(offset);
        dev_clock.init(offset);
    }
#if defined(CONFIG_KB_CLOCK_ENABLE)
    bool clock_enabled = true;
#else
    bool clock_enabled = false;
#endif
    int clock_drawn_minute = -1;   // 屏幕上时钟当前显示的分钟（时*60+分）；-1 = 未画/需重画
    int clock_partials = 0;        // 上次整屏刷新后的局部刷新次数
    // 在整帧缓冲的时钟区画当前时间（时间未知或已关闭时不画，时钟区保持服务端留白）
    auto drawClock = [&](uint8_t* buf, size_t len) {
        int h = 0, m = 0;
        if (!clock_enabled || !dev_clock.localHourMinute(h, m)) {
            clock_drawn_minute = -1;
            return;
        }
        ClockRenderer::drawIntoFrame(buf, len, h, m);
        clock_drawn_minute = h * 60 + m;
        clock_partials = 0;
    };

    // 6. 先显示后联网 (docs/07 §4 & D01 冷启动)：优先从本地 last.bin 恢复
    static uint8_t s_frame_buf[FRAME_BUFFER_BYTES];
    size_t loaded_len = 0;

    if (store.hasLastFrame() && store.loadLastFrame(s_frame_buf, sizeof(s_frame_buf), &loaded_len)) {
        LOGI("Displaying cached last frame (%u bytes)...", static_cast<unsigned>(loaded_len));
        if (nvs_mgr.isPaired()) drawClock(s_frame_buf, loaded_len);
        display.show(s_frame_buf, loaded_len, RefreshMode::Full, nullptr);
        display.sleep();
        policy.recordRefresh(RefreshMode::Full, 0, 1);
    } else {
        LOGI("No local frame found on flash. Initializing default frame...");
        memset(s_frame_buf, 0xFF, FRAME_BUFFER_BYTES); // 默认全白
        constexpr int lines[] = {52, 352, 429};
        for (int line_y : lines) {
            size_t row_start = line_y * 100;
            if (row_start + 100 <= FRAME_BUFFER_BYTES) {
                memset(s_frame_buf + row_start, 0x00, 100); // 0 = black
            }
        }
        display.show(s_frame_buf, FRAME_BUFFER_BYTES, RefreshMode::Full, nullptr);
        display.sleep();
        store.saveStaging(s_frame_buf, FRAME_BUFFER_BYTES);
        store.commitStaging();
        policy.recordRefresh(RefreshMode::Full, 0, 1);
    }

    // 7. 初始化任务焦点管理器与离线队列
    TaskFocusManager focus_mgr;
    OfflineEventQueue event_queue;
    event_queue.init();

    // 8. 初始化 API 客户端、配对客户端与同步引擎
    ApiClient api_client;
    api_client.setBaseUrl(BoardConfig::getServerUrl());

    PairingClient pairing_client(api_client, nvs_mgr, display);
    pairing_client.init();

    SyncEngine sync_engine(api_client, store, policy, display, &focus_mgr, &event_queue, &ota_mgr);
    // D-018 多页翻看：当前显示页（0 = 首页）与最近一次按键时间（附加页 3 分钟无操作自动回首页）
    int current_page = 0;
    uint32_t page_input_ms = 0;
    constexpr uint32_t kPageIdleMs = 3 * 60 * 1000;
    sync_engine.setActivePageProvider([&]() { return current_page; });

    // D-019 专注计时：专注页页号与时长来自服务端（存 NVS，离线重启也能用）
    FocusTimer focus_timer;
    int focus_page = -1;
    int focus_drawn = -1;  // 屏幕倒计时区当前显示的（状态×100000 + 秒）；-1 = 需重画
    {
        int v = 0;
        if (nvs_mgr.getInt("focus_pg", v)) focus_page = v;
        if (nvs_mgr.getInt("focus_min", v)) focus_timer.setMinutes(v);
    }
    auto msNow = []() -> uint32_t {
#ifdef ESP_PLATFORM
        return static_cast<uint32_t>(esp_timer_get_time() / 1000);
#else
        return 0;
#endif
    };
    auto focusKey = [&](uint32_t t) { return static_cast<int>(focus_timer.state()) * 100000 + focus_timer.displaySec(t); };
    auto drawFocus = [&](uint8_t* buf, size_t len) {
        const uint32_t t = msNow();
        FocusRenderer::drawIntoFrame(buf, len, focus_timer.state(), focus_timer.displaySec(t));
        focus_drawn = focusKey(t);
    };
    // D-015：新帧上屏前画上时钟；同步成功立即对时（偏移变化时写 NVS 并重画）
    // D-022/D-023 首页任务区由设备叠加：焦点框（帧里不画）+ 本地已完成任务的勾（不等服务端重渲染）。
    // focus_box_drawn = 屏幕上当前叠加状态的键（焦点行 + 已完成行位图），-1 = 未叠加
    int focus_box_drawn = -1;
    auto focusRow = [&]() -> int {
        const InteractiveTask* t = focus_mgr.getFocusedTask();
        return (t && t->slot >= 0 && t->slot < FocusBox::kMaxRows) ? t->slot : -1;
    };
    auto overlayKey = [&]() -> int {
        int done_mask = 0;
        for (const auto& t : focus_mgr.getTasks()) {
            if (t.status == "completed" && t.slot >= 0 && t.slot < FocusBox::kMaxRows) done_mask |= 1 << t.slot;
        }
        return focusRow() + 1 + 16 * done_mask;  // focusRow 为 -1 时仍区分"有无勾"
    };
    auto drawFocusBox = [&](uint8_t* buf, size_t len) {
        for (const auto& t : focus_mgr.getTasks()) {
            if (t.status == "completed") FocusBox::drawCheck(buf, len, t.slot);
        }
        const int row = focusRow();
        if (row >= 0) FocusBox::drawIntoFrame(buf, len, row);
        focus_box_drawn = overlayKey();
    };
    sync_engine.setFrameDecorator([&](uint8_t* buf, size_t len) {
        drawClock(buf, len);
        if (current_page == 0) drawFocusBox(buf, len);
        if (current_page > 0 && current_page == focus_page) drawFocus(buf, len);
    });
    sync_engine.setTimeCallback([&](const std::string& iso, int offset, bool has_offset) {
        if (dev_clock.syncFromServer(iso, offset, has_offset)) {
            nvs_mgr.setClockUtcOffset(dev_clock.utcOffsetMinutes());
            clock_drawn_minute = -1;
        }
    });


    // 7. 初始化 Wi-Fi 管理器与热点配网门户 (D-014)
    WifiManager wifi;
    wifi.init();

    WifiPortal portal;
    const std::string ap_ssid = WifiPortal::apSsidFor(hardware_id);
    bool has_wifi_creds = nvs_mgr.isProvisioned();

    auto nowMs = []() -> uint32_t {
#ifdef ESP_PLATFORM
        return static_cast<uint32_t>(esp_timer_get_time() / 1000);
#else
        return 0;
#endif
    };
    auto reached = [](uint32_t now, uint32_t at) { return at != 0 && static_cast<int32_t>(now - at) >= 0; };
    auto showBuffer = [&]() {
        display.show(s_frame_buf, sizeof(s_frame_buf), RefreshMode::Full, nullptr);
        display.sleep();
    };

    // 配网相关的界面状态：Confirm = 长按 BACK 后等待确认；Portal = 热点配网中（暂停同步，避免覆盖配网画面）
    enum class SetupUi { None, Confirm, Portal };
    SetupUi setup_ui = SetupUi::None;
    uint32_t setup_deadline_ms = 0;   // 确认画面 30s / 手动配网 15min 超时；0 = 不超时
    bool portal_has_saved = false;    // 进入配网时已有保存的 Wi-Fi（决定 15 分钟超时）
    bool attempting = false;          // 正在尝试网页提交的凭证
    std::string attempt_ssid, attempt_pass;
    uint32_t attempt_deadline_ms = 0;
    uint32_t portal_close_at_ms = 0;  // 连接成功后留几秒让网页拿到结果再关热点
    bool offline_hint_shown = false;
    uint32_t offline_since_ms = 0;
    bool offline_tracking = false;
    constexpr uint32_t kConfirmTimeoutMs = 30 * 1000;
    constexpr uint32_t kPortalTimeoutMs = 15 * 60 * 1000;
    constexpr uint32_t kAttemptTimeoutMs = 25 * 1000;
    constexpr uint32_t kOfflineHintAfterMs = 3 * 60 * 1000;

    // 恢复正常画面：已配对显示最后一帧（带时钟）；未配对则重新申请配对码（联网后会重画配对画面）
    auto restoreScreen = [&]() {
        current_page = 0;
        size_t len = 0;
        if (store.hasLastFrame() && store.loadLastFrame(s_frame_buf, sizeof(s_frame_buf), &len)) {
            if (pairing_client.isPaired()) drawClock(s_frame_buf, len);
            showBuffer();
        }
        if (!pairing_client.isPaired()) pairing_client.resetPairing();
    };

    // D-018 组合某一页的整屏画面：首页取 last.bin，附加页取 page{N}.bin；叠加离线提示与时钟
    auto composePage = [&](int page) -> bool {
        size_t len = 0;
        bool ok = page == 0 ? (store.hasLastFrame() && store.loadLastFrame(s_frame_buf, sizeof(s_frame_buf), &len))
                            : store.loadPage(page, s_frame_buf, sizeof(s_frame_buf), &len);
        if (!ok) return false;
        if (offline_hint_shown) {
            PairingScreen::overlayOfflineHint(s_frame_buf, sizeof(s_frame_buf));
        } else if (!has_wifi_creds) {
            PairingScreen::overlayOfflineHint(s_frame_buf, sizeof(s_frame_buf), false);
        }
        if (pairing_client.isPaired()) drawClock(s_frame_buf, len);
        if (page == 0) drawFocusBox(s_frame_buf, len);
        if (page > 0 && page == focus_page) drawFocus(s_frame_buf, len);
        return true;
    };
    // 翻到某页（循环）；页不存在时回首页。
    // D-025 翻页只能用普通全刷：整屏局刷（1.3.2）与快速全刷（1.3.3）在 E1001 面板上反相/褪色，已撤回
    auto showPage = [&](int page) {
        const int count = 1 + store.pageCount();
        page = ((page % count) + count) % count;
        if (!composePage(page)) {
            page = 0;
            if (!composePage(0)) return;
        }
        current_page = page;
        page_input_ms = nowMs();
        LOGI(">> Page %d/%d", page + 1, count);
        showBuffer();
    };

    auto startPortal = [&]() {
        // 未连上时停止对旧网络的重试，保证热点与扫描稳定；已连上则保持（网页提交后才切换）
        if (!wifi.isConnected()) wifi.disconnect();
        wifi.startAccessPoint(ap_ssid.c_str());
        portal.start(ap_ssid);
        portal_has_saved = has_wifi_creds;
        PairingScreen::renderWifiPortalScreen(s_frame_buf, sizeof(s_frame_buf), ap_ssid, portal_has_saved);
        showBuffer();
        setup_ui = SetupUi::Portal;
        setup_deadline_ms = portal_has_saved ? nowMs() + kPortalTimeoutMs : 0;
        attempting = false;
        portal_close_at_ms = 0;
    };

    auto endPortal = [&](bool reconnect_saved) {
        portal.stop();
        wifi.stopAccessPoint();
        setup_ui = SetupUi::None;
        attempting = false;
        attempt_pass.assign(attempt_pass.size(), '\0');
        attempt_pass.clear();
        if (reconnect_saved && has_wifi_creds && !wifi.isConnected()) {
            wifi.connect(nvs_mgr.getWifiSsid(), nvs_mgr.getWifiPassword());
        }
        offline_hint_shown = false;
        offline_tracking = false;
        if (!has_wifi_creds) {
            // 尚无 Wi-Fi 时返回：显示最后一帧，并在按键栏提示"长按 BACK 设置 Wi-Fi"（只刷新一次）
            size_t len = 0;
            if (store.hasLastFrame() && store.loadLastFrame(s_frame_buf, sizeof(s_frame_buf), &len)) {
                PairingScreen::overlayOfflineHint(s_frame_buf, sizeof(s_frame_buf), false);
                if (pairing_client.isPaired()) drawClock(s_frame_buf, len);
                showBuffer();
            }
            return;
        }
        restoreScreen();
    };

    // D-022/D-023 首页任务区（焦点框 + 本地勾）有变化时局部刷新；局刷失败退回整屏。
    // D-028 用标准波形（fast=false）：快速波形写的任务区关机后会褪色
    auto refreshTaskOverlay = [&]() {
        if (!pairing_client.isPaired() || !store.hasLastFrame() || overlayKey() == focus_box_drawn) return;
        size_t len = 0;
        if (!store.loadLastFrame(s_frame_buf, sizeof(s_frame_buf), &len)) {
            focus_box_drawn = overlayKey();
            return;
        }
        drawFocusBox(s_frame_buf, len);
        static uint8_t box_window[FocusBox::kWinBytes];
        FocusBox::extractWindow(s_frame_buf, len, box_window, sizeof(box_window));
        if (!display.showWindow(box_window, FocusBox::kWinX, FocusBox::kWinY, FocusBox::kWinW, FocusBox::kWinH,
                                /*fast=*/false)) {
            if (composePage(0)) showBuffer();
        }
    };

    // 检查 Wi-Fi 配置
    if (!has_wifi_creds) {
        std::string default_ssid = BoardConfig::getWifiSsid();
        if (!default_ssid.empty()) {
            // 仅开发构建（sdkconfig.defaults.local）会有默认 Wi-Fi；正式固件为空
            LOGI("Using default board config Wi-Fi credentials: %s", default_ssid.c_str());
            nvs_mgr.setWifiCredentials(default_ssid, BoardConfig::getWifiPassword());
            has_wifi_creds = true;
            wifi.connect(default_ssid, BoardConfig::getWifiPassword());
        } else {
            LOGI("No Wi-Fi credentials in NVS. Starting setup hotspot %s ...", ap_ssid.c_str());
            startPortal();
        }
    } else {
        LOGI("Connecting to configured Wi-Fi: %s", nvs_mgr.getWifiSsid().c_str());
        wifi.connect(nvs_mgr.getWifiSsid(), nvs_mgr.getWifiPassword());
    }

    // D-016 室内温湿度与电池：每分钟采样一次，随同步遥测上报
    EnvSensor env_sensor;
    BatteryMonitor battery;
    bool has_env = false, has_batt = false;
    float env_t = 0.0f, env_h = 0.0f;
    int batt_mv = 0;
    uint32_t last_sense_ms = 0;
    bool sensed_once = false;
    auto sampleSensors = [&]() {
        float t = 0.0f, h = 0.0f;
        if (env_sensor.read(t, h)) {
            env_t = t;
            env_h = h;
            has_env = true;
        }
        int mv = 0;
        if (battery.read(mv)) {
            batt_mv = mv;
            has_batt = true;
        }
    };

    // D-017 蜂鸣器：服务端提醒（立即提醒 / 定时提醒）随同步下发 beep 命令
    Buzzer buzzer;
    buzzer.init();

    // DONE 上报成功后请求尽快同步，让屏幕在数秒内反映完成状态（否则最长等一个 30s 同步周期）。
    // 按键回调在主循环 buttons.poll() 内同步执行，普通变量即可。
    bool sync_soon_requested = false;

    // 8. 初始化按键处理器并绑定交互 (含 10s 恢复出厂设置、长按 BACK 换 Wi-Fi)
    ButtonHandler buttons;
    buttons.init();
    buttons.setEventCallback([&](ButtonType type, ButtonAction action) {
        // D-017 正在响铃：任意按键先静音（这次按键只用于静音，不触发其它操作）
        if (buzzer.isBusy() && action != ButtonAction::VeryLongPress) {
            buzzer.stop();
            LOGI(">> Buzzer silenced by key %d", static_cast<int>(type));
            return;
        }

        // 确认画面：DONE 开始配网，其它短按取消
        if (setup_ui == SetupUi::Confirm) {
            if (action != ButtonAction::ShortPress) return;
            if (type == ButtonType::Done) {
                LOGI(">> Wi-Fi setup confirmed, starting hotspot %s", ap_ssid.c_str());
                startPortal();
            } else {
                LOGI(">> Wi-Fi setup cancelled");
                setup_ui = SetupUi::None;
                restoreScreen();
            }
            return;
        }

        // 恢复出厂设置：DONE 键非常长按 10 秒 (docs/07 §8 & §14)
        if (type == ButtonType::Done && action == ButtonAction::VeryLongPress) {
            LOGW("==================================================");
            LOGW(">> 10s VERY LONG PRESS DETECTED ON DONE BUTTON!   ");
            LOGW(">> INITIATING FACTORY RESET...                    ");
            LOGW("==================================================");

            nvs_mgr.factoryReset();
            has_wifi_creds = false;
            event_queue.clear();
            event_queue.saveToFile();

            pairing_client.resetPairing();
            wifi.disconnect();
            startPortal();
            return;
        }

        // 热点配网中：BACK / NEXT 短按随时返回（连接尝试中也可放弃），回到原画面并回连已保存的 Wi-Fi
        if (setup_ui == SetupUi::Portal) {
            if ((type == ButtonType::Back || type == ButtonType::Next) && action == ButtonAction::ShortPress) {
                LOGI(">> Wi-Fi setup cancelled by key %d", static_cast<int>(type));
                if (attempting) wifi.disconnect(); // 放弃正在尝试的新网络
                endPortal(true);
            }
            return;
        }

        // 长按 BACK 5 秒：换 Wi-Fi（先确认，防止误触）
        if (type == ButtonType::Back &&
            (action == ButtonAction::LongPress || action == ButtonAction::VeryLongPress)) {
            LOGI(">> BACK long press: asking to set up Wi-Fi");
            PairingScreen::renderWifiSetupConfirmScreen(s_frame_buf, sizeof(s_frame_buf),
                                                        has_wifi_creds ? nvs_mgr.getWifiSsid() : "");
            showBuffer();
            setup_ui = SetupUi::Confirm;
            setup_deadline_ms = nowMs() + kConfirmTimeoutMs;
            return;
        }

        // D-019 专注页：DONE 开始 / 暂停 / 继续（完成后再按回到初始），计时中 BACK 结束
        if (current_page > 0 && current_page == focus_page && action == ButtonAction::ShortPress &&
            (type == ButtonType::Done || (type == ButtonType::Back && focus_timer.active()))) {
            const uint32_t t = nowMs();
            page_input_ms = t;
            if (type == ButtonType::Back) {
                LOGI(">> Focus stopped");
                focus_timer.reset();
            } else if (focus_timer.state() == FocusTimer::State::Idle) {
                LOGI(">> Focus started (%d min)", focus_timer.minutes());
                focus_timer.start(t);
            } else if (focus_timer.state() == FocusTimer::State::Running) {
                focus_timer.pause(t);
            } else if (focus_timer.state() == FocusTimer::State::Paused) {
                focus_timer.resume(t);
            } else {
                focus_timer.reset();
            }
            return;  // 倒计时区由主循环按显示值变化局部刷新
        }

        // D-018 翻页：附加页上 NEXT/BACK 前后翻、DONE 回首页；首页上按住 NEXT/BACK 1~5 秒翻页
        if (current_page != 0) {
            page_input_ms = nowMs();
            const bool tap = action == ButtonAction::ShortPress || action == ButtonAction::MediumPress;
            if (type == ButtonType::Next && tap) showPage(current_page + 1);
            else if (type == ButtonType::Back && tap) showPage(current_page - 1);
            else if (type == ButtonType::Done && action == ButtonAction::ShortPress) showPage(0);
            return;
        }
        if (action == ButtonAction::MediumPress) {
            if (store.pageCount() > 0) {
                if (type == ButtonType::Next) showPage(1);
                else if (type == ButtonType::Back) showPage(-1);
            }
            return;
        }

        if (action == ButtonAction::LongPress || action == ButtonAction::VeryLongPress) {
            LOGI(">> Long press on button %d", static_cast<int>(type));
            return;
        }

        switch (type) {
            case ButtonType::Next:
                if (focus_mgr.focusNext()) {
                    auto task = focus_mgr.getFocusedTask();
                    LOGI(">> NEXT pressed -> Focus slot %d (task: %s)",
                         task ? task->slot : -1, task ? task->id.c_str() : "none");
                }
                break;

            case ButtonType::Back:
                if (focus_mgr.focusPrevious()) {
                    auto task = focus_mgr.getFocusedTask();
                    LOGI(">> BACK pressed -> Focus slot %d (task: %s)",
                         task ? task->slot : -1, task ? task->id.c_str() : "none");
                }
                break;

            case ButtonType::Done: {
                auto task = focus_mgr.getFocusedTask();
                if (task) {
                    std::string event_id = Uuid::generateV4();
                    LOGI(">> DONE pressed! Completing task %s (slot %d, eventId: %s)",
                         task->id.c_str(), task->slot, event_id.c_str());

                    QueuedTaskEvent ev;
                    ev.event_id = event_id;
                    ev.task_occurrence_id = task->id;
                    ev.frame_version = sync_engine.getLocalFrameVersion();
                    ev.occurred_at = "";

                    event_queue.enqueue(ev);
                    focus_mgr.markTaskCompleted(task->id);
                    focus_mgr.focusNextPending();  // D-022 焦点自动跳到下一个未完成任务
                    refreshTaskOverlay();          // D-023 先在屏上打勾（约半秒），再联网上报

                    if (wifi.isConnected() && pairing_client.isPaired()) {
                        sync_engine.flushOfflineEvents();
                        sync_soon_requested = true;
                    }
                } else {
                    LOGW(">> DONE pressed but no interactive task is currently focused");
                }
                break;
            }
        }
    });

    LOGI("Firmware Phase 8 ready. Entering main loop...");

    // 9. 主同步与事件处理循环
    uint32_t last_sync_ms = 0;
    int next_sync_seconds = 30;
    uint32_t sync_soon_at_ms = 0;

    while (true) {
        buttons.poll();
        wifi.poll();

        uint32_t now_ms = nowMs();

        buzzer.poll(now_ms);

        // D-019 专注完成：长鸣 3 声、上报（离线先排队）、跳到专注页显示完成
        if (focus_timer.tick(now_ms)) {
            LOGI(">> Focus finished (%d min)", focus_timer.runMinutes());
            buzzer.beep(3, Buzzer::Pattern::Long);
            QueuedTaskEvent ev;
            ev.kind = "focus";
            ev.minutes = focus_timer.runMinutes();
            ev.event_id = Uuid::generateV4();
            ev.occurred_at = dev_clock.isoNowUtc();
            event_queue.enqueue(ev);
            if (wifi.isConnected() && pairing_client.isPaired()) {
                sync_engine.flushOfflineEvents();
                sync_soon_requested = true;  // 服务端发积分后重渲染，尽快拿到新画面
            }
            if (setup_ui == SetupUi::None && focus_page > 0 && current_page != focus_page) showPage(focus_page);
        }
        // 专注页倒计时：显示值变化时局部刷新（剩余 >1 分钟每分钟一次，最后一分钟每 15 秒）
        if (setup_ui == SetupUi::None && focus_page > 0 && current_page == focus_page && focusKey(now_ms) != focus_drawn) {
            static uint8_t focus_region[FocusRenderer::kRegionBytes];
            FocusRenderer::renderRegion(focus_region, sizeof(focus_region), focus_timer.state(), focus_timer.displaySec(now_ms));
            if (display.showWindow(focus_region, FocusRenderer::kSlotX, FocusRenderer::kSlotY, FocusRenderer::kSlotW,
                                   FocusRenderer::kSlotH)) {
                focus_drawn = focusKey(now_ms);
            } else if (composePage(current_page)) {
                showBuffer();
            }
        }

        if (!sensed_once || now_ms - last_sense_ms >= 60 * 1000) {
            sensed_once = true;
            last_sense_ms = now_ms;
            sampleSensors();
        }

        // 配网确认画面超时 → 取消
        if (setup_ui == SetupUi::Confirm && reached(now_ms, setup_deadline_ms)) {
            setup_ui = SetupUi::None;
            restoreScreen();
        }

        // 热点配网：取网页提交的凭证 → 连接 → 回报结果
        if (setup_ui == SetupUi::Portal) {
            std::string sub_ssid, sub_pass;
            if (!attempting && portal_close_at_ms == 0 && portal.takeSubmitted(sub_ssid, sub_pass)) {
                LOGI("Trying Wi-Fi from setup page: %s", sub_ssid.c_str());
                attempt_ssid = sub_ssid;
                attempt_pass = sub_pass;
                sub_pass.assign(sub_pass.size(), '\0');
                attempting = true;
                attempt_deadline_ms = now_ms + kAttemptTimeoutMs;
                wifi.connect(attempt_ssid, attempt_pass);
            }
            if (attempting) {
                if (wifi.isConnected() && attempt_ssid == wifi.ssid()) {
                    LOGI("Wi-Fi setup succeeded: %s (saved)", attempt_ssid.c_str());
                    nvs_mgr.setWifiCredentials(attempt_ssid, attempt_pass);
                    has_wifi_creds = true;
                    attempting = false;
                    portal.setStatus(WifiPortal::Status::Connected, attempt_ssid);
                    portal_close_at_ms = now_ms + 8000;
                } else if (reached(now_ms, attempt_deadline_ms)) {
                    int reason = wifi.lastDisconnectReason();
                    LOGW("Wi-Fi setup failed: %s (reason=%d)", attempt_ssid.c_str(), reason);
                    attempting = false;
                    wifi.disconnect();
                    portal.setStatus(WifiPortal::Status::Failed, attempt_ssid, reason);
                    if (setup_deadline_ms != 0) setup_deadline_ms = now_ms + kPortalTimeoutMs;
                }
            }
            if (reached(now_ms, portal_close_at_ms)) {
                endPortal(false);
            } else if (!attempting && portal_close_at_ms == 0 && reached(now_ms, setup_deadline_ms)) {
                LOGI("Wi-Fi setup timed out, back to saved Wi-Fi");
                endPortal(true);
            }
        }

        // 已配网、已配对但长时间离线：按键栏提示"长按 BACK 设置 Wi-Fi"，其余画面保留（docs/07 保留最后一帧）
        if (setup_ui == SetupUi::None && has_wifi_creds && pairing_client.isPaired()) {
            if (wifi.isConnected()) {
                offline_tracking = false;
                if (offline_hint_shown) {
                    offline_hint_shown = false;
                    restoreScreen();
                }
            } else if (!offline_tracking) {
                offline_tracking = true;
                offline_since_ms = now_ms;
            } else if (!offline_hint_shown && now_ms - offline_since_ms >= kOfflineHintAfterMs) {
                offline_hint_shown = true;
                LOGW("Wi-Fi offline for a while, showing setup hint");
                if (composePage(current_page)) showBuffer();
            }
        }

        // D-022/D-023 首页任务区叠加状态变了（NEXT/BACK、完成任务、同步后任务变化）就只局部刷新任务区
        if (setup_ui == SetupUi::None && current_page == 0) refreshTaskOverlay();

        // D-018 附加页长时间无操作：回到首页（任务与提醒都在首页）
        if (setup_ui == SetupUi::None && current_page != 0 && now_ms - page_input_ms >= kPageIdleMs &&
            !(current_page == focus_page && focus_timer.active())) {
            showPage(0);
        }

        // D-015 设备时钟：分钟变化时局部刷新时钟区；整点或局刷次数过多时整屏刷新一次清除残影。
        // 断网时照常走（系统时间由晶振维持，开机由 RTC 恢复）。
        if (clock_enabled && setup_ui == SetupUi::None && pairing_client.isPaired() && store.hasLastFrame()) {
            int h = 0, m = 0;
            if (dev_clock.localHourMinute(h, m) && h * 60 + m != clock_drawn_minute) {
                constexpr int kClockMaxPartials = 60;
                bool full = (clock_drawn_minute >= 0 && m == 0) || clock_partials >= kClockMaxPartials;
                if (!full) {
                    uint8_t region[ClockRenderer::kRegionBytes];
                    ClockRenderer::renderRegion(region, sizeof(region), h, m);
                    if (display.showWindow(region, ClockRenderer::kSlotX, ClockRenderer::kSlotY,
                                           ClockRenderer::kSlotW, ClockRenderer::kSlotH)) {
                        clock_drawn_minute = h * 60 + m;
                        ++clock_partials;
                    } else {
                        // 局刷不可用：关闭时钟并整屏重画一次（不留下停住的旧时间）
                        LOGW("Clock partial refresh failed; disabling device clock");
                        clock_enabled = false;
                        full = true;
                    }
                }
                if (full) {
                    if (composePage(current_page)) showBuffer();  // D-018 刷新当前所在页
                    if (!clock_enabled) clock_drawn_minute = h * 60 + m;  // 避免每轮重试
                }
            }
        }

        if (setup_ui == SetupUi::None && wifi.isConnected()) {
            // 配对检查状态机 (Step B ~ Step D)
            if (!pairing_client.isPaired()) {
                pairing_client.step(now_ms);
            } else {
                // 已完成配对，运行正常同步循环
                if (sync_soon_requested) {
                    sync_soon_requested = false;
                    sync_soon_at_ms = now_ms + 3000; // 留时间给服务端 renderer 生成新帧
                }
                bool sync_soon_due = sync_soon_at_ms != 0 && static_cast<int32_t>(now_ms - sync_soon_at_ms) >= 0;
                if (sync_soon_due || now_ms - last_sync_ms >= static_cast<uint32_t>(next_sync_seconds * 1000)) {
                    sync_soon_at_ms = 0;
                    last_sync_ms = now_ms;

                    SyncTelemetry telemetry;
                    telemetry.frame_version = sync_engine.getLocalFrameVersion();
#ifdef ESP_PLATFORM
                    uint32_t free_h = esp_get_free_heap_size();
#else
                    uint32_t free_h = 120000;
#endif
                    diag_mgr.populateTelemetry(telemetry, ota_mgr.getRunningSlot(), ota_mgr.getRollbackCount(),
                                               wifi.getRssi(), now_ms / 1000, free_h, "power_on");
                    telemetry.has_env = has_env;
                    telemetry.temperature_c = env_t;
                    telemetry.humidity_pct = env_h;
                    telemetry.has_battery = has_batt;
                    telemetry.battery_mv = batt_mv;
                    telemetry.battery_percent = BatteryMonitor::percentFromMillivolts(batt_mv);

                    SyncStepResult step_res = sync_engine.step(telemetry, &next_sync_seconds);
                    for (const auto& cmd : sync_engine.takeCommands()) {
                        if (cmd.type == "beep") {
                            LOGI(">> Server alert: beep x%d", cmd.beeps > 0 ? cmd.beeps : 3);
                            buzzer.beep(cmd.beeps > 0 ? cmd.beeps : 3);
                            if (current_page != 0) showPage(0);  // D-018 提醒横幅在首页
                        }
                    }
                    // D-019 专注页页号与时长随同步更新（存 NVS）
                    if (sync_engine.focusPageIndex() >= 0 && sync_engine.focusPageIndex() != focus_page) {
                        focus_page = sync_engine.focusPageIndex();
                        nvs_mgr.setInt("focus_pg", focus_page);
                    }
                    if (sync_engine.focusMinutes() > 0 && sync_engine.focusMinutes() != focus_timer.minutes()) {
                        focus_timer.setMinutes(sync_engine.focusMinutes());
                        nvs_mgr.setInt("focus_min", focus_timer.minutes());
                        focus_drawn = -1;
                    }
                    if (step_res == SyncStepResult::OtaUpdated) {
                        LOGI(">> OTA Firmware update applied! Device preparing reboot into target slot...");
#ifdef ESP_PLATFORM
                        vTaskDelay(pdMS_TO_TICKS(1000));
                        esp_restart();
#endif
                    }
                }
            }
        }


#ifdef ESP_PLATFORM
        vTaskDelay(pdMS_TO_TICKS(50));
#else
        break;
#endif
    }
}
