#include "offline_event_queue.h"
#include "../board_config.h"
#include "../api_client/json_helper.h"
#include <cstdio>
#include <cstring>
#include <unistd.h>
#include <sys/stat.h>

#ifdef ESP_PLATFORM
#include "esp_log.h"
static const char* TAG = "EVENT_QUEUE";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[EVENT_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[EVENT_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[EVENT_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

OfflineEventQueue::OfflineEventQueue(const char* base_dir) {
    const char* base = (base_dir != nullptr && base_dir[0] != '\0') ? base_dir : BoardConfig::getFrameDirPath();
    snprintf(m_file_path, sizeof(m_file_path), "%s/events.json", base);
}

OfflineEventQueue::~OfflineEventQueue() = default;

bool OfflineEventQueue::init() {
    loadFromFile();
    LOGI("Offline event queue initialized (pending=%u, max=%u)",
         static_cast<unsigned>(m_events.size()), static_cast<unsigned>(MAX_QUEUE_SIZE));
    return true;
}

bool OfflineEventQueue::enqueue(const QueuedTaskEvent& event) {
    if (m_events.size() >= MAX_QUEUE_SIZE) {
        LOGE("Offline queue is full (max 100 events)!");
        return false;
    }

    // 防重复加入相同 eventId
    for (const auto& ev : m_events) {
        if (ev.event_id == event.event_id) {
            return true;
        }
    }

    m_events.push_back(event);
    saveToFile();
    LOGI("Enqueued task completion event: %s (task: %s, queue size: %u)",
         event.event_id.c_str(), event.task_occurrence_id.c_str(), static_cast<unsigned>(m_events.size()));
    return true;
}

bool OfflineEventQueue::peek(QueuedTaskEvent& out_event) const {
    if (m_events.empty()) return false;
    out_event = m_events.front();
    return true;
}

bool OfflineEventQueue::pop() {
    if (m_events.empty()) return false;
    m_events.erase(m_events.begin());
    saveToFile();
    return true;
}

size_t OfflineEventQueue::size() const {
    return m_events.size();
}

bool OfflineEventQueue::empty() const {
    return m_events.empty();
}

void OfflineEventQueue::clear() {
    m_events.clear();
    saveToFile();
}

bool OfflineEventQueue::saveToFile() {
    char tmp_path[140];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", m_file_path);

    FILE* f = fopen(tmp_path, "w");
    if (!f) {
        LOGE("Failed to open %s for saving offline events", tmp_path);
        return false;
    }

    fprintf(f, "[\n");
    for (size_t i = 0; i < m_events.size(); i++) {
        const auto& ev = m_events[i];
        fprintf(f, "  {\"eventId\":\"%s\",\"taskOccurrenceId\":\"%s\",\"frameVersion\":%d,\"occurredAt\":\"%s\",\"kind\":\"%s\",\"minutes\":%d}%s\n",
                ev.event_id.c_str(),
                ev.task_occurrence_id.c_str(),
                ev.frame_version,
                ev.occurred_at.c_str(),
                ev.kind.c_str(),
                ev.minutes,
                (i + 1 < m_events.size()) ? "," : "");
    }
    fprintf(f, "]\n");
    fclose(f);

    unlink(m_file_path);
    if (rename(tmp_path, m_file_path) != 0) {
        LOGE("Failed to atomic rename %s to %s", tmp_path, m_file_path);
        return false;
    }
    return true;
}

bool OfflineEventQueue::loadFromFile() {
    FILE* f = fopen(m_file_path, "r");
    if (!f) {
        return false; // 文件可能尚不存在
    }

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (sz <= 0 || sz > 1024 * 1024) {
        fclose(f);
        return false;
    }

    std::string content(sz, '\0');
    size_t read_bytes = fread(&content[0], 1, sz, f);
    fclose(f);
    content.resize(read_bytes);

    m_events.clear();

    // 简单高效提取 JSON 数组中的各对象
    size_t pos = 0;
    while (pos < content.length() && m_events.size() < MAX_QUEUE_SIZE) {
        size_t obj_start = content.find('{', pos);
        if (obj_start == std::string::npos) break;
        size_t obj_end = content.find('}', obj_start);
        if (obj_end == std::string::npos) break;

        std::string item = content.substr(obj_start, obj_end - obj_start + 1);
        QueuedTaskEvent ev;
        JsonHelper::extractStringField(item, "eventId", ev.event_id);
        JsonHelper::extractStringField(item, "taskOccurrenceId", ev.task_occurrence_id);
        JsonHelper::extractIntField(item, "frameVersion", ev.frame_version);
        JsonHelper::extractStringField(item, "occurredAt", ev.occurred_at);
        JsonHelper::extractStringField(item, "kind", ev.kind);  // 旧文件无 kind → 默认 task
        JsonHelper::extractIntField(item, "minutes", ev.minutes);
        if (ev.kind.empty()) ev.kind = "task";

        if (!ev.event_id.empty() && (ev.kind == "focus" ? ev.minutes > 0 : !ev.task_occurrence_id.empty())) {
            m_events.push_back(ev);
        }
        pos = obj_end + 1;
    }

    LOGI("Loaded %u events from %s", static_cast<unsigned>(m_events.size()), m_file_path);
    return true;
}

} // namespace kidboard
