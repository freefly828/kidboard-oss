#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string>
#include "board_config.h"

namespace kidboard {

class FrameStore {
public:
    explicit FrameStore(const char* base_dir = nullptr);
    ~FrameStore();

    bool init();
    bool hasLastFrame() const;
    bool loadLastFrame(uint8_t* out_buffer, size_t max_len, size_t* out_len = nullptr);
    bool saveStaging(const uint8_t* in_buffer, size_t len);
    bool commitStaging();
    bool saveMeta(const char* meta_json, size_t len);

    /* ---- D-018 附加页（页号 1..kMaxPages）：page{N}.bin + page{N}.sha ---- */
    static constexpr int kMaxPages = 8;
    bool savePage(int index, const uint8_t* data, size_t len, const std::string& sha256);
    bool loadPage(int index, uint8_t* out_buffer, size_t max_len, size_t* out_len = nullptr);
    bool hasPage(int index) const;
    /** 已存页的 SHA-256（十六进制）；没有返回空串 */
    std::string pageSha(int index) const;
    /** 删除 index 及之后的页（服务端页数变少时） */
    void removePagesFrom(int index);
    /** 从第 1 页起连续存在的页数 */
    int pageCount() const;

private:
    bool m_mounted;
    char m_base_dir[128];
    char m_last_path[128];
    char m_staging_path[128];
    char m_meta_path[128];
    void pagePath(int index, const char* ext, char* out, size_t out_len) const;
};

} // namespace kidboard
