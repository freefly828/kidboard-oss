#pragma once

#include <stdint.h>
#include <stddef.h>

namespace kidboard {

struct DirtyRect {
    int x;
    int y;
    int w;
    int h;
};

enum class RefreshMode {
    Full,
    FastFull,
    Partial
};

class IEpaperDisplay {
public:
    virtual ~IEpaperDisplay() = default;
    virtual bool init() = 0;
    virtual bool show(const uint8_t* frame, size_t len,
                      RefreshMode mode,
                      const DirtyRect* rect) = 0;
    virtual void sleep() = 0;

    /**
     * D-015 局部刷新一个窗口（设备时钟）。region 为窗口内 1-bit 数据（1=white，行优先，
     * 每行 w/8 字节）；x、w 必须是 8 的倍数。不支持的实现返回 false，调用方改用整屏刷新。
     * fast=true 用强制高温的快速波形（约 0.5 秒，但驱动弱、不刷新后几小时内会褪色，适合
     * 每分钟都重画的时钟/倒计时）；fast=false 用面板实测温度的标准波形（窗口内闪 2~3 秒，
     * 画面断电后也能保持，用于任务区，D-028）。
     */
    virtual bool showWindow(const uint8_t* region, int x, int y, int w, int h, bool fast = true) {
        (void)region; (void)x; (void)y; (void)w; (void)h; (void)fast;
        return false;
    }
};

} // namespace kidboard
