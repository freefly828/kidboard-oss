#include "uuid.h"
#include <cstdio>
#include <cstdint>
#include <cctype>

#ifdef ESP_PLATFORM
#include "esp_random.h"
#else
#include <random>
#include <chrono>
#endif

namespace kidboard {

std::string Uuid::generateV4() {
    uint8_t bytes[16];

#ifdef ESP_PLATFORM
    for (int i = 0; i < 4; i++) {
        uint32_t r = esp_random();
        bytes[i * 4]     = static_cast<uint8_t>(r & 0xFF);
        bytes[i * 4 + 1] = static_cast<uint8_t>((r >> 8) & 0xFF);
        bytes[i * 4 + 2] = static_cast<uint8_t>((r >> 16) & 0xFF);
        bytes[i * 4 + 3] = static_cast<uint8_t>((r >> 24) & 0xFF);
    }
#else
    static thread_local std::mt19937_64 rng(
        std::chrono::high_resolution_clock::now().time_since_epoch().count()
    );
    for (int i = 0; i < 2; i++) {
        uint64_t r = rng();
        for (int j = 0; j < 8; j++) {
            bytes[i * 8 + j] = static_cast<uint8_t>((r >> (j * 8)) & 0xFF);
        }
    }
#endif

    // RFC 4122: Version 4
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    // RFC 4122: Variant 1 (10xxxxxx)
    bytes[8] = (bytes[8] & 0x3F) | 0x80;

    char buf[37];
    snprintf(buf, sizeof(buf),
        "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    );

    return std::string(buf);
}

bool Uuid::isValidV4(const std::string& str) {
    if (str.length() != 36) return false;

    // xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    for (size_t i = 0; i < 36; i++) {
        char c = str[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else {
            if (!isxdigit(static_cast<unsigned char>(c))) return false;
        }
    }

    // Version must be '4'
    if (str[14] != '4') return false;

    // Variant must be 8, 9, a, b, A, B
    char var = tolower(static_cast<unsigned char>(str[19]));
    if (var != '8' && var != '9' && var != 'a' && var != 'b') {
        return false;
    }

    return true;
}

} // namespace kidboard
