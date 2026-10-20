#include "focus_renderer.h"

#include <cstring>

#include "board_config.h"
#include "clock/focus_font.h"

namespace kidboard {

namespace {
constexpr int kRowBytes = FocusRenderer::kSlotW / 8;

void ink(uint8_t* r, int x, int y) {
    if (x < 0 || x >= FocusRenderer::kSlotW || y < 0 || y >= FocusRenderer::kSlotH) return;
    r[y * kRowBytes + (x >> 3)] &= static_cast<uint8_t>(~(0x80 >> (x & 7)));
}

void fillRect(uint8_t* r, int x, int y, int w, int h) {
    for (int j = y; j < y + h; ++j)
        for (int i = x; i < x + w; ++i) ink(r, i, j);
}

/** 粗线段（方形笔刷） */
void thickLine(uint8_t* r, int x0, int y0, int x1, int y1, int t) {
    const int steps = (x1 - x0 > 0 ? x1 - x0 : x0 - x1) + (y1 - y0 > 0 ? y1 - y0 : y0 - y1);
    for (int s = 0; s <= steps; ++s) {
        const int x = x0 + (x1 - x0) * s / (steps ? steps : 1);
        const int y = y0 + (y1 - y0) * s / (steps ? steps : 1);
        fillRect(r, x - t / 2, y - t / 2, t, t);
    }
}

const focusfont::Glyph* glyphOf(char ch) {
    for (const auto& g : focusfont::kGlyphs)
        if (g.ch == ch) return &g;
    return nullptr;
}

constexpr int kIconX = 8;
constexpr int kIconW = 48;
constexpr int kIconH = 52;
constexpr int kIconY = (FocusRenderer::kSlotH - kIconH) / 2;

void drawIcon(uint8_t* r, FocusTimer::State state) {
    switch (state) {
        case FocusTimer::State::Running:  // ▶
            for (int j = 0; j < kIconH; ++j) {
                const int half = kIconH / 2;
                const int w = (j <= half ? j : kIconH - j) * kIconW / half;
                fillRect(r, kIconX, kIconY + j, w, 1);
            }
            break;
        case FocusTimer::State::Paused:  // ❚❚
            fillRect(r, kIconX + 4, kIconY, 14, kIconH);
            fillRect(r, kIconX + 30, kIconY, 14, kIconH);
            break;
        case FocusTimer::State::Done:  // ✓
            thickLine(r, kIconX + 2, kIconY + 28, kIconX + 18, kIconY + 46, 8);
            thickLine(r, kIconX + 18, kIconY + 46, kIconX + 46, kIconY + 6, 8);
            break;
        case FocusTimer::State::Idle:
            break;
    }
}
} // namespace

bool FocusRenderer::renderRegion(uint8_t* region, size_t region_size, FocusTimer::State state, int seconds) {
    if (!region || region_size < kRegionBytes) return false;
    memset(region, 0xFF, kRegionBytes);
    if (seconds < 0) seconds = 0;
    if (seconds > 99 * 60 + 59) seconds = 99 * 60 + 59;
    drawIcon(region, state);

    const int mm = seconds / 60, ss = seconds % 60;
    const char text[6] = {
        static_cast<char>('0' + mm / 10), static_cast<char>('0' + mm % 10), ':',
        static_cast<char>('0' + ss / 10), static_cast<char>('0' + ss % 10), '\0',
    };
    int width = 0;
    for (const char* p = text; *p; ++p) {
        const auto* g = glyphOf(*p);
        if (g) width += g->width;
    }
    // 数字右对齐，左侧留给状态图标
    int x = kSlotW - 8 - width;
    const int y0 = (kSlotH - focusfont::kHeight) / 2;
    for (const char* p = text; *p; ++p) {
        const auto* g = glyphOf(*p);
        if (!g) continue;
        const int bpr = (g->width + 7) / 8;
        for (int gy = 0; gy < focusfont::kHeight; ++gy)
            for (int gx = 0; gx < g->width; ++gx)
                if (g->bits[gy * bpr + (gx >> 3)] & (0x80 >> (gx & 7))) ink(region, x + gx, y0 + gy);
        x += g->width;
    }
    return true;
}

bool FocusRenderer::drawIntoFrame(uint8_t* frame, size_t frame_size, FocusTimer::State state, int seconds) {
    if (!frame || frame_size != FRAME_BUFFER_BYTES) return false;
    static uint8_t region[kRegionBytes];
    if (!renderRegion(region, sizeof(region), state, seconds)) return false;
    for (int y = 0; y < kSlotH; ++y) {
        memcpy(frame + (kSlotY + y) * 100 + kSlotX / 8, region + y * kRowBytes, kRowBytes);
    }
    return true;
}

} // namespace kidboard
