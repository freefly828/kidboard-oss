#pragma once

#include <string>
#include <cstdint>
#include <memory>
#include "../api_client/api_client.h"
#include "../storage/nvs_manager.h"
#include "../epaper/epaper_interface.h"

namespace kidboard {

enum class PairingClientState {
    Unpaired,
    RequestingCode,
    DisplayingCode,
    Polling,
    Paired,
    Expired,
    Error
};

class PairingClient {
public:
    static constexpr uint32_t POLL_INTERVAL_MS = 3000; // 3 秒轮询一次认领状态

    PairingClient(ApiClient& api_client,
                  NvsManager& nvs_mgr,
                  IEpaperDisplay& display);
    ~PairingClient();

    bool init();

    /**
     * 驱动配对状态机 (docs/05 §2 Step B~D)
     * @param now_ms 当前系统时间戳 (毫秒)
     * @return 若已完成配对 (Paired) 返回 true
     */
    bool step(uint32_t now_ms);

    PairingClientState getState() const;
    bool isPaired() const;

    const std::string& getPairingCode() const;
    const std::string& getPairingId() const;
    const std::string& getExpiresAt() const;

    void resetPairing();

private:
    bool requestPairingCode();
    bool displayPairingScreen();
    bool pollStatus();

    ApiClient& m_api_client;
    NvsManager& m_nvs_mgr;
    IEpaperDisplay& m_display;


    PairingClientState m_state = PairingClientState::Unpaired;
    std::string m_pairing_id;
    std::string m_code;
    std::string m_expires_at;

    uint32_t m_last_poll_ms = 0;
    uint32_t m_last_retry_ms = 0;
    static constexpr uint32_t RETRY_INTERVAL_MS = 5000;
    /** 显示配对码后的最长轮询时间（服务端有效期 15 分钟，多留 1 分钟余量）；从申请配对码的时刻 m_last_retry_ms 起算 */
    static constexpr uint32_t CODE_LIFETIME_MS = 16 * 60 * 1000;
};

} // namespace kidboard
