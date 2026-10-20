#pragma once

#include "epaper_interface.h"
#include "waveshare_7in5_v2.h"

namespace kidboard {

class EpaperDisplay : public IEpaperDisplay {
public:
    EpaperDisplay();
    ~EpaperDisplay() override = default;

    bool init() override;
    bool show(const uint8_t* frame, size_t len,
              RefreshMode mode,
              const DirtyRect* rect) override;
    void sleep() override;
    bool showWindow(const uint8_t* region, int x, int y, int w, int h, bool fast = true) override;

private:
    Waveshare7in5V2 m_panel;
};

} // namespace kidboard
