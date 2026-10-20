#include "pairing_client.h"
#include "board_config.h"
#include "../ui/pairing_screen.h"
#include <cstdio>
#include <cstring>
#include <vector>

#ifdef ESP_PLATFORM
#include "esp_log.h"
static const char* TAG = "PAIR_CLI";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[PAIR_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[PAIR_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[PAIR_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

PairingClient::PairingClient(ApiClient& api_client,
                             NvsManager& nvs_mgr,
                             IEpaperDisplay& display)
    : m_api_client(api_client),
      m_nvs_mgr(nvs_mgr),
      m_display(display) {
}

PairingClient::~PairingClient() = default;

bool PairingClient::init() {
    if (m_nvs_mgr.isPaired()) {
        std::string token = m_nvs_mgr.getDeviceToken();
        m_api_client.setDeviceToken(token);
        m_state = PairingClientState::Paired;
        LOGI("Device is already paired. Token configured.");
        return true;
    }

    m_state = PairingClientState::Unpaired;
    LOGI("Device is unpaired. Ready to initiate pairing flow.");
    return true;
}

bool PairingClient::requestPairingCode() {
    std::string hw_id = m_nvs_mgr.getHardwareId();
    std::string nonce = m_nvs_mgr.getDeviceNonce();

    LOGI("Requesting pairing code from server (hwId: %s)...", hw_id.c_str());

    PairInitResponse resp;
    if (!m_api_client.initPairing(hw_id, nonce, BoardConfig::firmwareVersion(), resp)) {
        LOGW("Failed to get pairing code: %s", resp.error_message.c_str());
        m_state = PairingClientState::Error;
        return false;
    }

    m_pairing_id = resp.pairing_id;
    m_code = resp.code;
    m_expires_at = resp.expires_at;

    LOGI("Pairing code received: [%s], pairingId=%s, expiresAt=%s",
         m_code.c_str(), m_pairing_id.c_str(), m_expires_at.c_str());

    m_state = PairingClientState::DisplayingCode;
    displayPairingScreen();
    m_state = PairingClientState::Polling;
    return true;
}

bool PairingClient::displayPairingScreen() {
    LOGI("Rendering 6-digit pairing code [%s] on 800x480 e-paper...", m_code.c_str());

    std::vector<uint8_t> frame_buf(PairingScreen::FRAME_BYTES);
    if (!PairingScreen::renderPairingScreen(frame_buf.data(), frame_buf.size(),
                                            m_nvs_mgr.getHardwareId(), m_code, m_expires_at)) {
        LOGE("Failed to render pairing screen bitmap");
        return false;
    }

    m_display.show(frame_buf.data(), frame_buf.size(), RefreshMode::Full, nullptr);
    m_display.sleep();
    return true;
}

bool PairingClient::pollStatus() {
    PairStatusResponse resp;
    std::string nonce = m_nvs_mgr.getDeviceNonce();

    if (!m_api_client.pollPairingStatus(m_pairing_id, nonce, resp)) {
        // 404/410：服务端已没有这条配对请求（被清理、服务器换库等），屏幕上的码已失效 → 立即换新码
        if (resp.status_code == 404 || resp.status_code == 410) {
            LOGW("Pairing request no longer exists on server (HTTP %d). Requesting a new code.", resp.status_code);
            m_state = PairingClientState::Expired;
            return false;
        }
        LOGW("Pairing status poll failed (network/server glitch)");
        return false;
    }

    if (resp.status == "paired") {
        LOGI(">> PAIRING SUCCESSFUL! Device claimed by parent.");
        if (!resp.token.empty()) {
            m_nvs_mgr.setDeviceToken(resp.token);
            m_api_client.setDeviceToken(resp.token);
            LOGI("Device token persisted to NVS.");
        }
        m_state = PairingClientState::Paired;
        return true;
    } else if (resp.status == "expired") {
        LOGW("Pairing code expired. Returning to Unpaired state to renew code.");
        m_state = PairingClientState::Expired;
        return false;
    }

    // status == "pending"
    return false;
}

bool PairingClient::step(uint32_t now_ms) {
    if (m_state == PairingClientState::Paired) {
        return true;
    }

    switch (m_state) {
        case PairingClientState::Unpaired:
        case PairingClientState::Expired:
            if (now_ms - m_last_retry_ms >= RETRY_INTERVAL_MS || m_last_retry_ms == 0) {
                m_last_retry_ms = now_ms;
                requestPairingCode();
            }
            break;

        case PairingClientState::Polling:
            // 兜底：配对码 15 分钟有效，轮询超过上限仍未认领（含长期拿不到服务端状态）→ 换新码
            if (now_ms - m_last_retry_ms >= CODE_LIFETIME_MS) {
                LOGW("Pairing code shown for too long without claim. Requesting a new code.");
                m_state = PairingClientState::Expired;
                break;
            }
            if (now_ms - m_last_poll_ms >= POLL_INTERVAL_MS) {
                m_last_poll_ms = now_ms;
                if (pollStatus()) {
                    return true;
                }
            }
            break;

        case PairingClientState::Error:
            if (now_ms - m_last_retry_ms >= RETRY_INTERVAL_MS) {
                m_last_retry_ms = now_ms;
                m_state = PairingClientState::Unpaired;
            }
            break;

        default:
            break;
    }

    return (m_state == PairingClientState::Paired);
}

PairingClientState PairingClient::getState() const {
    return m_state;
}

bool PairingClient::isPaired() const {
    return (m_state == PairingClientState::Paired);
}

const std::string& PairingClient::getPairingCode() const {
    return m_code;
}

const std::string& PairingClient::getPairingId() const {
    return m_pairing_id;
}

const std::string& PairingClient::getExpiresAt() const {
    return m_expires_at;
}

void PairingClient::resetPairing() {
    m_state = PairingClientState::Unpaired;
    m_pairing_id.clear();
    m_code.clear();
    m_expires_at.clear();
    m_last_poll_ms = 0;
    m_last_retry_ms = 0;
}

} // namespace kidboard
