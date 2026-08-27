# file-preview-kit — Agent 最小可实现单元（TODO）

> 数据源：`项目方案.md`（v2.1 设计规格）+ `项目进度.md`（2026-08-25 复验）+ 实际源码核对。
> 用途：把「剩余工作」拆成**单一 Agent 可独立交付**的最小单元。每个单元自带 WHERE / HOW / 验收 / 依赖 / 委派建议，可直接作为 `task()` 的 prompt 骨架。
> 当前完成度（进度文档口径）：核心调度 100% / 安全 100% / 分发 100% / 格式覆盖 ≈95%（§5.1–§5.7 全闭合，仅剩邮件等后置增强）/ 工程化 ≈95%。剩余项即下表。

---

## 阅读约定（单元 Schema）

每个单元字段含义：

| 字段 | 说明 |
|---|---|
| **目标** | 该单元交付什么（一句话） |
| **WHERE** | 涉及文件（相对仓库根 `D:\AI\project\file-preview-kit`），Agent 只在列示范围改动 |
| **HOW** | 实现要点 / 必须遵循的现有模式（避免重复造轮子） |
| **验收** | 完成的可验证证据（测试 / 构建 / 文档评审） |
| **依赖** | 前置单元（阻塞关系）；无则写「无」 |
| **委派** | 建议 `task()` 的 `category` + `load_skills`，用于真正派发时直接套用 |
| **优先级** | P0（生产硬指标）/ P1（高性价比）/ P2（方案后置项） |

> 全局约束（所有单元通用，勿违反）：
> - 解析层**不碰 DOM、不拼最终 HTML**；`env.sanitize` 是唯一清理点（方案 §2/§7）。
> - 插件 `test()` 返回 `number`，`>0` 才匹配，严禁布尔隐式转换（方案 §2.3）。
> - 大文件走 `readRange` / `header()`，禁止整文件 `arrayBuffer()`（除小文件快捷路径）。
> - 重依赖（mammoth/exceljs/pdfjs/sanitize-html/mediainfo）一律**动态 import**，保持 external，缺失时优雅降级。
> - 不 suppress 类型错误（`as any` / `@ts-ignore` 禁用）；不删测试凑绿。

---

## Milestone A — 生产就绪收口（建议优先，P0）

### A1 · CSP 部署文档（方案 §16.3 唯一未交付硬指标）

- **目标**：产出官方 CSP 部署指南，填补「渲染产物被严格 CSP 拦死却无指引」的缺口。
- **WHERE**：新增 `docs/csp-guide.md`；在根 `README.md` 加一段「Hosting / CSP」链接。
- **HOW**：
  - 列出方案 §16.3 四类资源的最小可用 CSP 片段：`img-src blob: data:`、`media-src blob:`、`frame-src/child-src blob:`（`<iframe srcdoc>` 隔离 Office/markdown 整页 HTML）、`worker-src/script-src` 允许 CDN 域（跨域加载 `pdf.worker.min.mjs` 需该 CDN 带 `Access-Control-Allow-Origin`）。
  - 自托管说明：把 `pdf.worker.min.mjs`、mediainfo `MediaInfoModule.wasm` 随包固定托管于同源 `assets/`，避免跨域 CORS 坑（呼应 `browser.ts` 的 `CDN_BASE` 思路）。
  - 给出「零构建 `<script type=module>` 引入」与「bundler 场景」两种 CSP 差异说明。
- **验收**：文档覆盖 §16.3 全部 4 类资源；含可复制的最小 CSP 片段 + 自托管部署步骤；经人工文档评审通过。
- **依赖**：无。
- **委派**：`category="writing"`，`load_skills=["technical-writer"]`。
- **优先级**：P0。

### A2 · 修复 tsup CJS `import.meta` 警告（削弱 §14 零构建/CJS 分发）

