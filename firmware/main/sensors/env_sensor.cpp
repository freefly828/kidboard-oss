#include "env_sensor.h"

#include "i2c_bus.h"

#ifdef ESP_PLATFORM
#include "driver/i2c_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif

namespace kidboard {

uint8_t EnvSensor::crc8(const uint8_t* data, size_t len) {
    uint8_t crc = 0xFF;
    for (size_t i = 0; i < len; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b) crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x31) : static_cast<uint8_t>(crc << 1);
    }
    return crc;
}

bool EnvSensor::decode(const uint8_t raw[6], float& temperature_c, float& humidity_pct) {
    if (crc8(raw, 2) != raw[2] || crc8(raw + 3, 2) != raw[5]) return false;
    const uint16_t t = static_cast<uint16_t>((raw[0] << 8) | raw[1]);
    const uint16_t h = static_cast<uint16_t>((raw[3] << 8) | raw[4]);
    temperature_c = -45.0f + 175.0f * static_cast<float>(t) / 65535.0f;
    humidity_pct = -6.0f + 125.0f * static_cast<float>(h) / 65535.0f;
    if (humidity_pct < 0.0f) humidity_pct = 0.0f;
    if (humidity_pct > 100.0f) humidity_pct = 100.0f;
    return true;
}

bool EnvSensor::read(float& temperature_c, float& humidity_pct) {
#ifdef ESP_PLATFORM
    if (!m_dev) {
        auto bus = static_cast<i2c_master_bus_handle_t>(sharedI2cBus());
        if (!bus) return false;
        i2c_device_config_t cfg = {};
        cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        cfg.device_address = 0x44;
        cfg.scl_speed_hz = 100000;
        i2c_master_dev_handle_t dev = nullptr;
        if (i2c_master_bus_add_device(bus, &cfg, &dev) != ESP_OK) return false;
        m_dev = dev;
    }
    auto dev = static_cast<i2c_master_dev_handle_t>(m_dev);
    const uint8_t cmd = 0xFD;  // 高精度测量
    if (i2c_master_transmit(dev, &cmd, 1, 100) != ESP_OK) return false;
    vTaskDelay(pdMS_TO_TICKS(12));
    uint8_t raw[6] = {};
    if (i2c_master_receive(dev, raw, sizeof(raw), 100) != ESP_OK) return false;
    return decode(raw, temperature_c, humidity_pct);
#else
    (void)temperature_c;
    (void)humidity_pct;
    (void)m_dev;
    return false;
#endif
}

} // namespace kidboard
