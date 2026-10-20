#include "wifi_portal.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <vector>

#ifdef ESP_PLATFORM
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
static const char* TAG = "WIFI_PORTAL";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[PORTAL_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[PORTAL_WARN] " __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

/* ---------------- 纯函数 ---------------- */

std::string WifiPortal::apSsidFor(const std::string& hardware_id) {
    std::string tail = hardware_id.size() >= 4 ? hardware_id.substr(hardware_id.size() - 4) : hardware_id;
    for (auto& c : tail) c = static_cast<char>(toupper(static_cast<unsigned char>(c)));
    return "KIDBOARD-" + tail;
}

static int hexVal(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string WifiPortal::urlDecode(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        char c = in[i];
        if (c == '+') {
            out += ' ';
        } else if (c == '%' && i + 2 < in.size() && hexVal(in[i + 1]) >= 0 && hexVal(in[i + 2]) >= 0) {
            out += static_cast<char>(hexVal(in[i + 1]) * 16 + hexVal(in[i + 2]));
            i += 2;
        } else {
            out += c;
        }
    }
    return out;
}

bool WifiPortal::formField(const std::string& body, const char* key, std::string& out) {
    const size_t klen = strlen(key);
    size_t pos = 0;
    while (pos <= body.size()) {
        size_t end = body.find('&', pos);
        if (end == std::string::npos) end = body.size();
        if (end - pos > klen && body.compare(pos, klen, key) == 0 && body[pos + klen] == '=') {
            out = urlDecode(body.substr(pos + klen + 1, end - pos - klen - 1));
            return true;
        }
        if (end - pos == klen && body.compare(pos, klen, key) == 0) {
            out.clear();
            return true;
        }
        pos = end + 1;
    }
    return false;
}

std::string WifiPortal::jsonEscape(const std::string& in) {
    std::string out;
    for (unsigned char c : in) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            char buf[8];
            snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

std::string WifiPortal::statusJson(Status status, const std::string& ssid, int reason) {
    const char* s = "idle";
    switch (status) {
        case Status::Idle: s = "idle"; break;
        case Status::Connecting: s = "connecting"; break;
        case Status::Connected: s = "connected"; break;
        case Status::Failed: s = "failed"; break;
    }
    char head[64];
    snprintf(head, sizeof(head), "{\"state\":\"%s\",\"reason\":%d,\"ssid\":\"", s, reason);
    return std::string(head) + jsonEscape(ssid) + "\"}";
}

/* ---------------- 主循环交接 ---------------- */

void WifiPortal::submit(const std::string& ssid, const std::string& password) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_sub_ssid = ssid;
    m_sub_password = password;
    m_has_submitted = true;
    m_status = Status::Connecting;
    m_status_ssid = ssid;
    m_status_reason = 0;
}

bool WifiPortal::takeSubmitted(std::string& ssid, std::string& password) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_has_submitted) return false;
    ssid = m_sub_ssid;
    password = m_sub_password;
    m_has_submitted = false;
    m_sub_password.assign(m_sub_password.size(), '\0');
    m_sub_password.clear();
    return true;
}

void WifiPortal::setStatus(Status status, const std::string& ssid, int reason) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_status = status;
    if (!ssid.empty()) m_status_ssid = ssid;
    m_status_reason = reason;
}

std::string WifiPortal::currentStatusJson() {
    std::lock_guard<std::mutex> lock(m_mutex);
    return statusJson(m_status, m_status_ssid, m_status_reason);
}

WifiPortal::~WifiPortal() {
    stop();
}

#ifdef ESP_PLATFORM

/* ---------------- 网页 ---------------- */

