#include "waveshare_7in5_v2.h"
#include <string.h>

#ifdef ESP_PLATFORM
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static const char* TAG = "EPAPER_7IN5";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#include <stdio.h>
#include <unistd.h>
#define LOGI(...) printf("[EPAPER_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[EPAPER_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[EPAPER_ERR] "  __VA_ARGS__); printf("\n")
#define pdMS_TO_TICKS(ms) (ms)
#define vTaskDelay(ticks) usleep((ticks) * 1000)
#endif

namespace kidboard {

// Waveshare 7.5inch V2 核心指令表
constexpr uint8_t CMD_PANEL_SETTING            = 0x00;
constexpr uint8_t CMD_POWER_SETTING            = 0x01;
constexpr uint8_t CMD_POWER_OFF                = 0x02;
constexpr uint8_t CMD_POWER_ON                 = 0x04;
constexpr uint8_t CMD_BOOSTER_SOFT_START       = 0x06;
constexpr uint8_t CMD_DEEP_SLEEP               = 0x07;
constexpr uint8_t CMD_DATA_START_TRANS_1       = 0x10;
constexpr uint8_t CMD_DUAL_SPI                 = 0x15;
constexpr uint8_t CMD_GET_STATUS               = 0x71;
constexpr uint8_t CMD_DISPLAY_REFRESH          = 0x12;
constexpr uint8_t CMD_DATA_START_TRANS_2       = 0x13;
constexpr uint8_t CMD_VCOM_DATA_INTERVAL_SET   = 0x50;
constexpr uint8_t CMD_TCON_SETTING             = 0x60;
constexpr uint8_t CMD_RESOLUTION_SETTING       = 0x61;
constexpr uint8_t CMD_PARTIAL_WINDOW           = 0x90;
constexpr uint8_t CMD_PARTIAL_IN               = 0x91;
constexpr uint8_t CMD_PARTIAL_OUT              = 0x92;
constexpr uint8_t CMD_CASCADE_SETTING          = 0xE0;
constexpr uint8_t CMD_FORCE_TEMPERATURE        = 0xE5;

Waveshare7in5V2::Waveshare7in5V2()
    : m_initialized(false), m_spi_active(false), m_spi_device(nullptr) {}

Waveshare7in5V2::~Waveshare7in5V2() {
    sleep();
}

void Waveshare7in5V2::resetHardware() {
    const auto& pins = BoardConfig::getPins();
#ifdef ESP_PLATFORM
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_rst), 1);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_rst), 0);
    vTaskDelay(pdMS_TO_TICKS(10)); // 5ms 在 E1001 真机上不足以完成复位（2026-10-09 实测）
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_rst), 1);
    vTaskDelay(pdMS_TO_TICKS(20));
#else
    (void)pins;
#endif
}

void Waveshare7in5V2::logBusyTimeline() {
#ifdef ESP_PLATFORM
    const auto& pins = BoardConfig::getPins();
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_rst), 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    int during_reset = readBusyPin();
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_rst), 1);
    constexpr int kSampleMs[] = {0, 10, 20, 50, 100, 200, 500};
    int levels[7];
    int elapsed = 0;
    for (int i = 0; i < 7; ++i) {
        if (kSampleMs[i] > elapsed) {
            vTaskDelay(pdMS_TO_TICKS(kSampleMs[i] - elapsed));
            elapsed = kSampleMs[i];
        }
        levels[i] = readBusyPin();
    }
    LOGW("DIAG BUSY timeline: rst_low=%d | after release 0ms=%d 10ms=%d 20ms=%d 50ms=%d 100ms=%d 200ms=%d 500ms=%d",
         during_reset, levels[0], levels[1], levels[2], levels[3], levels[4], levels[5], levels[6]);
#endif
}

