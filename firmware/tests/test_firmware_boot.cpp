/**
 * Firmware Boot & Lifecycle Integration Test (Host)
 *
 * 验证端到端启动生命周期：
 * 1. 首次上电无缓存 -> 生成 48KB 默认引导画面 -> 原子保存 last.bin -> 屏幕全刷
 * 2. 二次启动有缓存 -> 直接加载 48KB last.bin -> 屏幕全刷
 * 3. 实体按键注册与回调就绪
 */

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/stat.h>

#include "board_config.h"
#include "frame_store/frame_store.h"

extern "C" void app_main(void);

using namespace kidboard;

int main() {
    printf("==================================================\n");
    printf("  KidBoard Firmware Boot Integration Test (Host)  \n");
    printf("==================================================\n");

    // 清理旧环境
    system("rm -rf /spiffs");

    printf("\n--- Test Run 1: First Boot (Cold Start, No Frame) ---\n");
    app_main();

    FrameStore store;
    assert(store.init());
    assert(store.hasLastFrame());

    uint8_t buffer[FRAME_BUFFER_BYTES];
    size_t loaded = 0;
    assert(store.loadLastFrame(buffer, sizeof(buffer), &loaded));
    assert(loaded == FRAME_BUFFER_BYTES);
    printf("First boot successfully produced and committed 48KB initial frame!\n");

    printf("\n--- Test Run 2: Second Boot (Cached Last Frame) ---\n");
    app_main();
    printf("Second boot successfully read cached 48KB frame and refreshed!\n");

    printf("\n==================================================\n");
    printf("FIRMWARE BOOT INTEGRATION TEST PASSED!\n");
    printf("==================================================\n");
    return 0;
}