static const char kPortalHtml[] = R"HTML(<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>KidBoard 配网</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f4f5f7;color:#222}
main{max-width:420px;margin:0 auto;padding:20px 16px}
h1{font-size:22px;margin:4px 0 4px}p.sub{margin:0 0 16px;color:#666;font-size:14px}
.card{background:#fff;border-radius:12px;padding:14px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.row{display:flex;justify-content:space-between;align-items:center}
#list button{display:flex;justify-content:space-between;width:100%;padding:12px 4px;border:0;border-bottom:1px solid #eee;background:none;font-size:16px;text-align:left}
#list button:last-child{border-bottom:0}#list small{color:#888}
label{display:block;font-size:14px;color:#555;margin:10px 0 4px}
input{width:100%;box-sizing:border-box;font-size:16px;padding:11px;border:1px solid #ccc;border-radius:8px}
.btn{width:100%;margin-top:14px;padding:13px;font-size:17px;border:0;border-radius:8px;background:#222;color:#fff}
.btn:disabled{background:#999}.link{border:0;background:none;color:#2563eb;font-size:14px}
#msg{margin-top:12px;font-size:15px;line-height:1.5}.ok{color:#15803d}.err{color:#b91c1c}
</style></head><body><main>
<h1>KidBoard 连接 Wi-Fi</h1><p class="sub">只支持 2.4GHz Wi-Fi。连接成功后，设备上的绑定关系不变。</p>
<div class="card"><div class="row"><b>附近的 Wi-Fi</b><button class="link" id="rescan">重新扫描</button></div>
<div id="list"><small>正在扫描…</small></div></div>
<div class="card"><label for="ssid">Wi-Fi 名称</label><input id="ssid" maxlength="32" autocomplete="off">
<label for="pass">密码（无密码可留空）</label><input id="pass" type="password" maxlength="64">
<label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="show" type="checkbox" style="width:auto">显示密码</label>
<button class="btn" id="go">连接</button><div id="msg"></div></div>
</main><script>
const $=id=>document.getElementById(id);
function esc(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function bars(r){return r>-55?"▂▄▆█":r>-67?"▂▄▆":r>-78?"▂▄":"▂"}
async function scan(){$("list").innerHTML="<small>正在扫描…</small>";
try{const r=await fetch("/scan");const a=await r.json();
$("list").innerHTML=a.length?a.map(x=>`<button data-s="${esc(x.s)}"><span>${esc(x.s)}</span><small>${x.l?"🔒 ":""}${bars(x.r)}</small></button>`).join(""):"<small>没有扫描到，请手动输入名称</small>";
document.querySelectorAll("#list button").forEach(b=>b.onclick=()=>{$("ssid").value=b.dataset.s;$("pass").focus()});
}catch(e){$("list").innerHTML="<small>扫描失败，请手动输入名称</small>"}}
const REASON={201:"找不到这个 Wi-Fi（只支持 2.4GHz，或名称有误）",15:"密码错误",204:"密码错误",2:"密码错误",202:"密码错误",203:"连接被路由器拒绝"};
function show(t,c){$("msg").className=c||"";$("msg").textContent=t}
let polling=null,started=0,lastOk=0;
async function poll(){try{const s=await(await fetch("/status",{cache:"no-store"})).json();lastOk=Date.now();
if(s.state==="connected"){clearInterval(polling);$("go").disabled=false;show("✅ 已连接「"+s.ssid+"」。设备热点即将关闭，手机会自动回到原来的网络。","ok")}
else if(s.state==="failed"){clearInterval(polling);$("go").disabled=false;show("❌ 连接失败："+(REASON[s.reason]||("原因码 "+s.reason))+"。请检查后重试。","err")}
}catch(e){if(Date.now()-started>15000)show("与设备的连接中断了。如果设备屏幕已恢复正常显示，说明已连接成功；否则请重新连上设备热点再试。")}}
$("show").onchange=e=>$("pass").type=e.target.checked?"text":"password";
$("rescan").onclick=scan;
$("go").onclick=async()=>{const ssid=$("ssid").value.trim();if(!ssid){show("请填写 Wi-Fi 名称","err");return}
$("go").disabled=true;show("正在连接「"+ssid+"」，大约需要 20 秒…");
try{await fetch("/connect",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({ssid,pass:$("pass").value})});
started=Date.now();clearInterval(polling);polling=setInterval(poll,1500)}catch(e){$("go").disabled=false;show("提交失败，请重试","err")}};
scan();
</script></body></html>)HTML";

static WifiPortal* portalOf(httpd_req_t* req) {
    return static_cast<WifiPortal*>(req->user_ctx);
}

static esp_err_t handleRoot(httpd_req_t* req) {
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, kPortalHtml, HTTPD_RESP_USE_STRLEN);
}

struct ScanItem {
    std::string ssid;
    int rssi;
    bool locked;
};

static esp_err_t handleScan(httpd_req_t* req) {
    std::vector<ScanItem> items;
    if (esp_wifi_scan_start(nullptr, true) == ESP_OK) {
        uint16_t n = 20;
        std::vector<wifi_ap_record_t> recs(n);
        if (esp_wifi_scan_get_ap_records(&n, recs.data()) == ESP_OK) {
            for (uint16_t i = 0; i < n; ++i) {
                std::string s(reinterpret_cast<const char*>(recs[i].ssid));
                if (s.empty()) continue;
                auto it = std::find_if(items.begin(), items.end(), [&](const ScanItem& x) { return x.ssid == s; });
                if (it == items.end()) {
                    items.push_back({s, recs[i].rssi, recs[i].authmode != WIFI_AUTH_OPEN});
                } else if (recs[i].rssi > it->rssi) {
                    it->rssi = recs[i].rssi;
                }
            }
        }
    } else {
        LOGW("Wi-Fi scan failed");
    }
    std::sort(items.begin(), items.end(), [](const ScanItem& a, const ScanItem& b) { return a.rssi > b.rssi; });
    std::string json = "[";
    for (size_t i = 0; i < items.size(); ++i) {
        char tail[48];
        snprintf(tail, sizeof(tail), "\",\"r\":%d,\"l\":%d}", items[i].rssi, items[i].locked ? 1 : 0);
        if (i) json += ",";
        json += "{\"s\":\"" + WifiPortal::jsonEscape(items[i].ssid) + tail;
    }
    json += "]";
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, json.c_str(), json.size());
}

static esp_err_t handleConnect(httpd_req_t* req) {
    if (req->content_len == 0 || req->content_len > 512) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad body");
        return ESP_FAIL;
    }
    std::string body(req->content_len, '\0');
    size_t got = 0;
    while (got < req->content_len) {
        int r = httpd_req_recv(req, &body[got], req->content_len - got);
        if (r <= 0) {
            if (r == HTTPD_SOCK_ERR_TIMEOUT) continue;
            return ESP_FAIL;
        }
        got += static_cast<size_t>(r);
    }
    std::string ssid, pass;
    if (!WifiPortal::formField(body, "ssid", ssid) || ssid.empty() || ssid.size() > 32) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "ssid");
        return ESP_FAIL;
    }
    WifiPortal::formField(body, "pass", pass);
    if (pass.size() > 64 || (!pass.empty() && pass.size() < 8)) {
        // WPA2 密码 8~63 字符（64 位十六进制 PSK 也接受）
        httpd_resp_set_type(req, "application/json");
        httpd_resp_set_status(req, "200 OK");
        portalOf(req)->setStatus(WifiPortal::Status::Failed, ssid, 15);
        return httpd_resp_sendstr(req, "{\"ok\":false}");
    }
    LOGI("Credentials submitted for SSID: %s", ssid.c_str());
    portalOf(req)->submit(ssid, pass);
    pass.assign(pass.size(), '\0');
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{\"ok\":true}");
}