bool Waveshare7in5V2::waitBusy(int timeout_ms) {
    const auto& pins = BoardConfig::getPins();
#ifdef ESP_PLATFORM
    if (m_ignore_busy) {
        // 诊断模式：BUSY 不可信，按固定时长等待（全刷约 3~4 秒）
        vTaskDelay(pdMS_TO_TICKS(timeout_ms >= 8000 ? 5000 : 300));
        return true;
    }

    int64_t start = esp_timer_get_time();
    int64_t timeout_us = static_cast<int64_t>(timeout_ms) * 1000;
    int busy_level = pins.epaper_busy_active_level;

    while (gpio_get_level(static_cast<gpio_num_t>(pins.epaper_busy)) == busy_level) {
        if (m_poll_status) {
            // Waveshare / ESPHome 7.5" V2 做法：等待期间反复发送 0x71 (Get Status)
            sendCommand(CMD_GET_STATUS);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
        if ((esp_timer_get_time() - start) > timeout_us) {
            LOGW("Busy timeout after %d ms", timeout_ms);
            return false;
        }
    }
    return true;
#else
    (void)pins;
    (void)timeout_ms;
    return true;
#endif
}

void Waveshare7in5V2::sendCommand(uint8_t cmd) {
    const auto& pins = BoardConfig::getPins();
#ifdef ESP_PLATFORM
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_dc), 0); // 0 = Command
    spi_transaction_t t;
    memset(&t, 0, sizeof(t));
    t.length = 8;
    t.tx_buffer = &cmd;
    spi_device_polling_transmit(static_cast<spi_device_handle_t>(m_spi_device), &t);
#else
    (void)pins;
    (void)cmd;
#endif
}

void Waveshare7in5V2::sendData(uint8_t data) {
    const auto& pins = BoardConfig::getPins();
#ifdef ESP_PLATFORM
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_dc), 1); // 1 = Data
    spi_transaction_t t;
    memset(&t, 0, sizeof(t));
    t.length = 8;
    t.tx_buffer = &data;
    spi_device_polling_transmit(static_cast<spi_device_handle_t>(m_spi_device), &t);
#else
    (void)pins;
    (void)data;
#endif
}

void Waveshare7in5V2::sendBuffer(const uint8_t* data, size_t len, bool invert) {
    const auto& pins = BoardConfig::getPins();
#ifdef ESP_PLATFORM
    gpio_set_level(static_cast<gpio_num_t>(pins.epaper_dc), 1); // 1 = Data

    // 分块发送避免超出单个 SPI 事务最大 DMA 限制 (4096 bytes)；取反时经 1KB 栈上中转
    constexpr size_t CHUNK_SIZE = 1024;
    uint8_t chunk[CHUNK_SIZE];
    size_t offset = 0;
    while (offset < len) {
        size_t to_send = (len - offset > CHUNK_SIZE) ? CHUNK_SIZE : (len - offset);
        const uint8_t* src = data + offset;
        if (invert) {
            for (size_t i = 0; i < to_send; ++i) chunk[i] = static_cast<uint8_t>(~src[i]);
            src = chunk;
        }
        spi_transaction_t t;
        memset(&t, 0, sizeof(t));
        t.length = to_send * 8;
        t.tx_buffer = src;
        spi_device_polling_transmit(static_cast<spi_device_handle_t>(m_spi_device), &t);
        offset += to_send;
    }
#else
    (void)pins;
    (void)data;
    (void)len;
    (void)invert;
#endif
}

bool Waveshare7in5V2::setupBus() {
    const auto& pins = BoardConfig::getPins();
    (void)pins;

#ifdef ESP_PLATFORM
    // 初始化 GPIO 控制引脚 (DC, RST, BUSY)
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pin_bit_mask = (1ULL << pins.epaper_dc) | (1ULL << pins.epaper_rst);
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&io_conf);

    // BUSY 引脚为输入
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << pins.epaper_busy);
    io_conf.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&io_conf);

    // 与屏共用 SCK/MOSI 的 SD 卡（reTerminal E1001）：先拉高其 CS 使之不响应总线
    if (pins.sd_cs >= 0) {
        gpio_config_t sd_cs_conf = {};
        sd_cs_conf.intr_type = GPIO_INTR_DISABLE;
        sd_cs_conf.mode = GPIO_MODE_OUTPUT;
        sd_cs_conf.pin_bit_mask = (1ULL << pins.sd_cs);
        sd_cs_conf.pull_up_en = GPIO_PULLUP_ENABLE;
        gpio_config(&sd_cs_conf);
        gpio_set_level(static_cast<gpio_num_t>(pins.sd_cs), 1);
    }

    // SPI 总线配置
    spi_bus_config_t buscfg = {};
    buscfg.mosi_io_num = pins.epaper_mosi;
    buscfg.miso_io_num = -1;
    buscfg.sclk_io_num = pins.epaper_sclk;
    buscfg.quadwp_io_num = -1;
    buscfg.quadhd_io_num = -1;
    buscfg.max_transfer_sz = 4096;

    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        LOGE("Failed to initialize SPI bus: %d", ret);
        return false;
    }

    // SPI Mode 0；4MHz 与 Zephyr reTerminal E1001 板级配置（mipi-max-frequency）一致
    spi_device_interface_config_t devcfg = {};
    devcfg.clock_speed_hz = 4 * 1000 * 1000;
    devcfg.mode = 0; // CPOL=0, CPHA=0
    devcfg.spics_io_num = pins.epaper_cs;
    devcfg.queue_size = 1;

    spi_device_handle_t handle;
    ret = spi_bus_add_device(SPI2_HOST, &devcfg, &handle);
    if (ret != ESP_OK) {
        LOGE("Failed to add SPI device: %d", ret);
        return false;
    }
    m_spi_device = handle;
