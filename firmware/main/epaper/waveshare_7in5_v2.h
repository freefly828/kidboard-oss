#pragma once

#include "epaper_interface.h"
#include "board_config.h"

namespace kidboard {

class Waveshare7in5V2 {
public:
    Waveshare7in5V2();
    ~Waveshare7in5V2();

    bool init();
    bool displayFrame(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect);
    /** D-015 局部刷新窗口（x、w 为 8 的倍数）；不闪全屏，约 0.5 秒 */
    bool displayWindow(const uint8_t* region, int x, int y, int w, int h, bool fast = true);
    void sleep();

private:
    bool setupBus();
    int readBusyPin() const;
    void logBusyTimeline();
    bool waitBusy(int timeout_ms = BUSY_TIMEOUT_MS);
    void resetHardware();
    void sendCommand(uint8_t cmd);
    void sendData(uint8_t data);
    void sendBuffer(const uint8_t* data, size_t len, bool invert = false);

    bool m_initialized;
    bool m_spi_active;
    void* m_spi_device; // spi_device_handle_t
    bool m_poll_status = false; // 等待 BUSY 时发送 0x71
    bool m_ignore_busy = false; // 仅诊断构建：BUSY 不可信时用固定延时
};

} // namespace kidboard
