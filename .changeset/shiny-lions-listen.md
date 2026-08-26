---
'@file-preview/core': minor
'@file-preview/plugin-pdf': minor
'@file-preview/plugin-office': minor
---

### @file-preview/core

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