#endif
    m_spi_active = true;
    return true;
}

int Waveshare7in5V2::readBusyPin() const {
#ifdef ESP_PLATFORM
    return gpio_get_level(static_cast<gpio_num_t>(BoardConfig::getPins().epaper_busy));
#else
    return 1;
#endif
}

bool Waveshare7in5V2::init() {
    // GPIO/SPI 只配置一次；sleep() 后再次 init() 只需复位 + 寄存器序列
    if (!m_spi_active && !setupBus()) {
        return false;
    }

    // 真机实测：冷启动后首次复位可能不足以唤醒控制器，BUSY 不释放时重新复位
    bool ready = false;
    for (int attempt = 1; attempt <= 3 && !ready; ++attempt) {
        resetHardware();
        ready = waitBusy(1000);
        if (!ready) {
            LOGW("BUSY still asserted after reset attempt %d", attempt);
        }
    }
    if (!ready) {
        LOGE("Epaper busy timeout during init reset (BUSY stuck at %d)", readBusyPin());
        logBusyTimeline();

        m_poll_status = true;
        if (waitBusy(3000)) {
            LOGW("DIAG: BUSY released only with 0x71 status polling; keeping it enabled");
        } else {
            m_poll_status = false;
#ifdef CONFIG_KB_EPAPER_DIAG_IGNORE_BUSY
            LOGW("DIAG: BUSY stuck at %d, IGNORING BUSY and using fixed delays (diagnostic build)",
                 readBusyPin());
            m_ignore_busy = true;
#else
            return false;
#endif
        }
    }

    // 面板寄存器上电初始化序列（UC8179 / GDEW075T7，参数对齐 Zephyr reterminal_e1001 板级配置）
    sendCommand(CMD_BOOSTER_SOFT_START);
    sendData(0x17);
    sendData(0x17);
    sendData(0x17);
    sendData(0x17);

    sendCommand(CMD_POWER_SETTING);
    sendData(0x07);
    sendData(0x07);
    sendData(0x3f);
    sendData(0x3f);

    sendCommand(CMD_POWER_ON);
    vTaskDelay(pdMS_TO_TICKS(100));
    if (!waitBusy()) {
        LOGE("Epaper busy timeout after power on");
        return false;
    }

    sendCommand(CMD_PANEL_SETTING);
    sendData(0x1F); // KW-3f, KWR-2F, BWROTP 0f, BWOTP 1f

    sendCommand(CMD_RESOLUTION_SETTING);
    sendData(0x03); // 800 width (0x0320)
    sendData(0x20);
    sendData(0x01); // 480 height (0x01E0)
    sendData(0xE0);

    sendCommand(CMD_DUAL_SPI);
    sendData(0x00);

    sendCommand(CMD_VCOM_DATA_INTERVAL_SET);
    sendData(0x10);
    sendData(0x07);

    sendCommand(CMD_TCON_SETTING);
    sendData(0x22);

    m_initialized = true;
    LOGI("UC8179 7.5inch e-Paper initialized (800x480)");
    return true;
}

bool Waveshare7in5V2::displayFrame(const uint8_t* frame, size_t len, RefreshMode mode, const DirtyRect* rect) {
    if (!m_initialized) {
        if (!init()) return false;
    }
    if (len != FRAME_BUFFER_BYTES) {
        LOGE("displayFrame: expected %u bytes, got %u", static_cast<unsigned>(FRAME_BUFFER_BYTES), static_cast<unsigned>(len));
        return false;
    }

    // D-025 真机（E1001 面板）结论：整屏局部刷新（1.3.2）与 0xE5=0x5A 快速全刷（1.3.3）都会出现
    // 反相/竖纹，画面几十秒内褪成灰白，不可用。整屏一律用 OTP 默认全刷波形，mode 只作日志
    (void)rect;

    // 传输图像数据到黑白 SRAM (0x13)。帧契约 1=white，而本面板在当前 CDI 设置下
    // 0x13 中 1=black，故逐字节取反（与 Waveshare 官方 V2 驱动一致；真机实测未取反时黑白颠倒）
    sendCommand(CMD_DATA_START_TRANS_2);
    sendBuffer(frame, len, /*invert=*/true);

    // 触发屏幕全刷/局刷
    sendCommand(CMD_DISPLAY_REFRESH);
    vTaskDelay(pdMS_TO_TICKS(100));

    // 等待刷新完成（全刷通常需要 2~4 秒）
    if (!waitBusy(8000)) {
        LOGW("Display refresh wait busy timeout");
        return false;
    }

    LOGI("Frame displayed successfully (%u bytes, mode=%d)", static_cast<unsigned>(len), static_cast<int>(mode));
    return true;
}

