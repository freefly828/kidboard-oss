/**
 * KidBoard 800×480 墨水屏首页模板 — 单一模板源（docs/03 §4）。
 *
 * 布局: docs/02 §3 分区表（0-54 头部 / 55-352 双栏 / 353-429 留言 / 430-479 按键栏）
 * 约束: docs/06 §2（禁动画/远程字体/网络图片/emoji 图标）；
 *       关键文字 ≥22px、辅助 ≥16px（docs/02 §3）；
 *       不用浅灰细线做唯一分隔（二值化后不可辨）——一律 2px 黑实线。
 * 字体: Noto Sans CJK SC 优先（部署镜像内固定），系统字体兜底；模板不加载远程字体。
 */

import type { ScreenViewModel, TaskEntry } from "./types";
import { bottomText, CLOCK_SLOT, CLOCK_SLOT_RESERVE_PX, columnText, headerText, keysText } from "./screenText";

/** 任务勾选框 — 纯 CSS 1-bit 图标（非 emoji，docs/06 §2） */
function CheckIcon({ done }: { done: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "20px",
        height: "20px",
        border: "2px solid #000",
        lineHeight: "19px",
        textAlign: "center",
        fontSize: "16px",
        fontWeight: 700,
        marginRight: "8px",
        verticalAlign: "-3px",
        background: done ? "#000" : "#fff",
        color: "#fff",
      }}
    >
      {done ? "✓" : ""}
    </span>
  );
}

function TaskRow({ task }: { task: TaskEntry }) {
  const focused = task.focused;
  return (
    <div
      style={{
        // 行高固定 37px：6 行 = 222px，确保不溢出 298px 的任务分区
        // （22px 字号 + 1.6 行高 ≈ 35.2px，余量留给 3px 黑框）
        height: "37px",
        boxSizing: "border-box",
        fontSize: "22px",
        lineHeight: "33px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontWeight: focused ? 700 : 400,
        border: focused ? "3px solid #000" : "3px solid transparent",
        padding: focused ? "0 6px" : "0 9px",
        display: "flex",
        alignItems: "center",
      }}
    >
      {focused ? (
        <span style={{ fontWeight: 800, marginRight: "6px" }}>&gt;</span>
      ) : (
        <span style={{ marginRight: "14px" }}> </span>
      )}
      <CheckIcon done={task.status === "completed"} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
        {task.title}
      </span>
      {task.points ? (
        // D-020 积分徽标：已完成为黑底白字
        <span
          style={{
            flex: "none",
            fontSize: "18px",
            fontWeight: 800,
            lineHeight: "22px",
            border: "2px solid #000",
            padding: "0 5px",
            marginLeft: "8px",
            ...(task.status === "completed" ? { background: "#000", color: "#fff" } : {}),
          }}
        >
          +{task.points}
        </span>
      ) : null}
      {task.estimate ? (
        <span style={{ fontSize: "18px", marginLeft: "8px" }}>
          {task.estimate}
        </span>
      ) : null}
    </div>
  );
}

