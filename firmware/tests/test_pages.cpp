/**
 * 多页翻看（D-018）宿主机测试：页文件存取、同步响应 pages 解析、
 * SyncEngine 只下载 SHA 变化的页、显示当前页、失败重试与多余页清理。
 */

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "api_client/api_client.h"
#include "api_client/http_transport.h"
#include "api_client/json_helper.h"
#include "crypto/sha256.h"
#include "frame_store/frame_store.h"
#include "refresh_policy/refresh_policy.h"
#include "sync_engine/sync_engine.h"

using namespace kidboard;

class CountingDisplay : public IEpaperDisplay {
public:
    int shows = 0;
    uint8_t last_first_byte = 0;
    bool init() override { return true; }
    bool show(const uint8_t* frame, size_t len, RefreshMode, const DirtyRect*) override {
        (void)len;
        ++shows;
        last_first_byte = frame[0];
        return true;
    }
    void sleep() override {}
};

/** 模拟服务端：首页 v1 不变，pages 由测试设置；可让某页下载失败 */
class PagesServer : public IHttpTransport {
public:
    std::map<int, std::vector<uint8_t>> pages;
    std::vector<uint8_t> home;
    int fail_page = 0;
    std::vector<std::string> downloads;

    PagesServer() : home(FRAME_BUFFER_BYTES, 0x11) {}

    static std::vector<uint8_t> frameOf(uint8_t fill) { return std::vector<uint8_t>(FRAME_BUFFER_BYTES, fill); }

    HttpResponse post(const std::string&, const std::string&, const std::string&) override {
        std::string pages_json;
        for (const auto& [i, data] : pages) {
            if (!pages_json.empty()) pages_json += ",";
            char buf[256];
            snprintf(buf, sizeof(buf), "{\"index\":%d,\"sha256\":\"%s\",\"bytes\":48000,\"url\":\"/p/%d\"}", i,
                     Sha256::hashHex(data.data(), data.size()).c_str(), i);
            pages_json += buf;
        }
        char body[2048];
        snprintf(body, sizeof(body),
                 "{\"serverTime\":\"2026-10-10T08:00:00Z\",\"nextSyncSeconds\":30,"
                 "\"desiredFrame\":{\"version\":1,\"width\":800,\"height\":480,\"bytes\":48000,\"sha256\":\"%s\","
                 "\"url\":\"/home\",\"forceFullRefresh\":false},\"pages\":[%s],\"commands\":[]}",
                 Sha256::hashHex(home.data(), home.size()).c_str(), pages_json.c_str());
        HttpResponse r;
        r.success = true;
        r.status_code = 200;
        r.body = body;
        return r;
    }
    HttpResponse get(const std::string&, const std::string&) override { return {}; }
    bool downloadBinary(const std::string& url, const std::string&, uint8_t* out, size_t max_len, size_t* out_len) override {
        downloads.push_back(url);
        const std::vector<uint8_t>* src = nullptr;
        if (url.find("/home") != std::string::npos) src = &home;
        for (const auto& [i, data] : pages) {
            if (url.find("/p/" + std::to_string(i)) != std::string::npos) {
                if (i == fail_page) return false;
                src = &data;
            }
        }
        if (!src || max_len < src->size()) return false;
        std::copy(src->begin(), src->end(), out);
        *out_len = src->size();
        return true;
    }
};

static int countDownloads(const PagesServer& s, const std::string& needle) {
    int n = 0;
    for (const auto& d : s.downloads) n += d.find(needle) != std::string::npos;
    return n;
}

