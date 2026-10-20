#pragma once

#include <string>
#include <vector>
#include "../api_client/device_api_types.h"

namespace kidboard {

class TaskFocusManager {
public:
    TaskFocusManager();
    ~TaskFocusManager();

    // 更新任务列表（从 SyncResponse::interactive_tasks 同步）
    void updateTasks(const std::vector<InteractiveTask>& tasks);

    // 焦点导航
    bool focusNext();
    bool focusPrevious();
    /** D-022 跳到下一个未完成任务（从当前位置往后找，循环）；没有则不动 */
    bool focusNextPending();

    // 状态查询
    int getFocusIndex() const;
    int getTaskCount() const;
    const InteractiveTask* getFocusedTask() const;
    const std::vector<InteractiveTask>& getTasks() const;

    // 本地标记完成
    bool markTaskCompleted(const std::string& task_id);

private:
    std::vector<InteractiveTask> m_tasks;
    int m_focus_index;
};

} // namespace kidboard
