/**
 * 设备传感器（D-016）宿主机测试：SHT40 CRC 与换算、电池电量曲线、同步遥测 JSON。
 */

#include <cassert>
#include <cmath>
#include <cstdio>
#include <string>

#include "api_client/json_helper.h"
#include "sensors/battery_monitor.h"
#include "sensors/env_sensor.h"

using namespace kidboard;

int main() {
    // Sensirion 数据手册示例：0xBEEF → CRC 0x92
    const uint8_t beef[2] = {0xBE, 0xEF};
    assert(EnvSensor::crc8(beef, 2) == 0x92);

    // 温度原始值 0x6666 ≈ 25.0℃，湿度原始值 0x8000 ≈ 56.5%
    uint8_t raw[6] = {0x66, 0x66, 0, 0x80, 0x00, 0};
    raw[2] = EnvSensor::crc8(raw, 2);
    raw[5] = EnvSensor::crc8(raw + 3, 2);
    float t = 0, h = 0;
    assert(EnvSensor::decode(raw, t, h));
    assert(std::fabs(t - 25.0f) < 0.05f);
    assert(std::fabs(h - 56.5f) < 0.05f);
    raw[5] ^= 0xFF;  // CRC 错误 → 拒绝
    assert(!EnvSensor::decode(raw, t, h));
    // 湿度越界被限制在 0~100
    uint8_t wet[6] = {0x66, 0x66, 0, 0xFF, 0xFF, 0};
    wet[2] = EnvSensor::crc8(wet, 2);
    wet[5] = EnvSensor::crc8(wet + 3, 2);
    assert(EnvSensor::decode(wet, t, h) && h == 100.0f);

    // 电池曲线：满电 100、空电 0、中段单调递增
    assert(BatteryMonitor::percentFromMillivolts(4250) == 100);
    assert(BatteryMonitor::percentFromMillivolts(3200) == 0);
    assert(BatteryMonitor::percentFromMillivolts(3800) == 50);
    assert(BatteryMonitor::percentFromMillivolts(3650) == 20);
    int prev = -1;
    for (int mv = 3300; mv <= 4200; mv += 10) {
        int p = BatteryMonitor::percentFromMillivolts(mv);
        assert(p >= prev && p >= 0 && p <= 100);
        prev = p;
    }

    // 遥测 JSON：有读数才带字段，仍是合法对象结尾
    SyncTelemetry tel;
    std::string plain = JsonHelper::buildSyncRequestJson(tel);
    assert(plain.find("temperatureC") == std::string::npos && plain.find("batteryMv") == std::string::npos);
    tel.has_env = true;
    tel.temperature_c = 24.56f;
    tel.humidity_pct = 55.04f;
    tel.has_battery = true;
    tel.battery_mv = 3987;
    tel.battery_percent = 79;
    std::string full = JsonHelper::buildSyncRequestJson(tel);
    assert(full.find("\"temperatureC\":24.6") != std::string::npos);
    assert(full.find("\"humidityPct\":55.0") != std::string::npos);
    assert(full.find("\"batteryMv\":3987,\"batteryPercent\":79}") != std::string::npos);
    assert(full.back() == '}');

    // 宿主机无硬件：读取返回 false
    EnvSensor env;
    assert(!env.read(t, h));
    BatteryMonitor batt;
    int mv = 0;
    assert(!batt.read(mv));

    printf("SENSOR TESTS PASSED\n");
    return 0;
}
