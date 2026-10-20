#include "frame_store.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dirent.h>
#include <string>

#ifdef ESP_PLATFORM
#include "esp_spiffs.h"
#include "esp_log.h"
static const char* TAG = "FRAME_STORE";
#define LOGI(...) ESP_LOGI(TAG, __VA_ARGS__)
#define LOGW(...) ESP_LOGW(TAG, __VA_ARGS__)
#define LOGE(...) ESP_LOGE(TAG, __VA_ARGS__)
#else
#define LOGI(...) printf("[FRAME_STORE_INFO] " __VA_ARGS__); printf("\n")
#define LOGW(...) printf("[FRAME_STORE_WARN] " __VA_ARGS__); printf("\n")
#define LOGE(...) printf("[FRAME_STORE_ERR] "  __VA_ARGS__); printf("\n")
#endif

namespace kidboard {

/**
 * D-022 写文件；写不完整时（SPIFFS 碎片化 / 空间不足，真机报 "wrote 0 of 48000"）
 * 先做垃圾回收腾出空间再重试一次。
 */
static bool writeWholeFile(const char* path, const uint8_t* data, size_t len) {
    for (int attempt = 0; attempt < 2; ++attempt) {
        FILE* f = fopen(path, "wb");
        if (f) {
            // 分 4KB 块写：SPIFFS 一次写 48KB 时来不及回收已删除的页，直接报满（真机：used 仅 10% 也失败）；
            // 小块写让它边写边回收
            size_t written = 0;
            constexpr size_t kChunk = 4096;
            while (written < len) {
                const size_t n = (len - written) < kChunk ? (len - written) : kChunk;
                const size_t w = fwrite(data + written, 1, n, f);
                written += w;
                if (w != n) break;
            }
            fclose(f);
            if (written == len) return true;
            LOGW("Short write on %s: %u of %u", path, static_cast<unsigned>(written), static_cast<unsigned>(len));
        }
        unlink(path);
#ifdef ESP_PLATFORM
        size_t total = 0, used = 0;
        esp_spiffs_info(nullptr, &total, &used);
        LOGW("SPIFFS total=%u used=%u; running GC", static_cast<unsigned>(total), static_cast<unsigned>(used));
        esp_spiffs_gc(nullptr, len + 4096);
#else
        break;
#endif
    }
    return false;
}

FrameStore::FrameStore(const char* base_dir) : m_mounted(false) {
    const char* base = (base_dir != nullptr && base_dir[0] != '\0') ? base_dir : BoardConfig::getFrameDirPath();
    snprintf(m_base_dir, sizeof(m_base_dir), "%s", base);
    snprintf(m_last_path, sizeof(m_last_path), "%s/last.bin", base);
    snprintf(m_staging_path, sizeof(m_staging_path), "%s/staging.bin", base);
    snprintf(m_meta_path, sizeof(m_meta_path), "%s/meta.json", base);
}

FrameStore::~FrameStore() = default;

bool FrameStore::init() {
#ifdef ESP_PLATFORM
    esp_vfs_spiffs_conf_t conf = {
        .base_path = BoardConfig::getSpiffsBasePath(),
        .partition_label = nullptr, // default spiffs partition
        .max_files = 5,
        .format_if_mount_failed = true,
    };

    esp_err_t ret = esp_vfs_spiffs_register(&conf);
    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            LOGE("Failed to mount or format SPIFFS");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            LOGE("Failed to find SPIFFS partition");
        } else {
            LOGE("Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        }
        return false;
    }

    // D-022 清理：只删明确的垃圾（写一半的 .tmp、上次没提交的 staging.bin），其它文件只记日志
    if (DIR* dir = opendir(BoardConfig::getSpiffsBasePath())) {
        while (struct dirent* e = readdir(dir)) {
            const std::string name = e->d_name;
            const size_t slash = name.find_last_of('/');
            const std::string base = slash == std::string::npos ? name : name.substr(slash + 1);
            const bool garbage = base == "staging.bin" ||
                                 (base.size() > 4 && base.compare(base.size() - 4, 4, ".tmp") == 0);
            const std::string full = std::string(BoardConfig::getSpiffsBasePath()) + "/" + name;
            struct stat st;
            const long size = stat(full.c_str(), &st) == 0 ? static_cast<long>(st.st_size) : -1;
            LOGI("SPIFFS file %s (%ld bytes)%s", name.c_str(), size, garbage ? " -> removed" : "");
            if (garbage) unlink(full.c_str());
        }
        closedir(dir);
    }
    size_t total = 0, used = 0;
    ret = esp_spiffs_info(nullptr, &total, &used);
    if (ret == ESP_OK) {
        LOGI("SPIFFS mounted: total=%u, used=%u", static_cast<unsigned>(total), static_cast<unsigned>(used));
        // 用量过半就先整理一次，避免运行中写帧失败
        if (used > total / 2) esp_spiffs_gc(nullptr, 3 * FRAME_BUFFER_BYTES);
    }
    mkdir(BoardConfig::getFrameDirPath(), 0755);
#else
    // Host POSIX: ensure directory hierarchy exists
    char temp[128];
    snprintf(temp, sizeof(temp), "%s", m_base_dir);
    for (char* p = temp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(temp, 0755);
            *p = '/';
        }
    }
    mkdir(temp, 0755);
#endif

    m_mounted = true;
    return true;
}

