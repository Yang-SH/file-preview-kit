# file-preview-kit 使用指南（全场景）

> 覆盖：纯浏览器（零构建 / CDN+importmap）、打包器（Vite/webpack）、Node ESM、Node CJS、SSR 直出、Web Component、缩略图、翻页元数据、多工作表、文案 i18n、错误处理。
> 预览深度等级与格式边界见 `项目方案.md` §十八；部署安全见 `docs/csp-guide.md`。

---

## 0. 安装矩阵

| 场景 | 方式 |
| --- | --- |
| 打包器项目 | `npm i @file-preview/core @file-preview/plugin-pdf @file-preview/plugin-office @file-preview/plugin-archive` |
| 纯浏览器·零构建 | 直接 `<script type="module">` 引入 `dist/browser.js` |
| 纯浏览器·CDN＋重库 | 同上，另配 import map（见 §2.3） |
| Node ESM / TS(源码直跑) | `import ... from '@file-preview/core'` |
| Node CJS | `require('@file-preview/core')`（主入口 `dist/index.cjs`） |

> 当前版本尚未发布至 npm 时，请克隆仓库并 `npm install && npm run build --workspaces` 后以源码/产物方式使用。

---

## 1. 打包器场景（推荐）

### 1.1 按需组合

```js
import { corePlugins, createPreviewer, createBrowserEnv, fileFromBrowser } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

const env = createBrowserEnv({
  // bundler 场景可省略；仅当需要从 CDN 注入 pdfjs 资产时才传：
  // pdfModuleUrl / pdfWorkerUrl / pdfFontsUrl
});

const previewer = createPreviewer({
  plugins: [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()],
});

const file = await fileFromBrowser(new Blob([bytes], { type: 'application/pdf' }), 'doc.pdf', 'pdf');
const result = await previewer.preview(file, env);
// result.kind → image | text | json | table | html | media | tree | binary | iframe | error
```

### 1.2 结果渲染（二选一）

```js
import { render } from '@file-preview/core';            // 浏览器 DOM
render(result, document.querySelector('#box'), env);

import { renderToHtml } from '@file-preview/core';      // 字符串（SSR/任意）
box.innerHTML = renderToHtml(result, env);
```

### 1.3 选项

```js
await previewer.preview(file, env, {
  signal: controller.signal,   // 取消
  timeout: 30_000,             // 默认 30s → ERR_TIMEOUT
  maxBytes: 100 * 1024 * 1024, // 超限 → ERR_TOO_LARGE
  onProgress: (p) => console.log(p.phase, p.loaded, '/', p.total),
});
```

---

## 2. 纯浏览器场景

### 2.1 零构建一行接入（Web Component）

```html
<file-preview>
  <input type="file" slot="input" />
</file-preview>
<script type="module" src="./node_modules/@file-preview/core/dist/browser.js"></script>
<script type="module">
  const el = document.querySelector('file-preview');
  el.preview(fileInput.files[0]);          // File | Blob，默认启用 Worker 派发
  // 编程式等价：el.preview(someBlob)
</script>
```

- 导入即注册 `<file-preview>` 自定义元素（Shadow DOM 隔离），默认集 = core 七轻插件 ＋ pdf/office/archive。
- **能力边界**：入口只打包插件「逻辑」；重库经运行时裸说明符动态导入。纯静态托管下 XML/ZIP/PDF/Office/EML/WAV 会优雅降级为 text/binary——解锁方式见下节或 `docs/csp-guide.md` §六。

### 2.2 Worker 派发

```js
import { createPreviewer, workerPlugins, fileFromBrowser } from '@file-preview/core';

const pv = createPreviewer({
  plugins: workerPlugins(),                       // 排除自管 Worker 的 pdf
  dispatch: 'worker',
  workerUrl: new URL('./node_modules/@file-preview/core/dist/worker.js', import.meta.url).href,
});
```

`<file-preview>` 元素内部已默认 `dispatch:'worker'`。

### 2.3 CDN / import map 解锁重格式

纯静态托管想让 xml/zip/pdf/office/wasm 生效，提供 import map 把裸说明符映射到自托管 vendor 文件：

```html
<script type="importmap">
{ "imports": {
    "fast-xml-parser": "/assets/vendor/fast-xml-parser.min.js",
    "fflate": "/assets/vendor/fflate.esm.js",
    "mediainfo.js": "/assets/vendor/mediainfo/index.js"
} }
</script>
```

vendor 清单可直接参考离线页生成器 `examples/browser/build-standalone.mjs` 的产物。

---

## 3. Node 场景

### 3.1 ESM / TS

```ts
import { createPreviewer, corePlugins, createNodeEnv, initNodeSanitizer, fileFromNode, renderToHtml } from '@file-preview/core';
import { officePlugin } from '@file-preview/plugin-office';
import { pdfPlugin } from '@file-preview/plugin-pdf';

await initNodeSanitizer();                        // 懒加载 sanitize-html，调用一次
const previewer = createPreviewer({ plugins: [...corePlugins(), pdfPlugin(), officePlugin()] });
const env = createNodeEnv();

const result = await previewer.preview(await fileFromNode('report.docx'), env);
const html = `<html><body>${renderToHtml(result, env)}</body></html>`;   // SSR 直出
```

