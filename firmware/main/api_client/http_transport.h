#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string>

namespace kidboard {

struct HttpResponse {
    int status_code = 0;
    std::string body;
    std::string error_msg;
    bool success = false;
};

class IHttpTransport {
public:
    virtual ~IHttpTransport() = default;

    virtual HttpResponse post(const std::string& url,
                              const std::string& auth_header,
                              const std::string& json_body) = 0;

    virtual HttpResponse get(const std::string& url,
                             const std::string& auth_header) = 0;

    virtual bool downloadBinary(const std::string& url,
                                const std::string& auth_header,
                                uint8_t* out_buffer,
                                size_t max_len,
                                size_t* out_len) = 0;
};

} // namespace kidboard