bool Waveshare7in5V2::displayWindow(const uint8_t* region, int x, int y, int w, int h, bool fast) {
    if (!region || x < 0 || y < 0 || w <= 0 || h <= 0 || (x % 8) != 0 || (w % 8) != 0 ||
        x + w > SCREEN_WIDTH || y + h > SCREEN_HEIGHT) {
        LOGE("displayWindow: bad window %d,%d %dx%d", x, y, w, h);
        return false;
    }
    if (!m_initialized) {
        if (!init()) return false;
    }

    // 局部刷新序列参照 Waveshare EPD_7in5_V2 Init_Part / Display_Part：CDI 0xA9 0x07，进入局部模式后设定窗口。
    // fast：固定温度值 0x6E 选用快速波形。D-028 真机照片：快速波形写的时钟/任务区在关机后几小时内
    // 褪成灰色或消失（整屏全刷的内容完好），所以需要断电后仍保持的窗口（任务区）不强制温度，
    // 由面板按实测温度选标准波形（每次 init() 都会复位控制器，上一次的强制温度不会残留）
    if (fast) {
        sendCommand(CMD_CASCADE_SETTING);
        sendData(0x02);
        sendCommand(CMD_FORCE_TEMPERATURE);
        sendData(0x6E);
    }

    sendCommand(CMD_VCOM_DATA_INTERVAL_SET);
    sendData(0xA9);
    sendData(0x07);

    sendCommand(CMD_PARTIAL_IN);
    sendCommand(CMD_PARTIAL_WINDOW);
    const int x_end = x + w - 1;
    const int y_end = y + h - 1;
    sendData(static_cast<uint8_t>(x >> 8));
    sendData(static_cast<uint8_t>(x & 0xFF));
    sendData(static_cast<uint8_t>(x_end >> 8));
    sendData(static_cast<uint8_t>(x_end & 0xFF));
    sendData(static_cast<uint8_t>(y >> 8));
    sendData(static_cast<uint8_t>(y & 0xFF));
    sendData(static_cast<uint8_t>(y_end >> 8));
    sendData(static_cast<uint8_t>(y_end & 0xFF));
    sendData(0x01);

    // 局部模式的 CDI 0xA9（DDX=01）与全刷的 0x10（DDX=00）数据极性相反：真机实测（2026-10-11）
    // 按全刷方式取反后窗口变成黑底白字，所以这里 0x13 直接写帧数据（1=white），不取反。
    // 面板深睡后 SRAM 丢失、"旧数据"未知：0x10 写新数据的反相，使窗口内每个像素都按目标值驱动一次
    const size_t len = static_cast<size_t>(w / 8) * static_cast<size_t>(h);
    sendCommand(CMD_DATA_START_TRANS_1);
    sendBuffer(region, len, /*invert=*/true);
    sendCommand(CMD_DATA_START_TRANS_2);
    sendBuffer(region, len, /*invert=*/false);

    sendCommand(CMD_DISPLAY_REFRESH);
    vTaskDelay(pdMS_TO_TICKS(50));
    bool ok = waitBusy(fast ? 3000 : 8000);
    sendCommand(CMD_PARTIAL_OUT);
    if (!ok) {
        LOGW("Partial refresh wait busy timeout (fast=%d)", fast ? 1 : 0);
    }
    return ok;
}

void Waveshare7in5V2::sleep() {
    if (!m_initialized) return;
    sendCommand(CMD_POWER_OFF);
    waitBusy(2000);
    sendCommand(CMD_DEEP_SLEEP);
    sendData(0xA5); // 校验码
    m_initialized = false;
    LOGI("Waveshare 7.5inch entered deep sleep");
}

} // namespace kidboard
