/**
 * Renderer 测试配置。
 *
 * 关键约束：本目录的 pipeline / integration / layout.guard 测试都会启动**真实 Chromium**。
 * vitest 默认按文件并行（线程池），在本机同时拉起 4 个 Chromium 会互相争抢资源，
 * 导致 hook/test 超时（表现为 afterAll 10s 超时、单个用例 5s 超时）。
 * 这不是产品缺陷，而是测试基础设施问题——因此这里显式改为**串行**执行，
 * 并给 Chromium 用例留出足够超时余量。
 *
 * 纯函数类测试（frame/dirty 在 packages/screen-template）不受影响，仍可并行。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 串行跑测试文件：避免多个 Chromium 实例并发争抢
    fileParallelism: false,
    // 单文件内的用例也串行（一个 browser 实例被多个用例复用）
    sequence: { concurrent: false },
    // Chromium 启动 + 页面渲染在冷启动/CI 上明显慢于纯 JS 用例
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
