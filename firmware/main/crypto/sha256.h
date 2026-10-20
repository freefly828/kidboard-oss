#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string>

namespace kidboard {

class Sha256 {
public:
    Sha256();
    void reset();
    void update(const uint8_t* data, size_t len);
    void update(const char* data, size_t len);
    void finalize(uint8_t hash[32]);
    std::string finalizeHex();

    static std::string hashHex(const uint8_t* data, size_t len);
    static std::string hashHex(const char* data, size_t len);
    static void hashBytes(const uint8_t* data, size_t len, uint8_t hash[32]);

private:
    void transform(const uint8_t block[64]);

    uint32_t m_state[8];
    uint64_t m_bit_count;
    uint8_t m_buffer[64];
    size_t m_buffer_len;
};

} // namespace kidboard