- **目标**：消除 CJS 产物中 `import.meta` 警告，使 CJS 消费者能解析 worker URL，`<file-preview>` 的 CJS 形态可用。
- **WHERE**：`packages/core/src/browser.ts:12`（`new URL('./worker.js', import.meta.url)`）；`packages/core/tsup.config.ts`；可选 `packages/core/tests/smoke.test.ts`。
- **HOW**：
  - 根因：`tsup.config.ts` 对 `browser` 入口同时出 `format: ['esm','cjs']`，CJS 下 `import.meta.url` 无效 → 警告 + 空 worker URL。
  - 三选一（按成本/风险择优，推荐方案 a）：
    - **(a)** `browser` 入口仅出 ESM（在 `tsup.config.ts` 为 browser 单开 `format:['esm']`，index/worker 仍双产物）；CJS 用户走 `index` + 自行托管。
    - **(b)** CJS 兼容分支：用 `createRequire(import.meta.url)` 解析 `worker.js` 路径，或在 `browser.ts` 顶层 `const WORKER_URL = typeof import.meta !== 'undefined' ? new URL(...).href : require.resolve('./worker.js')`（注意 tsup CJS 仍需 `createRequire` 注入）。
    - **(c)** 文档声明「CJS 不支持零构建 `<file-preview>`」，仅 ESM 支持。
  - 选 (a) 或 (b) 后，补一条冒烟断言：CJS 下 `require('@file-preview/core')` 拿到的 `browser` 入口 `WORKER_URL` 非空。
- **验收**：`npm run build`（或 `pnpm --filter @file-preview/core build`）后 CJS `browser` 产物不再打印 `import.meta` 警告；或 `WORKER_URL` 在 CJS 下可解析；新增的冒烟断言通过。
- **依赖**：无（与 A1 独立，可并行）。
- **委派**：`category="deep"`（构建配置 + 入口代码联动，需谨慎），`load_skills=[]`。
- **优先级**：P0（复验发现的真实缺陷，直接削弱 P0 分发路径）。

### A3 · golden-file 回归测试套件（方案 §12 唯一缺失的测试类别）

- **目标**：补齐方案点名要建、却仍缺的 golden-file 回归，锁定「输入 → 期望 `PreviewResult` 快照」长期护栏。
- **WHERE**：新增 `packages/core/tests/golden/` 目录 + `packages/core/tests/golden/*.test.ts`；新增 `packages/core/tests/fixtures/`（小型真实样例：png/txt/csv/json/md/docx/xlsx/pdf/zip）；复用 `packages/core/tests/helpers.ts` 的 `memFile`。
- **HOW**：
  - 沿用现有测试约定：直接从 `../src/...ts` 引 TS 源码（strip-types），`nodeAdapter` + `initNodeSanitizer()` 驱动（参考 `archive.test.ts`）。
  - 每格式一个用例：`preview(file, nodeAdapter)` → `expect(result).toMatchSnapshot()`；快照首次生成后固化进仓库。
  - 对「内容确定性」强的格式（text/table/tree/json）做精确 `toEqual`；对 html（mammoth 版式可能随依赖版本漂移）用 `toMatchSnapshot` 并文档化如何 `vitest -u` 更新。
  - fixtures 用真实最小文件（可用现有 `node-ssr` 示例或脚本生成），避免 100MB 级样本（参考 archive.test 用 `zipSync` 内联生成的做法）。
- **验收**：至少覆盖 image/text/markdown/csv/json/office(docx,xlsx)/pdf/zip 各 1 例；`npm test` 比对快照通过；README 或测试顶部注明快照更新方式。
- **依赖**：无（与 A1/A2 独立）。建议 fixtures 生成脚本与 A3 同单元交付。
- **委派**：`category="tdd"`（加载 tdd skill）或 `writing`，`load_skills=["tdd"]`。
- **优先级**：P1。

### A4 · 复验收口（跨单元验证门，非独立 Agent 单元）

- **说明**：A1–A3 完成后统一复验：`npm test` / `npm run smoke` / dist 探针全绿，并同步更新 `packages/core/TDD-REPORT.md` §八。这是验收闸门，不单独派工，由编排者在 A1–A3 全部 `completed` 后执行。
- **验收证据**：`BUILD=0` / `vitest 全绿` / `SMOKE=0` / `DIST 探针=0`，TDD-REPORT 记录日期与结论。

---

## Milestone B — Office 收口（pptx，P1）

> 理由（进度文档）：pptx 是方案 §5.3 明确列出、当前**静默降级成 hexdump** 的格式，体验最差；mediainfo 是元数据增强（缺失时媒体仍能二进制/文本兜底）。故先 pptx。

### B1 · office.ts 增加 pptx 解析分支

