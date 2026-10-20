#include "sha256.h"
#include <string.h>
#include <cstdio>

namespace kidboard {

static inline uint32_t rotr(uint32_t x, uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

static inline uint32_t ch(uint32_t x, uint32_t y, uint32_t z) {
    return (x & y) ^ (~x & z);
}

static inline uint32_t maj(uint32_t x, uint32_t y, uint32_t z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

static inline uint32_t sig0(uint32_t x) {
    return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}

static inline uint32_t sig1(uint32_t x) {
    return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}

static inline uint32_t theta0(uint32_t x) {
    return rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3);
}

static inline uint32_t theta1(uint32_t x) {
    return rotr(x, 17) ^ rotr(x, 19) ^ (x >> 10);
}

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

Sha256::Sha256() {
    reset();
}

void Sha256::reset() {
    m_state[0] = 0x6a09e667;
    m_state[1] = 0xbb67ae85;
    m_state[2] = 0x3c6ef372;
    m_state[3] = 0xa54ff53a;
    m_state[4] = 0x510e527f;
    m_state[5] = 0x9b05688c;
    m_state[6] = 0x1f83d9ab;
    m_state[7] = 0x5be0cd19;
    m_bit_count = 0;
    m_buffer_len = 0;
}

void Sha256::transform(const uint8_t block[64]) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) {
        w[i] = (static_cast<uint32_t>(block[i * 4]) << 24) |
               (static_cast<uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<uint32_t>(block[i * 4 + 2]) << 8) |
               (static_cast<uint32_t>(block[i * 4 + 3]));
    }
    for (int i = 16; i < 64; i++) {
        w[i] = theta1(w[i - 2]) + w[i - 7] + theta0(w[i - 15]) + w[i - 16];
    }

    uint32_t a = m_state[0];
    uint32_t b = m_state[1];
    uint32_t c = m_state[2];
    uint32_t d = m_state[3];
    uint32_t e = m_state[4];
    uint32_t f = m_state[5];
    uint32_t g = m_state[6];
    uint32_t h = m_state[7];

    for (int i = 0; i < 64; i++) {
        uint32_t t1 = h + sig1(e) + ch(e, f, g) + K[i] + w[i];
        uint32_t t2 = sig0(a) + maj(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = c;
        c = b;
        b = a;
        a = t1 + t2;
    }

    m_state[0] += a;
    m_state[1] += b;
    m_state[2] += c;
    m_state[3] += d;
    m_state[4] += e;
    m_state[5] += f;
    m_state[6] += g;
    m_state[7] += h;
}

void Sha256::update(const uint8_t* data, size_t len) {
    if (!data || len == 0) return;

    m_bit_count += static_cast<uint64_t>(len) * 8;

    while (len > 0) {
        size_t to_copy = 64 - m_buffer_len;
        if (to_copy > len) to_copy = len;

        memcpy(m_buffer + m_buffer_len, data, to_copy);
        m_buffer_len += to_copy;
        data += to_copy;
        len -= to_copy;

        if (m_buffer_len == 64) {
            transform(m_buffer);
            m_buffer_len = 0;
        }
    }
}

void Sha256::update(const char* data, size_t len) {
    update(reinterpret_cast<const uint8_t*>(data), len);
}

void Sha256::finalize(uint8_t hash[32]) {
    // Padding
    m_buffer[m_buffer_len++] = 0x80;

    if (m_buffer_len > 56) {
        memset(m_buffer + m_buffer_len, 0, 64 - m_buffer_len);
        transform(m_buffer);
        m_buffer_len = 0;
    }

    memset(m_buffer + m_buffer_len, 0, 56 - m_buffer_len);

    // Big-endian 64-bit length
    for (int i = 0; i < 8; i++) {
        m_buffer[56 + i] = static_cast<uint8_t>((m_bit_count >> (56 - i * 8)) & 0xFF);
    }
    transform(m_buffer);

    for (int i = 0; i < 8; i++) {
        hash[i * 4]     = static_cast<uint8_t>((m_state[i] >> 24) & 0xFF);
        hash[i * 4 + 1] = static_cast<uint8_t>((m_state[i] >> 16) & 0xFF);
        hash[i * 4 + 2] = static_cast<uint8_t>((m_state[i] >> 8) & 0xFF);
        hash[i * 4 + 3] = static_cast<uint8_t>(m_state[i] & 0xFF);
    }
}

std::string Sha256::finalizeHex() {
    uint8_t hash[32];
    finalize(hash);
    char hex[65];
    for (int i = 0; i < 32; i++) {
        snprintf(hex + i * 2, 3, "%02x", hash[i]);
    }
    hex[64] = '\0';
    return std::string(hex);
}

std::string Sha256::hashHex(const uint8_t* data, size_t len) {
    Sha256 sha;
    sha.update(data, len);
    return sha.finalizeHex();
}

std::string Sha256::hashHex(const char* data, size_t len) {
    return hashHex(reinterpret_cast<const uint8_t*>(data), len);
}

void Sha256::hashBytes(const uint8_t* data, size_t len, uint8_t hash[32]) {
    Sha256 sha;
    sha.update(data, len);
    sha.finalize(hash);
}

} // namespace kidboard
