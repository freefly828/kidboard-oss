#pragma once

#include <string>
#include <memory>
#include "device_api_types.h"
#include "http_transport.h"

namespace kidboard {

class ApiClient {
public:
    explicit ApiClient(std::shared_ptr<IHttpTransport> transport = nullptr);
    ~ApiClient();

    void setBaseUrl(const std::string& base_url);
    void setDeviceToken(const std::string& token);
    const std::string& getBaseUrl() const;
    const std::string& getDeviceToken() const;

    bool sync(const SyncTelemetry& telemetry, SyncResponse& out_response);
    bool downloadFrame(const std::string& url_or_path, uint8_t* out_buffer, size_t max_len, size_t* out_len);
    bool reportTaskComplete(const std::string& event_id,
                            const std::string& task_occurrence_id,
                            int frame_version,
                            const std::string& occurred_at,
                            TaskCompleteResponse& out_response);

    /** D-019 上报专注完成（POST /api/v1/device/events/focus-complete，eventId 幂等） */
    bool reportFocusComplete(const std::string& event_id, int minutes, const std::string& occurred_at,
                             TaskCompleteResponse& out_response);

    bool initPairing(const std::string& hardware_id,
                     const std::string& device_nonce,
                     const std::string& firmware_version,
                     PairInitResponse& out_response);

    bool pollPairingStatus(const std::string& pairing_id,
                           const std::string& device_nonce,
                           PairStatusResponse& out_response);


    void setTransport(std::shared_ptr<IHttpTransport> transport);

private:
    std::string buildFullUrl(const std::string& path_or_url) const;

    std::string m_base_url;
    std::string m_device_token;
    std::shared_ptr<IHttpTransport> m_transport;
};

} // namespace kidboard
