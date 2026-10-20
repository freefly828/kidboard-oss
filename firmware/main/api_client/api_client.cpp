#include "api_client.h"
#include "json_helper.h"
#include <cstdio>
#include <cstring>

#ifdef ESP_PLATFORM
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
static const char* TAG = "API_CLIENT";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)

namespace kidboard {

class EspHttpTransport : public IHttpTransport {
public:
    HttpResponse post(const std::string& url, const std::string& auth_header, const std::string& json_body) override {
        return request(HTTP_METHOD_POST, url, auth_header, &json_body);
    }

    HttpResponse get(const std::string& url, const std::string& auth_header) override {
        return request(HTTP_METHOD_GET, url, auth_header, nullptr);
    }

private:
    // 响应体上限：Device API JSON 远小于此，防止异常响应耗尽内存
    static constexpr size_t kMaxBodyBytes = 16 * 1024;

    /**
     * open → write → fetch_headers → read 的流式请求。
     * 不能用 esp_http_client_perform() 再 read()：perform 会把响应体读完丢弃，
     * 之后 read 恒为 0（真机上所有 JSON 响应都会变成空串）。
     */
    static HttpResponse request(esp_http_client_method_t method, const std::string& url,
                                const std::string& auth_header, const std::string* body) {
        HttpResponse response;
        esp_http_client_config_t config = {};
        config.url = url.c_str();
        config.crt_bundle_attach = esp_crt_bundle_attach;
        config.timeout_ms = 10000;

        esp_http_client_handle_t client = esp_http_client_init(&config);
        if (!client) {
            response.error_msg = "Failed to init http client";
            return response;
        }

        esp_http_client_set_method(client, method);
        if (body != nullptr) {
            esp_http_client_set_header(client, "Content-Type", "application/json");
        }
        if (!auth_header.empty()) {
            esp_http_client_set_header(client, "Authorization", auth_header.c_str());
        }

        const int write_len = body ? static_cast<int>(body->size()) : 0;
        esp_err_t err = esp_http_client_open(client, write_len);
        if (err != ESP_OK) {
            response.error_msg = esp_err_to_name(err);
            LOGE("HTTP open %s failed: %s", url.c_str(), response.error_msg.c_str());
            esp_http_client_cleanup(client);
            return response;
        }

        if (write_len > 0 && esp_http_client_write(client, body->data(), write_len) != write_len) {
            response.error_msg = "Failed to write request body";
            LOGE("HTTP write %s failed", url.c_str());
            esp_http_client_close(client);
            esp_http_client_cleanup(client);
            return response;
        }

        if (esp_http_client_fetch_headers(client) < 0) {
            response.error_msg = "Failed to read response headers";
            LOGE("HTTP fetch headers %s failed", url.c_str());
            esp_http_client_close(client);
            esp_http_client_cleanup(client);
            return response;
        }

        response.status_code = esp_http_client_get_status_code(client);
        char buf[1024];
        int r = 0;
        while ((r = esp_http_client_read(client, buf, sizeof(buf))) > 0) {
            if (response.body.size() + static_cast<size_t>(r) > kMaxBodyBytes) {
                response.error_msg = "Response body too large";
                break;
            }
            response.body.append(buf, r);
        }
        response.success = response.error_msg.empty() &&
                           response.status_code >= 200 && response.status_code < 300;
        if (!response.success) {
            LOGW("HTTP %s -> %d %s", url.c_str(), response.status_code, response.error_msg.c_str());
        }

        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return response;
    }

public:
    bool downloadBinary(const std::string& url, const std::string& auth_header,
                        uint8_t* out_buffer, size_t max_len, size_t* out_len) override {
        if (!out_buffer || max_len == 0) return false;

        esp_http_client_config_t config = {};
        config.url = url.c_str();
        config.crt_bundle_attach = esp_crt_bundle_attach;
        config.timeout_ms = 15000;

        esp_http_client_handle_t client = esp_http_client_init(&config);
        if (!client) return false;

        esp_http_client_set_method(client, HTTP_METHOD_GET);
        if (!auth_header.empty()) {
            esp_http_client_set_header(client, "Authorization", auth_header.c_str());
        }

        esp_err_t err = esp_http_client_open(client, 0);
        if (err != ESP_OK) {
            LOGE("Failed to open HTTP connection: %s", esp_err_to_name(err));
            esp_http_client_cleanup(client);
            return false;
        }

        // 状态码须在 fetch_headers 之后读取，否则恒为 0
        int content_len = esp_http_client_fetch_headers(client);
        int status = esp_http_client_get_status_code(client);
        if (content_len < 0 || status != 200) {
            LOGE("Download HTTP status: %d (content_len=%d)", status, content_len);
            esp_http_client_close(client);
            esp_http_client_cleanup(client);
            return false;
        }

        size_t total_read = 0;
        int read_bytes = 0;
        while (total_read < max_len) {
            read_bytes = esp_http_client_read(client, reinterpret_cast<char*>(out_buffer + total_read), max_len - total_read);
            if (read_bytes <= 0) break;
            total_read += read_bytes;
        }

        if (out_len) *out_len = total_read;
        esp_http_client_close(client);
        esp_http_client_cleanup(client);

        if (content_len > 0 && total_read != static_cast<size_t>(content_len)) {
            LOGE("Incomplete download: got %u of %d", static_cast<unsigned>(total_read), content_len);
            return false;
        }
        return true;
    }
};

} // namespace kidboard
#else
#define LOGI(...) printf("[API_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[API_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[API_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

