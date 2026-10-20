#pragma once

#include <stdint.h>
#include <stddef.h>

#ifdef __has_include
#if __has_include("sdkconfig.h")
#include "sdkconfig.h"
#endif
#endif

namespace kidboard {

// 默认引脚配置 — 集中定义，禁止散落硬编码（docs/11 §3）
// 兜底值与 Kconfig 默认板型 reTerminal E1001 一致（仅宿主机测试等无 sdkconfig 场景生效）
#ifndef CONFIG_KB_EPAPER_MOSI_GPIO
#define CONFIG_KB_EPAPER_MOSI_GPIO 9
#endif
#ifndef CONFIG_KB_EPAPER_SCLK_GPIO
#define CONFIG_KB_EPAPER_SCLK_GPIO 7
#endif
#ifndef CONFIG_KB_EPAPER_CS_GPIO
#define CONFIG_KB_EPAPER_CS_GPIO 10
#endif
#ifndef CONFIG_KB_EPAPER_DC_GPIO
#define CONFIG_KB_EPAPER_DC_GPIO 11
#endif
#ifndef CONFIG_KB_EPAPER_RST_GPIO
#define CONFIG_KB_EPAPER_RST_GPIO 12
#endif
#ifndef CONFIG_KB_EPAPER_BUSY_GPIO
#define CONFIG_KB_EPAPER_BUSY_GPIO 13
#endif
#ifndef CONFIG_KB_EPAPER_BUSY_ACTIVE_LEVEL
#define CONFIG_KB_EPAPER_BUSY_ACTIVE_LEVEL 0 // 0 = low active, 1 = high active
#endif

#ifndef CONFIG_KB_SD_CS_GPIO
#define CONFIG_KB_SD_CS_GPIO 14 // 与屏共用 SPI 的 SD 卡片选；-1 = 无
#endif

#ifndef CONFIG_KB_STATUS_LED_GPIO
#define CONFIG_KB_STATUS_LED_GPIO 6 // reTerminal E1001 绿色 LED，低电平点亮；-1 = 无
#endif

#ifndef CONFIG_KB_BUTTON_DONE_GPIO
#define CONFIG_KB_BUTTON_DONE_GPIO 3
#endif
#ifndef CONFIG_KB_BUTTON_NEXT_GPIO
#define CONFIG_KB_BUTTON_NEXT_GPIO 4
#endif
#ifndef CONFIG_KB_BUTTON_BACK_GPIO
#define CONFIG_KB_BUTTON_BACK_GPIO 5
#endif
#ifndef CONFIG_KB_BUTTON_DEBOUNCE_MS
#define CONFIG_KB_BUTTON_DEBOUNCE_MS 40
#endif

#ifndef CONFIG_KB_SPIFFS_BASE_PATH
#define CONFIG_KB_SPIFFS_BASE_PATH "/spiffs"
#endif
#ifndef CONFIG_KB_FRAME_DIR_PATH
#define CONFIG_KB_FRAME_DIR_PATH "/spiffs/frame"
#endif

#ifndef CONFIG_KB_WIFI_SSID
#define CONFIG_KB_WIFI_SSID "" // 空 = 走热点配网（D-014）
#endif
#ifndef CONFIG_KB_WIFI_PASSWORD
#define CONFIG_KB_WIFI_PASSWORD ""
#endif
// D-015 设备时钟（宿主机测试默认开启；sdkconfig 里 bool 关闭时宏不存在，用 KB_CLOCK_ENABLED 判断）
#ifndef ESP_PLATFORM
#ifndef CONFIG_KB_CLOCK_ENABLE
#define CONFIG_KB_CLOCK_ENABLE 1
#endif
#endif
// D-016 / D-017 板载外设（宿主机无硬件）
#ifndef CONFIG_KB_BATTERY_ADC_GPIO
#define CONFIG_KB_BATTERY_ADC_GPIO -1
#endif
#ifndef CONFIG_KB_BATTERY_EN_GPIO
#define CONFIG_KB_BATTERY_EN_GPIO -1
#endif
#ifndef CONFIG_KB_BUZZER_GPIO
#define CONFIG_KB_BUZZER_GPIO -1
#endif
#ifndef CONFIG_KB_CLOCK_DEFAULT_UTC_OFFSET_MIN
#define CONFIG_KB_CLOCK_DEFAULT_UTC_OFFSET_MIN 480
#endif
#ifndef CONFIG_KB_SERVER_URL
#define CONFIG_KB_SERVER_URL "http://192.168.1.100:3000"
#endif

// 屏幕冻结契约参数（docs/06 §5）
constexpr int SCREEN_WIDTH = 800;
constexpr int SCREEN_HEIGHT = 480;
constexpr size_t FRAME_BUFFER_BYTES = 48000; // 800 * 480 / 8
constexpr int BUSY_TIMEOUT_MS = 5000;        // 墨水屏 busy 超时保护

struct BoardPins {
    int epaper_mosi;
    int epaper_sclk;
    int epaper_cs;
    int epaper_dc;
    int epaper_rst;
    int epaper_busy;
    int epaper_busy_active_level;
    int sd_cs; // 共用 SPI 总线的 SD 卡片选，-1 = 无

    int button_done;
    int button_next;
    int button_back;
    int button_debounce_ms;
    int status_led; // 低电平点亮，-1 = 无
};

class BoardConfig {
public:
    static const BoardPins& getPins();
    static const char* getSpiffsBasePath();
    static const char* getFrameDirPath();
    static const char* getWifiSsid();
    static const char* getWifiPassword();
    static const char* getServerUrl();
    /** 固件版本：来自 firmware/version.txt（ESP-IDF 写入 app 描述）；宿主机为 "0.0.0-host" */
    static const char* firmwareVersion();
};

} // namespace kidboard
