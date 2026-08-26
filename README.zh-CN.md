# file-preview-kit

[![CI](https://github.com/Yang-SH/file-preview-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-SH/file-preview-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Core entry size](https://img.shields.io/badge/core%20gzip-96.6%20kB-blue)

[English](./README.md) | **简体中文**

面向浏览器与 Node.js 的同构文件预览组件库：流式文件输入、类型嗅探、插件式解析、统一结果模型与双渲染器，内置多层安全加固。

> 设计规格见 [`项目方案.md`](./项目方案.md)，验证报告见 [`packages/core/TDD-REPORT.md`](./packages/core/TDD-REPORT.md)。
> **全场景使用指南**：[`docs/usage-guide.zh-CN.md`](./docs/usage-guide.zh-CN.md) · 测试覆盖快照：[`docs/test-coverage-matrix.md`](./docs/test-coverage-matrix.md)。

## 特性

- **同构核心** —— 同一条管线运行于浏览器与 Node.js（流式 `IFile`、`maxBytes` 护栏、超时/AbortSignal 合并、LRU 缓存）。
- **插件架构** —— 优先级路由（`test() → number`），按需组合。
- **统一结果模型** —— 解析结果收敛为 `image / text / json / table / html / media / tree / binary / error`；`PreviewResult` 类型另定义 `iframe`，供渲染层做整页文档隔离使用。
- **安全优先** —— 所有 HTML 输出经过唯一 sanitize 清理点；XXE 双层加固；ZIP 炸弹四阈值防御；稳定错误码枚举。
- **零构建友好** —— `<script type="module">` 即可注册 Web Component 默认集；重依赖全部位于动态导入之后。
- **完全离线可用** —— 可生成自包含单文件演示页，运行时无需 CDN 与服务器。

## 包结构

| 包 | 说明 |
| --- | --- |
| [`@file-preview/core`](./packages/core) | 同构核心：流式 `IFile`、类型探测、插件路由、环境适配、渲染层。内置轻量插件：`image` / `text` / `markdown` / `csv` / `xml`(XXE 加固) / `media`(mediainfo WASM) / `email`(eml)。 |
| [`@file-preview/plugin-pdf`](./packages/plugin-pdf) | PDF 预览（pdfjs-dist；浏览器渲染页面 / Node 提取文本）。 |
| [`@file-preview/plugin-office`](./packages/plugin-office) | Office 三件套 docx·xlsx·pptx（mammoth / exceljs / fflate）。 |
| [`@file-preview/plugin-archive`](./packages/plugin-archive) | ZIP 目录树 + 四阈值炸弹防御（fflate）。 |

## 安装

```bash
npm install @file-preview/core @file-preview/plugin-pdf @file-preview/plugin-office @file-preview/plugin-archive
```

> **状态：** v0.3.0 尚未发布至 npm。当前请以源码方式使用：
>
> ```bash
> git clone https://github.com/Yang-SH/file-preview-kit.git
> cd file-preview-kit && npm install && npm run build --workspaces
> ```

## 快速开始

### 按需组合插件（推荐）

```js
import { corePlugins, createPreviewer, createBrowserEnv, fileFromBrowser } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

const env = createBrowserEnv({
  // CDN drop-in 场景注入 pdfjs 资源；bundler 场景可省略
  pdfModuleUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs',
  pdfWorkerUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
});

const previewer = createPreviewer({
  plugins: [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()],
});

const file = await fileFromBrowser(new Blob([bytes], { type: 'application/pdf' }), 'doc.pdf', 'pdf');
const result = await previewer.preview(file, env);
// result.kind → 'image' | 'text' | 'json' | 'table' | 'html' | 'media' | 'tree' | 'binary' | 'error'
```

### 零构建浏览器入口

```html
<file-preview></file-preview>
<script type="module" src="./node_modules/@file-preview/core/dist/browser.js"></script>
<script type="module">
  const el = document.querySelector('file-preview');
  el.preview(fileInput.files[0]); // File | Blob —— 默认启用 Worker 统一派发
</script>
```

`/browser` 入口将「core + 三拆分包」全量默认集打包为单文件，导入即注册 `<file-preview>` 自定义元素。

### 缩略图与预览深度

```js
import { createThumbnailer, corePlugins, pdfPlugin } from '@file-preview/core';
const t = createThumbnailer({ plugins: [...corePlugins(), pdfPlugin()] });
const thumb = await t.thumbnail(file, env, { maxWidth: 320, maxHeight: 320 });
// thumb.via === 'image'          → 真实封面：{ dataUrl, width?, height? }
// thumb.via === 'fallback-card'  → { icon, name, size, formatFamily }，供列表 UI 自行渲染
```

v1 覆盖：图片（浏览器端等比缩小）与 PDF（首页封面）；视频/office/其余格式返回回退卡——列表 UI 请基于返回数据自行构建。

**预览深度等级**：全部格式均为 *glance 内容级*（读懂内容）；图片/SVG/PDF/视频/markdown 额外达到 *visual 视觉级*。office 三件套（docx/xlsx/pptx）永久定位为 glance 级内容预览——版式还原不在设计范围内。详见 `项目方案.md` §十八。

> **零构建部署须知：** 入口打包的是插件「逻辑」，重解析库（`fast-xml-parser`、`fflate`、`pdfjs-dist`、`mammoth`、`exceljs`、`emailjs-mime-parser`、`mediainfo.js`）在运行时经裸说明符动态导入。纯静态托管下这些导入无法解析，XML / ZIP / PDF / Office / EML / 媒体元数据预览会优雅降级为 `text` / `binary` 而非报错。如需免打包解锁完整能力，请提供 [import map](./docs/csp-guide.md) 或将相关库 vendor 到入口同目录（离线单文件页即采用该模式）。

### Node.js SSR

```js
import { createPreviewer, corePlugins, createNodeEnv, initNodeSanitizer, fileFromNode } from '@file-preview/core';
const { officePlugin } = await import('@file-preview/plugin-office');

await initNodeSanitizer(); // 懒加载 sanitize-html，调用一次即可
const previewer = createPreviewer({ plugins: [...corePlugins(), officePlugin()] });

const result = await previewer.preview(await fileFromNode('report.docx'), createNodeEnv());
console.log(result.kind, result.html?.slice(0, 200));
```

## 格式支持总表

| 格式 | 能力 | 结果 kind | 提供方 |
| --- | --- | --- | --- |
| PNG / JPEG / GIF / WebP / BMP / SVG | dataURL + 固有尺寸（SVG 走安全 `<img>`） | `image` | core |
| TXT 及代码文件 | UTF-8 文本预览 | `text` | core |
| Markdown | 渲染 HTML（内联 HTML 已转义） | `html` | core |
| JSON | 无损解析 | `json` | core |
| CSV | 首行表头表格（papaparse） | `table` | core |
| XML | 结构化对象 + XXE 加固（fast-xml-parser） | `json` | core |
| WAV / MP4 / … 音视频 | mediainfo WASM 元数据；浏览器生成播放 src | `media` | core |
| EML 邮件 | 头表 + 正文 + 附件清单 | `html` | core |
| PDF | 浏览器 canvas 页面渲染（前 `maxPages` 页，默认 3——结果携带 `totalPages`/`renderedPages`）；Node 全文提取 | `html` / `text` | plugin-pdf |
| DOCX | HTML 转换（mammoth） | `html` | plugin-office |
| XLSX | 首个工作表表格（exceljs） | `table` | plugin-office |
| PPTX | 幻灯片文本抽取（fflate + XML） | `html` | plugin-office |
| ZIP | 目录树 + 炸弹防御（fflate） | `tree` | plugin-archive |
| 未知/二进制 | 十六进制降级兜底 | `binary` | 内置 |

### 支持边界（设计取舍）

- **eml**：HTML-only 正文以转义源码形式展示，不做富渲染。
- **msg (Outlook)**、**字体文件**、**3D 模型**：按方案走 binary 降级。
- **文本**超过 **8 MB** 截断为前 8 MB。
- **xlsx** 单次读取一个工作表，行数上限 `maxRows`（默认 1000）。经 `officePlugin({ sheet: 'Beta' | 2, maxRows })` 选表；结果携带 `sheetName` ＋ `sheetTotal`，切换器 UI 由你构建。
- **PDF** 浏览器渲染前 `maxPages` 页（默认 3，经 `pdfPlugin({ maxPages })` 配置），结果携带 `totalPages`／`renderedPages` 元数据——分页 UI 由调用方自建。渲染页附带**透明文本层**：原生 Ctrl+F 检索与文字选中复制开箱即用（扫描版无文本则自动省略该层）。
- **交互与外框属宿主职责**：图片的缩放/旋转/全屏（挂稳定类名 `fpk-image` 做 CSS transform 即可）、打印样式、下载按钮、工具栏与文件列表。
- **移动端/响应式**：输出为普通 HTML/CSS，无固定宽度、不拦截触摸事件——viewport 与容器尺寸由页面自理。
- **无障碍基线**：语义化标记（`table`／`pre`／`figure`＋`figcaption`／媒体原生 `controls`）＋稳定类名；alt 策略与 ARIA live region 属宿主关注点。
- 依赖非嵌入 CJK 字体的 PDF 需自行托管 pdfjs `standard_fonts`/cMaps（见 [CSP 指南](./docs/csp-guide.md)）。

## 安全

- **唯一清理点** —— 所有 `html` 输出经 `env.sanitize`：浏览器默认 DOMPurify、Node 为 sanitize-html（入口调用一次 `initNodeSanitizer()`），也可注入自定义实现。
- **XXE 加固** —— DOCTYPE 整体剥离后严格校验，实体永不展开。
- **ZIP 炸弹防御** —— 条目数/总解压量/单条目/嵌套深度四阈值，超限降级 hex dump 并返回 `ERR_TOO_LARGE`。
- **稳定错误码** —— `ERR_UNSUPPORTED / ERR_TOO_LARGE / ERR_PARSE / ERR_ABORTED / ERR_TIMEOUT`。
- 严格 CSP 托管页请参阅 [`docs/csp-guide.md`](./docs/csp-guide.md) 的最小片段（覆盖 `blob:` / `data:` 与 pdfjs worker）。

## 测试与验证

```bash
npm test                # 125 个 vitest 用例：冒烟 / sanitize XSS / 错误码 / golden-file / 构建卫生
npm run build           # 全包 ESM/CJS/DTS
npm run smoke           # Node 端到端冒烟（零安装，strip-types 直跑）
cd packages/core && npm run verify:offline   # 生成两份完全离线的单文件 HTML：
#   examples/browser/demo-offline.html    —— 交互式演示台（16 种样例 + 拖拽投递）
#   examples/browser/verify-offline.html  —— 21 项自动断言
```

两份离线页双击即开（无需服务器与网络）；验证页的断言结果暴露于 `window.__FPK_VERIFY__`。

CI 在每次 push 与 PR 上执行 typecheck → vitest → build → smoke → dist 探针 → 体积预算。

## 版本与发布

版本与 CHANGELOG 由 [changesets](https://github.com/changesets/changesets) 管理：

```bash
npx changeset      # 记录用户可感知的变更（patch/minor/major）
npm run version    # 消费变更 → semver bump + CHANGELOG 生成
npm run release    # 构建 + 发布（需 npm 凭据；CI 中由 changesets/action 代办）
```

约定：**major** = 破坏性变更（`PreviewResult`/插件接口语义变化），受影响插件的 `contractVersion` 同步 +1 并在变更正文说明迁移方式。详见 [`.changeset/README.md`](./.changeset/README.md)。

## 许可证

[MIT](./LICENSE) © Yang-SH
