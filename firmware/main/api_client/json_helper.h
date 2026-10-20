#pragma once

#include <string>
#include <vector>
#include "device_api_types.h"

namespace kidboard {

class JsonHelper {
public:
    static std::string buildSyncRequestJson(const SyncTelemetry& telemetry);
    static bool parseSyncResponseJson(const std::string& json_str, SyncResponse& out_resp);

    static std::string buildPairInitJson(const std::string& hardware_id, const std::string& device_nonce, const std::string& firmware_version);
    static bool parsePairInitResponseJson(const std::string& json_str, PairInitResponse& out_resp);
    static bool parsePairStatusResponseJson(const std::string& json_str, PairStatusResponse& out_resp);

    // 辅助安全提取方法
    static bool extractStringField(const std::string& json, const std::string& key, std::string& out_val);
    static bool extractIntField(const std::string& json, const std::string& key, int& out_val);
    static bool extractBoolField(const std::string& json, const std::string& key, bool& out_val);
    static bool extractFloatField(const std::string& json, const std::string& key, float& out_val);
    static bool extractJsonObject(const std::string& json, const std::string& key, std::string& out_obj);
    /** 提取 key 对应数组中的每个对象（仅支持对象数组；跳过字符串内的括号） */
    static bool extractJsonObjectArray(const std::string& json, const std::string& key, std::vector<std::string>& out_objs);
};

} // namespace kidboard
