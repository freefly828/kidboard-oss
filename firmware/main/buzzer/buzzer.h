#pragma once

#include <atomic>
#include <cstdint>

namespace kidboard {

/**
 * 蜂鸣器（D-017）：reTerminal E1001 无源蜂鸣器接 GPIO45，用 LEDC PWM 发声。
 *
 * 节拍由独立的 esp_timer 推进（不依赖主循环）：主循环在刷屏、联网时会阻塞数秒，
 * 若靠主循环开关，正好处于"响"的那段就会一直响到阻塞结束（真机实测专注完成时长响、按键也关不掉）。
 * stop() 立即静音（任意按键调用）。宿主机没有定时器，测试用 poll() 手动推进。
 */
class Buzzer {
public:
    enum class Pattern { Short, Long };

    bool init();
    /** 响 count 声（Short 每声 150 ms，Long 每声 600 ms，间隔 150 ms）；count ≤ 0 无效 */
    void beep(int count, Pattern pattern = Pattern::Short);
    /** 立即静音并取消剩余节拍 */
    void stop();
    /** 宿主机测试用：按时间推进节拍（ESP 上由定时器推进，调用无副作用） */
    void poll(uint32_t now_ms);
    bool isBusy() const { return m_remaining_edges.load() > 0 || m_on.load(); }

    /* ---- 纯函数（宿主机可测） ---- */
    static uint32_t segmentMs(Pattern pattern, bool on);

private:
    /** 切换一次开/关，返回这一段应保持的毫秒数；没有剩余节拍返回 0 */
    uint32_t advance();
    void setOn(bool on);
    static void onTimer(void* arg);

    bool m_ready = false;
    std::atomic<bool> m_on{false};
    std::atomic<int> m_remaining_edges{0};  // 剩余的开/关切换次数
    Pattern m_pattern = Pattern::Short;
    void* m_timer = nullptr;  // esp_timer_handle_t
    // 宿主机 poll() 用
    uint32_t m_next_ms = 0;
    bool m_started = false;
};

} // namespace kidboard
