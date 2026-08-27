import { defineConfig } from 'vitest/config';

// 正式测试体系（方案 §12 / §16）：
// - 默认 node 环境；需要 DOM 的用例文件顶部用 `// @vitest-environment jsdom` 切换。
// - jsdom 由 packages/core devDependencies 提供（npm workspaces 已提升到根 node_modules）。
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 顺序执行测试文件：build-clean.test.ts 会在子进程里 `npm run build` 清空重建
    // packages/core/dist/，与并行调度的 node-dist.e2e.test.ts（运行中 require 产物）
    // 存在删除窗口竞态（偶发 Cannot find module .../dist/index.cjs）。禁用文件级
    // 并行后构建与消费严格错开；用例内部的并行度不受影响。
    fileParallelism: false,
  },
});