- **目标**：让 `.pptx` 产出内容预览（文字 + 幻灯片清单），不再降级 binary。
- **WHERE**：`packages/core/src/plugins/office.ts`（新增 `previewPptx`）；参考 `packages/core/src/plugins/archive.ts`（fflate 解压用法）与 `packages/core/src/detect.ts`（`zipHint` 已能产出 `'pptx'`）。
- **HOW**：
  - 解压：`fflate.unzip` 已为依赖，复用 archive 的 unzip 模式；读 `ppt/slides/slideN.xml` + `ppt/presentation.xml`（幻灯片顺序）。
  - 抽取：slide XML 内 `<a:t>` 文本节点 → 拼成 `kind:'html'`（每页标题 + 文本列表）或 `kind:'tree'`（幻灯片清单）。版式还原有限，仅内容预览（同 docx caveat）。
  - 无扩展名场景：`detect.ts` 已按中央目录 `ppt/` 判 `zipHint='pptx'`，直接消费。
  - 错误处理：解析失败返回 `{kind:'error', code: ERR_PARSE, ...}`，由 router 交下一插件。
  - 复用 `PreviewErrorCode`（来自 `../errors.ts`）。
- **验收**：真实最小 `.pptx` 经 `officePlugin().preview` 产出非 binary 的 `html`/`tree`；损坏 pptx（PK 头 + 垃圾）返回 `ERR_PARSE`。
- **依赖**：无（可独立开发，但 B2/B3 依赖它）。
- **委派**：`category="deep"`，`load_skills=[]`（XML 抽取纯字符串处理，勿引 DOMParser——Node 无 DOM，用正则或 `fast-xml-parser`）。
- **优先级**：P1。

### B2 · officePlugin().test() 增加 pptx 优先级

- **目标**：路由层对 pptx 正确命中 office 插件，`.pptx` 不再被 archive 接管或降级。
- **WHERE**：`packages/core/src/plugins/office.ts` 的 `test()`（当前 pptx 返回 0）；`packages/core/src/plugins/archive.ts` 的 `test()`（已对 pptx 返回 0，需保持）。
- **HOW**：
  - office `test()` 加：`if (ctx.zipHint === 'pptx') return 90;` `if (ctx.extension === 'pptx' || ctx.extension === 'pptm') return 90;`
  - 确认 archive `test()` 对 `zipHint==='pptx'` 仍返回 0（现有 `archive.test.ts:128` 已断言，勿破坏）。
- **验收**：`officePlugin().test({zipHint:'pptx'}) > 0`；全默认插件集 `corePlugins()` 下 `.pptx` 不再降级 binary；现有 archive 路由互斥测试仍绿。
- **依赖**：B1（同文件，建议与 B1 同单元或紧接）。
- **委派**：`category="quick"`（单文件条件分支），`load_skills=[]`。
- **优先级**：P1。

### B3 · pptx vitest fixture + 错误码/降级回归

- **目标**：为 pptx 建立测试护栏，固化「正常产出 + 损坏降级」行为。
- **WHERE**：新增 `packages/core/tests/office.test.ts`；fixture 同 A3 的 `tests/fixtures/`（放一个最小真实 `.pptx`）。
- **HOW**：沿用 `archive.test.ts` 模式——`memFile` / `nodeAdapter` / `initNodeSanitizer`；用例：① 最小 pptx → 非 binary；② 损坏 pptx → `ERR_PARSE`；③ 全插件集集成：`.pptx` 经 `createPreviewer({plugins:corePlugins()})` 出 html/tree。
- **验收**：3 条用例全绿；并入 CI（随 `npm test`）。
- **依赖**：B1、B2。
- **委派**：`category="tdd"`，`load_skills=["tdd"]`。
- **优先级**：P1。

---

## Milestone C — 工程化收尾（方案 §9/§12，P2）

### C1 · changesets 版本治理

- **目标**：落地 `changesets` 管版本与 CHANGELOG，配合 `contractVersion` 演进。
- **WHERE**：新增 `.changeset/config.json`、`.changeset/README.md`；根 `package.json` 加 `changeset`/`version`/`publish` 脚本；`pnpm-workspace.yaml` 已存在（27B）仅需确认含 `.changeset` 无关项。
- **HOW**：安装 `@changesets/cli`；初始化配置；写一条 initial changeset；脚本接 npm publish（发 npm 暂不需真发，仅打通流程）。
- **验收**：`npx changeset` 可用；`npx changeset version` 能产出 CHANGELOG + semver bump；文档注明流程。
- **依赖**：无（可与 A 并行）。
- **委派**：`category="unspecified-low"`，`load_skills=[]`。
- **优先级**：P2。

### C2 · CI 体积预算卡点

