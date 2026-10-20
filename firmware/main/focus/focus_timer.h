#pragma once

#include <cstdint>

namespace kidboard {

/**
 * 专注计时（D-019）状态机：Idle →(DONE) Running ⇄(DONE) Paused；BACK 结束回 Idle；
 * 倒计时到 0 → Done（蜂鸣、上报、发积分），再按 DONE 回 Idle。
 * 时间用主循环的毫秒计数（esp_timer），与墙钟无关，断网与对时都不影响计时。
 */
class FocusTimer {
public:
    enum class State { Idle, Running, Paused, Done };

    /** 设置每次时长（分钟，5~90）；进行中不生效，下次开始时使用 */
    void setMinutes(int minutes);
    int minutes() const { return m_minutes; }
    /** 本次（进行中 / 刚完成）计时的时长 */
    int runMinutes() const { return m_run_minutes; }

    State state() const { return m_state; }
    bool active() const { return m_state == State::Running || m_state == State::Paused; }

    void start(uint32_t now_ms);
    void pause(uint32_t now_ms);
    void resume(uint32_t now_ms);
    /** 结束 / 清除完成状态，回到 Idle */
    void reset();

    /** 推进；本次调用刚好完成时返回 true（只返回一次） */
    bool tick(uint32_t now_ms);

    /** 剩余秒数（Idle 为整段时长，Done 为 0） */
    int remainingSec(uint32_t now_ms) const;

    /** 屏幕上显示的秒数：剩余 >60 秒按整分钟向上取整，最后一分钟按 15 秒向上取整（减少局刷次数） */
    int displaySec(uint32_t now_ms) const;
    static int quantize(int remaining_sec);

private:
    State m_state = State::Idle;
    int m_minutes = 25;
    int m_run_minutes = 25;          // 本次计时的时长（开始时锁定）
    uint32_t m_started_ms = 0;       // 最近一次开始/继续的时刻
    uint32_t m_elapsed_before_ms = 0;  // 暂停前已累计的毫秒
};

} // namespace kidboard
