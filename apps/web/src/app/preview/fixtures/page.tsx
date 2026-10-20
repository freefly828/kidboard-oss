/**
 * 800×480 模板预览总览页 — 渲染全部 8 套 fixture（docs/06 §10）。
 * 与实际渲染模板同源（@kidboard/screen-template），不允许单独手写近似 UI（docs/02 P06）。
 */

import { Screen } from "@kidboard/screen-template";
import { allFixtures } from "@kidboard/screen-template/fixtures";

export const metadata = { title: "KidBoard 模板预览" };

const FIXTURE_NOTES: Record<string, string> = {
  emptyDay: "空白日程",
  fullSchedule: "日程满（5 条）",
  fullTasks: "任务满（6 条）",
  allCompleted: "全部完成",
  longChinese: "超长中文",
  mixedContent: "英文/数字混排",
  offlineState: "离线状态",
  largeFontEdge: "大字体边界",
};

export default function FixturesPreviewPage() {
  return (
    <main style={{ background: "#e8e8e4", padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>KidBoard 800×480 模板预览</h1>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 20px" }}>
        8 套 fixture（docs/06 §10）· 与渲染管线同一模板源 · Phase 3 visual regression 基线
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
          gap: 24,
        }}
      >
        {Object.entries(allFixtures).map(([name, vm]) => (
          <figure key={name} style={{ margin: 0 }}>
            <div style={{ width: 400, height: 240, overflow: "hidden", border: "1px solid #999" }}>
              <div style={{ transform: "scale(0.5)", transformOrigin: "top left" }}>
                <Screen vm={vm} />
              </div>
            </div>
            <figcaption style={{ fontSize: 12, color: "#333", marginTop: 6 }}>
              <code>{name}</code> — {FIXTURE_NOTES[name]}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