- **目标**：每插件产物（含 wasm）设 bundle size 上限，CI 卡点防膨胀。
- **WHERE**：新增 `.github/workflows/ci.yml`；新增 size 配置（如 `size-limit` 或 `bundlesize`），挂在 `packages/core/package.json`。
- **HOW**：CI 串联 `vitest` + `smoke` + size 检查；对各入口（index/browser/worker）设体积上限（参考方案 §12「体积预算」）。复验 `npm test` / `npm run smoke` 全绿（呼应 A4）。
- **验收**：PR 触发 CI，超限则失败；正常产物通过。
- **依赖**：A3、C1（测试与版本流程就绪后接 CI 才有意义）。
- **委派**：`category="unspecified-low"`，`load_skills=[]`。
- **优先级**：P2。

### C3 · 按 §9 拆分 `plugin-*` 独立包（✅ 2026-08-26 完成，证据见 TDD-REPORT §十六）

- **目标**：将核心内置的重依赖插件拆为独立包，减小主包、落实方案 §9 多包结构。
- **WHERE**：新增 `packages/plugin-pdf/`、`packages/plugin-office/`、`packages/plugin-archive/`（及后续 media）；改写 `packages/core/package.json` 依赖、`pnpm-workspace.yaml`、`packages/core/src/plugins/index.ts`（core 改为 re-export 或动态聚合）。
- **HOW**（建议拆为 3 个原子子单元，勿一次性大改）：
  - **C3a** pdf 拆分：`plugin-pdf` 包 pdfjs 逻辑，`core` 改为 `peerDependency` + 动态 import。
  - **C3b** office 拆分：`plugin-office` 包 mammoth/exceljs/pptx 逻辑。
  - **C3c** archive 拆分：fflate 逻辑外移。
  - 每个子单元遵循现有 `contractVersion:1` 契约与 `test()>0` 路由约定；`tsup` 双产物 + `sideEffects:false`。
- **验收**：拆分后 `corePlugins()` 仍聚合可用；`npm test` 全绿；主包体积下降（C2 卡点验证）。
- **依赖**：C1（版本治理先行）。
- **委派**：`category="unspecified-high"`（跨包重构，需谨慎），`load_skills=[]`；建议 C3a→C3b→C3c 顺序、每步独立验证。
- **优先级**：P2（方案明确后置，可延后）。

---

## 额外缺口（来自 §二 对账表，非进度文档 Milestone，但方案有要求）

### D1 · XML 正确处理（方案 §5.5，当前按纯文本兜底）

- **目标**：`.xml` 不再当纯文本，而是解析为 `kind:'json'` 或 `kind:'tree'`，并防 XXE。
- **WHERE**：新增 `packages/core/src/plugins/xml.ts`；在 `packages/core/src/plugins/index.ts` 注册；`detect.ts` 扩展名/MIME 已覆盖 `xml`。
- **HOW**：用 `fast-xml-parser`（默认禁实体扩展，天然防 XXE，呼应方案 §5.5/§11）；`test()` 按扩展名 `xml` 或内容首行 `<?xml` 命中；产出 `json`（结构化）或 `tree`（节点树）。
- **验收**：`.xml` 产出非纯文本结果；构造 XXE payload 被拒（不外联/不展开实体）；加 vitest 用例。
- **依赖**：无。
- **委派**：`category="unspecified-high"`，`load_skills=[]`。
- **优先级**：P1（方案点名格式，当前 ⚠️ 缺口）。

### D2 · mediainfo 媒体元数据插件（方案 §5.6，当前无 plugin-media）

- **目标**：音频/视频文件经 mediainfo.js(WASM) 提取元数据，产出 `kind:'media'`；浏览器生成播放 src，Node 仅 metadata。
- **WHERE**：新增 `packages/core/src/plugins/media.ts`（或独立 `plugin-media` 包）；注册进 `corePlugins()`/`workerPlugins()`；`env.loadWasm` 接管 wasm 加载。
- **HOW**：按方案 §5.6 用 `MediaInfoFactory.createMediaInfo({ locateFile: p => env.loadWasm(p) })` + `analyzeData(()=>file.size, (cs,off)=>file.readRange(off,off+cs))`；**锁定 `mediainfo.js@0.3.1`**（BSD-2-Clause 干净，但上游停更，方案要求固定托管 wasm）；ffmpeg 不引入。
- **验收**：真实音视频文件经 `mediaPlugin().preview` 产出 `media` 元数据；浏览器端 `env.createObjectURL` 给出可播放 src；加 vitest（用 mock wasm 或最小样本）。
- **依赖**：无（引入 WASM 外部依赖，方案标 P2，建议在 B/pptx 之后）。
- **委派**：`category="unspecified-high"`，`load_skills=[]`。
- **优先级**：P2。

