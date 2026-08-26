# @file-preview/plugin-archive

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
