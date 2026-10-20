#include "button_handler.h"

#ifdef ESP_PLATFORM
#include "driver/gpio.h"
#include "esp_timer.h"
#include "esp_log.h"
static const char* TAG = "BUTTONS";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#else
#include <stdio.h>
#define LOGI(...) printf("[BUTTON_INFO] " __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

ButtonHandler::ButtonHandler()
    : m_callback(nullptr),
      m_event_callback(nullptr),
      m_done_down_time_ms(0),
      m_next_down_time_ms(0),
      m_back_down_time_ms(0),
      m_done_pressed(false),
      m_next_pressed(false),
      m_back_pressed(false) {}

ButtonHandler::~ButtonHandler() = default;

bool ButtonHandler::init() {
    const auto& pins = BoardConfig::getPins();

#ifdef ESP_PLATFORM
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << pins.button_done) |
                           (1ULL << pins.button_next) |
                           (1ULL << pins.button_back);
    io_conf.pull_up_en = GPIO_PULLUP_ENABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    gpio_config(&io_conf);
#else
    (void)pins;
#endif

    LOGI("Button handler initialized (DONE=%d, NEXT=%d, BACK=%d, debounce=%dms)",
         pins.button_done, pins.button_next, pins.button_back, pins.button_debounce_ms);
    return true;
}

void ButtonHandler::setCallback(ButtonCallback cb) {
    m_callback = std::move(cb);
}

void ButtonHandler::setEventCallback(ButtonEventCallback cb) {
    m_event_callback = std::move(cb);
}

void ButtonHandler::handleRelease(ButtonType type, uint32_t duration_ms) {
    const auto& pins = BoardConfig::getPins();
    if (duration_ms < static_cast<uint32_t>(pins.button_debounce_ms)) {
        return; // Filter out jitter
    }

    ButtonAction action = ButtonAction::ShortPress;
    if (duration_ms >= 10000) {
        action = ButtonAction::VeryLongPress;
        LOGI(">> Very long press (>=10s) on button %d", static_cast<int>(type));
    } else if (duration_ms >= 5000) {
        action = ButtonAction::LongPress;
        LOGI(">> Long press (>=5s) on button %d", static_cast<int>(type));
    } else if (duration_ms >= 1000) {
        action = ButtonAction::MediumPress;
    } else {
        action = ButtonAction::ShortPress;
    }

    if (m_event_callback) {
        m_event_callback(type, action);
    }
    if (action == ButtonAction::ShortPress && m_callback) {
        m_callback(type);
    }
}

void ButtonHandler::simulatePress(ButtonType type, uint32_t duration_ms) {
    handleRelease(type, duration_ms);
}

void ButtonHandler::poll() {
#ifdef ESP_PLATFORM
    const auto& pins = BoardConfig::getPins();
    uint32_t now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);

    // Active low (0 = pressed, 1 = released)
    bool raw_done = (gpio_get_level(static_cast<gpio_num_t>(pins.button_done)) == 0);
    bool raw_next = (gpio_get_level(static_cast<gpio_num_t>(pins.button_next)) == 0);
    bool raw_back = (gpio_get_level(static_cast<gpio_num_t>(pins.button_back)) == 0);

    // DONE 处理
    if (raw_done && !m_done_pressed) {
        m_done_pressed = true;
        m_done_down_time_ms = now_ms;
    } else if (!raw_done && m_done_pressed) {
        m_done_pressed = false;
        handleRelease(ButtonType::Done, now_ms - m_done_down_time_ms);
    }

    // NEXT 处理
    if (raw_next && !m_next_pressed) {
        m_next_pressed = true;
        m_next_down_time_ms = now_ms;
    } else if (!raw_next && m_next_pressed) {
        m_next_pressed = false;
        handleRelease(ButtonType::Next, now_ms - m_next_down_time_ms);
    }

    // BACK 处理
    if (raw_back && !m_back_pressed) {
        m_back_pressed = true;
        m_back_down_time_ms = now_ms;
    } else if (!raw_back && m_back_pressed) {
        m_back_pressed = false;
        handleRelease(ButtonType::Back, now_ms - m_back_down_time_ms);
    }
#endif
}

} // namespace kidboard
