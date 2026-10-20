#pragma once

namespace kidboard {

/**
 * 电池电量（D-016）：reTerminal E1001 电池经 10k/20k 分压接 GPIO1（ADC1_CH0），
 * 测量前拉高 GPIO21 打开分压。读数经同步遥测上报，后台显示电量并在低电时提醒家长。
 */
class BatteryMonitor {
public:
    /** 测量电池电压（mV，已乘分压比）；硬件不可用返回 false */
    bool read(int& millivolts);

    /* ---- 纯函数（宿主机可测） ---- */
    /** 锂电池电压 → 剩余电量百分比（轻载放电曲线，分段线性插值，0~100） */
    static int percentFromMillivolts(int millivolts);

private:
    bool m_ready = false;
    bool m_failed = false;
    bool m_settled = false;
    void* m_adc = nullptr;
    void* m_cali = nullptr;
};

} // namespace kidboard
