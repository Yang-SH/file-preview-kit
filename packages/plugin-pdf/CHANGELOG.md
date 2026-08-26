# @file-preview/plugin-pdf

## 0.4.0

### Minor Changes

- 9e75b7b: ### @file-preview/core
  
  - **修复（D1）**：previewer 以探测结论富化路由文件——裸 IFile（未声明 mimeType）的图片预览 dataUrl 不再误标 octet-stream，PNG 尺寸正常抽取。
  - **修复（D2）**：image 插件魔数自证，伪造扩展名的垃圾字节不再渲染为破损 `<img>`，转由候选链降级。
  - **修复（D3）**：所有候选耗尽且内容为高可读 UTF-8 时，文本救援优先于 hex dump；`ERR_TOO_LARGE` 契约不受影响。
  - **新增（G2）**：`createThumbnailer` 缩略图 API——图片等比缩小、PDF 封面两档首发，其余格式回退「图标＋文件名＋大小」卡片；永不 reject。
  
  ### @file-preview/plugin-pdf
  
  - **新增（G1）**：`pdfPlugin({ maxPages })` 页数预算可配；结果携带 `totalPages / renderedPages` 元数据供调用方自建翻页 UI。
  - **新增（G6）**：浏览器渲染页附带静态透明文本层——原生 Ctrl+F 检索与文字选中复制开箱即用（扫描版自动省略）。
  - **新增（G7）**：`pdfPlugin({ messages })` 注入图注/标题/Node 页头文案，对接任意 i18n 方案。
  - **修复（D2 同源）**：`%PDF-` 魔数自证，伪造扩展名交还候选链。
  
  ### @file-preview/plugin-office
  
  - **新增（G8）**：`officePlugin({ sheet, maxRows })` ——xlsx 工作表按名称/1-based 序号选择、行数预算可配；结果新增 `sheetTotal` 供调用方自建工作表切换器。

### Patch Changes

- Updated dependencies [9e75b7b]
  - @file-preview/core@0.4.0

## 0.3.0

### Minor Changes

- 374f09b: **C3 分包落地（方案 §9 多包结构）**：pdf / office / archive 三类重插件自 `@file-preview/core` 拆出为独立按需包——`@file-preview/plugin-pdf`（pdfjs-dist ^4.10.38）、`@file-preview/plugin-office`（mammoth ^1.9.0 / exceljs ^4.4.0，docx·xlsx·pptx）、`@file-preview/plugin-archive`（fflate ^0.8.2，zip + 炸弹四阈值防御）。
  
  **core 侧变化（迁移注意）**：
  
  - `@file-preview/core` 不再内置/导出 `pdfPlugin` / `officePlugin` / `zipPlugin`，`corePlugins()` 默认集收窄为轻量七插件（image/text/markdown/csv/xml/media/email）；重依赖 pdfjs-dist/mammoth/exceljs/fflate 随插件迁出，core 体积显著下降（主入口 index.cjs gz 115.1K → **96.5K，-16%**）。
  - 按需组合方式：
  
  ```js
  import { corePlugins, createPreviewer } from '@file-preview/core';
  import { pdfPlugin } from '@file-preview/plugin-pdf';
  import { officePlugin } from '@file-preview/plugin-office';
  import { zipPlugin } from '@file-preview/plugin-archive';
  
  const previewer = createPreviewer([...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()]);
  ```
  
  - `@file-preview/core/browser` 与 `core/worker` 零构建入口的默认集保持完整：browser 源码级内联三插件（§14 单文件自带全量默认能力）；worker 默认集含 office/archive，pdf 因 pdfjs 自管 Worker（runsInWorker:false）排除在外——与拆分前行为一致。

### Patch Changes

- Updated dependencies [374f09b]
- Updated dependencies [374f09b]
- Updated dependencies [374f09b]
  - @file-preview/core@0.3.0
