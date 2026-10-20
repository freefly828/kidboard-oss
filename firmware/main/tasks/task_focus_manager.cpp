#include "task_focus_manager.h"
#include <algorithm>

namespace kidboard {

TaskFocusManager::TaskFocusManager() : m_focus_index(0) {}

TaskFocusManager::~TaskFocusManager() = default;

void TaskFocusManager::updateTasks(const std::vector<InteractiveTask>& tasks) {
    std::string prev_focused_id = "";
    if (m_focus_index >= 0 && m_focus_index < static_cast<int>(m_tasks.size())) {
        prev_focused_id = m_tasks[m_focus_index].id;
    }

    m_tasks = tasks;

    if (m_tasks.empty()) {
        m_focus_index = 0;
        return;
    }

    // 优先保持之前聚焦且仍未完成的任务；否则落到第一条 pending——
    // 与服务端渲染帧的焦点规则（第一条 pending 前加 ">"）一致，DONE 完成的就是屏上标记的那条
    int new_index = -1;
    if (!prev_focused_id.empty()) {
        for (size_t i = 0; i < m_tasks.size(); i++) {
            if (m_tasks[i].id == prev_focused_id && m_tasks[i].status == "pending") {
                new_index = static_cast<int>(i);
                break;
            }
        }
    }
    if (new_index < 0) {
        for (size_t i = 0; i < m_tasks.size(); i++) {
            if (m_tasks[i].status == "pending") {
                new_index = static_cast<int>(i);
                break;
            }
        }
    }
    m_focus_index = new_index < 0 ? 0 : new_index;
}

bool TaskFocusManager::focusNext() {
    if (m_tasks.empty()) return false;
    m_focus_index = (m_focus_index + 1) % static_cast<int>(m_tasks.size());
    return true;
}

bool TaskFocusManager::focusPrevious() {
    if (m_tasks.empty()) return false;
    m_focus_index = (m_focus_index - 1 + static_cast<int>(m_tasks.size())) % static_cast<int>(m_tasks.size());
    return true;
}

bool TaskFocusManager::focusNextPending() {
    const int n = static_cast<int>(m_tasks.size());
    for (int step = 1; step <= n; ++step) {
        const int i = (m_focus_index + step) % n;
        if (m_tasks[i].status == "pending") {
            m_focus_index = i;
            return true;
        }
    }
    return false;
}

int TaskFocusManager::getFocusIndex() const {
    return m_focus_index;
}

int TaskFocusManager::getTaskCount() const {
    return static_cast<int>(m_tasks.size());
}

const InteractiveTask* TaskFocusManager::getFocusedTask() const {
    if (m_tasks.empty() || m_focus_index < 0 || m_focus_index >= static_cast<int>(m_tasks.size())) {
        return nullptr;
    }
    return &m_tasks[m_focus_index];
}

const std::vector<InteractiveTask>& TaskFocusManager::getTasks() const {
    return m_tasks;
}

bool TaskFocusManager::markTaskCompleted(const std::string& task_id) {
    for (auto& task : m_tasks) {
        if (task.id == task_id) {
            task.status = "completed";
            return true;
        }
    }
    return false;
}

} // namespace kidboard
