import { defineConfig } from 'tsup';

// 发布产物（仓库内消费走 package.json 的源码级 exports，免构建排序）。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // pdfjs-dist 保持 external：由消费方运行时解析（Node node_modules / 浏览器 CDN 注入）
  external: ['pdfjs-dist', 'node:fs/promises', 'node:path', 'node:url', 'node:module'],
});
