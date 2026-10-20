#pragma once

#include <mutex>
#include <string>

namespace kidboard {

/**
 * 热点 + 网页配网门户（D-014）。
 *
 * 设备开出开放式热点 KIDBOARD-XXXX，手机连上后浏览器打开 http://192.168.4.1
 * （DNS 全部解析到 192.168.4.1，多数手机会自动弹出该页面）：扫描附近 Wi-Fi、
 * 选择并输入密码。网页提交的凭证交给主循环去连接，连接结果再通过 setStatus()
 * 回报给网页轮询的 /status。
 *
 * 线程：HTTP/DNS 处理运行在各自任务中，与主循环之间只通过本类加锁的字段交接。
 */
class WifiPortal {
public:
    enum class Status { Idle, Connecting, Connected, Failed };

    WifiPortal() = default;
    ~WifiPortal();

    /** 启动 HTTP 服务与 DNS 劫持（热点由 WifiManager::startAccessPoint 负责） */
    bool start(const std::string& ap_ssid);
    void stop();
    bool isActive() const { return m_active; }
    const std::string& apSsid() const { return m_ap_ssid; }

    /** 主循环取走网页提交的凭证；没有新提交返回 false */
    bool takeSubmitted(std::string& ssid, std::string& password);

    /** 主循环回报连接结果；reason 为 Wi-Fi 断开原因码（失败时） */
    void setStatus(Status status, const std::string& ssid = "", int reason = 0);

    /* ---- 纯函数（宿主机可测） ---- */

    /** 硬件编号 KB-S3-A1B2C3D4 → 热点名 KIDBOARD-C3D4（屏幕字库只有大写） */
    static std::string apSsidFor(const std::string& hardware_id);
    /** application/x-www-form-urlencoded 解码（'+' → 空格，%XX） */
    static std::string urlDecode(const std::string& in);
    /** 从表单体中取某个字段并解码；不存在返回 false */
    static bool formField(const std::string& body, const char* key, std::string& out);
    /** JSON 字符串转义（SSID 可能含引号、反斜杠、控制字符） */
    static std::string jsonEscape(const std::string& in);
    /** /status 的 JSON */
    static std::string statusJson(Status status, const std::string& ssid, int reason);

    /** 供 HTTP 处理函数调用 */
    void submit(const std::string& ssid, const std::string& password);
    std::string currentStatusJson();

private:
    bool m_active = false;
    std::string m_ap_ssid;

    std::mutex m_mutex;
    bool m_has_submitted = false;
    std::string m_sub_ssid;
    std::string m_sub_password;
    Status m_status = Status::Idle;
    std::string m_status_ssid;
    int m_status_reason = 0;

    void* m_httpd = nullptr;     // httpd_handle_t
    void* m_dns_task = nullptr;  // TaskHandle_t
    int m_dns_sock = -1;
};

} // namespace kidboard
