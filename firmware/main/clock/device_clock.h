#pragma once

#include <cstdint>
#include <string>

namespace kidboard {

/**
 * 设备时间（D-015）。
 *
 * - 对时：每次同步成功用响应里的 serverTime（UTC）校准系统时间，偏差 >2 秒才改；
 *   不另走 NTP（少一个依赖，也不受路由器拦截 UDP 123 影响）。
 * - 时区：同步响应的 utcOffsetMinutes（孩子时区当前偏移，含夏令时）；缺省用 Kconfig 默认值，
 *   最近一次的值由调用方存进 NVS，断网重启后仍可用。
 * - 断网兜底：板载 PCF8563 RTC（I2C 0x51，内置电池供电）保存 UTC。开机先从 RTC 读回时间，
 *   对时后再写回；RTC 掉电标志（VL）置位或年份不合理时视为无效，不显示时钟。
 * 本地时间 = UTC + 偏移，自行换算，不依赖 libc 的 TZ 机制。
 */
class DeviceClock {
public:
    /** 开机：设置时区偏移，尝试从 RTC 恢复时间 */
    void init(int utc_offset_minutes);

    /** 时间可信（已对时或 RTC 有效） */
    bool isValid() const;

    /**
     * 用服务器时间校准。has_offset=false 时保持当前偏移。
     * 返回偏移是否变化（调用方据此写 NVS）。
     */
    bool syncFromServer(const std::string& iso_utc, int utc_offset_minutes, bool has_offset);

    /** 当前本地时、分；时间无效返回 false */
    bool localHourMinute(int& hour, int& minute) const;

    int utcOffsetMinutes() const { return m_offset_min; }

    /** 当前 UTC 时间 "YYYY-MM-DDTHH:MM:SSZ"；时间无效返回空串（事件 occurredAt 用） */
    std::string isoNowUtc() const;

    /* ---- 纯函数（宿主机可测） ---- */

    /** "2026-10-09T17:56:26.878Z" → Unix 秒；格式不对返回 -1 */
    static int64_t parseIsoUtc(const std::string& iso);
    /** Unix 秒 + 偏移 → 本地时分 */
    static void hourMinuteOf(int64_t utc_seconds, int offset_minutes, int& hour, int& minute);
    /** 公历日期 → 自 1970-01-01 的天数 */
    static int64_t daysFromCivil(int y, int m, int d);
    /** 自 1970-01-01 的天数 → 公历日期 */
    static void civilFromDays(int64_t z, int& y, int& m, int& d);
    /** 时间戳是否在合理范围（2024 年以后、2100 年以前） */
    static bool plausible(int64_t utc_seconds);

private:
    int64_t nowUtc() const;
    void setNow(int64_t utc_seconds);
    bool rtcRead(int64_t& utc_seconds);
    bool rtcWrite(int64_t utc_seconds);

    int m_offset_min = 480;
    bool m_valid = false;
    int64_t m_host_delta = 0;      // 宿主机：模拟设置系统时间
    int64_t m_last_rtc_write = 0;  // 限制 RTC 写入频率
    void* m_i2c_bus = nullptr;
    void* m_rtc_dev = nullptr;
};

} // namespace kidboard
