#pragma once

#include <cstddef>
#include <cstdint>

#include "focus_timer.h"

namespace kidboard {

/**
 * 专注页倒计时区绘制（D-019）：与 packages/screen-template/pages FOCUS_SLOT 一致，
 * 服务端留白，设备画状态图标（▶ 进行中 / ❚❚ 暂停 / ✓ 完成）与大号 "MM:SS"（focus_font.h，
 * 由服务端同一字体生成）。区域缓冲 1-bit、1=white、行优先、MSB 在左。
 */
class FocusRenderer {
public:
    static constexpr int kSlotX = 192;
    static constexpr int kSlotY = 96;
    static constexpr int kSlotW = 416;
    static constexpr int kSlotH = 112;
    static constexpr size_t kRegionBytes = (kSlotW / 8) * kSlotH;

    static bool renderRegion(uint8_t* region, size_t region_size, FocusTimer::State state, int seconds);
    static bool drawIntoFrame(uint8_t* frame, size_t frame_size, FocusTimer::State state, int seconds);
};

} // namespace kidboard
