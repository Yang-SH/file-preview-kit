# file-preview-kit

同构文件预览组件库（monorepo）。核心思路：**同构核心 + 环境适配层 + 插件式解析器 + 统一结果模型 + 双渲染器**。

完整设计见 [`项目方案.md`](./项目方案.md)。

## 包结构

| 包 | 说明 |
| --- | --- |
| `@file-preview/core` | 同构核心：流式 `IFile`、类型探测、插件路由、环境适配、渲染层。内置轻量插件集：`image` / `text` / `markdown` / `csv` / `xml`(XXE 加固) / `media`(mediainfo.js WASM 音视频元数据) / `email`(eml 结构化预览)。 |
| `@file-preview/plugin-pdf` | PDF 预览（pdfjs-dist 按需加载；浏览器渲染 PNG 页面 / Node 提取文本）。**已拆分独立包（C3）**。 |
| `@file-preview/plugin-office` | Office 三件套 docx·xlsx·pptx（mammoth / exceljs + fflate 抽取 pptx 文本）。**已拆分独立包（C3）**。 |
| `@file-preview/plugin-archive` | zip 及炸弹四阈值防御（fflate）。**已拆分独立包（C3）**。 |
| `@file-preview/browser` | （规划中）零构建 CDN 包：core + 默认插件集 + Web Component `<file-preview>`。当前由 core 的 `/browser` 零构建入口承担。 |

### 按需组合插件

core 默认集不含 pdf / office / archive 重插件，按需安装并显式组合：

```bash
npm install @file-preview/core @file-preview/plugin-pdf @file-preview/plugin-office @file-preview/plugin-archive
```

```js
import { corePlugins, createPreviewer } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

const previewer = createPreviewer([...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()]);
```

> 零构建入口 `@file-preview/core/browser` 已默认组合三拆分包（单文件自带全量默认能力）；`/worker` 默认集含 office/archive，pdf 因 pdfjs 自管 Worker 而排除。

## 格式支持边界

方案 §5.7 的设计取舍（非缺陷）：

- **eml**：结构化预览（头表 + 正文 + 附件清单）。HTML-only 邮件以转义源码形式展示，不做富渲染。
- **msg（Outlook）**：不支持，走 binary 降级（纯 JS 解析成本高，方案明令暂不覆盖）。
- **字体（ttf/otf/woff）/ 3D 模型**：不支持结构化预览，走 binary 十六进制降级。

## 快速验证

```bash
# 正式测试体系（vitest）：冒烟 9 场景固化 + sanitize XSS 回归 + 错误码回归
npm test

# Node 端到端冒烟测试（无需安装依赖，走 node --experimental-strip-types）
node --experimental-strip-types packages/core/examples/node-ssr/smoke.ts

# 浏览器全功能验证台（21 项断言：全格式 + 安全 + Worker + 缓存）
# ① 静态伺服版（importmap + CDN 重库）：
node packages/core/examples/browser/serve.mjs   # → http://localhost:4173/packages/core/examples/browser/verify-all.html
# ② 离线单文件版（双击直接打开，file:// 协议；全部依赖本地内联，断网可用）：
cd packages/core && npm run verify:offline       # → examples/browser/verify-offline.html
```

两页共用同一份断言模块 [`verify-cases.mjs`](./packages/core/examples/browser/verify-cases.mjs)，结果暴露在 `window.__FPK_VERIFY__` 供自动化消费。

## 设计要点（已落进骨架）

- `IFile` 流式/按需读取：`header()` / `readRange()` / `arrayBuffer()`。
- `Previewer.preview()` 先按 `maxBytes` 护栏短路，再合并默认超时（30s）与 `AbortSignal`。
- `EnvAdapter` 抽离 DOM/fs/WASM/Worker/sanitize；`sanitize` 是唯一清理点。
- 错误码稳定枚举：`ERR_UNSUPPORTED / ERR_TOO_LARGE / ERR_PARSE / ERR_ABORTED / ERR_TIMEOUT`。
- 浏览器零构建入口 `src/browser.ts`：导入即 `customElements.define('file-preview', ...)`。

> Sanitize 默认即生产级：浏览器端 **DOMPurify**、Node 端 **sanitize-html**（入口处调用一次 `initNodeSanitizer()` 懒加载；未初始化时降级依赖-free 的 `minimalSanitize` 并告警）。也可经 `EnvOptions.sanitize` 注入自定义实现——渲染层 `env.sanitize` 始终是唯一清理点。
> 「核心统一派发 Worker」已实现：`createPreviewer({ dispatch: 'worker', workerUrl })` 即后台解析（零构建 Web Component 默认启用）；Node 端 `spawnWorker` 返回 null → 主线程异步。

## Hosting / CSP

托管页若启用严格 CSP，渲染产物所需的 `blob:` / `data:` 资源与跨域 pdf.worker 会被拦截。最小可用 CSP 片段、自托管 pdfjs/worker 部署步骤见 [`docs/csp-guide.md`](./docs/csp-guide.md)。

## 版本与发布（changesets）

版本与 CHANGELOG 由 [changesets](https://github.com/changesets/changesets) 管理（`.changeset/`）：

```bash
npx changeset            # 1) 为用户可感知的改动写一条变更记录（patch/minor/major）
npm run version          # 2) 消费变更：生成各包 CHANGELOG.md + semver bump
npm run release          # 3) 构建 + changeset publish（需 npm 凭据；CI 中由 changesets/action 代办）
```

约定：**major** = 破坏性变更（`PreviewResult`/插件接口语义变化），受影响插件的 `contractVersion` 同步 +1 并在变更正文说明迁移方式。详见 [`.changeset/README.md`](./.changeset/README.md)。