export function Screen({ vm }: { vm: ScreenViewModel }) {
  const head = headerText(vm);
  const cols = columnText(vm);
  const bottom = bottomText(vm);
  const keys = keysText(vm);
  return (
    <div
      style={{
        width: "800px",
        height: "480px",
        background: "#fff",
        color: "#000",
        display: "grid",
        // docs/02 §3: 头部 0-54 / 双栏 55-352 / 留言 353-429 / 按键栏 430-479
        // 54 + 298 + 77 + 51 = 480，必须精确填满画布（否则底部留白 4px）
        gridTemplateRows: "54px 298px 77px 51px",
        fontFamily:
          '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif',
        position: "relative",
      }}
    >
      {/* 头部 0-54 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px",
          borderBottom: "2px solid #000",
          fontSize: "22px",
          fontWeight: 700,
        }}
      >
        <span style={{ display: "flex", alignItems: "center" }}>
          {/* D-015 设备时钟区：设备上由固件绘制，Web 预览用 clockText 模拟 */}
          <span style={{ flex: "none", width: `${CLOCK_SLOT_RESERVE_PX}px`, height: `${CLOCK_SLOT.height}px`, fontSize: "36px", lineHeight: `${CLOCK_SLOT.height}px`, fontWeight: 700 }}>
            {vm.clockText ?? ""}
          </span>
          <span style={{ whiteSpace: "nowrap" }}>{head.left}</span>
        </span>
        <span style={{ whiteSpace: "nowrap" }}>{head.middle}</span>
        {head.weather ? (
          // 两行天气：第 1 行 18px 天气温度，第 2 行 16px 提醒（docs/02 §3 辅助文字 ≥16px）
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", maxWidth: "380px", overflow: "hidden" }}>
            <span style={{ fontSize: "18px", lineHeight: "22px", whiteSpace: "nowrap" }}>{head.weather.summary}</span>
            {head.weather.advice ? (
              <span style={{ fontSize: "16px", lineHeight: "20px", fontWeight: 400, whiteSpace: "nowrap" }}>{head.weather.advice}</span>
            ) : null}
          </span>
        ) : (
          <span style={{ whiteSpace: "nowrap" }}>{head.right}</span>
        )}
      </div>

      {/* 双栏 55-352 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <section
          style={{
            padding: "14px 18px",
            borderRight: "2px solid #000",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: "24px", fontWeight: 800, marginBottom: "12px" }}>
            {cols.scheduleTitle}
          </div>
          {vm.schedule.length === 0 ? (
            <div style={{ fontSize: "22px", color: "#000" }}>{cols.scheduleEmpty}</div>
          ) : vm.schedule.length <= 5 ? (
            vm.schedule.map((s, idx) => (
              <div
                key={idx + s.time + s.title}
                style={{
                  height: "37px",
                  boxSizing: "border-box",
                  fontSize: "22px",
                  lineHeight: "37px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ fontWeight: 700 }}>{s.time}</span> {s.title}
              </div>
            ))
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gridTemplateRows: "repeat(5, 37px)",
                gridAutoFlow: "column",
                columnGap: "10px",
              }}
            >
              {vm.schedule.slice(0, 10).map((s, idx) => (
                <div
                  key={idx + s.time + s.title}
                  style={{
                    height: "37px",
                    boxSizing: "border-box",
                    fontSize: "18px",
                    lineHeight: "37px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{s.time}</span> {s.title}
                </div>
              ))}
            </div>
          )}
        </section>
        <section style={{ padding: "14px 18px", overflow: "hidden" }}>
          <div style={{ fontSize: "24px", fontWeight: 800, marginBottom: "12px" }}>
            {cols.tasksTitle}
          </div>
          {vm.tasks.length === 0 ? (
            <div style={{ fontSize: "22px" }}>{cols.tasksEmpty}</div>
          ) : (
            vm.tasks.map((t, i) => <TaskRow key={`${i}-${t.title}`} task={t} />)
          )}
        </section>
      </div>

      {/* 留言 353-429
       * 分区 77px = 2px 上边框 + 2×10px padding + 2×27.5px 行高 → 恰好 2 行（docs/06 §9）。
       * line-height 必须 ≤1.25，否则超长中文换行会顶出分区。 */}
      <div
        style={{
          borderTop: "2px solid #000",
          padding: "10px 18px",
          fontSize: "22px",
          lineHeight: 1.25,
          overflow: "hidden",
          // D-017 提醒横幅：黑底白字
          ...(bottom.kind === "alert" ? { background: "#000", color: "#fff", fontWeight: 700 } : {}),
        }}
      >
        {bottom.kind === "empty" ? (
          <span style={{ fontSize: "18px" }}>{bottom.text}</span>
        ) : (
          <span style={bottom.kind === "poem" ? { fontSize: "20px" } : undefined}>
            <span style={{ fontWeight: 800 }}>{bottom.label}</span>
            {bottom.text}
          </span>
        )}
      </div>

      {/* 按键栏 430-479 */}
      <div
        style={{
          borderTop: "2px solid #000",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          fontSize: "18px",
          fontWeight: 700,
        }}
      >
        {keys.map((k) => (
          <span key={k}>{k}</span>
        ))}
      </div>

      {/* 离线提示（docs/02 §4: 不覆盖主内容） */}
      {vm.offlineNotice ? (
        <div
          style={{
            position: "absolute",
            right: "12px",
            bottom: "54px",
            border: "2px solid #000",
            background: "#fff",
            padding: "2px 10px",
            fontSize: "16px",
            fontWeight: 700,
          }}
        >
          {vm.offlineNotice}
        </div>
      ) : null}
    </div>
  );
}
