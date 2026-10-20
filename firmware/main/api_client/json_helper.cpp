#include "json_helper.h"
#include <cstdio>
#include <cstdlib>
#include <cctype>
#include <sstream>

namespace kidboard {

/** 空串输出 JSON null：服务端 schema 中这些字段为 nullish，"" 会被判为非法（如 lastRefreshAt 必须是 ISO 时间） */
static std::string jsonStringOrNull(const std::string& v) {
    return v.empty() ? std::string("null") : ("\"" + v + "\"");
}

std::string JsonHelper::buildSyncRequestJson(const SyncTelemetry& t) {
    // 设备无 NTP 时钟，lastRefreshAt 通常为空 → null（真机实测："" 导致每次 sync 都 400）
    char buf[512];
    snprintf(buf, sizeof(buf),
        "{"
        "\"firmwareVersion\":\"%s\","
        "\"frameVersion\":%d,"
        "\"lastRefreshMode\":%s,"
        "\"lastRefreshAt\":%s,"
        "\"partialRefreshCount\":%d,"
        "\"rssi\":%d,"
        "\"uptimeSeconds\":%u,"
        "\"freeHeap\":%u,"
        "\"resetReason\":%s"
        "}",
        t.firmware_version.c_str(),
        t.frame_version,
        jsonStringOrNull(t.last_refresh_mode).c_str(),
        jsonStringOrNull(t.last_refresh_at).c_str(),
        t.partial_refresh_count,
        t.rssi,
        static_cast<unsigned>(t.uptime_seconds),
        static_cast<unsigned>(t.free_heap),
        jsonStringOrNull(t.reset_reason).c_str()
    );
    std::string out(buf);
    // D-016 可选传感器字段：插在结尾 } 之前
    char extra[160] = "";
    int n = 0;
    if (t.has_env) {
        n += snprintf(extra + n, sizeof(extra) - n, ",\"temperatureC\":%.1f,\"humidityPct\":%.1f",
                      static_cast<double>(t.temperature_c), static_cast<double>(t.humidity_pct));
    }
    if (t.has_battery && n >= 0 && n < static_cast<int>(sizeof(extra))) {
        snprintf(extra + n, sizeof(extra) - n, ",\"batteryMv\":%d,\"batteryPercent\":%d", t.battery_mv, t.battery_percent);
    }
    if (extra[0] && !out.empty() && out.back() == '}') out.insert(out.size() - 1, extra);
    return out;
}

static size_t findKeyPos(const std::string& json, const std::string& key) {
    std::string needle = "\"" + key + "\"";
    size_t pos = 0;
    // 只认"键"：引号串后紧跟冒号。同名的字符串值（如 "kind":"focus" 里的 "focus"）要跳过，
    // 否则会把后面真正的 "focus":{...} 错过（D-019 真实响应里 pages 就排在 focus 之前）
    while ((pos = json.find(needle, pos)) != std::string::npos) {
        size_t after = pos + needle.length();
        while (after < json.length() && isspace(static_cast<unsigned char>(json[after]))) after++;
        if (after < json.length() && json[after] == ':') {
            size_t val_start = after + 1;
            while (val_start < json.length() && isspace(static_cast<unsigned char>(json[val_start]))) {
                val_start++;
            }
            return val_start;
        }
        pos = after;
    }
    return std::string::npos;
}

bool JsonHelper::extractStringField(const std::string& json, const std::string& key, std::string& out_val) {
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length()) return false;

    if (json[start] == 'n' && json.compare(start, 4, "null") == 0) {
        out_val = "";
        return true;
    }

    if (json[start] != '"') return false;
    start++; // 跳过前双引号

    size_t end = json.find('"', start);
    if (end == std::string::npos) return false;

    out_val = json.substr(start, end - start);
    return true;
}

bool JsonHelper::extractIntField(const std::string& json, const std::string& key, int& out_val) {
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length()) return false;

    if (json[start] == 'n' && json.compare(start, 4, "null") == 0) {
        return false;
    }

    char* endptr = nullptr;
    long val = strtol(json.c_str() + start, &endptr, 10);
    if (endptr == json.c_str() + start) return false;

    out_val = static_cast<int>(val);
    return true;
}

