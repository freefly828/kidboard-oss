#pragma once

#include <cstddef>
#include <cstdint>

namespace kidboard {

/**
 * 室内温湿度（D-016）：板载 SHT40（I2C0 地址 0x44）。
 * 读数经同步遥测上报，服务端在画面顶栏显示"室内 24℃ 55%"（校准偏移在后台设置）。
 */
class EnvSensor {
public:
    /** 测量一次（高精度，约 10 ms）；失败返回 false */
    bool read(float& temperature_c, float& humidity_pct);

    /* ---- 纯函数（宿主机可测） ---- */
    /** Sensirion CRC-8（多项式 0x31，初值 0xFF） */
    static uint8_t crc8(const uint8_t* data, size_t len);
    /** 解析 6 字节测量结果（含 CRC 校验）；湿度限制在 0~100 */
    static bool decode(const uint8_t raw[6], float& temperature_c, float& humidity_pct);

private:
    void* m_dev = nullptr;
};

} // namespace kidboard