ApiClient::ApiClient(std::shared_ptr<IHttpTransport> transport)
    : m_base_url(""), m_device_token(""), m_transport(std::move(transport)) {
#ifdef ESP_PLATFORM
    if (!m_transport) {
        m_transport = std::make_shared<EspHttpTransport>();
    }
#endif
}

ApiClient::~ApiClient() = default;

void ApiClient::setBaseUrl(const std::string& base_url) {
    m_base_url = base_url;
    // Strip trailing slash if present
    if (!m_base_url.empty() && m_base_url.back() == '/') {
        m_base_url.pop_back();
    }
}

void ApiClient::setDeviceToken(const std::string& token) {
    m_device_token = token;
}

const std::string& ApiClient::getBaseUrl() const {
    return m_base_url;
}

const std::string& ApiClient::getDeviceToken() const {
    return m_device_token;
}

void ApiClient::setTransport(std::shared_ptr<IHttpTransport> transport) {
    m_transport = std::move(transport);
}

std::string ApiClient::buildFullUrl(const std::string& path_or_url) const {
    if (path_or_url.rfind("http://", 0) == 0 || path_or_url.rfind("https://", 0) == 0) {
        return path_or_url;
    }
    if (path_or_url.empty() || path_or_url[0] != '/') {
        return m_base_url + "/" + path_or_url;
    }
    return m_base_url + path_or_url;
}

bool ApiClient::sync(const SyncTelemetry& telemetry, SyncResponse& out_response) {
    if (!m_transport) {
        out_response.error_message = "No HTTP transport configured";
        return false;
    }

    std::string url = buildFullUrl("/api/v1/device/sync");
    std::string auth = m_device_token.empty() ? "" : ("Device " + m_device_token);
    std::string req_json = JsonHelper::buildSyncRequestJson(telemetry);

    HttpResponse res = m_transport->post(url, auth, req_json);
    out_response.status_code = res.status_code;

    if (!res.success || res.status_code != 200) {
        out_response.success = false;
        out_response.error_message = res.error_msg.empty() ? ("HTTP " + std::to_string(res.status_code)) : res.error_msg;
        LOGW("Sync failed: %s", out_response.error_message.c_str());
        return false;
    }

    if (!JsonHelper::parseSyncResponseJson(res.body, out_response)) {
        out_response.success = false;
        out_response.error_message = "Failed to parse sync response JSON";
        LOGE("Failed to parse sync response: %s", res.body.c_str());
        return false;
    }

    return true;
}

bool ApiClient::downloadFrame(const std::string& url_or_path, uint8_t* out_buffer, size_t max_len, size_t* out_len) {
    if (!m_transport) return false;

    std::string url = buildFullUrl(url_or_path);
    std::string auth = m_device_token.empty() ? "" : ("Device " + m_device_token);
    return m_transport->downloadBinary(url, auth, out_buffer, max_len, out_len);
}

bool ApiClient::reportTaskComplete(const std::string& event_id,
                                   const std::string& task_occurrence_id,
                                   int frame_version,
                                   const std::string& occurred_at,
                                   TaskCompleteResponse& out_response) {
    if (!m_transport) {
        out_response.error_message = "No transport configured";
        return false;
    }

    std::string url = buildFullUrl("/api/v1/device/events/task-complete");
    std::string auth = m_device_token.empty() ? "" : ("Device " + m_device_token);

    // occurredAt 为 nullish ISO 时间；设备无时钟时为空串，必须发 null，否则服务端 400
    const std::string occurred_json = occurred_at.empty() ? std::string("null") : ("\"" + occurred_at + "\"");
    char buf[512];
    snprintf(buf, sizeof(buf),
        "{\"eventId\":\"%s\",\"frameVersion\":%d,\"taskOccurrenceId\":\"%s\",\"occurredAt\":%s}",
        event_id.c_str(), frame_version, task_occurrence_id.c_str(), occurred_json.c_str());

    HttpResponse res = m_transport->post(url, auth, std::string(buf));
    out_response.status_code = res.status_code;

    if (!res.success || res.status_code != 200) {
        out_response.success = false;
        out_response.error_message = res.error_msg.empty() ? ("HTTP " + std::to_string(res.status_code)) : res.error_msg;
        LOGW("reportTaskComplete failed: %s", out_response.error_message.c_str());
        return false;
    }

    out_response.success = true;
    JsonHelper::extractStringField(res.body, "status", out_response.status);
    JsonHelper::extractBoolField(res.body, "applied", out_response.applied);
    JsonHelper::extractBoolField(res.body, "idempotent", out_response.idempotent);
    LOGI("reportTaskComplete OK: applied=%d, idempotent=%d", out_response.applied, out_response.idempotent);
    return true;
}

