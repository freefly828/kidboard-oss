#pragma once

#include <cstddef>
#include <cstdint>

namespace kidboard {

/**
 * 设备时钟绘制（D-015）。
 *
 * 服务端画面在时钟区（与 packages/screen-template CLOCK_SLOT 一致）保持全白，
 * 设备用 clock_font.h（与服务端同一字体生成）在此画 "HH:MM"。
 * 时钟区按字节对齐（x、宽度为 8 的倍数），区域缓冲为 1-bit、1=white、行优先、MSB 在左，
 * 与帧契约相同，可直接用于局部刷新。
 */
class ClockRenderer {
public:
    static constexpr int kSlotX = 16;
    static constexpr int kSlotY = 8;
    static constexpr int kSlotW = 104;
    static constexpr int kSlotH = 38;
    static constexpr size_t kRegionBytes = (kSlotW / 8) * kSlotH;

    /** 画出时钟区（白底黑字 "HH:MM"）；hour/minute 越界时返回 false 并画空白 */
    static bool renderRegion(uint8_t* region, size_t region_size, int hour, int minute);

    /** 空白时钟区（时间未知时） */
    static void clearRegion(uint8_t* region, size_t region_size);

    /** 把区域缓冲写入整帧缓冲（48,000 字节）的时钟区 */
    static bool blitToFrame(uint8_t* frame, size_t frame_size, const uint8_t* region, size_t region_size);

    /** 直接在整帧上画时钟（显示整帧前调用） */
    static bool drawIntoFrame(uint8_t* frame, size_t frame_size, int hour, int minute);
};

} // namespace kidboard