int main() {
    system("rm -rf /tmp/kb_pages_test");

    // ---- FrameStore 页文件 ----
    FrameStore store("/tmp/kb_pages_test");
    assert(store.init());
    assert(store.pageCount() == 0 && !store.hasPage(1) && store.pageSha(1).empty());
    std::vector<uint8_t> p1(FRAME_BUFFER_BYTES, 0x22);
    std::string sha1 = Sha256::hashHex(p1.data(), p1.size());
    assert(store.savePage(1, p1.data(), p1.size(), sha1));
    assert(store.hasPage(1) && store.pageSha(1) == sha1 && store.pageCount() == 1);
    std::vector<uint8_t> back(FRAME_BUFFER_BYTES, 0);
    size_t len = 0;
    assert(store.loadPage(1, back.data(), back.size(), &len) && len == FRAME_BUFFER_BYTES && back == p1);
    assert(!store.savePage(0, p1.data(), p1.size(), sha1));               // 页号从 1 开始
    assert(!store.savePage(1, p1.data(), 100, sha1));                     // 必须整帧
    assert(store.savePage(3, p1.data(), p1.size(), sha1));
    assert(store.pageCount() == 1);                                        // 连续页数（缺第 2 页）
    store.removePagesFrom(1);
    assert(store.pageCount() == 0 && !store.hasPage(3));

    // ---- pages 解析：缺字段 / 非法 SHA 的条目丢弃；无 pages 字段 has_pages=false ----
    SyncResponse r;
    std::string good(64, 'a');
    assert(JsonHelper::parseSyncResponseJson("{\"serverTime\":\"x\",\"nextSyncSeconds\":30,\"pages\":[{\"index\":1,\"sha256\":\"" + good +
                                                 "\",\"url\":\"/p/1\"},{\"index\":2,\"sha256\":\"short\",\"url\":\"/p/2\"}]}",
                                             r));
    assert(r.has_pages && r.pages.size() == 1 && r.pages[0].index == 1 && r.pages[0].url == "/p/1");
    SyncResponse old;
    assert(JsonHelper::parseSyncResponseJson("{\"serverTime\":\"x\",\"nextSyncSeconds\":30}", old));
    assert(!old.has_pages);

    // ---- SyncEngine 页同步 ----
    auto server = std::make_shared<PagesServer>();
    server->pages[1] = PagesServer::frameOf(0x31);
    server->pages[2] = PagesServer::frameOf(0x32);
    ApiClient api(server);
    api.setDeviceToken("t");
    RefreshPolicy policy;
    CountingDisplay display;
    SyncEngine engine(api, store, policy, display);
    int active_page = 0;
    engine.setActivePageProvider([&]() { return active_page; });
    SyncTelemetry tel;

    // 首次：首页 + 2 页全部下载；在首页，只显示首页
    engine.step(tel);
    assert(countDownloads(*server, "/home") == 1 && countDownloads(*server, "/p/1") == 1 && countDownloads(*server, "/p/2") == 1);
    assert(store.pageCount() == 2 && display.shows == 1 && display.last_first_byte == 0x11);

    // 页未变：不重复下载
    engine.step(tel);
    assert(countDownloads(*server, "/p/1") == 1 && countDownloads(*server, "/p/2") == 1);

    // 第 2 页内容变化且正在看第 2 页：只下载第 2 页并上屏
    active_page = 2;
    server->pages[2] = PagesServer::frameOf(0x42);
    int shows_before = display.shows;
    engine.step(tel);
    assert(countDownloads(*server, "/p/1") == 1 && countDownloads(*server, "/p/2") == 2);
    assert(display.shows == shows_before + 1 && display.last_first_byte == 0x42);

    // 第 1 页变化但下载失败：本次跳过，下次同步自动补下
    server->pages[1] = PagesServer::frameOf(0x51);
    server->fail_page = 1;
    engine.step(tel);
    assert(store.pageSha(1) == sha1 || store.pageSha(1) != Sha256::hashHex(server->pages[1].data(), FRAME_BUFFER_BYTES));
    server->fail_page = 0;
    engine.step(tel);
    assert(store.pageSha(1) == Sha256::hashHex(server->pages[1].data(), FRAME_BUFFER_BYTES));

    // 服务端只剩 1 页：本地第 2 页删除
    server->pages.erase(2);
    engine.step(tel);
    assert(store.pageCount() == 1 && !store.hasPage(2));

    printf("PAGES TESTS PASSED\n");
    return 0;
}
