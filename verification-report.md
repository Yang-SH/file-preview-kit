# file-preview-kit 验证报告

> 任务：验证项目代码与文档内容的一致性（以代码为真相源，只报告、不修改）
> 日期：2026-08-26 · 方式：全量执行（test / build / smoke / typecheck / probe / size / 离线页浏览器真跑）+ 逐条静态对码
> 覆盖文档：`README.md`、`README.zh-CN.md`、`项目方案.md`、`项目进度.md`、`todo.md`、`docs/csp-guide.md`

---

## 总结论

**代码与文档高度一致，核心硬声明全部实证通过。** 共核对 30+ 条硬声明：✅ 通过 26 条，❌ 失实 2 条，⚠️ 轻微偏差/滞后 6 条，外部声明按约定标"未验" 3 条。

- 执行链七道门全部真实跑绿：vitest **125/125**、build ×4 包零警告、smoke `[OK]`、typecheck ×4 包 =0、dist 探针 =0、体积预算 EXIT=0、离线页浏览器断言 **21/21**。
- 两处失实均为**文档滞后**（README 对 demo 页的表述、项目进度.md 的 git/changeset 状态），不涉及代码缺陷。

---

## 一、执行证据（全部真实运行）

| # | 文档声明 | 实测结果 | 判定 |
|---|---|---|---|
| E1 | `npm test` — "125 个 vitest 用例"（README.md:131、zh:131） | `Test Files 11 passed (11) · Tests 125 passed (125)` | ✅ |
| E2 | `npm run build` — 全包 ESM/CJS/DTS（README.md:132） | core/plugin-archive/plugin-office/plugin-pdf 四包全部成功，DTS 齐全，**零 `import.meta` 警告** | ✅ |
| E3 | `npm run smoke` — Node 端到端冒烟（README.md:133） | `[OK] packages/core smoke passed`（sanitizer iframe/object 残留=false、XLSX/PDF/Worker/zip 炸弹防御全过） | ✅ |
| E4 | `verify:offline` 生成两份单文件 HTML（README.md:134） | `demo-offline.html`(8.99 MB) + `verify-offline.html`(9.68 MB) | ✅ |
| E5 | verify 页含 **21 项自动断言**（README.md:136） | Playwright 加载后 `window.__FPK_VERIFY__` = `{pass:21, fail:0}`，覆盖图片/文本/JSON/CSV/MD/XML/**XXE 不展开**/ZIP/**炸弹降级 ERR_TOO_LARGE**/pptx/docx/xlsx/PDF canvas/media/eml/未知降级/损坏 PDF/maxBytes 护栏/LRU 命中/Worker 派发/render 清理点 | ✅ |
| E6 | CI 七步流水线（README.md:141、进度.md §四 C2） | `.github/workflows/ci.yml`:16-48 实有 checkout→npm ci→typecheck→vitest→build→smoke→dist 探针→size 卡点；push(main)+PR 触发 | ✅ |
| E7 | （CI 同款补跑）typecheck | ×4 包 `tsc --noEmit` exit 0 | ✅ |
| E8 | （CI 同款补跑）dist 生产路径探针 | `probe-dist.mjs` exit 0（dist 产物 zip 插件+炸弹防御可用） | ✅ |
| E9 | （CI 同款补跑）体积预算卡点 | `check-size.mjs` EXIT=0：browser.js 29.5K/36K、index.cjs 96.6K/150K、worker.cjs 96.5K/150K、chunks 聚合 95.4K/170K、dist 总量 1159.0K/1843K | ✅ |

## 二、数字与安全声明对码