bool JsonHelper::extractBoolField(const std::string& json, const std::string& key, bool& out_val) {
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length()) return false;

    if (json.compare(start, 4, "true") == 0) {
        out_val = true;
        return true;
    }
    if (json.compare(start, 5, "false") == 0) {
        out_val = false;
        return true;
    }
    return false;
}

bool JsonHelper::extractFloatField(const std::string& json, const std::string& key, float& out_val) {
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length()) return false;

    char* endptr = nullptr;
    float val = strtof(json.c_str() + start, &endptr);
    if (endptr == json.c_str() + start) return false;

    out_val = val;
    return true;
}

bool JsonHelper::extractJsonObject(const std::string& json, const std::string& key, std::string& out_obj) {
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length()) return false;

    if (json[start] == 'n' && json.compare(start, 4, "null") == 0) {
        return false;
    }
    if (json[start] != '{') return false;

    int brace_count = 0;
    size_t i = start;
    for (; i < json.length(); i++) {
        if (json[i] == '{') brace_count++;
        else if (json[i] == '}') {
            brace_count--;
            if (brace_count == 0) {
                out_obj = json.substr(start, i - start + 1);
                return true;
            }
        }
    }
    return false;
}

bool JsonHelper::extractJsonObjectArray(const std::string& json, const std::string& key, std::vector<std::string>& out_objs) {
    out_objs.clear();
    size_t start = findKeyPos(json, key);
    if (start == std::string::npos || start >= json.length() || json[start] != '[') return false;

    int depth = 0;
    bool in_string = false;
    size_t obj_start = std::string::npos;
    for (size_t i = start + 1; i < json.length(); i++) {
        char c = json[i];
        if (in_string) {
            if (c == '\\') { i++; continue; } // 跳过转义字符
            if (c == '"') in_string = false;
            continue;
        }
        if (c == '"') { in_string = true; continue; }
        if (c == '{') {
            if (depth == 0) obj_start = i;
            depth++;
        } else if (c == '}') {
            depth--;
            if (depth == 0 && obj_start != std::string::npos) {
                out_objs.push_back(json.substr(obj_start, i - obj_start + 1));
                obj_start = std::string::npos;
            }
        } else if (c == ']' && depth == 0) {
            return true;
        }
    }
    return false;
}

