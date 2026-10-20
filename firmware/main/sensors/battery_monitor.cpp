#include "battery_monitor.h"

#include "board_config.h"

#ifdef ESP_PLATFORM
#include "driver/gpio.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static const char* TAG = "BATTERY";
#endif

namespace kidboard {

int BatteryMonitor::percentFromMillivolts(int mv) {
    // 单节锂电池轻载放电曲线（mV → %），两点间线性插值
    static const int kCurve[][2] = {
        {4180, 100}, {4100, 92}, {4000, 81}, {3900, 66}, {3800, 50},
        {3750, 40},  {3700, 30}, {3650, 20}, {3600, 12}, {3500, 5}, {3300, 0},
    };
    constexpr int n = sizeof(kCurve) / sizeof(kCurve[0]);
    if (mv >= kCurve[0][0]) return 100;
    if (mv <= kCurve[n - 1][0]) return 0;
    for (int i = 1; i < n; ++i) {
        if (mv >= kCurve[i][0]) {
            const int v0 = kCurve[i][0], p0 = kCurve[i][1];
            const int v1 = kCurve[i - 1][0], p1 = kCurve[i - 1][1];
            return p0 + (mv - v0) * (p1 - p0) / (v1 - v0);
        }
    }
    return 0;
}

bool BatteryMonitor::read(int& millivolts) {
#ifdef ESP_PLATFORM
    if (CONFIG_KB_BATTERY_ADC_GPIO < 0 || m_failed) return false;
    if (!m_ready) {
        if (CONFIG_KB_BATTERY_EN_GPIO >= 0) {
            gpio_reset_pin(static_cast<gpio_num_t>(CONFIG_KB_BATTERY_EN_GPIO));
            gpio_set_direction(static_cast<gpio_num_t>(CONFIG_KB_BATTERY_EN_GPIO), GPIO_MODE_OUTPUT);
        }
        adc_unit_t unit;
        adc_channel_t channel;
        if (adc_oneshot_io_to_channel(CONFIG_KB_BATTERY_ADC_GPIO, &unit, &channel) != ESP_OK) {
            ESP_LOGW(TAG, "GPIO%d is not an ADC pin", CONFIG_KB_BATTERY_ADC_GPIO);
            m_failed = true;
            return false;
        }
        adc_oneshot_unit_handle_t adc = nullptr;
        adc_oneshot_unit_init_cfg_t unit_cfg = {};
        unit_cfg.unit_id = unit;
        if (adc_oneshot_new_unit(&unit_cfg, &adc) != ESP_OK) {
            m_failed = true;
            return false;
        }
        adc_oneshot_chan_cfg_t chan_cfg = {};
        chan_cfg.atten = ADC_ATTEN_DB_12;
        chan_cfg.bitwidth = ADC_BITWIDTH_DEFAULT;
        adc_oneshot_config_channel(adc, channel, &chan_cfg);
        adc_cali_handle_t cali = nullptr;
        adc_cali_curve_fitting_config_t cali_cfg = {};
        cali_cfg.unit_id = unit;
        cali_cfg.chan = channel;
        cali_cfg.atten = ADC_ATTEN_DB_12;
        cali_cfg.bitwidth = ADC_BITWIDTH_DEFAULT;
        if (adc_cali_create_scheme_curve_fitting(&cali_cfg, &cali) != ESP_OK) cali = nullptr;
        m_adc = adc;
        m_cali = cali;
        m_ready = true;
    }

    if (CONFIG_KB_BATTERY_EN_GPIO >= 0) {
        gpio_set_level(static_cast<gpio_num_t>(CONFIG_KB_BATTERY_EN_GPIO), 1);
        // 分压电路需要时间稳定（Seeed 示例初始化等 100 ms）；首次读取多等一些
        vTaskDelay(pdMS_TO_TICKS(m_settled ? 20 : 100));
        m_settled = true;
    }
    adc_unit_t unit;
    adc_channel_t channel;
    adc_oneshot_io_to_channel(CONFIG_KB_BATTERY_ADC_GPIO, &unit, &channel);
    int sum_mv = 0, count = 0;
    {
        int discard = 0;  // 丢弃第一次采样（采样电容未充满时偏低）
        adc_oneshot_read(static_cast<adc_oneshot_unit_handle_t>(m_adc), channel, &discard);
    }
    for (int i = 0; i < 8; ++i) {
        int raw = 0, mv = 0;
        if (adc_oneshot_read(static_cast<adc_oneshot_unit_handle_t>(m_adc), channel, &raw) != ESP_OK) continue;
        if (m_cali) {
            adc_cali_raw_to_voltage(static_cast<adc_cali_handle_t>(m_cali), raw, &mv);
        } else {
            mv = raw * 3100 / 4095;  // 未校准时的粗略换算
        }
        sum_mv += mv;
        ++count;
    }
    if (CONFIG_KB_BATTERY_EN_GPIO >= 0) gpio_set_level(static_cast<gpio_num_t>(CONFIG_KB_BATTERY_EN_GPIO), 0);
    if (count == 0) return false;
    const int pin_mv = sum_mv / count;
    millivolts = pin_mv * 2;  // 10k/20k 分压
    ESP_LOGI(TAG, "Battery ADC pin=%d mV -> battery=%d mV (cali=%s)", pin_mv, millivolts, m_cali ? "yes" : "no");
    // 锂电池正常 3.0~4.3V；超出范围视为测量异常，不上报（避免误报电量低）
    return millivolts >= 3000 && millivolts <= 4500;
#else
    (void)millivolts;
    (void)m_ready;
    (void)m_failed;
    (void)m_settled;
    (void)m_adc;
    (void)m_cali;
    return false;
#endif
}

} // namespace kidboard
