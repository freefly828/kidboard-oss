#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string>
#include <vector>

namespace kidboard {

struct QueuedTaskEvent {
    std::string event_id;
    std::string task_occurrence_id;
    int frame_version = 0;
    std::string occurred_at;
    /** "task"（任务完成）或 "focus"（D-019 专注完成，minutes 为时长） */
    std::string kind = "task";
    int minutes = 0;
};

class OfflineEventQueue {
public:
    static constexpr size_t MAX_QUEUE_SIZE = 100;

    explicit OfflineEventQueue(const char* base_dir = nullptr);
    ~OfflineEventQueue();

    bool init();
    bool enqueue(const QueuedTaskEvent& event);
    bool peek(QueuedTaskEvent& out_event) const;
    bool pop();
    size_t size() const;
    bool empty() const;
    void clear();

    // 本地持久化 (docs/07 §9)
    bool saveToFile();
    bool loadFromFile();

private:
    std::vector<QueuedTaskEvent> m_events;
    char m_file_path[128];
};

} // namespace kidboard
