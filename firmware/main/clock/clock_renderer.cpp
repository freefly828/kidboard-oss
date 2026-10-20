#include "clock_renderer.h"

#include <cstring>

#include "board_config.h"
#include "clock_font.h"

namespace kidboard {

namespace {
constexpr int kRowBytes = ClockRenderer::kSlotW / 8;
constexpr int kFrameRowBytes = 800 / 8;

const clockfont::Glyph* glyphOf(char ch) {
    for (const auto& g : clockfont::kGlyphs) {
        if (g.ch == ch) return &g;
    }
    return nullptr;
}

/** 在区域缓冲中把 (x, y) 置黑（0） */
void inkAt(uint8_t* region, int x, int y) {
    if (x < 0 || x >= ClockRenderer::kSlotW || y < 0 || y >= ClockRenderer::kSlotH) return;
    region[y * kRowBytes + (x >> 3)] &= static_cast<uint8_t>(~(0x80 >> (x & 7)));
}
} // namespace

void ClockRenderer::clearRegion(uint8_t* region, size_t region_size) {
    if (!region) return;
    memset(region, 0xFF, region_size < kRegionBytes ? region_size : kRegionBytes);
}

bool ClockRenderer::renderRegion(uint8_t* region, size_t region_size, int hour, int minute) {
    if (!region || region_size < kRegionBytes) return false;
    clearRegion(region, region_size);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;

    const char text[6] = {
        static_cast<char>('0' + hour / 10), static_cast<char>('0' + hour % 10), ':',
        static_cast<char>('0' + minute / 10), static_cast<char>('0' + minute % 10), '\0',
    };

    // 左对齐（与日期文字左侧对齐），垂直居中
    int x = 2;
    const int y0 = (kSlotH - clockfont::kHeight) / 2;
    for (const char* p = text; *p; ++p) {
        const clockfont::Glyph* g = glyphOf(*p);
        if (!g) continue;
        const int bpr = (g->width + 7) / 8;
        for (int gy = 0; gy < clockfont::kHeight; ++gy) {
            for (int gx = 0; gx < g->width; ++gx) {
                if (g->bits[gy * bpr + (gx >> 3)] & (0x80 >> (gx & 7))) inkAt(region, x + gx, y0 + gy);
            }
        }
        x += g->width;
    }
    return true;
}

bool ClockRenderer::blitToFrame(uint8_t* frame, size_t frame_size, const uint8_t* region, size_t region_size) {
    if (!frame || frame_size != FRAME_BUFFER_BYTES || !region || region_size < kRegionBytes) return false;
    for (int y = 0; y < kSlotH; ++y) {
        memcpy(frame + (kSlotY + y) * kFrameRowBytes + kSlotX / 8, region + y * kRowBytes, kRowBytes);
    }
    return true;
}

bool ClockRenderer::drawIntoFrame(uint8_t* frame, size_t frame_size, int hour, int minute) {
    uint8_t region[kRegionBytes];
    if (!renderRegion(region, sizeof(region), hour, minute)) return false;
    return blitToFrame(frame, frame_size, region, sizeof(region));
}

} // namespace kidboard
