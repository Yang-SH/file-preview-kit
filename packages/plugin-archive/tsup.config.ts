import { defineConfig } from 'tsup';

// 发布产物（仓库内消费走 package.json 的源码级 exports，免构建排序）。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['fflate'],
});
