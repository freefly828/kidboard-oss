#include "pairing_screen.h"
#include <cstring>
#include <cctype>

namespace kidboard {

static const uint8_t COLOR_WHITE = 1;
static const uint8_t COLOR_BLACK = 0;

// 标准 5x7 ASCII 字符点阵 (从 ASCII 32 空格 到 126 '~')
// 每个字符 5 字节，每字节为 1 列 (低 7 位表示 7 行)
static const uint8_t FONT_5X7[][5] = {
    {0x00, 0x00, 0x00, 0x00, 0x00}, // 32 ' '
    {0x00, 0x00, 0x5F, 0x00, 0x00}, // 33 '!'
    {0x00, 0x07, 0x00, 0x07, 0x00}, // 34 '"'
    {0x14, 0x7F, 0x14, 0x7F, 0x14}, // 35 '#'
    {0x24, 0x2A, 0x7F, 0x2A, 0x12}, // 36 '$'
    {0x23, 0x13, 0x08, 0x64, 0x62}, // 37 '%'
    {0x36, 0x49, 0x55, 0x22, 0x50}, // 38 '&'
    {0x00, 0x05, 0x03, 0x00, 0x00}, // 39 '''
    {0x00, 0x1C, 0x22, 0x41, 0x00}, // 40 '('
    {0x00, 0x41, 0x22, 0x1C, 0x00}, // 41 ')'
    {0x14, 0x08, 0x3E, 0x08, 0x14}, // 42 '*'
    {0x08, 0x08, 0x3E, 0x08, 0x08}, // 43 '+'
    {0x00, 0x50, 0x30, 0x00, 0x00}, // 44 ','
    {0x08, 0x08, 0x08, 0x08, 0x08}, // 45 '-'
    {0x00, 0x60, 0x60, 0x00, 0x00}, // 46 '.'
    {0x20, 0x10, 0x08, 0x04, 0x02}, // 47 '/'
    {0x3E, 0x51, 0x49, 0x45, 0x3E}, // 48 '0'
    {0x00, 0x42, 0x7F, 0x40, 0x00}, // 49 '1'
    {0x42, 0x61, 0x51, 0x49, 0x46}, // 50 '2'
    {0x21, 0x41, 0x45, 0x4B, 0x31}, // 51 '3'
    {0x18, 0x14, 0x12, 0x7F, 0x10}, // 52 '4'
    {0x27, 0x45, 0x45, 0x45, 0x39}, // 53 '5'
    {0x3C, 0x4A, 0x49, 0x49, 0x30}, // 54 '6'
    {0x01, 0x71, 0x09, 0x05, 0x03}, // 55 '7'
    {0x36, 0x49, 0x49, 0x49, 0x36}, // 56 '8'
    {0x06, 0x49, 0x49, 0x29, 0x1E}, // 57 '9'
    {0x00, 0x36, 0x36, 0x00, 0x00}, // 58 ':'
    {0x00, 0x56, 0x36, 0x00, 0x00}, // 59 ';'
    {0x08, 0x14, 0x22, 0x41, 0x00}, // 60 '<'
    {0x14, 0x14, 0x14, 0x14, 0x14}, // 61 '='
    {0x00, 0x41, 0x22, 0x14, 0x08}, // 62 '>'
    {0x02, 0x01, 0x51, 0x09, 0x06}, // 63 '?'
    {0x32, 0x49, 0x79, 0x41, 0x3E}, // 64 '@'
    {0x7E, 0x11, 0x11, 0x11, 0x7E}, // 65 'A'
    {0x7F, 0x49, 0x49, 0x49, 0x36}, // 66 'B'
    {0x3E, 0x41, 0x41, 0x41, 0x22}, // 67 'C'
    {0x7F, 0x41, 0x41, 0x22, 0x1C}, // 68 'D'
    {0x7F, 0x49, 0x49, 0x49, 0x41}, // 69 'E'
    {0x7F, 0x09, 0x09, 0x09, 0x01}, // 70 'F'
    {0x3E, 0x41, 0x49, 0x49, 0x7A}, // 71 'G'
    {0x7F, 0x08, 0x08, 0x08, 0x7F}, // 72 'H'
    {0x00, 0x41, 0x7F, 0x41, 0x00}, // 73 'I'
    {0x20, 0x40, 0x41, 0x3F, 0x01}, // 74 'J'
    {0x7F, 0x08, 0x14, 0x22, 0x41}, // 75 'K'
    {0x7F, 0x40, 0x40, 0x40, 0x40}, // 76 'L'
    {0x7F, 0x02, 0x0C, 0x02, 0x7F}, // 77 'M'
    {0x7F, 0x04, 0x08, 0x10, 0x7F}, // 78 'N'
    {0x3E, 0x41, 0x41, 0x41, 0x3E}, // 79 'O'
    {0x7F, 0x09, 0x09, 0x09, 0x06}, // 80 'P'
    {0x3E, 0x41, 0x51, 0x21, 0x5E}, // 81 'Q'
    {0x7F, 0x09, 0x19, 0x29, 0x46}, // 82 'R'
    {0x46, 0x49, 0x49, 0x49, 0x31}, // 83 'S'
    {0x01, 0x01, 0x7F, 0x01, 0x01}, // 84 'T'
    {0x3F, 0x40, 0x40, 0x40, 0x3F}, // 85 'U'
    {0x1F, 0x20, 0x40, 0x20, 0x1F}, // 86 'V'
    {0x3F, 0x40, 0x38, 0x40, 0x3F}, // 87 'W'
    {0x63, 0x14, 0x08, 0x14, 0x63}, // 88 'X'
    {0x07, 0x08, 0x70, 0x08, 0x07}, // 89 'Y'
    {0x61, 0x51, 0x49, 0x45, 0x43}, // 90 'Z'
    {0x00, 0x7F, 0x41, 0x41, 0x00}, // 91 '['
    {0x02, 0x04, 0x08, 0x10, 0x20}, // 92 '\'
    {0x00, 0x41, 0x41, 0x7F, 0x00}, // 93 ']'
    {0x04, 0x02, 0x01, 0x02, 0x04}, // 94 '^'
    {0x40, 0x40, 0x40, 0x40, 0x40}, // 95 '_'
    {0x00, 0x01, 0x02, 0x04, 0x00}, // 96 '`'
};

void PairingScreen::clearScreen(uint8_t* buf, uint8_t color) {
    memset(buf, color ? 0xFF : 0x00, FRAME_BYTES);
}

void PairingScreen::setPixel(uint8_t* buf, int x, int y, uint8_t color) {
    if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return;
    size_t idx = static_cast<size_t>(y) * (SCREEN_WIDTH / 8) + (x >> 3);
    uint8_t mask = 0x80 >> (x & 7);
    if (color) {
        buf[idx] |= mask;
    } else {
        buf[idx] &= ~mask;
    }
}

void PairingScreen::drawRect(uint8_t* buf, int x, int y, int w, int h, uint8_t color) {
    for (int i = x; i < x + w; ++i) {
        setPixel(buf, i, y, color);
        setPixel(buf, i, y + h - 1, color);
    }
    for (int j = y; j < y + h; ++j) {
        setPixel(buf, x, j, color);
        setPixel(buf, x + w - 1, j, color);
    }
}

void PairingScreen::fillRect(uint8_t* buf, int x, int y, int w, int h, uint8_t color) {
    for (int j = y; j < y + h; ++j) {
        for (int i = x; i < x + w; ++i) {
            setPixel(buf, i, j, color);
        }
    }
}

void PairingScreen::drawChar(uint8_t* buf, int x, int y, char c, int scale, uint8_t color) {
    c = toupper(static_cast<unsigned char>(c));
    if (c < 32 || c > 96) c = ' ';
    const uint8_t* col_data = FONT_5X7[c - 32];

    for (int col = 0; col < 5; ++col) {
        uint8_t bits = col_data[col];
        for (int row = 0; row < 7; ++row) {
            if (bits & (1 << row)) {
                if (scale == 1) {
                    setPixel(buf, x + col, y + row, color);
                } else {
                    fillRect(buf, x + col * scale, y + row * scale, scale, scale, color);
                }
            }
        }
    }
}

void PairingScreen::drawString(uint8_t* buf, int x, int y, const char* str, int scale, uint8_t color) {
    int cur_x = x;
    while (*str) {
        drawChar(buf, cur_x, y, *str, scale, color);
        cur_x += 6 * scale; // 5 宽 + 1 间距
        str++;
    }
}

void PairingScreen::drawCenteredString(uint8_t* buf, int center_x, int y, const char* str, int scale, uint8_t color) {
    size_t len = strlen(str);
    int total_width = static_cast<int>(len) * 6 * scale;
    int start_x = center_x - total_width / 2;
    drawString(buf, start_x, y, str, scale, color);
}

bool PairingScreen::renderPairingScreen(uint8_t* out_buffer,
                                       size_t buffer_size,
                                       const std::string& hardware_id,
                                       const std::string& code,
                                       const std::string& expires_at) {
    (void)expires_at;
    if (!out_buffer || buffer_size != FRAME_BYTES) return false;

    // 1. 全屏填充为白色 (1=white)
    clearScreen(out_buffer, COLOR_WHITE);

    // 2. 双边框 (黑线 0=black)
    drawRect(out_buffer, 8, 8, 784, 464, COLOR_BLACK);
    drawRect(out_buffer, 10, 10, 780, 460, COLOR_BLACK);

    // 3. 顶部黑底白字 Banner
    fillRect(out_buffer, 12, 12, 776, 44, COLOR_BLACK);
    drawString(out_buffer, 28, 24, "KIDBOARD  |  DEVICE PAIRING MODE", 2, COLOR_WHITE);

    // 4. 硬件编号与状态条
    std::string hw_text = "HARDWARE ID: " + hardware_id;
    drawString(out_buffer, 30, 72, hw_text.c_str(), 2, COLOR_BLACK);
    drawString(out_buffer, 540, 72, "STATUS: WAITING CLAIM", 2, COLOR_BLACK);

    // 分隔线
    fillRect(out_buffer, 16, 102, 768, 2, COLOR_BLACK);

    // 5. 中央配对码展示卡片
    drawRect(out_buffer, 80, 122, 640, 150, COLOR_BLACK);
    drawRect(out_buffer, 82, 124, 636, 146, COLOR_BLACK);

    drawCenteredString(out_buffer, 400, 138, "DEVICE PAIRING CODE", 2, COLOR_BLACK);

    // 配对码格式化为带空格： "4  8  2  9  1  3"
    std::string formatted_code;
    for (size_t i = 0; i < code.length(); ++i) {
        formatted_code += code[i];
        if (i + 1 < code.length()) {
            formatted_code += "  ";
        }
    }

    // 6 倍超大字模居中显示
    drawCenteredString(out_buffer, 400, 180, formatted_code.c_str(), 6, COLOR_BLACK);

    // 6. 下方配对操作指南卡片
    drawRect(out_buffer, 80, 290, 640, 160, COLOR_BLACK);
    drawString(out_buffer, 104, 308, "HOW TO PAIR YOUR DEVICE:", 2, COLOR_BLACK);
    drawString(out_buffer, 104, 340, "1. OPEN BROWSER AND LOG IN TO KIDBOARD WEB APP", 2, COLOR_BLACK);
    drawString(out_buffer, 104, 370, "2. GO TO 'DEVICES' -> CLICK 'ADD / PAIR DEVICE'", 2, COLOR_BLACK);
    drawString(out_buffer, 104, 400, "3. ENTER THE 6-DIGIT CODE ABOVE TO COMPLETE BINDING", 2, COLOR_BLACK);
    drawString(out_buffer, 104, 430, "* PAIRING CODE VALID FOR 15 MINUTES. KEEP SCREEN POWERED.", 1, COLOR_BLACK);

    return true;
}

bool PairingScreen::renderResetScreen(uint8_t* out_buffer, size_t buffer_size) {
    if (!out_buffer || buffer_size != FRAME_BYTES) return false;

    clearScreen(out_buffer, COLOR_WHITE);

    // 双边框
    drawRect(out_buffer, 8, 8, 784, 464, COLOR_BLACK);
    drawRect(out_buffer, 10, 10, 780, 460, COLOR_BLACK);

    // 顶部 Banner
    fillRect(out_buffer, 12, 12, 776, 44, COLOR_BLACK);
    drawString(out_buffer, 28, 24, "KIDBOARD  |  FACTORY RESET", 2, COLOR_WHITE);

    // 中央提示框
    drawRect(out_buffer, 80, 140, 640, 200, COLOR_BLACK);
    drawRect(out_buffer, 82, 142, 636, 196, COLOR_BLACK);

    drawCenteredString(out_buffer, 400, 180, "FACTORY RESET COMPLETED", 3, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 230, "ALL WI-FI CREDENTIALS AND DEVICE TOKENS CLEARED", 2, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 270, "RESTARTING PROVISIONING SYSTEM...", 2, COLOR_BLACK);

    // 底部提示
    drawCenteredString(out_buffer, 400, 410, "DEVICE READY FOR RE-PROVISIONING AND PAIRING", 2, COLOR_BLACK);

    return true;
}

bool PairingScreen::renderWifiSetupConfirmScreen(uint8_t* out_buffer, size_t buffer_size,
                                                 const std::string& current_ssid) {
    if (!out_buffer || buffer_size != FRAME_BYTES) return false;
    clearScreen(out_buffer, COLOR_WHITE);
    drawRect(out_buffer, 8, 8, 784, 464, COLOR_BLACK);
    drawRect(out_buffer, 10, 10, 780, 460, COLOR_BLACK);
    fillRect(out_buffer, 12, 12, 776, 44, COLOR_BLACK);
    drawString(out_buffer, 28, 24, "KIDBOARD  |  CHANGE WI-FI", 2, COLOR_WHITE);

    drawCenteredString(out_buffer, 400, 120, "SET UP A NEW WI-FI?", 4, COLOR_BLACK);
    std::string cur = "CURRENT: " + (current_ssid.empty() ? std::string("(NONE)") : current_ssid);
    drawCenteredString(out_buffer, 400, 190, cur.c_str(), 2, COLOR_BLACK);

    drawRect(out_buffer, 120, 250, 560, 130, COLOR_BLACK);
    drawRect(out_buffer, 122, 252, 556, 126, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 275, "PRESS DONE  = START SETUP", 3, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 330, "NEXT / BACK = CANCEL", 3, COLOR_BLACK);

    drawCenteredString(out_buffer, 400, 420, "CANCELS AUTOMATICALLY IN 30 SECONDS", 2, COLOR_BLACK);
    return true;
}

bool PairingScreen::renderWifiPortalScreen(uint8_t* out_buffer, size_t buffer_size,
                                           const std::string& ap_ssid, bool has_saved_wifi) {
    if (!out_buffer || buffer_size != FRAME_BYTES) return false;
    clearScreen(out_buffer, COLOR_WHITE);
    drawRect(out_buffer, 8, 8, 784, 464, COLOR_BLACK);
    drawRect(out_buffer, 10, 10, 780, 460, COLOR_BLACK);
    fillRect(out_buffer, 12, 12, 776, 44, COLOR_BLACK);
    drawString(out_buffer, 28, 24, "KIDBOARD  |  WI-FI SETUP", 2, COLOR_WHITE);

    // 步骤 1：连热点（热点名最大号显示）
    drawString(out_buffer, 40, 80, "1. ON YOUR PHONE, JOIN THIS WI-FI:", 2, COLOR_BLACK);
    drawRect(out_buffer, 80, 108, 640, 76, COLOR_BLACK);
    drawRect(out_buffer, 82, 110, 636, 72, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 125, ap_ssid.c_str(), 6, COLOR_BLACK);

    // 步骤 2：打开网页
    drawString(out_buffer, 40, 204, "2. OPEN THE BROWSER AND GO TO:", 2, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 234, "192.168.4.1", 6, COLOR_BLACK);

    // 步骤 3：选网输密码
    drawString(out_buffer, 40, 304, "3. PICK YOUR HOME WI-FI (2.4GHZ ONLY) AND ENTER", 2, COLOR_BLACK);
    drawString(out_buffer, 40, 330, "   THE PASSWORD. THE PAGE SHOWS THE RESULT.", 2, COLOR_BLACK);

    fillRect(out_buffer, 16, 362, 768, 2, COLOR_BLACK);
    drawString(out_buffer, 40, 374, "* THE SETUP HOTSPOT HAS NO PASSWORD. PAIRING IS KEPT.", 2, COLOR_BLACK);
    if (has_saved_wifi) {
        drawString(out_buffer, 40, 400, "* CLOSES BY ITSELF AFTER 15 MINUTES WITHOUT SETUP.", 2, COLOR_BLACK);
    }

    // 返回提示：黑底白字整条，任何时候都能退出配网
    fillRect(out_buffer, 12, 426, 776, 44, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 437, "PRESS BACK OR NEXT TO RETURN", 3, COLOR_WHITE);
    return true;
}

bool PairingScreen::overlayOfflineHint(uint8_t* buffer, size_t buffer_size, bool configured) {
    if (!buffer || buffer_size != FRAME_BYTES) return false;
    fillRect(buffer, 0, 432, SCREEN_WIDTH, 48, COLOR_BLACK);
    drawCenteredString(buffer, 400, 442, configured ? "WI-FI OFFLINE" : "WI-FI NOT SET UP", 2, COLOR_WHITE);
    drawCenteredString(buffer, 400, 462, "HOLD BACK 5 SECONDS TO SET UP WI-FI", 2, COLOR_WHITE);
    return true;
}

bool PairingScreen::renderProvisioningScreen(uint8_t* out_buffer,
                                             size_t buffer_size,
                                             const std::string& prov_service_name,
                                             bool is_softap) {
    if (!out_buffer || buffer_size != FRAME_BYTES) return false;

    clearScreen(out_buffer, COLOR_WHITE);

    drawRect(out_buffer, 8, 8, 784, 464, COLOR_BLACK);
    drawRect(out_buffer, 10, 10, 780, 460, COLOR_BLACK);

    fillRect(out_buffer, 12, 12, 776, 44, COLOR_BLACK);
    drawString(out_buffer, 28, 24, "KIDBOARD  |  WI-FI PROVISIONING", 2, COLOR_WHITE);

    drawRect(out_buffer, 80, 120, 640, 220, COLOR_BLACK);
    drawCenteredString(out_buffer, 400, 150, "WAITING FOR WI-FI SETUP", 3, COLOR_BLACK);

    std::string mode_text = is_softap ? "MODE: SOFTAP CONFIGURATION" : "MODE: BLE PROVISIONING";
    drawCenteredString(out_buffer, 400, 200, mode_text.c_str(), 2, COLOR_BLACK);

    std::string srv_text = "SERVICE / SSID: " + prov_service_name;
    drawCenteredString(out_buffer, 400, 240, srv_text.c_str(), 2, COLOR_BLACK);

    drawCenteredString(out_buffer, 400, 280, "USE KIDBOARD APP TO CONFIGURE WI-FI CREDENTIALS", 2, COLOR_BLACK);

    drawCenteredString(out_buffer, 400, 400, "LONG PRESS DONE (10S) TO FACTORY RESET", 2, COLOR_BLACK);

    return true;
}

} // namespace kidboard
