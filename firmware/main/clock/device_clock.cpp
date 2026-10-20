#include "device_clock.h"
#include "sensors/i2c_bus.h"

#include <cstdio>
#include <cstdlib>
#include <ctime>

#ifdef ESP_PLATFORM
#include <sys/time.h>
#include "driver/i2c_master.h"
#include "esp_log.h"
static const char* TAG = "CLOCK";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[CLOCK_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[CLOCK_WARN] " __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

namespace {
// reTerminal E1001：I2C0 SDA=19 / SCL=20，PCF8563 地址 0x51（docs/11、Zephyr 板级 DTS）
#ifdef ESP_PLATFORM
constexpr uint8_t kRtcAddr = 0x51;  // PCF8563，与 SHT40 共用 I2C0（sensors/i2c_bus）
#endif
constexpr int64_t kRtcWriteMinIntervalS = 6 * 3600;  // 无明显偏差时最多 6 小时写一次 RTC
constexpr int64_t kResyncThresholdS = 2;

#ifdef ESP_PLATFORM
uint8_t toBcd(int v) { return static_cast<uint8_t>(((v / 10) << 4) | (v % 10)); }
int fromBcd(uint8_t v) { return ((v >> 4) & 0x0F) * 10 + (v & 0x0F); }
#endif
} // namespace

/* ---------------- 纯函数 ---------------- */

// Howard Hinnant 的 days_from_civil / civil_from_days（公有领域算法）
int64_t DeviceClock::daysFromCivil(int y, int m, int d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const int64_t yoe = y - era * 400;
    const int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

void DeviceClock::civilFromDays(int64_t z, int& y, int& m, int& d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const int64_t doe = z - era * 146097;
    const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const int64_t mp = (5 * doy + 2) / 153;
    d = static_cast<int>(doy - (153 * mp + 2) / 5 + 1);
    m = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
    y = static_cast<int>(yoe + era * 400 + (m <= 2));
}

int64_t DeviceClock::parseIsoUtc(const std::string& iso) {
    int y, mo, d, h, mi, s;
    char sep = 0;
    if (sscanf(iso.c_str(), "%4d-%2d-%2d%c%2d:%2d:%2d", &y, &mo, &d, &sep, &h, &mi, &s) != 7) return -1;
    if ((sep != 'T' && sep != ' ') || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return -1;
    // 只接受 UTC（Z 结尾，可带毫秒）
    if (iso.empty() || iso.back() != 'Z') return -1;
    return daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;
}

void DeviceClock::hourMinuteOf(int64_t utc_seconds, int offset_minutes, int& hour, int& minute) {
    int64_t local = utc_seconds + static_cast<int64_t>(offset_minutes) * 60;
    int64_t sec_of_day = local % 86400;
    if (sec_of_day < 0) sec_of_day += 86400;
    hour = static_cast<int>(sec_of_day / 3600);
    minute = static_cast<int>((sec_of_day % 3600) / 60);
}

bool DeviceClock::plausible(int64_t utc_seconds) {
    return utc_seconds >= daysFromCivil(2024, 1, 1) * 86400 && utc_seconds < daysFromCivil(2100, 1, 1) * 86400;
}

/* ---------------- 系统时间 ---------------- */

int64_t DeviceClock::nowUtc() const {
#ifdef ESP_PLATFORM
    timeval tv = {};
    gettimeofday(&tv, nullptr);
    return tv.tv_sec;
#else
    return static_cast<int64_t>(time(nullptr)) + m_host_delta;
#endif
}

void DeviceClock::setNow(int64_t utc_seconds) {
#ifdef ESP_PLATFORM
    timeval tv = {};
    tv.tv_sec = static_cast<time_t>(utc_seconds);
    settimeofday(&tv, nullptr);
#else
    m_host_delta = utc_seconds - static_cast<int64_t>(time(nullptr));
#endif
}

void DeviceClock::init(int utc_offset_minutes) {
    m_offset_min = utc_offset_minutes;
    int64_t rtc = 0;
    if (rtcRead(rtc) && plausible(rtc)) {
        setNow(rtc);
        m_valid = true;
        m_last_rtc_write = rtc;
        int h, m;
        hourMinuteOf(rtc, m_offset_min, h, m);
        LOGI("Time restored from RTC: %02d:%02d (UTC%+d min)", h, m, m_offset_min);
    } else if (plausible(nowUtc())) {
        // 软件重启后系统时间仍在（RTC 不可用时）
        m_valid = true;
    } else {
        LOGI("No valid time yet (RTC unset); clock hidden until first sync");
    }
}

bool DeviceClock::isValid() const {
    return m_valid && plausible(nowUtc());
}

bool DeviceClock::syncFromServer(const std::string& iso_utc, int utc_offset_minutes, bool has_offset) {
    bool offset_changed = false;
    if (has_offset && utc_offset_minutes >= -14 * 60 && utc_offset_minutes <= 14 * 60 &&
        utc_offset_minutes != m_offset_min) {
        LOGI("UTC offset %d -> %d min", m_offset_min, utc_offset_minutes);
        m_offset_min = utc_offset_minutes;
        offset_changed = true;
    }

    int64_t server = parseIsoUtc(iso_utc);
    if (!plausible(server)) return offset_changed;

    int64_t drift = server - nowUtc();
    if (!m_valid || llabs(drift) > kResyncThresholdS) {
        setNow(server);
        if (!m_valid || llabs(drift) > 60) {
            LOGI("Clock synced from server (drift %lld s)", static_cast<long long>(drift));
        }
        m_valid = true;
        rtcWrite(server);
        m_last_rtc_write = server;
    } else if (server - m_last_rtc_write >= kRtcWriteMinIntervalS) {
        rtcWrite(server);
        m_last_rtc_write = server;
    }
    return offset_changed;
}

std::string DeviceClock::isoNowUtc() const {
    if (!isValid()) return "";
    const int64_t t = nowUtc();
    int y, m, d;
    civilFromDays(t / 86400, y, m, d);
    const int64_t sod = t % 86400;
    char buf[32];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, d, static_cast<int>(sod / 3600),
             static_cast<int>((sod / 60) % 60), static_cast<int>(sod % 60));
    return buf;
}

bool DeviceClock::localHourMinute(int& hour, int& minute) const {
    if (!isValid()) return false;
    hourMinuteOf(nowUtc(), m_offset_min, hour, minute);
    return true;
}

/* ---------------- PCF8563 RTC ---------------- */

#ifdef ESP_PLATFORM

bool DeviceClock::rtcRead(int64_t& utc_seconds) {
    if (!m_rtc_dev) {
        auto bus = static_cast<i2c_master_bus_handle_t>(sharedI2cBus());
        if (!bus) return false;
        i2c_device_config_t dev_cfg = {};
        dev_cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev_cfg.device_address = kRtcAddr;
        dev_cfg.scl_speed_hz = 100000;
        i2c_master_dev_handle_t dev = nullptr;
        if (i2c_master_bus_add_device(bus, &dev_cfg, &dev) != ESP_OK) {
            LOGW("PCF8563 add failed; RTC unavailable");
            return false;
        }
        m_i2c_bus = bus;
        m_rtc_dev = dev;
    }

    uint8_t reg = 0x02;  // VL_seconds 起连续读 7 字节
    uint8_t r[7] = {};
    if (i2c_master_transmit_receive(static_cast<i2c_master_dev_handle_t>(m_rtc_dev), &reg, 1, r, sizeof(r), 100) != ESP_OK) {
        LOGW("PCF8563 read failed");
        return false;
    }
    if (r[0] & 0x80) {
        LOGW("PCF8563 VL flag set (time lost); ignoring RTC");
        return false;
    }
    int sec = fromBcd(r[0] & 0x7F);
    int min = fromBcd(r[1] & 0x7F);
    int hour = fromBcd(r[2] & 0x3F);
    int day = fromBcd(r[3] & 0x3F);
    int month = fromBcd(r[5] & 0x1F);
    int year = 2000 + fromBcd(r[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) return false;
    utc_seconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec;
    return true;
}

bool DeviceClock::rtcWrite(int64_t utc_seconds) {
    if (!m_rtc_dev) {
        int64_t dummy = 0;
        rtcRead(dummy);  // 初始化总线
        if (!m_rtc_dev) return false;
    }
    int64_t days = utc_seconds / 86400;
    int64_t sod = utc_seconds % 86400;
    int y, m, d;
    civilFromDays(days, y, m, d);
    int weekday = static_cast<int>((days + 4) % 7);  // 1970-01-01 为周四
    uint8_t buf[8] = {
        0x02,
        toBcd(static_cast<int>(sod % 60)),  // 写秒同时清除 VL 标志
        toBcd(static_cast<int>((sod / 60) % 60)),
        toBcd(static_cast<int>(sod / 3600)),
        toBcd(d),
        toBcd(weekday),
        toBcd(m),  // century 位 = 0（20xx）
        toBcd(y % 100),
    };
    if (i2c_master_transmit(static_cast<i2c_master_dev_handle_t>(m_rtc_dev), buf, sizeof(buf), 100) != ESP_OK) {
        LOGW("PCF8563 write failed");
        return false;
    }
    return true;
}

#else  // 宿主机：无 RTC

bool DeviceClock::rtcRead(int64_t& utc_seconds) {
    (void)utc_seconds;
    (void)m_i2c_bus;
    (void)m_rtc_dev;
    return false;
}

bool DeviceClock::rtcWrite(int64_t utc_seconds) {
    (void)utc_seconds;
    return false;
}

#endif

} // namespace kidboard
