#include "refresh_policy.h"

namespace kidboard {

constexpr int MAX_PARTIAL_COUNT = 5;
constexpr int64_t FULL_REFRESH_INTERVAL_SECONDS = 24 * 3600; // 24 小时
constexpr float PARTIAL_AREA_MAX_RATIO = 0.25f;

RefreshPolicy::RefreshPolicy()
    : m_partial_count(0),
      m_last_full_refresh_epoch(0),
      m_last_frame_version(0),
      m_last_refresh_mode(RefreshMode::Full) {}

RefreshMode RefreshPolicy::decideMode(const RefreshDecisionInput& input) const {
    // 1. 开机首帧必须 Full (docs/06 §8)
    if (input.boot_first_frame) {
        return RefreshMode::Full;
    }

    // 2. 远端命令/策略强制 Full
    if (input.force_full_refresh) {
        return RefreshMode::Full;
    }

    // 3. 超过 24 小时未执行全刷
    if (m_last_full_refresh_epoch > 0 &&
        (input.current_epoch_seconds - m_last_full_refresh_epoch) >= FULL_REFRESH_INTERVAL_SECONDS) {
        return RefreshMode::Full;
    }

    // 4. 连续局刷次数超限 (>= 5 次)
    if (m_partial_count >= MAX_PARTIAL_COUNT) {
        return RefreshMode::Full;
    }

    // 5. 面积比满足局刷阈值且硬件支持局刷
    if (input.partial_supported && input.changed_ratio <= PARTIAL_AREA_MAX_RATIO) {
        return RefreshMode::Partial;
    }

    // 6. 其他情况降级为 FastFull
    return RefreshMode::FastFull;
}

void RefreshPolicy::recordRefresh(RefreshMode mode, int64_t epoch_seconds, int frame_version) {
    m_last_refresh_mode = mode;
    m_last_frame_version = frame_version;

    if (mode == RefreshMode::Full) {
        m_partial_count = 0;
        m_last_full_refresh_epoch = epoch_seconds;
    } else {
        m_partial_count++;
    }
}

} // namespace kidboard