### D3 · 字体 / 3D / 邮件（方案 §5.7，低优先）

- **目标**：补齐方案 §5.7 余下格式——eml 用 `emailjs-mime-parser` 解析；msg 暂不覆盖；字体/3D 仅做基础元数据或声明不支持。
- **WHERE**：新增 `packages/core/src/plugins/email.ts`（eml）；其余在 `fallback` 或文档标注未覆盖。
- **HOW**：eml → 解析头/正文/附件结构 → `tree`/`html`；字体/3D 走 `binary` 降级并明确文档说明（避免过度投入）。
- **验收**：`.eml` 产出结构化结果；文档列出 font/3d/msg 的支持边界。
- **依赖**：无。
- **委派**：`category="unspecified-low"`，`load_skills=[]`。
- **优先级**：P2（方案后置）。

---

## 推荐执行顺序（编排参考）

```
A1 ─┐
A2 ─┼─(并行)─→ A4 复验门 ─→ 生产可发布
A3 ─┘
B1 → B2 → B3          （Office 收口，P1）
D1                    （XML 缺口，P1，可与 B 并行）
──────── 以下 P2，按资源再排 ────────
C1 → C2               （工程化）
D2 → D3               （媒体/邮件）
C3a → C3b → C3c       （分包，最后）
```

> 完成 A1+A2+A3+B1+B2+B3+D1 后，方案「可落地承诺」基本 100% 达成（核心/安全/分发/主流格式全覆盖 + 生产就绪四项齐备 + 回归闭环）。C/D2/D3/C3 为方案后置的 P2 增强。

---

## 执行状态

- **2026-08-25 · Milestone A 全部完成并通过复验门 A4**（`BUILD=0` 零 import.meta 警告 / `vitest 91/91` / `SMOKE=0` / 探针=0；证据见 `packages/core/TDD-REPORT.md` §九）：
  - **A1 ✅** `docs/csp-guide.md` + README「Hosting / CSP」段；
  - **A2 ✅** 采用方案 (a)（browser 仅出 ESM）并额外修复复验发现的更重缺陷——空 `import.meta` shim 使 `index.cjs` 顶层 `new URL(...)` 抛 RangeError、整个 CJS 主入口 require 崩溃，及 `pdf.ts` 的 `createRequire(undefined)` 抛错；新增回归护栏 `tests/build-clean.test.ts`；
  - **A3 ✅** `tests/golden/`（9 格式 10 用例）+ `gen-fixtures.mjs` + 提交的确定性 fixtures；
  - **A4 ✅** 复验全绿，TDD-REPORT §九 与 项目进度.md 已同步。
- **2026-08-25 · Milestone B 全部完成并复验**（`BUILD=0` 零警告 / `vitest 99/99` / `SMOKE=0` / 探针=0 / `tsc=0`；证据见 `TDD-REPORT.md` §十）：
  - **B1 ✅** `office.ts` 新增 `previewPptx`（fflate 解压 slide XML + `<a:t>` 抽取 → html；64MB 解压预算防炸弹；实体还原后转义）+ 候选链路由（docx/xlsx/pptx 互退，兼容改名场景）；
  - **B2 ✅** `test()` 对 `zipHint==='pptx'` 与扩展名 pptx·pptm 返 90；archive 互斥断言保持绿；
  - **B3 ✅** `tests/office.test.ts` 8 用例（内联 zipSync 确定性 fixture）：正常 html / 损坏 ERR_PARSE（插件级）/ binary 降级契约（管线级）/ 路由互斥 / 无扩展名兜底 / 空白页占位。
- **2026-08-25 · D1 XML 插件完成并复验**（`tsc=0` / `vitest 108/108` / `SMOKE=0` / 探针=0 / `BUILD=0` 零警告；证据见 `TDD-REPORT.md` §十一）：
  - **D1 ✅** `plugins/xml.ts`（fast-xml-parser → json；显式 110 / 嗅探 60 / svg·zipHint 排除）+ 双层 XXE 加固（DOCTYPE 剥离 + XMLValidator 严格校验，实测修正 FXP 宽松解析盲区）+ `tests/xml.test.ts` 9 用例；新依赖 `fast-xml-parser` 已锁定版本入 packages/core。
