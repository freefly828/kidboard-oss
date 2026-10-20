#pragma once

#include <stdint.h>
#include <functional>
#include "board_config.h"

namespace kidboard {

enum class ButtonType {
    Done,
    Next,
    Back
};

enum class ButtonAction {
    ShortPress,     // 短按（< 1 秒）
    MediumPress,    // 按住 1~5 秒（D-018 翻页）
    LongPress,      // 长按 5s (docs/07 §8)
    VeryLongPress   // 超长按 10s
};

using ButtonCallback = std::function<void(ButtonType type)>;
using ButtonEventCallback = std::function<void(ButtonType type, ButtonAction action)>;

class ButtonHandler {
public:
    ButtonHandler();
    ~ButtonHandler();

    bool init();
    void setCallback(ButtonCallback cb);
    void setEventCallback(ButtonEventCallback cb);
    void poll(); // 轮询按键消抖或定时器任务触发

    // 测试辅助注入
    void simulatePress(ButtonType type, uint32_t duration_ms = 100);

private:
    void handleRelease(ButtonType type, uint32_t duration_ms);

    ButtonCallback m_callback;
    ButtonEventCallback m_event_callback;

    uint32_t m_done_down_time_ms;
    uint32_t m_next_down_time_ms;
    uint32_t m_back_down_time_ms;

    bool m_done_pressed;
    bool m_next_pressed;
    bool m_back_pressed;
};

} // namespace kidboard