bool JsonHelper::parseSyncResponseJson(const std::string& json_str, SyncResponse& out_resp) {
    if (json_str.empty()) return false;

    // 1. 基础字段
    extractStringField(json_str, "serverTime", out_resp.server_time);
    out_resp.has_utc_offset = extractIntField(json_str, "utcOffsetMinutes", out_resp.utc_offset_minutes);
    extractIntField(json_str, "nextSyncSeconds", out_resp.next_sync_seconds);
    if (out_resp.next_sync_seconds <= 0) out_resp.next_sync_seconds = 30;

    // 2. desiredFrame 解析
    std::string frame_obj;
    if (extractJsonObject(json_str, "desiredFrame", frame_obj)) {
        out_resp.has_desired_frame = true;
        DesiredFrame& df = out_resp.desired_frame;

        extractIntField(frame_obj, "version", df.version);
        extractIntField(frame_obj, "width", df.width);
        extractIntField(frame_obj, "height", df.height);
        int bytes_val = 0;
        if (extractIntField(frame_obj, "bytes", bytes_val)) {
            df.bytes = static_cast<size_t>(bytes_val);
        }
        extractStringField(frame_obj, "sha256", df.sha256);
        extractStringField(frame_obj, "url", df.url);
        extractBoolField(frame_obj, "forceFullRefresh", df.force_full_refresh);

        // dirtyRect
        std::string dirty_obj;
        if (extractJsonObject(frame_obj, "dirtyRect", dirty_obj)) {
            df.has_dirty_rect = true;
            extractIntField(dirty_obj, "x", df.dirty_rect.x);
            extractIntField(dirty_obj, "y", df.dirty_rect.y);
            extractIntField(dirty_obj, "w", df.dirty_rect.w);
            extractIntField(dirty_obj, "h", df.dirty_rect.h);
        } else {
            df.has_dirty_rect = false;
        }
    } else {
        out_resp.has_desired_frame = false;
    }

    // 3. refreshPolicy
    std::string policy_obj;
    if (extractJsonObject(json_str, "refreshPolicy", policy_obj)) {
        extractBoolField(policy_obj, "partialEnabled", out_resp.refresh_policy.partial_enabled);
        extractIntField(policy_obj, "partialMaxCount", out_resp.refresh_policy.partial_max_count);
        extractIntField(policy_obj, "forceFullAfterHours", out_resp.refresh_policy.force_full_after_hours);
        extractFloatField(policy_obj, "partialAreaMaxRatio", out_resp.refresh_policy.partial_area_max_ratio);
    }

    // 4. interactiveTasks：按键 DONE/NEXT/BACK 绑定的今日任务（此前未解析，真机按键无任务可操作）
    std::vector<std::string> task_objs;
    out_resp.interactive_tasks.clear();
    if (extractJsonObjectArray(json_str, "interactiveTasks", task_objs)) {
        for (const auto& obj : task_objs) {
            InteractiveTask task;
            extractStringField(obj, "id", task.id);
            extractIntField(obj, "slot", task.slot);
            extractStringField(obj, "status", task.status);
            if (!task.id.empty()) out_resp.interactive_tasks.push_back(task);
        }
    }

    // 5. commands（D-017）：[{id, type, payload:{beeps}}]
    std::vector<std::string> cmd_objs;
    out_resp.commands.clear();
    if (extractJsonObjectArray(json_str, "commands", cmd_objs)) {
        for (const auto& obj : cmd_objs) {
            DeviceCommand cmd;
            extractStringField(obj, "id", cmd.id);
            extractStringField(obj, "type", cmd.type);
            extractIntField(obj, "beeps", cmd.beeps);
            if (!cmd.type.empty()) out_resp.commands.push_back(cmd);
        }
    }

    // 6. pages（D-018）：[{index, sha256, bytes, url}]
    std::vector<std::string> page_objs;
    out_resp.pages.clear();
    out_resp.has_pages = extractJsonObjectArray(json_str, "pages", page_objs);
    for (const auto& obj : page_objs) {
        PageRef p;
        extractIntField(obj, "index", p.index);
        extractStringField(obj, "kind", p.kind);
        extractStringField(obj, "sha256", p.sha256);
        extractStringField(obj, "url", p.url);
        if (p.index > 0 && !p.url.empty() && p.sha256.size() == 64) out_resp.pages.push_back(p);
    }

    // 7. focus（D-019）：{minutes, points}
    std::string focus_obj;
    out_resp.has_focus = extractJsonObject(json_str, "focus", focus_obj) && extractIntField(focus_obj, "minutes", out_resp.focus_minutes);

    // 8. ota manifest (docs/05 §7)
    std::string ota_obj;
    if (extractJsonObject(json_str, "ota", ota_obj)) {
        out_resp.has_ota = true;
        extractStringField(ota_obj, "version", out_resp.ota.version);
        extractStringField(ota_obj, "url", out_resp.ota.url);
        extractStringField(ota_obj, "sha256", out_resp.ota.sha256);
        extractBoolField(ota_obj, "mandatory", out_resp.ota.mandatory);
    } else {
        out_resp.has_ota = false;
    }

    out_resp.success = true;
    return true;
}


std::string JsonHelper::buildPairInitJson(const std::string& hardware_id, const std::string& device_nonce, const std::string& firmware_version) {
    char buf[512];
    snprintf(buf, sizeof(buf),
        "{"
        "\"hardwareId\":\"%s\","
        "\"deviceNonce\":\"%s\","
        "\"firmwareVersion\":\"%s\""
        "}",
        hardware_id.c_str(),
        device_nonce.c_str(),
        firmware_version.c_str()
    );
    return std::string(buf);
}

bool JsonHelper::parsePairInitResponseJson(const std::string& json_str, PairInitResponse& out_resp) {
    extractStringField(json_str, "pairingId", out_resp.pairing_id);
    extractStringField(json_str, "code", out_resp.code);
    extractStringField(json_str, "expiresAt", out_resp.expires_at);

    if (!out_resp.pairing_id.empty() && !out_resp.code.empty()) {
        out_resp.success = true;
        return true;
    }
    return false;
}

bool JsonHelper::parsePairStatusResponseJson(const std::string& json_str, PairStatusResponse& out_resp) {
    extractStringField(json_str, "status", out_resp.status);
    extractStringField(json_str, "token", out_resp.token);
    extractStringField(json_str, "deviceId", out_resp.device_id);

    if (!out_resp.status.empty()) {
        out_resp.success = true;
        return true;
    }
    return false;
}

} // namespace kidboard

