/**
 * 首页任务焦点框（D-022）宿主机测试：框只画在 TASK_ROWS 对应行、局部窗口覆盖全部任务行、
 * 完成任务后焦点跳到下一个未完成、空任务列表清空焦点。
 */

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>

#include "board_config.h"
#include "tasks/focus_box.h"
#include "tasks/task_focus_manager.h"

using namespace kidboard;

static bool black(const uint8_t* f, int x, int y) { return !(f[y * 100 + (x >> 3)] & (0x80 >> (x & 7))); }

static int blackIn(const uint8_t* f, int x0, int y0, int w, int h) {
    int n = 0;
    for (int y = y0; y < y0 + h; ++y)
        for (int x = x0; x < x0 + w; ++x) n += black(f, x, y);
    return n;
}

int main() {
    // 与 packages/screen-template TASK_ROWS 一致
    assert(FocusBox::kRowX == 418 && FocusBox::kRowY == 112 && FocusBox::kRowW == 364 && FocusBox::kRowH == 37 && FocusBox::kMaxRows == 6);
    // 局部窗口按字节对齐并覆盖全部行
    assert(FocusBox::kWinX % 8 == 0 && FocusBox::kWinW % 8 == 0);
    assert(FocusBox::kWinX <= FocusBox::kRowX && FocusBox::kWinX + FocusBox::kWinW >= FocusBox::kRowX + FocusBox::kRowW);
    assert(FocusBox::kWinY <= FocusBox::kRowY && FocusBox::kWinY + FocusBox::kWinH >= FocusBox::kRowY + 6 * FocusBox::kRowH);
    assert(FocusBox::kWinY + FocusBox::kWinH <= 352);  // 不碰留言区分隔线

    static uint8_t frame[FRAME_BUFFER_BYTES];
    memset(frame, 0xFF, sizeof(frame));
    assert(FocusBox::drawIntoFrame(frame, sizeof(frame), 2));
    const int y0 = 112 + 2 * 37;
    // 四条边 3px，只在第 3 行范围内
    assert(black(frame, 418, y0) && black(frame, 781, y0 + 36) && black(frame, 420, y0 + 18) && black(frame, 600, y0 + 2));
    assert(!black(frame, 600, y0 + 3) && !black(frame, 417, y0) && !black(frame, 600, y0 - 1) && !black(frame, 600, y0 + 37));
    const int total = blackIn(frame, 0, 0, 800, 480);
    assert(total == blackIn(frame, 418, y0, 364, 37) && total == 2 * 3 * 364 + 2 * 3 * (37 - 6));
    assert(!FocusBox::drawIntoFrame(frame, sizeof(frame), 6) && !FocusBox::drawIntoFrame(frame, sizeof(frame), -1));

    static uint8_t window[FocusBox::kWinBytes];
    assert(FocusBox::extractWindow(frame, sizeof(frame), window, sizeof(window)));
    int win_black = 0;
    for (size_t i = 0; i < sizeof(window); ++i)
        for (int b = 0; b < 8; ++b) win_black += !(window[i] & (0x80 >> b));
    assert(win_black == total);  // 框完整落在窗口内

    // D-023 本地打勾：与 TASK_CHECK 一致（行左上角 +32,+8，21×21），只改动这一格，且在局部窗口内
    assert(FocusBox::kCheckDx == 32 && FocusBox::kCheckDy == 8 && FocusBox::kCheckSize == 21);
    memset(frame, 0xFF, sizeof(frame));
    assert(FocusBox::drawCheck(frame, sizeof(frame), 1));
    const int cx = 418 + 32, cy = 112 + 37 + 8;
    const int ink_in_box = blackIn(frame, cx, cy, 21, 21);
    assert(ink_in_box > 21 * 21 / 2 && ink_in_box < 21 * 21);       // 黑底 + 白勾
    assert(blackIn(frame, 0, 0, 800, 480) == ink_in_box);          // 只改这一格
    assert(black(frame, cx, cy) && black(frame, cx + 20, cy + 20)); // 四角为黑
    assert(!black(frame, cx + 9, cy + 15));                         // 勾的拐点为白
    assert(cy >= FocusBox::kWinY && cy + 21 <= FocusBox::kWinY + FocusBox::kWinH);
    assert(!FocusBox::drawCheck(frame, sizeof(frame), 6));

    // 焦点：完成后跳到下一个未完成（循环），全部完成则不动
    TaskFocusManager fm;
    std::vector<InteractiveTask> tasks(4);
    for (int i = 0; i < 4; ++i) {
        tasks[i].id = "t" + std::to_string(i);
        tasks[i].slot = i;
        tasks[i].status = i == 1 ? "completed" : "pending";
    }
    fm.updateTasks(tasks);
    assert(fm.getFocusedTask()->slot == 0);
    fm.markTaskCompleted("t0");
    assert(fm.focusNextPending() && fm.getFocusedTask()->slot == 2);  // 跳过已完成的 t1
    fm.markTaskCompleted("t2");
    assert(fm.focusNextPending() && fm.getFocusedTask()->slot == 3);
    fm.markTaskCompleted("t3");
    assert(!fm.focusNextPending() && fm.getFocusedTask()->slot == 3);  // 全部完成：不动
    // 明日预览：服务端下发空列表 → 清空，没有焦点
    fm.updateTasks({});
    assert(fm.getFocusedTask() == nullptr);

    printf("FOCUS BOX TESTS PASSED\n");
    return 0;
}