bool FrameStore::hasLastFrame() const {
    struct stat st;
    if (stat(m_last_path, &st) == 0) {
        return (static_cast<size_t>(st.st_size) == FRAME_BUFFER_BYTES);
    }
    return false;
}

bool FrameStore::loadLastFrame(uint8_t* out_buffer, size_t max_len, size_t* out_len) {
    if (!out_buffer || max_len < FRAME_BUFFER_BYTES) return false;

    FILE* f = fopen(m_last_path, "rb");
    if (!f) {
        LOGW("No last frame found at %s", m_last_path);
        return false;
    }

    size_t bytes_read = fread(out_buffer, 1, FRAME_BUFFER_BYTES, f);
    fclose(f);

    if (bytes_read != FRAME_BUFFER_BYTES) {
        LOGE("last.bin corrupted: read %u bytes, expected %u", static_cast<unsigned>(bytes_read), static_cast<unsigned>(FRAME_BUFFER_BYTES));
        return false;
    }

    if (out_len) *out_len = bytes_read;
    LOGI("Loaded last frame (%u bytes) from %s", static_cast<unsigned>(bytes_read), m_last_path);
    return true;
}

bool FrameStore::saveStaging(const uint8_t* in_buffer, size_t len) {
    if (!in_buffer || len != FRAME_BUFFER_BYTES) {
        LOGE("saveStaging: invalid payload size %u", static_cast<unsigned>(len));
        return false;
    }

    if (!writeWholeFile(m_staging_path, in_buffer, len)) {
        LOGE("Failed to write staging frame");
        return false;
    }
    return true;
}

bool FrameStore::commitStaging() {
    struct stat st;
    if (stat(m_staging_path, &st) != 0 || static_cast<size_t>(st.st_size) != FRAME_BUFFER_BYTES) {
        LOGE("Cannot commit staging: file missing or wrong size");
        return false;
    }

    // 原子替换: staging -> last (docs/07 §5: 原子 rename staging→last)
    unlink(m_last_path);
    if (rename(m_staging_path, m_last_path) != 0) {
        LOGE("Failed to rename staging to last frame");
        return false;
    }
    LOGI("Committed staging frame to %s", m_last_path);
    return true;
}

void FrameStore::pagePath(int index, const char* ext, char* out, size_t out_len) const {
    snprintf(out, out_len, "%s/page%d.%s", m_base_dir, index, ext);
}

bool FrameStore::savePage(int index, const uint8_t* data, size_t len, const std::string& sha256) {
    if (index < 1 || index > kMaxPages || !data || len != FRAME_BUFFER_BYTES) return false;
    char bin[160], tmp[160], sha[160];
    pagePath(index, "bin", bin, sizeof(bin));
    pagePath(index, "tmp", tmp, sizeof(tmp));
    pagePath(index, "sha", sha, sizeof(sha));
    if (!writeWholeFile(tmp, data, len)) return false;
    // 先删旧 SHA：若中途掉电，下次同步会因 SHA 不符而重新下载
    unlink(sha);
    unlink(bin);
    if (rename(tmp, bin) != 0) return false;
    FILE* s = fopen(sha, "w");
    if (!s) return false;
    fwrite(sha256.data(), 1, sha256.size(), s);
    fclose(s);
    LOGI("Saved page %d (%s)", index, sha256.substr(0, 12).c_str());
    return true;
}

bool FrameStore::loadPage(int index, uint8_t* out_buffer, size_t max_len, size_t* out_len) {
    if (index < 1 || index > kMaxPages || !out_buffer || max_len < FRAME_BUFFER_BYTES) return false;
    char bin[160];
    pagePath(index, "bin", bin, sizeof(bin));
    FILE* f = fopen(bin, "rb");
    if (!f) return false;
    size_t n = fread(out_buffer, 1, FRAME_BUFFER_BYTES, f);
    fclose(f);
    if (n != FRAME_BUFFER_BYTES) return false;
    if (out_len) *out_len = n;
    return true;
}

bool FrameStore::hasPage(int index) const {
    if (index < 1 || index > kMaxPages) return false;
    char bin[160];
    pagePath(index, "bin", bin, sizeof(bin));
    struct stat st;
    return stat(bin, &st) == 0 && static_cast<size_t>(st.st_size) == FRAME_BUFFER_BYTES;
}

std::string FrameStore::pageSha(int index) const {
    if (!hasPage(index)) return "";
    char sha[160];
    pagePath(index, "sha", sha, sizeof(sha));
    FILE* f = fopen(sha, "r");
    if (!f) return "";
    char buf[80] = {};
    size_t n = fread(buf, 1, 64, f);
    fclose(f);
    return std::string(buf, n);
}

void FrameStore::removePagesFrom(int index) {
    for (int i = index < 1 ? 1 : index; i <= kMaxPages; ++i) {
        char p[160];
        pagePath(i, "bin", p, sizeof(p));
        unlink(p);
        pagePath(i, "sha", p, sizeof(p));
        unlink(p);
    }
}

int FrameStore::pageCount() const {
    int n = 0;
    while (n < kMaxPages && hasPage(n + 1)) ++n;
    return n;
}

bool FrameStore::saveMeta(const char* meta_json, size_t len) {
    if (!meta_json || len == 0) return false;

    FILE* f = fopen(m_meta_path, "w");
    if (!f) return false;

    size_t written = fwrite(meta_json, 1, len, f);
    fclose(f);
    return (written == len);
}

} // namespace kidboard