| # | 文档声明（位置） | 代码证据 | 判定 |
|---|---|---|---|
| N1 | 错误码五枚举 `ERR_UNSUPPORTED/TOO_LARGE/PARSE/ABORTED/TIMEOUT`（README.md:125） | `packages/core/src/errors.ts:2-8` 逐字吻合 | ✅ |
| N2 | ZIP 四阈值防御：条目数/总解压量/单条目/嵌套深度（README.md:124） | `packages/plugin-archive/src/index.ts:16-21`：100MB 总量 / 1000 条目 / 10 层 / 50MB 单条目；:107-122 四级快速失败；smoke 与离线页均实证降级行为 | ✅ |
| N3 | 默认超时 30000ms + maxBytes 默认 100MB（方案 §二.3/§六） | `previewer.ts:33,38`（`opts.timeout ?? 30000`、`100 * 1024 * 1024`）；combineSignal 含已中止 signal 边界修复 | ✅ |
| N4 | core 内置轻量七插件 image/text/markdown/csv/xml/media/email（README.md:26） | `plugins/index.ts:14-24` 恰好七个 | ✅ |
| N5 | `<file-preview>` 默认启用 Worker 统一派发（README.md:76） | `browser.ts:47-51`（`dispatch:'worker'`）+ :81 注册自定义元素 | ✅ |
| N6 | CDN URL `pdfjs-dist@4.10.38`（README.md:56-57） | `browser.ts:14` `PDFJS_VERSION='4.10.38'`，URL 模板逐字一致（CDN 可达性=外部未验） | ✅* |
| N7 | `mediainfo.js@0.3.1` 锁定、emailjs-mime-parser ^2.0.7（todo.md D2/D3） | `packages/core/package.json` dependencies 精确吻合（fast-xml-parser 亦精确锁 5.11.0） | ✅ |
| N8 | v0.3.0 尚未发布 npm（README.md:37） | 本地四包 version 均 0.3.0 且有 CHANGELOG（registry 发布状态=外部未验） | ✅* |
| N9 | 快速开始示例的导入名（corePlugins/createPreviewer/createBrowserEnv/fileFromBrowser/createNodeEnv/initNodeSanitizer/fileFromNode 等） | `packages/core/src/index.ts` 导出清单全部存在 | ✅ |
| N10 | demo 页 16 种样例 + 拖拽投递（README.md:135） | 浏览器实测恰 16 个样例按钮；`demo-app.mjs:195-200` dragenter/dragover/drop 处理链完整 | ✅ |
| N11 | 结果模型九种 kind：image/text/json/table/html/media/tree/binary/error（README.md:17、66） | `types.ts:26-36` 实为 **10 种**——还有 `iframe`（渲染层整页隔离用）。README 列表漏 `iframe` | ⚠️ |
| N12 | gzip 徽章 `core gzip-96.5 kB`（README.md:5、zh:5）及"115.1K→96.5K"（todo.md C3、进度.md §一） | 本次实测 index.cjs gz=**96.6K**，worker.cjs=96.5K。徽章数字当前对应的是 worker.cjs；差 0.1K 属构建漂移未回写 | ⚠️ |

## 三、发现的问题（按严重度）

### ❌ F1 · README 双语版："`window.__FPK_VERIFY__`" 表述失实
- **原文**：README.md:139「Both offline pages run by simply double-clicking them … results are exposed on `window.__FPK_VERIFY__`.」（zh:139 同文）
- **事实**：该全局变量只在 **verify 页**注入（`examples/browser/build-standalone.mjs:221`）；Playwright 实测 **demo 页加载后 `window.__FPK_VERIFY__ === undefined`**。
- **建议改法**：限定为"验证页的结果暴露于 `window.__FPK_VERIFY__`"，或删去"两份"。

### ❌ F2 · 项目进度.md §三「下一步建议」整段过时
- **原文**：进度.md:44「仓库尚未纳入 git……」；:50「3 条待处理 changeset（c3-plugin-split / email / media）」
- **事实**：仓库已初始化且有提交历史（HEAD=e43bf39 docs restructure README…）；`.changeset/` 仅剩 config.json + README.md，**无任何待消费 changeset**；四包已 0.3.0 并各自生成 CHANGELOG——即 §三.1/.2 两项"阻塞/待办"均已完成。
- **建议改法**：§三重写为"已完成/仅剩发布干跑与远端推送"。

