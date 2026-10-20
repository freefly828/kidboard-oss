#pragma once

#include <cstdint>
#include <cstddef>
#include <string>

namespace kidboard {

class PairingScreen {
public:
    static constexpr int SCREEN_WIDTH = 800;
    static constexpr int SCREEN_HEIGHT = 480;
    static constexpr size_t FRAME_BYTES = 48000;

    /**
     * 渲染设备配对界面 (800x480, 48,000 bytes, 1=white / 0=black)
     * 遵循 docs/05 §2 Step B: 设备在墨水屏显示 6 位码
     */
    static bool renderPairingScreen(uint8_t* out_buffer,
                                    size_t buffer_size,
                                    const std::string& hardware_id,
                                    const std::string& code,
                                    const std::string& expires_at);

    /**
     * 渲染设备恢复出厂设置提示界面 (docs/07 §14)
     */
    static bool renderResetScreen(uint8_t* out_buffer,
                                  size_t buffer_size);

    /**
     * 渲染配网模式等待画面 (docs/07 §3: 没有 Wi-Fi 凭证进入 provisioning)
     */
    static bool renderProvisioningScreen(uint8_t* out_buffer,
                                         size_t buffer_size,
                                         const std::string& prov_service_name,
                                         bool is_softap);

    /** D-014 长按 BACK 后的确认画面：DONE 开始配网，其它键取消 */
    static bool renderWifiSetupConfirmScreen(uint8_t* out_buffer, size_t buffer_size,
                                             const std::string& current_ssid);

    /**
     * D-014 热点配网画面：手机连热点 → 浏览器打开 192.168.4.1。
     * 底部黑条始终提示"按 BACK/NEXT 返回"；has_saved_wifi 时另提示 15 分钟自动关闭。
     */
    static bool renderWifiPortalScreen(uint8_t* out_buffer, size_t buffer_size,
                                       const std::string& ap_ssid, bool has_saved_wifi);

    /**
     * D-014 在当前画面底部按键栏（y>=432）覆盖提示，保留其余内容：
     * configured=true → "WI-FI OFFLINE"；false → "WI-FI NOT SET UP"（配网中途返回、尚无 Wi-Fi）
     */
    static bool overlayOfflineHint(uint8_t* buffer, size_t buffer_size, bool configured = true);

private:
    static void clearScreen(uint8_t* buf, uint8_t color);
    static void setPixel(uint8_t* buf, int x, int y, uint8_t color);
    static void drawRect(uint8_t* buf, int x, int y, int w, int h, uint8_t color);
    static void fillRect(uint8_t* buf, int x, int y, int w, int h, uint8_t color);
    static void drawChar(uint8_t* buf, int x, int y, char c, int scale, uint8_t color);
    static void drawString(uint8_t* buf, int x, int y, const char* str, int scale, uint8_t color);
    static void drawCenteredString(uint8_t* buf, int center_x, int y, const char* str, int scale, uint8_t color);
};

} // namespace kidboard