static esp_err_t handleStatus(httpd_req_t* req) {
    std::string json = portalOf(req)->currentStatusJson();
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, json.c_str(), json.size());
}

/** 其它路径（含手机的联网检测 /generate_204、/hotspot-detect.html 等）一律跳到首页，触发"登录此网络"弹窗 */
static esp_err_t handleNotFound(httpd_req_t* req, httpd_err_code_t) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
    return httpd_resp_send(req, nullptr, 0);
}

/* ---------------- DNS 劫持：所有 A 查询都回答 192.168.4.1 ---------------- */

struct DnsCtx {
    int sock;
    volatile bool running;
};
static DnsCtx s_dns = {-1, false};

static void dnsTask(void*) {
    uint8_t buf[512];
    while (s_dns.running) {
        sockaddr_in from = {};
        socklen_t flen = sizeof(from);
        int n = recvfrom(s_dns.sock, buf, sizeof(buf), 0, reinterpret_cast<sockaddr*>(&from), &flen);
        if (n < 0) {
            if (!s_dns.running) break;
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
        if (n < 12 || n + 16 > static_cast<int>(sizeof(buf))) continue;
        if (buf[2] & 0x80) continue; // 不是查询
        int qd = (buf[4] << 8) | buf[5];
        if (qd < 1) continue;
        // 跳过第一个问题的 QNAME
        int p = 12;
        while (p < n && buf[p] != 0) p += buf[p] + 1;
        p += 5; // 0 结尾 + QTYPE + QCLASS
        if (p > n) continue;
        uint16_t qtype = (buf[p - 4] << 8) | buf[p - 3];
        // 应答头：QR=1 AA=1 RA=1，只保留第一个问题
        buf[2] = 0x84 | (buf[2] & 0x01);
        buf[3] = 0x80;
        buf[4] = 0; buf[5] = 1;
        buf[8] = 0; buf[9] = 0;
        buf[10] = 0; buf[11] = 0;
        int len = p;
        if (qtype == 1) {
            buf[6] = 0; buf[7] = 1;
            const uint8_t ans[] = {0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 168, 4, 1};
            memcpy(buf + len, ans, sizeof(ans));
            len += sizeof(ans);
        } else {
            buf[6] = 0; buf[7] = 0; // AAAA 等：空应答，手机会退回 IPv4
        }
        sendto(s_dns.sock, buf, len, 0, reinterpret_cast<sockaddr*>(&from), flen);
    }
    vTaskDelete(nullptr);
}

bool WifiPortal::start(const std::string& ap_ssid) {
    if (m_active) return true;
    m_ap_ssid = ap_ssid;
    setStatus(Status::Idle, "", 0);

    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.stack_size = 8192;
    cfg.max_uri_handlers = 8;
    cfg.lru_purge_enable = true;
    httpd_handle_t server = nullptr;
    if (httpd_start(&server, &cfg) != ESP_OK) {
        LOGW("httpd_start failed");
        return false;
    }
    const httpd_uri_t uris[] = {
        {"/", HTTP_GET, handleRoot, this},
        {"/scan", HTTP_GET, handleScan, this},
        {"/connect", HTTP_POST, handleConnect, this},
        {"/status", HTTP_GET, handleStatus, this},
    };
    for (const auto& u : uris) httpd_register_uri_handler(server, &u);
    httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, handleNotFound);
    m_httpd = server;

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock >= 0) {
        sockaddr_in addr = {};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(53);
        addr.sin_addr.s_addr = htonl(INADDR_ANY);
        if (bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
            timeval tv = {1, 0};
            setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
            s_dns.sock = sock;
            s_dns.running = true;
            TaskHandle_t h = nullptr;
            xTaskCreate(dnsTask, "kb_dns", 3072, nullptr, 4, &h);
            m_dns_task = h;
            m_dns_sock = sock;
        } else {
            LOGW("DNS bind failed; portal still works via http://192.168.4.1");
            close(sock);
        }
    }

    m_active = true;
    LOGI("Setup portal ready on http://192.168.4.1 (AP %s)", ap_ssid.c_str());
    return true;
}

void WifiPortal::stop() {
    if (!m_active) return;
    if (m_httpd) {
        httpd_stop(static_cast<httpd_handle_t>(m_httpd));
        m_httpd = nullptr;
    }
    if (m_dns_sock >= 0) {
        s_dns.running = false;
        vTaskDelay(pdMS_TO_TICKS(1200)); // 等 DNS 任务的 1s 接收超时后自行退出
        close(m_dns_sock);
        m_dns_sock = -1;
        s_dns.sock = -1;
        m_dns_task = nullptr;
    }
    m_active = false;
    LOGI("Setup portal stopped");
}

#else // 宿主机：只保留状态，便于主流程测试

bool WifiPortal::start(const std::string& ap_ssid) {
    m_ap_ssid = ap_ssid;
    m_active = true;
    setStatus(Status::Idle, "", 0);
    LOGI("Setup portal (host stub) started: %s", ap_ssid.c_str());
    return true;
}

void WifiPortal::stop() {
    m_active = false;
}

#endif

} // namespace kidboard
