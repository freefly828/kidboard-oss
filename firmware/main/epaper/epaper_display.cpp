#include "epaper_display.h"
#include "status_led/status_led.h"

namespace kidboard {

EpaperDisplay::EpaperDisplay() = default;

bool EpaperDisplay::init() {
    bool ok = m_panel.init();
    if (!ok) StatusLed::setError(true);
    return ok;
}

bool EpaperDisplay::show(const uint8_t* frame, size_t len,
                         RefreshMode mode,
                         const DirtyRect* rect) {
    bool ok = m_panel.displayFrame(frame, len, mode, rect);
    StatusLed::setError(!ok); // 刷新失败快闪，成功恢复常亮
    // 刷完必须调用 display sleep (docs/07 §7: 刷完必须调用 display sleep/power off)
    m_panel.sleep();
    return ok;
}

bool EpaperDisplay::showWindow(const uint8_t* region, int x, int y, int w, int h, bool fast) {
    bool ok = m_panel.displayWindow(region, x, y, w, h, fast);
    m_panel.sleep();
    return ok;
}

void EpaperDisplay::sleep() {
    m_panel.sleep();
}

} // namespace kidboard
