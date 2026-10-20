#include <cassert>
#include <cstdio>
#include <string>
#include <vector>
#include "../main/crypto/sha256.h"

using namespace kidboard;

int main() {
    printf("========================================\n");
    printf("  Testing SHA-256 Crypto Implementation \n");
    printf("========================================\n");

    // Test 1: Empty string
    std::string h1 = Sha256::hashHex("", 0);
    printf("Empty hash: %s\n", h1.c_str());
    assert(h1 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    // Test 2: "abc"
    std::string h2 = Sha256::hashHex("abc", 3);
    printf("'abc' hash: %s\n", h2.c_str());
    assert(h2 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    // Test 3: NIST 448-bit string
    const char* str3 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    std::string h3 = Sha256::hashHex(str3, 56);
    printf("NIST 448-bit hash: %s\n", h3.c_str());
    assert(h3 == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

    // Test 4: 48,000 bytes all 0xFF (blank screen in KidBoard contract)
    std::vector<uint8_t> blank_frame(48000, 0xFF);
    std::string h4 = Sha256::hashHex(blank_frame.data(), blank_frame.size());
    printf("48KB blank frame hash: %s\n", h4.c_str());
    assert(h4.length() == 64);

    // Test 5: Incremental streaming update vs one-shot
    Sha256 streamer;
    for (size_t i = 0; i < blank_frame.size(); i += 1024) {
        size_t chunk = std::min<size_t>(1024, blank_frame.size() - i);
        streamer.update(blank_frame.data() + i, chunk);
    }
    std::string h5 = streamer.finalizeHex();
    assert(h4 == h5);
    printf("Incremental streaming matches one-shot: PASS\n");

    printf("\nALL SHA-256 TESTS PASSED!\n");
    return 0;
}
