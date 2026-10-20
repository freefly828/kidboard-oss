#pragma once

#include <stdint.h>
#include <stddef.h>
#include <time.h>
#include "epaper_interface.h"

namespace kidboard {

struct RefreshDecisionInput {
    bool boot_first_frame;
    bool force_full_refresh;
    float changed_ratio;
    bool partial_supported;
    int64_t current_epoch_seconds;
};

class RefreshPolicy {
public:
    RefreshPolicy();

    RefreshMode decideMode(const RefreshDecisionInput& input) const;
    void recordRefresh(RefreshMode mode, int64_t epoch_seconds, int frame_version);

    int getPartialCount() const { return m_partial_count; }
    int64_t getLastFullRefreshEpoch() const { return m_last_full_refresh_epoch; }
    int getLastFrameVersion() const { return m_last_frame_version; }
    RefreshMode getLastRefreshMode() const { return m_last_refresh_mode; }

private:
    int m_partial_count;
    int64_t m_last_full_refresh_epoch;
    int m_last_frame_version;
    RefreshMode m_last_refresh_mode;
};

} // namespace kidboard