- **2026-08-25 · C1 changesets 版本治理完成并复验**（108/108 全绿；证据见 `TDD-REPORT.md` §十二）：
  - **C1 ✅** `@changesets/cli` + `.changeset/{config.json,README.md}`（含 contractVersion 联动规则）+ 根脚本 `changeset/version/release`；initial changeset 经 `npx changeset version` 实证：core **0.1.0→0.2.0** + CHANGELOG 自动生成。
- **2026-08-25 · C2 CI 体积预算卡点完成并复验**（108/108 全绿；证据见 `TDD-REPORT.md` §十三）：
  - **C2 ✅** `packages/core/scripts/check-size.mjs`（五入口 gzip 逐限 + 动态 chunk 聚合 + dist 总量护栏；正/负双向实证 exit 0/1）+ `.github/workflows/ci.yml` 七步流水线（typecheck→vitest→build→smoke→探针→size 卡点）。§12 测试与发布五项要求自此全部齐备。
- **2026-08-25 · D2 mediainfo 媒体元数据插件完成并复验**（`tsc=0` / `vitest 117/117` / `SMOKE=0` / 探针=0 / `BUILD=0` 零警告 / `SIZE=0`；证据见 `TDD-REPORT.md` §十四）：
  - **D2 ✅** `plugins/media.ts`：mediainfo.js@**0.3.1** 锁定 + 动态 import external；`analyzeData` 流式区间读取（不整文件加载）；wasm 定位三级策略（`getAssetUrl('mediainfo.wasm')` 注入 → Node createRequire 解析 exports 子路径 → emscripten 默认）；轨道判定以 Audio·Video 为准（实测垃圾文本也有 General 轨，防误判）；浏览器 `file.blob` 零拷贝优先产出播放 src，Node 仅 metadata；`close()` 释放 WASM 堆。`tests/media.test.ts` 9 用例（真实 WASM 解析最小 WAV / 损坏 ERR_PARSE / 路由互斥 / 管线集成 / browser src 契约）。方案点名格式 §5.1–§5.7 自此全部闭合。
- **2026-08-25 · D3 邮件 eml 插件完成并复验**（`tsc=0` / `vitest 125/125` / `SMOKE=0` / 探针=0 / `BUILD=0` 零警告 / `SIZE=0`；证据见 `TDD-REPORT.md` §十五）：
  - **D3 ✅** `plugins/email.ts`：emailjs-mime-parser@^2.0.7(MIT) 动态 import external → kind:'html'（头表 + mime-word 解码主题 + QP/base64 正文还原 + 附件清单）；HTML-only 邮件转义源码展示的安全边界；CJS 双形态互操作（探针实证 Node ESM 与 bundler 两形态）；上游 7bit 非 ASCII 截断边界如实记录于 TDD-REPORT §十五.3。`tests/email.test.ts` 8 用例。README「格式支持边界」节声明 font/3d/msg 走 binary 降级（todo 验收第二项）。方案格式章节 §5.1–§5.7 全部闭合。
- **2026-08-26 · C3 分包完成并复验**（`typecheck×4 包=0` / `vitest 125/125` / `BUILD×4 包=0` 零警告 / `SMOKE=0` / `verify:browser 探针=0` / `probe-dist=0` / `CJS require OK 且 pdfPlugin 零泄漏` / `SIZE=0`；证据见 `TDD-REPORT.md` §十六）：
  - **C3a ✅** `@file-preview/plugin-pdf@0.2.0`：pdfPlugin 全量迁出（pdfjs-dist ^4.10.38 随迁），源码级 exports 免构建排序；
  - **C3b ✅** `@file-preview/plugin-office@0.2.0`：officePlugin 迁出（mammoth ^1.9.0 / exceljs ^4.4.0 随迁，docx·xlsx·pptx 不变）；
  - **C3c ✅** `@file-preview/plugin-archive@0.2.0`：zipPlugin + ZipGuardLimits 迁出（fflate ^0.8.2 随迁，炸弹四阈值防御不变）；
  - core 默认集收窄为轻量七插件、重依赖随插件迁出（index.cjs gz **115.1K→96.5K，-16%**）；browser/worker 零构建入口源码级内联保持默认集完整；7 个受影响测试文件改显式组合；check-size.mjs 新基线重校准；`.changeset/c3-plugin-split.md` 单条多包变更记录 + README 包结构与「按需组合插件」用法同步。
- 方案全部待办清空——A1–A3/A4、B1–B3、C1/C2/C3、D1/D2/D3 全部交付，无剩余项。
