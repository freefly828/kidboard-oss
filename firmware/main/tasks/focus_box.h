#pragma once

#include <cstddef>
#include <cstdint>

namespace kidboard {

/**
 * 首页任务焦点框（D-022）：与 packages/screen-template TASK_ROWS 一致。
 * 服务端帧不画"当前选中"，设备在焦点任务所在行画 3px 黑框；按 NEXT/BACK 时只局部刷新任务区。
 */
class FocusBox {
public:
    // 任务行：x 418~781，第 i 行 y = 112 + 37*i，高 37，最多 6 行
    static constexpr int kRowX = 418;
    static constexpr int kRowY = 112;
    static constexpr int kRowW = 364;
    static constexpr int kRowH = 37;
    static constexpr int kMaxRows = 6;
    static constexpr int kBorder = 3;

    // 局部刷新窗口：覆盖全部任务行（x、宽度按字节对齐）
    static constexpr int kWinX = 408;
    static constexpr int kWinY = 104;
    static constexpr int kWinW = 384;
    static constexpr int kWinH = kMaxRows * kRowH + 16;
    static constexpr size_t kWinBytes = (kWinW / 8) * kWinH;

    // D-023 勾选框（与 packages/screen-template TASK_CHECK 一致）：行左上角偏移 (32, 8)，21×21
    static constexpr int kCheckDx = 32;
    static constexpr int kCheckDy = 8;
    static constexpr int kCheckSize = 21;

    /** 本地把第 row 行的勾选框涂黑并画白色对勾（按 DONE 后立即显示，不等服务端重渲染） */
    static bool drawCheck(uint8_t* frame, size_t frame_size, int row);

    /** 在整帧上给第 row 行画框（row 越界则不画） */
    static bool drawIntoFrame(uint8_t* frame, size_t frame_size, int row);

    /** 从整帧裁出局部刷新窗口 */
    static bool extractWindow(const uint8_t* frame, size_t frame_size, uint8_t* window, size_t window_size);
};

} // namespace kidboard
