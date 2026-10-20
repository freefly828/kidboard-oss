#pragma once

#include <string>

namespace kidboard {

class Uuid {
public:
    // 生成标准 RFC 4122 v4 UUID (例如 "f47ac10b-58cc-4372-a567-0e02b2c3d479")
    static std::string generateV4();

    // 校验字符串是否为合法 UUIDv4 格式
    static bool isValidV4(const std::string& uuid_str);
};

} // namespace kidboard