### ⚠️ W1 · docs/csp-guide.md §四 称媒体插件「尚未合入」
- csp-guide.md:94「媒体元数据插件（方案 §5.6，**尚未合入**）」——实际 `plugins/media.ts` 已交付、进 `corePlugins()` 默认集、tests/media.test.ts 9 用例在跑（todo.md D2、进度.md §二 §5.6 行均可证）。CSP 指南读者会误以为无需配置 `'wasm-unsafe-eval'`。**建议更新该节为已合入状态并保留 CSP 片段。**

### ⚠️ W2 · gzip 徽章数字漂移（见 N12）
- 徽章/文档写 96.5，当前 index.cjs 实测 96.6（96.5 现对应 worker.cjs）。CI 有 size 门但无"徽章数字同步"机制，属可接受的维护噪声；介意的话可把徽章改为区间或由 CI 回写。

### ⚠️ W3 · 结果模型列表漏 `iframe`（见 N11）
- README 的 kind 枚举少列 `iframe`。若口径是"解析器产出"而非"类型全集"，建议在括号内注明 iframe 由渲染层使用。

### ⚠️ W4 · 设计意图偏差：缓存键哈希算法（方案 §六/§十一 vs 实现）
- 方案两处写 `sha1(header)`；实现为 **FNV-1a**(header 前 4KB)（`cache.ts:9-22`，注释明示为快速哈希的有意取舍）。功能等价（防碰撞前缀指纹），但规格文字未回改。

### ⚠️ W5 · 设计意图偏差：包结构（方案 §九 vs 实现）
- 方案 §九列 8 包（含 plugin-image/media/text/fallback）；实现为 **4 包**（轻插件内置 core，仅拆 pdf/office/archive）。进度.md §二 §9 行已如实记录该取舍（"npm workspaces 四包"），属已声明的有意收敛，非隐瞒。

### ⚠️ W6 · 设计意图偏差：独立 `@file-preview/browser` 包未建（方案 §十四）
- 由 core 的 `/browser` 入口承担同职责；进度.md §三.3 也如实列为 P3 可选项。方案正文未回注。

## 四、外部声明（按约定只验本地可证）

| 声明 | 本地可证部分 | 外部部分 |
|---|---|---|
| CI 徽章指向 Yang-SH/file-preview-kit | `.github/workflows/ci.yml` 存在且步骤与描述一致 | 远端 Actions 运行状态：**未验** |
| v0.3.0 未发布 npm | 本地版本 0.3.0 + CHANGELOG 存在 | registry 实际无此包：**未验** |
| jsdelivr CDN pdfjs-dist@4.10.38 | browser.ts 版本常量与 README URL 一致 | CDN 可达性：**未验** |

## 五、双语互差核对

README.md 与 README.zh-CN.md 逐节对照（特性/包结构/安装/快速开始/格式总表/支持边界/安全/测试与验证/版本与发布/许可证）：结构一一对应、数字一致（125/21/16/96.5）、无单侧独有的功能性差异。唯一共享问题是 F1（两版同句失实）。**判定：互差 ✅ 无。**

## 六、todo.md 与 项目方案.md 的性质说明

- `todo.md` 为执行日志：其历史 vitest 计数序列 91→99→108→117→125 的终态与本次实测 125 吻合；C3 条目所记插件包 @0.2.0 与当前 @0.3.0 的差异系后续 changeset 正常演进，非失实。
- `项目方案.md` 为设计规格 v2.1：除 W4-W6 三处已被进度文档如实声明的取舍外，其余接口契约（IFile 流式三方法、test()→number 归一路由、EnvAdapter 表面、错误码体系、超时/护栏默认值）均与源码逐条吻合。

---

### 附：验证方法备注

- 离线页经本地临时 HTTP 服务 + Playwright(Chromium) 打开读取 `window.__FPK_VERIFY__`（MCP 直接拦截 file:// 协议）；临时服务已关闭、浏览器已退出、临时脚本位于仓库外的 %TEMP%。
- 全程未修改仓库内任何文件；本报告为唯一新增交付物。
