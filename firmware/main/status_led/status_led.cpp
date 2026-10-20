#include "status_led.h"
#include "board_config.h"

#ifdef ESP_PLATFORM
#include "driver/gpio.h"
#include "esp_timer.h"
#endif

namespace kidboard {

namespace {
bool s_initialized = false;
bool s_error = false;
#ifdef ESP_PLATFORM
esp_timer_handle_t s_blink_timer = nullptr;
bool s_led_on = false;
constexpr uint64_t kBlinkHalfPeriodUs = 250 * 1000; // 每秒约 2 次

void writeLed(bool on) {
    const int pin = BoardConfig::getPins().status_led;
    if (pin < 0) return;
    gpio_set_level(static_cast<gpio_num_t>(pin), on ? 0 : 1); // 低电平点亮
    s_led_on = on;
}

void onBlinkTimer(void*) {
    writeLed(!s_led_on);
}
#endif
} // namespace

void StatusLed::init() {
    if (s_initialized) return;
#ifdef ESP_PLATFORM
    const int pin = BoardConfig::getPins().status_led;
    if (pin < 0) return;
    const gpio_num_t led = static_cast<gpio_num_t>(pin);
    gpio_reset_pin(led);
    gpio_set_direction(led, GPIO_MODE_OUTPUT);
    writeLed(true);

    esp_timer_create_args_t args = {};
    args.callback = &onBlinkTimer;
    args.name = "status_led";
    esp_timer_create(&args, &s_blink_timer);
#endif
    s_initialized = true;
}

void StatusLed::setError(bool error) {
    if (!s_initialized || error == s_error) return;
    s_error = error;
#ifdef ESP_PLATFORM
    if (s_blink_timer == nullptr) return;
    if (error) {
        esp_timer_start_periodic(s_blink_timer, kBlinkHalfPeriodUs);
    } else {
        esp_timer_stop(s_blink_timer);
        writeLed(true);
    }
#endif
}

bool StatusLed::isError() {
    return s_error;
}

} // namespace kidboard