### 3.2 CJS（主入口）

```js
const { createPreviewer, corePlugins, createNodeEnv, initNodeSanitizer, fileFromNode } = require('@file-preview/core');
// 注意：CJS 主入口不含已拆分的 plugin-*（按需 require 各 plugin 包）
```

> 插件包的 CJS 完整链路依赖发布期 publishConfig 替换（prepack 已自动处理）；直接从 workspace 源码 require 插件 CJS 属未定义行为。

### 3.3 流式大文件

`fileFromNode` 基于 fd 区间读取，不整文件入内存；探测仅读头部 16KB，文本预览上限 8MB（超出截断，README 支持边界有声明）。

---

## 4. PDF：页数预算与翻页数据（G1）

```js
import { pdfPlugin } from '@file-preview/plugin-pdf';

const pv = createPreviewer({ plugins: [pdfPlugin({ maxPages: 5 })] });
const r = await pv.preview(pdfFile, browserEnv);
// r.kind === 'html'
console.log(r.totalPages, r.renderedPages);   // 例：42, 5 —— 翻页控件由此自建
// 浏览器渲染页附带透明文本层：Ctrl+F 检索、选中复制开箱即用（扫描版无文本则省略）
```

Node 端文本提取**不受** maxPages 限制（内容级完整阅读）。UI 归调用方是本库的既定哲学：库给 `totalPages/renderedPages` 数据。

---

## 5. 缩略图（G2）

```js
import { createThumbnailer, corePlugins, pdfPlugin } from '@file-preview/core';
const t = createThumbnailer({ plugins: [...corePlugins(), pdfPlugin()] });

const thumb = await t.thumbnail(file, env, { maxWidth: 320, maxHeight: 320 });
if (thumb.via === 'image') {
  // 真实封面：<img src={thumb.dataUrl} width={thumb.width} height={thumb.height}>
} else {
  // fallback-card：列表 UI 用 thumb.icon + thumb.name + thumb.size + thumb.formatFamily 自行渲染
}
```

v1 覆盖：图片（浏览器 canvas 等比缩小）、PDF 首页封面；视频/office/其余回退卡片。永不 reject。

---

## 6. xlsx 多工作表（G8）

```js
import { officePlugin } from '@file-preview/plugin-office';

const office = officePlugin({ sheet: 'Data', maxRows: 500 });  // 名称或 1-based 序号；默认第 1 表/1000 行
const r = await createPreviewer({ plugins: [office] }).preview(xlsxFile, nodeEnv);
// r.sheetName === 'Data'; r.sheetTotal === 总表数 —— 切换器据此再次调用 preview 即可
```

---

## 7. 内置文案 i18n（G7）

```js
pdfPlugin({
  messages: {
    figcaptionPage: (i, total) => `Page ${i} of ${total}`,
    titlePreview: (name, rendered, total) => `${name} — preview ${rendered}/${total}`,
    nodePageHeader: (i, total) => `[page ${i}]`,
  },
});
```

未注入时使用中文默认文案。其余内置输出（错误 message 等）为英文。

---

## 8. 错误处理

稳定错误码（方案 §16）：`ERR_UNSUPPORTED / ERR_TOO_LARGE / ERR_PARSE / ERR_ABORTED / ERR_TIMEOUT`。

```js
try {
  const r = await previewer.preview(file, env, opts);
  if (r.kind === 'binary' && r.info?.code) showErrorByCode(r.info.code);
} catch (e) {
  if (e.code === 'ERR_ABORTED') { /* 用户取消 */ }
  if (e.code === 'ERR_TIMEOUT') { /* 超时 */ }
}
```

无插件命中且内容为高可读 UTF-8 时自动降级为 `text`（文本救援）；否则 hex dump 兜底。

---

## 9. 安全 / 移动端 / 无障碍要点

- **唯一清理点**：所有 html 输出经 `env.sanitize`；浏览器默认 DOMPurify，Node 先 `initNodeSanitizer()`。
- **XXE**：DOCTYPE 剥离＋严格校验；**zip 炸弹**：四阈值防御（条目/总量/单条目/嵌套）。
- **移动端**：输出为普通 HTML/CSS，无固定宽度、不拦截触摸；viewport 由页面自理。
- **图片交互**：挂稳定类名 `.fpk-image` 做 CSS transform（缩放/旋转配方见 README 支持边界节）。
- **a11y**：语义化标记＋媒体原生 controls；alt 策略与 live region 属宿主。
- **下载原件／打印样式**：宿主职责。
- **严格 CSP 页面**：按 `docs/csp-guide.md` 配置 `blob:`/`data:`/worker 与（可选）import map。

---

## 10. 常见问题

**Q: 纯静态托管后 PDF 显示成 hex？** 重库未解析——配 import map 或改用 bundler（§2.3 / csp-guide §六）。
**Q: pptx 只有文字？** 产品定位为 glance 内容级预览，版式还原不在范围（方案 §十八）。
**Q: 大 xlsx 只显示部分行？** 默认 maxRows=1000 截断，用 `officePlugin({ maxRows })` 调整并配合 sheetTotal 做分批加载。
**Q: 如何升级破坏性变更？** major 版本会同步提升受影响插件 `contractVersion` 并在 CHANGELOG 说明迁移方式。
