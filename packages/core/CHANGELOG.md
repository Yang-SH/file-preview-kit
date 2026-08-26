# @file-preview/core

## 0.2.0

### Minor Changes

- 生产就绪与格式覆盖收口（Milestone A/B + D1）：
  
  - **新增 pptx 内容预览**：fflate 解压 `ppt/slides/slideN.xml` 抽取文本 → `kind:'html'`，含解压预算防 zip 炸弹；`.pptx` 不再降级为二进制转储
  - **新增 xml 结构化预览**：fast-xml-parser → `kind:'json'`；DOCTYPE 剥离 + XMLValidator 严格校验，免疫 XXE 与实体炸弹；malformed 自动落回纯文本兜底
  - **CSP 部署指南**：`docs/csp-guide.md` 提供零构建/自托管两套最小 CSP 片段与 pdfjs 资源自托管步骤
  - **分发修复**：browser 入口改为仅 ESM，修复 CJS 主入口 require 崩溃与 `import.meta` 警告
  - 新增 golden-file 回归套件、build-clean 冒烟护栏（现共 108 条 vitest 用例）
