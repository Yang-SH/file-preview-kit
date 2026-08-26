import { defineConfig } from 'tsup';

// 共享构建选项：浏览器产物按 browser 条件解析依赖（如 fflate 默认导出 esm/browser.js）。
// 若用默认 node 条件，fflate 会选中 esm/index.mjs——其顶层 `import { createRequire } from "module"`
// 原样进 bundle 后浏览器 chunk 直接 TypeError（真机实证发现），被插件 catch 静默降级 binary。
const shared = {
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022' as const,
  platform: 'browser' as const,
  // 零构建场景（CDN drop-in / 裸 <script type=module>）无法解析裸说明符（无打包器、无 import map）：
  // 静态 import 的依赖必须打进产物，否则 browser.js/worker.js 模块图整体加载失败。
  // 重库（mammoth/exceljs/pdfjs-dist/sanitize-html 均为动态 import）保持 external：按需懒加载，
  // 缺失时由插件契约返回 error 结果优雅降级，不阻塞其余格式。
  // C3 分包后：拆分插件包的源码被 browser/worker 入口打包，其内部动态引用的这些重库
  // 已不再是 core 的 dependencies（不会被 tsup 自动排除），必须显式 external。
  noExternal: ['dompurify'],
  external: [
    'node:fs/promises',
    'node:path',
    'node:url',
    'node:module',
    'node:fs',
    'pdfjs-dist',
    'mammoth',
    'exceljs',
    'fflate',
  ],
};

// 双配置拆分（A2 修复）：
// - index/worker 保持 ESM+CJS 双产物；
// - browser 仅出 ESM：browser.ts 以 `new URL('./worker.js', import.meta.url)` 解析 Worker 入口，
//   platform:'browser' 下 CJS 无法 shim `import.meta.url` → tsup 打印 import.meta 警告且 CJS worker URL 为空。
//   package.json 的 exports 对 ./browser 本就只声明 `import`，CJS browser 产物无人消费，直接不再产出。
export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      worker: 'src/worker.ts',
    },
    format: ['esm', 'cjs'],
  },
  {
    ...shared,
    entry: {
      browser: 'src/browser.ts',
    },
    format: ['esm'],
  },
]);
