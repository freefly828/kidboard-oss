#include "focus_timer.h"

namespace kidboard {

void FocusTimer::setMinutes(int minutes) {
    if (minutes < 5) minutes = 5;
    if (minutes > 90) minutes = 90;
    m_minutes = minutes;
}

void FocusTimer::start(uint32_t now_ms) {
    m_run_minutes = m_minutes;
    m_elapsed_before_ms = 0;
    m_started_ms = now_ms;
    m_state = State::Running;
}

void FocusTimer::pause(uint32_t now_ms) {
    if (m_state != State::Running) return;
    m_elapsed_before_ms += now_ms - m_started_ms;
    m_state = State::Paused;
}

void FocusTimer::resume(uint32_t now_ms) {
    if (m_state != State::Paused) return;
    m_started_ms = now_ms;
    m_state = State::Running;
}

void FocusTimer::reset() {
    m_state = State::Idle;
    m_elapsed_before_ms = 0;
}

int FocusTimer::remainingSec(uint32_t now_ms) const {
    const int64_t total_ms = static_cast<int64_t>(m_run_minutes) * 60 * 1000;
    switch (m_state) {
        case State::Idle:
            return m_minutes * 60;
        case State::Done:
            return 0;
        case State::Paused: {
            int64_t left = total_ms - m_elapsed_before_ms;
            return left <= 0 ? 0 : static_cast<int>((left + 999) / 1000);
        }
        case State::Running: {
            int64_t left = total_ms - m_elapsed_before_ms - static_cast<int64_t>(now_ms - m_started_ms);
            return left <= 0 ? 0 : static_cast<int>((left + 999) / 1000);
        }
    }
    return 0;
}

bool FocusTimer::tick(uint32_t now_ms) {
    if (m_state != State::Running) return false;
    if (remainingSec(now_ms) > 0) return false;
    m_state = State::Done;
    return true;
}

int FocusTimer::quantize(int remaining_sec) {
    if (remaining_sec <= 0) return 0;
    if (remaining_sec > 60) return (remaining_sec + 59) / 60 * 60;
    return (remaining_sec + 14) / 15 * 15;
}

int FocusTimer::displaySec(uint32_t now_ms) const {
    return quantize(remainingSec(now_ms));
}

} // namespace kidboard
