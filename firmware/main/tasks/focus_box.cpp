#include "focus_box.h"

#include <cstring>

#include "board_config.h"

namespace kidboard {

namespace {
void ink(uint8_t* frame, int x, int y) {
    if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return;
    frame[y * (SCREEN_WIDTH / 8) + (x >> 3)] &= static_cast<uint8_t>(~(0x80 >> (x & 7)));
}
}  // namespace

bool FocusBox::drawIntoFrame(uint8_t* frame, size_t frame_size, int row) {
    if (!frame || frame_size != FRAME_BUFFER_BYTES) return false;
    if (row < 0 || row >= kMaxRows) return false;
    const int x0 = kRowX, x1 = kRowX + kRowW - 1;
    const int y0 = kRowY + row * kRowH, y1 = y0 + kRowH - 1;
    for (int t = 0; t < kBorder; ++t) {
        for (int x = x0; x <= x1; ++x) {
            ink(frame, x, y0 + t);
            ink(frame, x, y1 - t);
        }
        for (int y = y0; y <= y1; ++y) {
            ink(frame, x0 + t, y);
            ink(frame, x1 - t, y);
        }
    }
    return true;
}

bool FocusBox::drawCheck(uint8_t* frame, size_t frame_size, int row) {
    if (!frame || frame_size != FRAME_BUFFER_BYTES) return false;
    if (row < 0 || row >= kMaxRows) return false;
    const int x0 = kRowX + kCheckDx;
    const int y0 = kRowY + row * kRowH + kCheckDy;
    for (int y = y0; y < y0 + kCheckSize; ++y)
        for (int x = x0; x < x0 + kCheckSize; ++x) ink(frame, x, y);
    // 白色对勾：(5,11) → (9,15) → (16,5)，线宽 3
    auto white = [&](int x, int y) {
        if (x < x0 + 2 || x >= x0 + kCheckSize - 2 || y < y0 + 2 || y >= y0 + kCheckSize - 2) return;
        frame[y * (SCREEN_WIDTH / 8) + (x >> 3)] |= static_cast<uint8_t>(0x80 >> (x & 7));
    };
    auto stroke = [&](int ax, int ay, int bx, int by) {
        const int steps = (bx - ax > 0 ? bx - ax : ax - bx) + (by - ay > 0 ? by - ay : ay - by);
        for (int s = 0; s <= steps; ++s) {
            const int x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) white(x + dx, y + dy);
        }
    };
    stroke(x0 + 5, y0 + 11, x0 + 9, y0 + 15);
    stroke(x0 + 9, y0 + 15, x0 + 16, y0 + 5);
    return true;
}

bool FocusBox::extractWindow(const uint8_t* frame, size_t frame_size, uint8_t* window, size_t window_size) {
    if (!frame || frame_size != FRAME_BUFFER_BYTES || !window || window_size < kWinBytes) return false;
    const int row_bytes = kWinW / 8;
    for (int y = 0; y < kWinH; ++y) {
        memcpy(window + y * row_bytes, frame + (kWinY + y) * (SCREEN_WIDTH / 8) + kWinX / 8, row_bytes);
    }
    return true;
}

} // namespace kidboard
