/**
 * 热点配网门户（D-014）宿主机测试：表单解析、热点名、状态 JSON、凭证交接、配网画面。
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

#include "network/wifi_portal.h"
#include "ui/pairing_screen.h"

using namespace kidboard;

static int blackPixels(const uint8_t* buf, int y0, int y1) {
    int n = 0;
    for (int y = y0; y < y1; ++y)
        for (int x = 0; x < 800; ++x)
            if (!(buf[y * 100 + (x >> 3)] & (0x80 >> (x & 7)))) ++n;
    return n;
}

int main() {
    // 热点名：取硬件编号末 4 位，大写（屏幕字库只有大写）
    assert(WifiPortal::apSsidFor("KB-S3-A1B2C3D4") == "KIDBOARD-C3D4");
    assert(WifiPortal::apSsidFor("kb-s3-0011aabb") == "KIDBOARD-AABB");

    // URL 解码：'+' 与 %XX、UTF-8 中文、非法转义原样保留
    assert(WifiPortal::urlDecode("a+b%21") == "a b!");
    assert(WifiPortal::urlDecode("%E5%AE%B6") == "\xE5\xAE\xB6");
    assert(WifiPortal::urlDecode("100%") == "100%");
    assert(WifiPortal::urlDecode("%zz") == "%zz");

    // 表单字段
    std::string v;
    assert(WifiPortal::formField("ssid=My+Home&pass=p%26ss%3Dword", "ssid", v) && v == "My Home");
    assert(WifiPortal::formField("ssid=My+Home&pass=p%26ss%3Dword", "pass", v) && v == "p&ss=word");
    assert(WifiPortal::formField("ssid=x&pass=", "pass", v) && v.empty());
    assert(WifiPortal::formField("ssid=x&pass", "pass", v) && v.empty());
    assert(!WifiPortal::formField("ssid=x", "pass", v));
    assert(WifiPortal::formField("xssid=1&ssid=2", "ssid", v) && v == "2");

    // JSON
    assert(WifiPortal::jsonEscape("a\"b\\c\n") == "a\\\"b\\\\c\\u000a");
    assert(WifiPortal::statusJson(WifiPortal::Status::Failed, "Home", 201) ==
           "{\"state\":\"failed\",\"reason\":201,\"ssid\":\"Home\"}");

    // 网页提交 → 主循环取走（只取一次）→ 回报结果
    WifiPortal portal;
    assert(portal.start("KIDBOARD-C3D4") && portal.isActive());
    std::string s, p;
    assert(!portal.takeSubmitted(s, p));
    portal.submit("Home", "secret123");
    assert(portal.currentStatusJson().find("\"connecting\"") != std::string::npos);
    assert(portal.takeSubmitted(s, p) && s == "Home" && p == "secret123");
    assert(!portal.takeSubmitted(s, p));
    portal.setStatus(WifiPortal::Status::Connected, "Home");
    assert(portal.currentStatusJson() == "{\"state\":\"connected\",\"reason\":0,\"ssid\":\"Home\"}");
    portal.stop();
    assert(!portal.isActive());

    // 配网画面与离线提示：48,000 字节，有内容
    static uint8_t buf[PairingScreen::FRAME_BYTES];
    assert(PairingScreen::renderWifiPortalScreen(buf, sizeof(buf), "KIDBOARD-C3D4", true));
    assert(blackPixels(buf, 100, 300) > 1000);
    assert(PairingScreen::renderWifiSetupConfirmScreen(buf, sizeof(buf), "Ziroom"));
    assert(blackPixels(buf, 100, 400) > 1000);
    memset(buf, 0xFF, sizeof(buf));
    assert(PairingScreen::overlayOfflineHint(buf, sizeof(buf)));
    assert(blackPixels(buf, 0, 432) == 0);          // 上方内容保持不变
    assert(blackPixels(buf, 432, 480) > 30000);     // 按键栏变为黑底白字
    assert(!PairingScreen::overlayOfflineHint(buf, 100));
    static uint8_t buf2[PairingScreen::FRAME_BYTES];
    memset(buf2, 0xFF, sizeof(buf2));
    assert(PairingScreen::overlayOfflineHint(buf2, sizeof(buf2), false));
    assert(memcmp(buf, buf2, sizeof(buf)) != 0);    // "NOT SET UP" 与 "OFFLINE" 文案不同

    // 配网画面底部黑条（返回提示）在有无已保存 Wi-Fi 时都存在
    assert(PairingScreen::renderWifiPortalScreen(buf, sizeof(buf), "KIDBOARD-C3D4", false));
    assert(blackPixels(buf, 428, 468) > 25000);

    printf("WIFI PORTAL TESTS PASSED\n");
    return 0;
}
