#include "board_config.h"

#ifdef ESP_PLATFORM
#include "esp_app_desc.h"
#endif

namespace kidboard {

static const BoardPins s_board_pins = {
    .epaper_mosi = CONFIG_KB_EPAPER_MOSI_GPIO,
    .epaper_sclk = CONFIG_KB_EPAPER_SCLK_GPIO,
    .epaper_cs = CONFIG_KB_EPAPER_CS_GPIO,
    .epaper_dc = CONFIG_KB_EPAPER_DC_GPIO,
    .epaper_rst = CONFIG_KB_EPAPER_RST_GPIO,
    .epaper_busy = CONFIG_KB_EPAPER_BUSY_GPIO,
    .epaper_busy_active_level = CONFIG_KB_EPAPER_BUSY_ACTIVE_LEVEL,
    .sd_cs = CONFIG_KB_SD_CS_GPIO,

    .button_done = CONFIG_KB_BUTTON_DONE_GPIO,
    .button_next = CONFIG_KB_BUTTON_NEXT_GPIO,
    .button_back = CONFIG_KB_BUTTON_BACK_GPIO,
    .button_debounce_ms = CONFIG_KB_BUTTON_DEBOUNCE_MS,
    .status_led = CONFIG_KB_STATUS_LED_GPIO,
};

const BoardPins& BoardConfig::getPins() {
    return s_board_pins;
}

const char* BoardConfig::getSpiffsBasePath() {
    return CONFIG_KB_SPIFFS_BASE_PATH;
}

const char* BoardConfig::getFrameDirPath() {
    return CONFIG_KB_FRAME_DIR_PATH;
}

const char* BoardConfig::getWifiSsid() {
    return CONFIG_KB_WIFI_SSID;
}

const char* BoardConfig::getWifiPassword() {
    return CONFIG_KB_WIFI_PASSWORD;
}

const char* BoardConfig::firmwareVersion() {
#ifdef ESP_PLATFORM
    return esp_app_get_description()->version;
#else
    return "0.0.0-host";
#endif
}

const char* BoardConfig::getServerUrl() {
    return CONFIG_KB_SERVER_URL;
}

} // namespace kidboard
