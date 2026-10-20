#include "buzzer.h"

#include "board_config.h"

#ifdef ESP_PLATFORM
#include "driver/ledc.h"
#include "esp_log.h"
#include "esp_timer.h"
static const char* TAG = "BUZZER";
#endif

namespace kidboard {

namespace {
constexpr uint32_t kToneHz = 2700;  // 无源蜂鸣器常见谐振频率附近，声音较响
}

uint32_t Buzzer::segmentMs(Pattern pattern, bool on) {
    if (!on) return 150;
    return pattern == Pattern::Long ? 600 : 150;
}

bool Buzzer::init() {
#ifdef ESP_PLATFORM
    if (CONFIG_KB_BUZZER_GPIO < 0) return false;
    // GPIO45 是 strapping 脚：只在启动完成后配置为 PWM 输出
    ledc_timer_config_t timer = {};
    timer.speed_mode = LEDC_LOW_SPEED_MODE;
    timer.duty_resolution = LEDC_TIMER_10_BIT;
    timer.timer_num = LEDC_TIMER_0;
    timer.freq_hz = kToneHz;
    timer.clk_cfg = LEDC_AUTO_CLK;
    if (ledc_timer_config(&timer) != ESP_OK) {
        ESP_LOGW(TAG, "LEDC timer config failed");
        return false;
    }
    ledc_channel_config_t ch = {};
    ch.gpio_num = CONFIG_KB_BUZZER_GPIO;
    ch.speed_mode = LEDC_LOW_SPEED_MODE;
    ch.channel = LEDC_CHANNEL_0;
    ch.timer_sel = LEDC_TIMER_0;
    ch.duty = 0;
    ch.hpoint = 0;
    if (ledc_channel_config(&ch) != ESP_OK) {
        ESP_LOGW(TAG, "LEDC channel config failed");
        return false;
    }
    esp_timer_create_args_t args = {};
    args.callback = &Buzzer::onTimer;
    args.arg = this;
    args.name = "buzzer";
    esp_timer_handle_t handle = nullptr;
    if (esp_timer_create(&args, &handle) != ESP_OK) {
        ESP_LOGW(TAG, "esp_timer_create failed");
        return false;
    }
    m_timer = handle;
#endif
    m_ready = true;
    return true;
}

void Buzzer::setOn(bool on) {
    m_on = on;
#ifdef ESP_PLATFORM
    if (!m_ready) return;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, on ? 512 : 0);  // 50% 占空比
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
#endif
}

uint32_t Buzzer::advance() {
    const int left = m_remaining_edges.load();
    if (left <= 0) {
        setOn(false);
        return 0;
    }
    // 交替切换：剩余切换次数为偶数时开、奇数时关
    const bool turn_on = (left % 2) == 0;
    setOn(turn_on);
    m_remaining_edges = left - 1;
    return segmentMs(m_pattern, turn_on);
}

void Buzzer::onTimer(void* arg) {
#ifdef ESP_PLATFORM
    auto* self = static_cast<Buzzer*>(arg);
    const uint32_t ms = self->advance();
    if (ms > 0) esp_timer_start_once(static_cast<esp_timer_handle_t>(self->m_timer), static_cast<uint64_t>(ms) * 1000);
#else
    (void)arg;
#endif
}

void Buzzer::beep(int count, Pattern pattern) {
    if (count <= 0) return;
    if (count > 10) count = 10;
#ifdef ESP_PLATFORM
    if (m_timer) esp_timer_stop(static_cast<esp_timer_handle_t>(m_timer));
#endif
    m_pattern = pattern;
    m_remaining_edges = count * 2;  // 每声：开 + 关
    m_started = false;
#ifdef ESP_PLATFORM
    if (m_timer) {
        onTimer(this);  // 立即开始第一声，之后由定时器推进
    }
#endif
}

void Buzzer::stop() {
#ifdef ESP_PLATFORM
    if (m_timer) esp_timer_stop(static_cast<esp_timer_handle_t>(m_timer));
#endif
    m_remaining_edges = 0;
    m_started = false;
    setOn(false);
}

void Buzzer::poll(uint32_t now_ms) {
#ifdef ESP_PLATFORM
    (void)now_ms;  // 由 esp_timer 推进
#else
    if (m_remaining_edges.load() <= 0) return;
    if (m_started && static_cast<int32_t>(now_ms - m_next_ms) < 0) return;
    m_started = true;
    m_next_ms = now_ms + advance();
#endif
}

} // namespace kidboard
