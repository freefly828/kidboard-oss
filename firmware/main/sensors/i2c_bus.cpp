#include "i2c_bus.h"

#ifdef ESP_PLATFORM
#include "driver/i2c_master.h"
#include "esp_log.h"
#endif

namespace kidboard {

void* sharedI2cBus() {
#ifdef ESP_PLATFORM
    static i2c_master_bus_handle_t s_bus = nullptr;
    static bool s_tried = false;
    if (!s_bus && !s_tried) {
        s_tried = true;
        i2c_master_bus_config_t cfg = {};
        cfg.i2c_port = I2C_NUM_0;
        cfg.sda_io_num = GPIO_NUM_19;
        cfg.scl_io_num = GPIO_NUM_20;
        cfg.clk_source = I2C_CLK_SRC_DEFAULT;
        cfg.glitch_ignore_cnt = 7;
        cfg.flags.enable_internal_pullup = true;
        if (i2c_new_master_bus(&cfg, &s_bus) != ESP_OK) {
            ESP_LOGW("I2C_BUS", "I2C0 bus init failed (RTC / SHT40 unavailable)");
            s_bus = nullptr;
        }
    }
    return s_bus;
#else
    return nullptr;
#endif
}

} // namespace kidboard
