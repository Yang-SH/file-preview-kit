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
  },
});
