# file-preview-kit — CSP 部署指南

> 对应方案 `项目方案.md` §16.3「CSP 要求」。渲染产物依赖 `blob:` / `data:` 资源与（默认配置下的）跨域 pdf.worker，严格 CSP 会直接拦死预览。本文给出**最小可用 CSP 片段**与**自托管部署说明**。

## 一、为什么需要放宽 CSP

file-preview-kit 的渲染产物使用以下资源，均会被默认严格 CSP 拦截：

| 资源 | 来源 | 被哪个指令管控 |
| --- | --- | --- |
| 图片 / SVG 缩略图（DataURL） | 插件产出 `data:image/png;base64,...` | `img-src` |
| 浏览器端生成的对象 URL（图片兜底、音视频播放） | `URL.createObjectURL()` → `blob:` | `img-src` / `media-src` |
| Office/markdown 整页文档的 `<iframe srcdoc>` 隔离 | 渲染层注入 `srcdoc` | `frame-src` / `child-src`（srcdoc 文档继承父页策略） |
| pdfjs Worker（默认从 jsdelivr CDN 加载） | `pdf.worker.min.mjs`（跨域时 pdf.js 会用 blob 包装器启动） | `worker-src` / `script-src` |
| pdfjs 标准字体（默认从 jsdelivr CDN fetch） | `standard_fonts/*` | `connect-src` |

## 二、最小可用 CSP 片段

### 场景 A：零构建 CDN drop-in（`<script type="module" src="https://cdn.../browser.js">`）

脚本、Worker、字体全部来自 CDN 域：

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net;
  worker-src 'self' blob: https://cdn.jsdelivr.net;
  connect-src 'self' https://cdn.jsdelivr.net;
  img-src 'self' blob: data:;
  media-src 'self' blob:;
  frame-src 'self' blob:;
  child-src 'self' blob:;
```

要点：

- `worker-src` 需同时含 **`blob:` 与 CDN 域**：pdf.js 对跨域 `workerSrc` 会生成 blob 包装模块再 `import` 真实的 CDN worker，两条缺一不可。
- `connect-src` 放行 CDN 域：pdfjs 通过 `fetch` 加载 `standard_fonts/` 标准字体。
- 若你的 `browser.js` 托管在其它 CDN，把 `https://cdn.jsdelivr.net` 替换为对应源即可；该 CDN 必须返回 `Access-Control-Allow-Origin`（跨域 worker/字体加载需要 CORS）。

### 场景 B：打包器（bundler）/ 自托管同源资源

所有资源同源自带，无需放行第三方域：

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  worker-src 'self' blob:;
  connect-src 'self';
  img-src 'self' blob: data:;
  media-src 'self' blob:;
  frame-src 'self' blob:;
  child-src 'self' blob:;
```

> 打包器（Vite/webpack）常以 `new Worker(new URL(...))` 或内联 blob 启动 worker，因此 `worker-src blob:` 建议保留。
>
> Node SSR 直出场景：服务端本身不受浏览器 CSP 约束，但**托管直出 HTML 的页面**仍需上述指令（至少 `img-src ... data:`——Node 渲染器的图片输出是 Data URL）。

## 三、自托管 pdfjs 资源（消除跨域依赖）

默认配置下 `packages/core/src/browser.ts` 从 jsdelivr 加载 pdfjs 三件资源：

```ts
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
// pdfModuleUrl:   ${PDFJS_CDN}/build/pdf.mjs
// pdfWorkerUrl:   ${PDFJS_CDN}/build/pdf.worker.min.mjs
// pdfFontsUrl:    ${PDFJS_CDN}/standard_fonts/
```

自托管步骤：

1. 把以下文件复制到你站点的同源目录（示例 `/assets/pdfjs/`）：
   - `node_modules/pdfjs-dist/build/pdf.mjs`
   - `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`
   - `node_modules/pdfjs-dist/standard_fonts/`（整个目录）
2. 创建预览器时显式传入同源地址（覆盖 CDN 默认值）：

```ts
import { createBrowserEnv } from '@file-preview/core';

const env = createBrowserEnv({
  pdfModuleUrl: '/assets/pdfjs/pdf.mjs',
  pdfWorkerUrl: '/assets/pdfjs/pdf.worker.min.mjs',
  pdfFontsUrl: '/assets/pdfjs/standard_fonts/',
});
```

零构建场景同理：把 `dist/browser.js`、`dist/worker.js` 与上述 pdfjs 资源一起放在同一 CDN 目录，kit 内部按 `import.meta.url` 相对解析 `./assets/`（方案 §14 的 `CDN_BASE` 模式），同源托管后 CSP 收敛为场景 B 即可。

## 四、WASM 插件（mediainfo.js）的 CSP 要求

媒体元数据插件（方案 §5.6，**已合入**：core 内置 `src/plugins/media.ts`，随默认插件集提供）引入 `MediaInfoModule.wasm`。WASM 编译受 `script-src` 管控，需追加：

```http
  script-src 'self' 'wasm-unsafe-eval';
```

wasm 文件本体经 `fetch` 加载（`env.loadWasm`），走 `connect-src`；按第三节同样方式放入同源 `assets/` 即可，无需新增第三方域。

## 五、核对清单

- [ ] `img-src` 含 `blob:` 与 `data:`
- [ ] `media-src` 含 `blob:`
- [ ] `frame-src` / `child-src` 含 `blob:`（`<iframe srcdoc>` 隔离 Office/markdown 整页 HTML）
- [ ] `worker-src` 含 `blob:`（+ CDN 域，若未自托管）
- [ ] `script-src` 含 CDN 域（零构建场景）；自托管后仅 `'self'`
- [ ] `connect-src` 含 CDN 域（pdfjs 标准字体；自托管后仅 `'self'`）
- [ ] CDN 返回 `Access-Control-Allow-Origin`（若未自托管）

## 六、零构建部署的依赖解析（import map）

`dist/browser.js` 打包的是插件**逻辑**；重解析库在运行时以裸说明符动态导入：`fast-xml-parser`（xml）、`fflate`（zip）、`pdfjs-dist`（pdf）、`mammoth` / `exceljs`（office）、`emailjs-mime-parser`(eml)、`mediainfo.js`（wasm）、`sanitize-html`（仅 Node）。纯静态托管下浏览器无法解析裸说明符，对应格式预览会**优雅降级**为 `text` / `binary`（不报错）。两种解锁方式：

1. **import map**（推荐，零产物改动）——页面里先于模块脚本声明：

```html
<script type="importmap">
{
  "imports": {
    "fast-xml-parser": "/assets/vendor/fast-xml-parser.min.js",
    "fflate": "/assets/vendor/fflate.esm.js",
    "mediainfo.js": "/assets/vendor/mediainfo/index.js"
  }
}
</script>
```

2. **vendor 同目录**：将库文件与 `browser.js` 一同部署并改写为相对导入——`examples/browser/build-standalone.mjs` 生成的离线单文件页即该模式的现成产物，其 vendor 清单可直接参考。

能力对照：

| 格式 | 纯 dist 静态托管 | import map / vendor 后 |
| --- | --- | --- |
| 图片 / 文本 / JSON / CSV / Markdown | ✅ 完整（依赖已随包 chunk 化） | ✅ 完整 |
| XML 结构化 | ⚠️ 优雅降级 text | ✅ 完整 |
| ZIP / PDF / DOCX / XLSX / PPTX / EML / 媒体元数据 | ⚠️ 优雅降级 text / binary | ✅ 完整 |

> 注：降级行为由候选链与文本救援保证（见 `previewer.ts` fallbackResult），不会抛出未处理异常。
