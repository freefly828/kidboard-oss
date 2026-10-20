#pragma once

namespace kidboard {

/**
 * 状态指示灯（reTerminal E1001 绿色 LED，GPIO 见 BoardConfig::status_led，低电平点亮）。
 * - 常亮：固件运行正常
 * - 快闪：屏幕初始化/刷新失败（无串口时也能判断故障）
 * 闪烁由 esp_timer 后台驱动，不阻塞调用方；宿主机构建为空实现。
 */
class StatusLed {
public:
    /** 配置 GPIO 并点亮；重复调用无副作用 */
    static void init();

    /** true = 进入快闪（错误），false = 恢复常亮 */
    static void setError(bool error);

    static bool isError();
};

} // namespace kidboard