bool ApiClient::reportFocusComplete(const std::string& event_id, int minutes, const std::string& occurred_at,
                                    TaskCompleteResponse& out_response) {
    if (!m_transport) {
        out_response.error_message = "No transport configured";
        return false;
    }
    std::string url = buildFullUrl("/api/v1/device/events/focus-complete");
    std::string auth = m_device_token.empty() ? "" : ("Device " + m_device_token);
    const std::string occurred_json = occurred_at.empty() ? std::string("null") : ("\"" + occurred_at + "\"");
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"eventId\":\"%s\",\"minutes\":%d,\"occurredAt\":%s}", event_id.c_str(), minutes,
             occurred_json.c_str());
    HttpResponse res = m_transport->post(url, auth, std::string(buf));
    out_response.status_code = res.status_code;
    if (!res.success || res.status_code != 200) {
        out_response.success = false;
        out_response.error_message = res.error_msg.empty() ? ("HTTP " + std::to_string(res.status_code)) : res.error_msg;
        LOGW("reportFocusComplete failed: %s", out_response.error_message.c_str());
        return false;
    }
    out_response.success = true;
    JsonHelper::extractBoolField(res.body, "applied", out_response.applied);
    JsonHelper::extractBoolField(res.body, "idempotent", out_response.idempotent);
    return true;
}

bool ApiClient::initPairing(const std::string& hardware_id,
                            const std::string& device_nonce,
                            const std::string& firmware_version,
                            PairInitResponse& out_response) {
    if (!m_transport) {
        out_response.error_message = "No transport configured";
        return false;
    }

    std::string url = buildFullUrl("/api/v1/device/pair/init");
    std::string body = JsonHelper::buildPairInitJson(hardware_id, device_nonce, firmware_version);

    HttpResponse res = m_transport->post(url, "", body);
    out_response.status_code = res.status_code;

    if (!res.success || res.status_code != 200) {
        out_response.success = false;
        out_response.error_message = res.error_msg.empty() ? ("HTTP " + std::to_string(res.status_code)) : res.error_msg;
        LOGW("initPairing failed: %s", out_response.error_message.c_str());
        return false;
    }

    if (!JsonHelper::parsePairInitResponseJson(res.body, out_response)) {
        out_response.success = false;
        out_response.error_message = "Failed to parse pair init response JSON";
        LOGE("Failed to parse pair init response: %s", res.body.c_str());
        return false;
    }

    out_response.success = true;
    LOGI("initPairing OK: pairingId=%s, code=%s, expiresAt=%s",
         out_response.pairing_id.c_str(), out_response.code.c_str(), out_response.expires_at.c_str());
    return true;
}

bool ApiClient::pollPairingStatus(const std::string& pairing_id,
                                  const std::string& device_nonce,
                                  PairStatusResponse& out_response) {
    if (!m_transport) {
        out_response.error_message = "No transport configured";
        return false;
    }

    std::string encoded_nonce;
    for (char c : device_nonce) {
        if (c == '+') encoded_nonce += "%2B";
        else if (c == '/') encoded_nonce += "%2F";
        else if (c == '=') encoded_nonce += "%3D";
        else encoded_nonce += c;
    }

    std::string path = "/api/v1/device/pair/" + pairing_id + "/status?nonce=" + encoded_nonce;
    std::string url = buildFullUrl(path);

    HttpResponse res = m_transport->get(url, "");
    out_response.status_code = res.status_code;

    if (!res.success || res.status_code != 200) {
        out_response.success = false;
        out_response.error_message = res.error_msg.empty() ? ("HTTP " + std::to_string(res.status_code)) : res.error_msg;
        LOGW("pollPairingStatus failed: %s", out_response.error_message.c_str());
        return false;
    }

    if (!JsonHelper::parsePairStatusResponseJson(res.body, out_response)) {
        out_response.success = false;
        out_response.error_message = "Failed to parse pair status response JSON";
        LOGE("Failed to parse pair status response: %s", res.body.c_str());
        return false;
    }

    out_response.success = true;
    return true;
}

} // namespace kidboard

