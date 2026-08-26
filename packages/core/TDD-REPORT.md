# packages/core TDD 验证报告

> 验证方式：真实构建 + 真实运行，不依赖摘要。全部结论来自实际执行的命令输出。
> 日期：2026-08-24 · 范围：`@file-preview/core` 骨架（方案 §1–§16 的可落地部分）

---

## 一、验证结论（TL;DR）

**核心调度引擎、流式 IFile、探测、image/text/json/Office/PDF 插件、真实 sanitizer、Worker 派发骨架、Web Component、dist 产物——全部实现并真跑通。**

> **2026-08-25 追加轮**：markdown/csv 渲染插件、zip 压缩包插件（含炸弹防御阈值）已补齐并全链路验证（vitest 77 用例 + smoke 11 场景 + dist 产物探针），详见第六节；同日**真机实证**（Chromium/Playwright）跑通 WC 渲染 / Worker 统一派发 / PDF canvas，详见第七节。下文矩阵与缺口清单已同步更新。

本轮额外修复 3 个此前遗留的缺口（均为测试暴露）：

| # | 问题 | 修复 |
|---|---|---|
| 1 | `node:module` 解构 `createRequire` 类型报错，DTS 构建失败 | 显式断言 `NodeRequire` |
| 2 | PDF 插件 Node 分支导入标准构建 → 打印 legacy 警告 | 改导 `pdfjs-dist/legacy/build/pdf.mjs` |
| 3 | PDF 标准字体经 `standardFontDataUrl` + Node fetch 加载 `file://` 失败 → 打印 UnknownErrorException | 改用自定义 `StandardFontDataFactory`，fs 直读字体（pdfjs 官方 Node 推荐做法） |

修复后**冒烟测试零警告、零报错**；构建（tsup CJS）现输出 3 条 `import.meta` 警告（不影响产物可用性，见第八节）。

---

## 二、执行证据（真实命令输出）

### 2.1 构建：ESM / CJS / DTS 全绿

```
DTS ⚡️ Build success in 6681ms
ESM ⚡️ Build success in 50ms
CJS ⚡️ Build success in 80ms
BUILD_EXIT=0
```

产物：`dist/index.js(.cjs)` / `browser.js(.cjs)` / `worker.js(.cjs)` + `.d.ts/.d.cts` 全量生成。

### 2.2 Node 冒烟测试：9 场景全过、零警告

```
SANITIZE iframe 残留 = false | object 残留 = false   ← 真实 sanitizer 剥离恶意标签
TEXT   kind = text | <pre class="fp-text">…中文…
JSON   kind = json | keys=name,ok,n
BINARY kind = binary | hexDump generated             ← 未知文件降级
IMAGE  kind = image | 1x1                            ← PNG 尺寸提取
CACHE  hit = true                                    ← LRU 缓存命中
XLSX   kind = table | cols=Name,Age rows=1           ← exceljs→table
PDF    kind = text | 含"Hello PDF"=true              ← pdfjs legacy 文本提取
WORKER kind = text | pdf 已排除出 worker 集 = true    ← 派发分流正确
        corePlugins 含 pdf = true
✅ packages/core 骨架端到端跑通（含真实 sanitizer / Office / PDF / Worker 派发逻辑）
SMOKE_EXIT=0
```

### 2.3 浏览器路径（jsdom）

```
BROWSER <file-preview> render pre = "hello from browser\n第二行"
✅ 浏览器 render + <file-preview> 跑通 (jsdom)
VERIFY_EXIT=0
```

### 2.4 产物可被 Node 直接消费（生产路径）

```
DIST   kind = table | 产物包经包名消费走通 = true
✅ dist 产物可被 Node 直接 import 消费（生产路径）
```

即 `import { createPreviewer } from '@file-preview/core'` 指向的 `dist/index.js` 真实可用，**不是**仅 `--experimental-strip-types` 源码能跑。

### 2.5 worker.js 体积与重库隔离

```
dist/worker.js   897 B    ← 无 pdfjs/exceljs/mammoth 引用（grep=0）
dist/index.js    1.14 KB  ← 入口，重库走动态 import
dist/browser.js  1.97 KB  ← 含 <file-preview> 注册副作用
```

"重依赖动态 import 不进主包"（方案 §9）在产物层面成立。

---

## 三、方案承诺 vs 实测 对账矩阵

| 方案要求 | 实测 | 状态 |
|---|---|---|
| §1 流式 IFile（浏览器 Blob.slice / Node fd 按次开闭） | smoke IMAGE 走 Blob、fileFromNode 零泄漏告警 | ✅ |
| §2 探测（魔数+扩展名+PK头+EOCD 细分 docx/xlsx/pptx+文本兜底） | detect.ts 全程被调用、BINARY 降级命中 | ✅ |
| §3 核心统一派发 Worker（主线程发 Blob→Worker 重建 IFile→runPipeline→回传纯数据） | previewer.ts `dispatch:'worker'` + worker.ts 协议完整；smoke 验证分流逻辑（pdf 排除）；**真机 Chromium 实证 txt/png/zip 双通道逐字节一致**（§7） | ✅ |
| §5 image / text / json | 实测通过 | ✅ |
| §5 Office（docx→mammoth、xlsx→exceljs） | XLSX→table 实测通过；docx 依赖就绪未单独断言 | ✅ |
| §5 PDF（浏览器 canvas 渲染 / Node 文本提取） | Node 文本提取实测通过；**真机 Chromium canvas 渲染出 PNG 页图**（§7）。CJK 内嵌字体的 PDF 渲染未测（fixture 无嵌入字体） | ✅ |
| §5 markdown→html / csv→table / xml | markdown-it(html:false 纵深防御)/papaparse 专用插件，vitest 实测；xml 仍按纯文本兜底 | ✅ md/csv / ❌ xml |
| §5 压缩包 + zip 炸弹防御 | zipPlugin 只读中央目录清单（fflate filter 恒 false 永不解压），超限降级 hex dump | ✅ |
| §5 媒体 mediainfo | 未实现 | ❌ |
| §7/§16 sanitize 唯一清理点（DOMPurify/sanitize-html） | iframe/object 剥离实测；未装依赖时降级 minimalSanitize 并告警 | ✅ |
| §9 重库按需加载 | worker.js 897B 零重库引用 | ✅ |
| §11 zip 炸弹：≤100MB/≤1000 条目/≤10 嵌套 | 四阈值全部落地（方案三阈值 + 加码单条目 ≤50MB）；默认值（11 层/1001 条目）与注入小阈值双路实测 | ✅ |
| §14 `<file-preview>` Web Component 零构建引入 | jsdom 实证 render 输出 + **真机 Chromium shadow DOM 中文渲染**（§7）；`dist/browser.js` 已产出 | ✅ |
| §16 错误码 / 30s 超时 / AbortSignal | errors.ts + combineSignal 实现并被 smoke 覆盖 | ✅ |
| §16 CSP 文档 | 未写 | ❌ |
| §12 golden-file / sanitize 回归 / zip 炸弹测试 | vitest 77 用例：sanitize XSS 回归、错误码回归、zip 炸弹 fixture（注入小阈值 + 默认阈值双路）；golden-file 回归未建 | ⚠️ |
| 构建产物 ESM/CJS/DTS + worker entry | 全绿，4.2 节证据 | ✅ |

**达标率（以可落地承诺计）：核心调度 100%、安全 100%、分发 100%、格式覆盖约 75%（md/csv/zip 补齐后）、工程化约 70%（vitest 已接入）。**

---

## 四、剩余缺口（诚实标注，非 bug）

### 功能缺口（方案有、骨架无）
1. **媒体元数据**（mediainfo 或 music-metadata）——P2 优先级本就靠后。
2. **xml 专用渲染**——低优先级，当前按纯文本兜底。
3. **CJK 字体 PDF 的浏览器渲染**——fixture 未嵌入中文字体，pdfjs 渲染管线本身已真机实证（§7）。

### 工程化缺口
4. golden-file 回归测试未建（sanitize/XSS/错误码/zip 炸弹回归已建）。
5. CSP 部署文档未写。
6. changesets 发布流、体积预算 CI 未配。
7. ~~fflate 未声明进 package.json~~ **已修正**：根 `package.json` 的 `dependencies` 已声明 `fflate@^0.8.3`，workspace 内 core 可直接 import（零构建场景仍由 tsup 打进 bundle）。

---

## 五、验收标准建议（下一步 TDD 清单）

若把"生产可用"定义为下列全部通过，则当前完成度约 85%，按优先级补齐：

- [x] **P0** vitest 接入：把 smoke 场景固化为正式用例 + sanitize 回归（含 iframe/object/script 注入样本）
- [x] **P0** 真实浏览器（Playwright）实证：`<file-preview>` + Worker 派发 + PDF canvas 渲染（§7；CJK 内嵌字体 PDF 留待补充 fixture）
- [x] **P1** markdown→html / csv→table 渲染器（纯 JS，低成本）
- [x] **P1** zip 炸弹条目/嵌套阈值（fflate）
- [ ] **P2** CSP 文档（blob:/srcdoc/跨域 Worker 三处）
- [ ] **P2** changesets + 体积预算 CI

---

## 六、2026-08-25 收口轮证据（zip 插件 + 炸弹防御 + markdown/csv）

> 全部命令真实执行于 `packages/core`，输出未删减关键行。

### 6.1 正式测试：77/77 全绿（含新增 opts 契约回归）

```
 Test Files  5 passed (5)
      Tests  77 passed (77)
TEST_EXIT=0
```

`tests/archive.test.ts` 覆盖：zip→tree 基础 4 用例、炸弹四阈值注入小阈值 4 用例、生产默认阈值 3 用例（11 层深降级、1001 条目降级、10 段不降级的边界语义）、路由互斥与集成 4 用例、渲染 1 用例、opts 省略契约回归 1 用例。

### 6.2 构建 + smoke 11 场景（新增 ZIP/BOMB 两场景）

```
ESM ⚡️ Build success / CJS ⚡️ Build success / DTS ⚡️ Build success    BUILD_EXIT=0
ZIP    kind = tree | roots=d,r.txt                                    ← 真实 .zip 经 detect → archive → tree
BOMB   kind = binary | code=ERR_TOO_LARGE reason=zip bomb guard: 3 entries > max 2
SMOKE_EXIT=0   （零警告零报错）
```

### 6.3 dist 产物探针（生产路径，非 strip-types 源码）

```
✅ DIST zip → tree | roots=d,r.txt
✅ DIST zip 炸弹防御降级 | zip bomb guard: 3 entries > max 2
PROBE_EXIT=0
```

探针脚本固化于 `examples/node-ssr/probe-dist.mjs`（经包名 `@file-preview/core` 消费 dist）。

### 6.4 产物健康度

```
worker.js 0.9KB —— pdfjs/exceljs/mammoth/papaparse/markdown-it 引用 = 0；fflate 保持动态 import 外置
markdown-it/papaparse 各自独立 chunk，主入口 index.js 1.2KB
```

### 6.5 本轮修复的真实 bug（探针实证）

dist 探针直接调用插件省略第三参时抛 `TypeError: Cannot read properties of undefined (reading 'onProgress')`——全部 8 处插件的 `opts.onProgress?.()` 在 `opts === undefined` 时崩溃（管线恒传 opts 所以 vitest 未暴露）。修复：

1. `types.ts` 契约改为 `preview(file, env, opts?: PreviewOptions)`；
2. 8 处调用点统一改 `opts?.onProgress?.()`；
3. 新增回归测试「opts 省略时不抛错」。

---

## 七、2026-08-25 真机实证（Chromium · Playwright）

> 环境：本地静态服务（`examples/browser/serve.mjs`，仓库根 :4173）+ Playwright MCP 驱动真实 Chromium。
> 页面：`examples/browser/verify.html`（自校验，结果暴露于 `window.__VERIFY__`）；fixture 由 `gen-fixtures.mjs` 生成。
> pdfjs 资产走**本地 node_modules 路径**（非 CDN），排除网络变量。截图存档 `docs/verify-browser-all-pass.png`。

### 7.1 结果：10/10 PASS，pageErrors=[]

```
PASS worker-url-resolves        :: …/dist/worker.js
PASS worker-consistency:hello.txt :: kind=text/text      ← 主线程 vs 真实 Worker 结果逐字节一致
PASS text-cjk-intact            :: 第二行中文测试 无损
PASS worker-consistency:logo.png  :: kind=image/image
PASS worker-consistency:sample.zip:: kind=tree/tree      ← zip 经真实 Worker 派发出树
PASS zip-tree-roots             :: ["d","r.txt"]
PASS no-worker-fallback-warnings:: （Worker 派发未回退主线程）
PASS wc-shadow-dom-text         :: <file-preview> shadow DOM 中文渲染
PASS pdf-canvas-pages           :: pages=1 kind=html     ← pdfjs 自管 Worker → canvas → PNG
PASS pdf-png-dataurl            :: data:image/png;base64 present
```

### 7.2 本轮抓到并修复的真 bug（jsdom/Node 全绿的盲区）

**fflate 打包进浏览器产物后整体不可用。** 根因链：

1. fflate 的 exports 按 conditions 分流：node 条件 → `esm/index.mjs`（顶层 `import { createRequire } from "module"`）；默认/browser 条件 → `esm/browser.js`（无内建依赖）。
2. tsup 未设 platform，esbuild 按 **node** 条件选中前者，且把 fflate 整体打进 chunk（不在 dependencies 故未被 external）。
3. 浏览器加载该 chunk 即 `TypeError: Failed to resolve module specifier "module"` → archive 插件动态 import 失败 → 被 try/catch 吞成 ERR_PARSE → **静默降级 binary，无任何 console 报错**。
4. Node 侧 vitest/smoke/probe 全绿（Node 能解析 "module"）——正是「必须真机实证」的 P0 立项理由。

修复：`tsup.config.ts` 增加 `platform: 'browser'`（重库 mammoth/exceljs/pdfjs/sanitize-html 本就 dynamic-external 不受影响）。重建后 dist 中 fflate 落在 `browser-VDROVAII.js`（createRequire 命中数=0），且 Node 端 probe 复测该 browser 构建仍全绿（纯 JS 双端兼容）。

另修正验证页自身两处断言错误（渲染器实际类名 `.fp-pre`；zip 断言 detail 捕获），与库无关。

### 7.3 复验矩阵

| 验证 | 结果 |
|---|---|
| vitest | 77/77 ✅ |
| smoke（源码 strip-types） | 11 场景 ✅ |
| dist 探针（Node 消费 browser 构建产物） | zip→tree + 炸弹降级 ✅ |
| 真机 Chromium（本节） | 10/10 ✅ |

### 7.4 遗留（诚实边界）

- CJK 内嵌字体 PDF 的浏览器渲染未测（现 fixture 仅 Helvetica ASCII）；pdfjs 渲染管线本身已证。
  - `<file-preview>` 声明式 `<input slot="input">` 变更事件路径未自动化（编程式 preview() 已覆盖同一内部管线）。

---

## 八、2026-08-25 独立复验（Sisyphus · 真实重跑）

> 目的：不信任摘要，重新真实执行构建/测试/冒烟/dist 探针，并直接读源码核对方案各节承诺，确认"已完成代码是否达到文档效果"。
> 环境：win32 / PowerShell / Node（与首轮同机）。命令均为本轮新执行，输出未删减关键行。

### 8.1 复验命令与真实输出

**构建（ESM/CJS/DTS）** — `npm run build`（packages/core）
```
ESM ⚡️ Build success │ CJS ⚡️ Build success │ DTS ⚡️ Build success   BUILD_EXIT=0
dist/index.js 1.23KB │ browser.js 1.91KB │ worker.js 889B
```
⚠️ 修正首轮"零警告"：tsup CJS 产物现打印 **3 条 `import.meta` 警告**（`src/browser.ts:12` / `src/index.ts:40` / `src/plugins/pdf.ts:87`："import.meta is not available with the cjs output format"）。根因：`import.meta.url` 用于解析 worker URL / `createRequire`，在 CJS 格式下为空。**影响面**：CJS 消费者（`require('@file-preview/core')`）拿不到正确的 worker URL，浏览器零构建（`browser.js`）的 CJS 形态不可用；ESM 消费者不受影响。属可改进项，非功能阻塞，记入口碑/工程化待办。

**正式测试（vitest）** — `npm test`（根）
```
Test Files  5 passed (5)
     Tests  77 passed (77)      TEST_EXIT=0
```
与首轮 77 例一致，**无回归**。

**Node 冒烟（strip-types 源码）** — `npm run smoke`
```
SANITIZE iframe 残留=false | object 残留=false
TEXT/JSON/BINARY/IMAGE/CACHE/XLSX/PDF/WORKER/ZIP/BOMB 十场景全过   SMOKE_EXIT=0
```
含 ZIP→tree、BOMB→ERR_TOO_LARGE 降级，全绿。

**dist 产物探针（生产路径，经包名消费）** — `node packages/core/examples/node-ssr/probe-dist.mjs`
```
✅ DIST zip → tree | roots=d,r.txt
✅ DIST zip 炸弹防御降级 | zip bomb guard: 3 entries > max 2     PROBE_EXIT=0
```

### 8.2 源码级承诺核对（直接读 `src/`）

| 方案节 | 代码证据 | 结论 |
|---|---|---|
| §16 错误码枚举 | `errors.ts`：`ERR_UNSUPPORTED/TOO_LARGE/PARSE/ABORTED/TIMEOUT` 五码 + `PreviewAbortError`/`PreviewTimeoutError` | ✅ 完全一致 |
| §1/§6 `maxBytes` 护栏 | `previewer.ts:33,88`：任何插件前先 `file.size > maxBytes(默认100MB)` → `ERR_TOO_LARGE` | ✅ |
| §16 超时合并 | `combineSignal()`：`AbortSignal.timeout(opts.timeout ?? 30000)` 与 `opts.signal` 合并；已中止 signal 直接透传（防挂起误判 TIMEOUT） | ✅ |
| §2/§6 归一 number 路由 | `previewer.ts:41`：`p.test(detected)` 返回 number，`filter(priority>0)` 无布尔隐式 | ✅ |
| §3 核心统一派发 | `previewer.ts`：`getWorker` → `worker.post({blob, opts})` → 失败回退主线程；`runPipeline` 被主线程与 Worker 复用 | ✅ |
| §7/§16 sanitize 唯一清理点 | `render.ts`：`render()` 的 `html`/`iframe` 与 `renderToHtml()` 同两分支均 `env.sanitize(...)`；`media` 分支已补 | ✅ |
| §4 探测 + zip 细分 | `detect.ts`：魔数(png/jpeg/gif/bmp/pdf)+WEBP+PK头；`classifyZipByContent` 读尾部 64KB 定位 EOCD、扫中央目录 `word//xl//ppt/` | ✅ |
| §11 zip 炸弹四阈值 | `archive.ts`：`maxEntries=1000 / maxTotal=100MB / maxSingle=50MB / maxDepth=10`；`unzipSync` filter 恒 `false` 永不解压 | ✅ |
| §5 Office | `office.ts`（依赖就绪）；冒烟 XLSX→table 经 exceljs 实测通过 | ✅ |

**一处实现偏离（效果等价，非缺陷）**：方案 §4 建议用 `file-type` v17 做魔数兜底，实际 `detect.ts` 用自研 `MAGIC` 数组 + 扩展名 + ZIP 内容分类，**未引入 `file-type` 依赖**即达成"魔数+扩展名+zip 兜底"的效果。属减少依赖的合理偏离；如需与方案字面一致可后续补 `file-type`，但当前检测覆盖已满足需求。

### 8.3 浏览器真机（§7）本轮未重跑说明

§7 的 Chromium/Playwright 10/10 PASS 为**前轮实证**，本轮环境**无浏览器/Playwright 工具**，无法重跑。该结论仍作为前轮有效证据保留，标注"未在本轮复验中重跑"，不影响其余结论。

### 8.4 对首轮声明的修正清单

| 首轮声明 | 本轮复核 | 处理 |
|---|---|---|
| "构建与冒烟零警告" | 冒烟确为零警告；构建有 3 条 `import.meta` CJS 警告 | 已修正措辞（首轮 §2 末） |
| 缺口 #7 "fflate 未声明" | 根 `package.json` 已含 `fflate@^0.8.3` | 已划除并标注已修正 |
| §7 浏览器 10/10 | 本轮未重跑 | 标注"前轮证据，本轮未重跑" |

### 8.5 复验结论

- **已实现范围（核心调度 / 流式 IFile / 探测 / image·text·json·markdown·csv·Office·PDF·zip / 真实 sanitizer / Worker 派发 / Web Component / dist 产物）全部真实跑通，且与方案各节承诺一致。**
- **真实命令证据齐备**：BUILD=0 / TEST 77/77=0 / SMOKE=0 / PROBE=0。
- **剩余缺口不变**（首轮 §四）：mediainfo 媒体元数据、xml 专用渲染、CSP 部署文档、golden-file 回归、changesets+体积预算 CI。均属 P2 及以后，方案本身即排在后。
- **新增工程化待办**：消除 tsup CJS 的 `import.meta` 警告（建议 `browser` 入口仅出 ESM、CJS 走 `require` 解析 worker URL 的兼容分支，或文档声明 CJS 不支持零构建 `<file-preview>`）。

**达标率（可落地承诺）**：核心调度 100% / 安全 100% / 分发 100% / 格式覆盖 ≈75% / 工程化 ≈70%。生产可用视角下 P0+P1 全绿，完成度约 **85–90%**，与首轮评估一致。

---

## 九、2026-08-25 Milestone A 收口验证（生产就绪三项交付）

> 本轮交付进度文档 §四「Milestone A — 生产就绪收口」全部条目：A1 CSP 部署文档 / A2 CJS `import.meta` 缺陷修复 / A3 golden-file 回归套件，并完成统一复验（本节即 A4 验收门记录）。

### 9.1 交付物

| 单元 | 交付 | 说明 |
|---|---|---|
| A1 | `docs/csp-guide.md` + 根 README「Hosting / CSP」段 | 覆盖方案 §16.3 全部 4 类资源（img/media/frame/worker·script·connect）；给出零构建 CDN 与自托管两套最小 CSP 片段；含 pdfjs 三件资源同源托管步骤与 mediainfo WASM 的 `'wasm-unsafe-eval'` 前瞻说明 |
| A2 | `tsup.config.ts` 拆双配置 + `src/index.ts` / `src/plugins/pdf.ts` 加固 + 新增 `tests/build-clean.test.ts` | 见 §9.2 |
| A3 | `tests/golden/golden.test.ts`（10 用例）+ `tests/golden/gen-fixtures.mjs` + `fixtures/{sample.docx,sample.xlsx}` | 覆盖 image/text/markdown/csv/json/docx/xlsx/pdf/zip；确定性格式精确断言，docx HTML 用快照固化；fixtures 由 fflate 最小 OOXML + exceljs 确定性生成并随仓库提交 |

### 9.2 A2 修复细节（缺陷比预判更重）

复验发现 `dist/index.cjs` 顶层的空 `import.meta` shim 使 `new URL('./worker.js', undefined)` **在 require 时直接抛 RangeError —— 整个 CJS 主入口不可加载**（比「空 worker URL」更严重）；`pdf.ts` 的 `createRequire(import.meta.url)` 同样在 CJS 下抛错。修复：

1. **`browser` 入口仅出 ESM**：tsup 改为双配置数组（index/worker 保持 ESM+CJS；browser 仅 ESM）。`package.json` exports 对 `./browser` 本就只声明 `import`，无消费断裂。
2. **`defaultWorkerUrl` 守卫**（index.ts）：try/catch 包裹模块相对解析，CJS 下降级为空串（契约：CJS 消费者显式传 `workerUrl`；Node 端 `spawnWorker=null` 本不派发）。
3. **pdf.ts require 基准去 import.meta 化**：CJS 用包装器原生 `__filename`，ESM 回退 `cwd`（下方两处 `require.resolve` 本就有 try/catch 优雅降级；裸说明符解析在标准 node_modules 布局下两者等价）。
4. **回归护栏**：`build-clean.test.ts` 四断言——全量构建零 `[empty-import-meta]` 警告 / 无 `browser.cjs` / CJS require 可用且 `defaultWorkerUrl===''` / ESM URL 指向 `/dist/worker.js`。

### 9.3 复验证据（真实命令）

| 门 | 结果 | 备注 |
|---|---|---|
| BUILD | =0，**零 `import.meta` 警告**（前轮 3 条 → 0） | `npm run build`（packages/core） |
| vitest | **91/91 通过**（7 文件；前轮 77/77 + build-clean 4 条 + golden 10 条） | 根目录 `npm test` |
| SMOKE | =0（11 场景全过） | `node --experimental-strip-types examples/node-ssr/smoke.ts` |
| DIST 探针 | =0 | `node examples/node-ssr/probe-dist.mjs` |

### 9.4 结论

- 方案 §16 生产就绪四项**全部齐备**（错误码 / 超时 / CSP 文档 / 结构化日志）。
- §12 测试类别**全部齐备**（sanitize 回归 / zip 炸弹 fixture / 错误码回归 / golden-file 快照）。
- §14 零构建分发路径缺陷消除，CJS 主入口恢复可加载。
- 剩余缺口仅：pptx 插件、xml 专用渲染、mediainfo、changesets+体积预算 CI（均为方案后置项）。

---

## 十、2026-08-25 Milestone B 收口验证（pptx · Office 三件套闭环）

### 10.1 交付物（todo B1/B2/B3）

| 单元 | 交付 |
|---|---|
| B1 | `office.ts` 新增 `previewPptx`：fflate 解压 `ppt/slides/slideN.xml` → `<a:p>/<a:t>` 分段抽取 → `kind:'html'`（每页 section + 段落）。**炸弹防御**：filter 仅解压 slide XML，按中央目录声明的 `originalSize` 做 64MB 解压预算，超限拒绝。实体（`&amp;/&lt;/&gt;/&quot;/&apos;/&#nn;`）还原后统一 HTML 转义回填（渲染层 sanitize 前的纵深第一层） |
| B2 | `officePlugin().test()`：`zipHint==='pptx'` 与扩展名 `pptx/pptm` 均返 90；`preview` 路由改为候选链（docx/xlsx/pptx 互退），无扩展名改名场景经 xlsx→docx 失败后由 pptx 兜底可达 |
| B3 | 新增 `tests/office.test.ts` 8 用例（fixture 为内联 `zipSync` 确定性最小 pptx，无二进制入库）：正常→html（含实体转义断言）/ 无扩展名兜底 / 空白页占位 / 插件级损坏→`ERR_PARSE` / 管线级损坏→binary+`ERR_UNSUPPORTED`（router 契约固化）/ 路由优先级 90 / 与 archive 互斥保持 |

### 10.2 实现要点与边界

- **幻灯片顺序**按文件名数值序 `slideN.xml`（常规导出与 `presentation.xml` sldIdLst 一致）；极端重排属版式细节，不在「内容预览」契约内。
- **版式 caveat** 同 docx/pptx 方案标注：丢母版/动画/图表/媒体，仅内容预览。
- 既有契约不破坏：`archive.test.ts` 的 `zipPlugin().test({zipHint:'pptx'})===0` 断言保持绿。

### 10.3 复验证据（真实命令）

| 门 | 结果 | 备注 |
|---|---|---|
| BUILD | =0，零警告 | `npm run build` |
| vitest | **99/99 通过**（8 文件；91 + office 8 条） | 根目录 `npm test` |
| SMOKE | =0 | smoke.ts |
| DIST 探针 | =0 | probe-dist.mjs |
| tsc --noEmit | =0 | typecheck |

### 10.4 结论

方案 §5.3 Office 三件套（docx/xlsx/pptx）**全部落地**；`.pptx` 不再静默降级 hexdump。剩余缺口：xml 专用渲染（D1）、mediainfo（D2）、changesets+体积预算 CI（C1/C2）、分包（C3），均 P2。

---

## 十一、2026-08-25 D1 收口验证（XML 插件 · 结构化解析 + XXE 加固）

### 11.1 交付物（todo D1）

| 项 | 交付 |
|---|---|
| 新依赖 | `fast-xml-parser`（packages/core dependencies，精确版本锁定；动态 import 保持 external，不进主包） |
| `plugins/xml.ts` | → `kind:'json'`。路由：扩展名 xml / MIME application·text xml / 非图片 `+xml` 后缀 → **110**（svg 排除，归 image 插件）；无扩展名头部 `<?xml` 嗅探 → **60**（> isText 50）；zipHint 存在 → 0。8MB 读入上限 |
| XXE 加固（双层） | ① 解析前**剥离 DOCTYPE**（含实体声明全集）——从源头消灭内部/外部实体，任何版本行为下「不展开、不外联」；② `XMLValidator.validate` 严格结构校验——FXP 解析器本身对闭合错误宽松，须显式验证后才 parse |
| 失败降级 | malformed → 插件级 `{kind:'error', code:ERR_PARSE}`；管线级 router 落回 textPlugin（ext xml 命中 100）→ 纯文本兜底 |
| 注册 | `corePlugins()` / `workerPlugins()`（纯字符串处理，runsInWorker 默认 true）/ 根 index 导出 `xmlPlugin` |
| 测试 | `tests/xml.test.ts` **9 用例**：结构/属性/数值化/内联实体解析、XXE 内部·外部(file://)·嵌套(十亿笑话缩小版)三态拒绝、路由矩阵（含 svg 互斥集成）、malformed 双层降级契约 |

### 11.2 实现要点

- **宽松性修正**（本轮实测发现）：FXP 的 XMLParser 对 `<root><a></root>` 这类闭合错误默认静默产出结果——必须前置 `XMLValidator`，否则 malformed 无法触发 ERR_PARSE 兜底链。
- **DOCTYPE 策略**：预览场景不需要 DTD；整体剥离比「逐项禁用」更稳健，且使内部实体展开类攻击（十亿笑话）与外部实体外联（file:// / http://）同时失效。
- 属性前缀 `@`、属性与标签值数值化开启——golden 断言按此形状契约固化。

### 11.3 复验证据（真实命令）

| 门 | 结果 | 备注 |
|---|---|---|
| tsc --noEmit | =0 | typecheck |
| vitest | **108/108 通过**（9 文件；99 + xml 9 条） | 根目录 `npm test` |
| SMOKE | =0 | smoke.ts |
| DIST 探针 | =0 | probe-dist.mjs |
| BUILD | =0，零警告 | `npm run build` |

### 11.4 结论

方案 §5.5 文本族六格式（text/md/csv/json/**xml**）全部落地且 xml 具备 XXE 防护实证。剩余缺口仅 mediainfo（D2）、邮件等 P2 格式与工程化收尾（C1 changesets / C2 CI 体积预算 / C3 分包）。

---

## 十二、2026-08-25 C1 收口验证（changesets 版本治理）

### 12.1 交付物（todo C1）

| 项 | 交付 |
|---|---|
| 工具链 | 根 devDependencies 新增 `@changesets/cli@3.0.1`（npm workspaces 模式，无需 pnpm） |
| `.changeset/config.json` | `commit:false`（当前目录未 git init）、`access:public`、`baseBranch:main`、官方 changelog 生成器 |
| `.changeset/README.md` | 流程说明 + **bump 类型与 `contractVersion` 联动规则**（major ⇒ 受影响插件 contractVersion+1 并写迁移说明，方案 §12 契约演进要求） |
| 根脚本 | `changeset` / `version`（=changeset version）/ `release`（=build + changeset publish；需 npm 凭据，暂不真发） |
| initial changeset | `.changeset/2026-08-25-milestone-a-b-d1.md`（minor：pptx / xml / CSP 指南 / CJS 修复 / 回归套件汇总） |

### 12.2 实证结果（验收标准逐条）

| 验收项 | 结果 |
|---|---|
| `npx changeset` 可用 | ✅ CLI v3.0.1 正常执行（变更以手工 md 文件写入，等价于交互产物） |
| `npx changeset version` 产出 CHANGELOG + semver bump | ✅ `@file-preview/core` **0.1.0 → 0.2.0**；`packages/core/CHANGELOG.md` 自动生成且内容完整；changeset 文件消费后清除 |

### 12.3 复验证据（version bump 后全量回归）

| 门 | 结果 |
|---|---|
| vitest | **108/108 通过** |
| SMOKE / DIST 探针 | =0 / =0 |
| tsc --noEmit | =0 |

### 12.4 结论

方案 §9「changesets 管版本与 CHANGELOG」与 §12「版本治理：changesets + semver；contractVersion 同步演进」落地完成。Milestone C 剩余：C2 CI 体积预算卡点、C3 分包（可选）。

---

## 十三、2026-08-25 C2 收口验证（CI 体积预算卡点）

### 13.1 交付物（todo C2）

| 项 | 交付 |
|---|---|
| `packages/core/scripts/check-size.mjs` | gzip 口径体积预算卡点：**5 个固定名入口逐文件限额**（browser.js 36K / index.cjs·worker.cjs 各 150K / index.js 3K / worker.js 2K gz，基线为 2026-08-25 实测值 +30% 余量）+ **hash 命名动态 chunk 聚合 170K gz**（content-hash 文件名不可硬编码，按角色聚合）+ **dist 总原始字节 1.8M 护栏**；缺产物即失败（防构建配置静默破坏）；`FPK_SIZE_BUDGET_JSON` 环境变量可覆盖预算（供负向验证） |
| `.github/workflows/ci.yml` | push(main)/PR 触发，单 job 七步串联：npm ci → typecheck → vitest → build → smoke → dist 生产路径探针 → check:size 卡点；concurrency 取消同 ref 旧跑 |
| npm script | `packages/core` 新增 `check:size` |

### 13.2 双向验证（验收标准逐条）

| 验收项 | 结果 |
|---|---|
| 正常产物通过 | ✅ exit=0：五入口（27.2K/114.2K/111.9K/1.4K/0.6K gz）+ chunks 聚合 111.5K + dist 总量 1344.1K 全部在预算内 |
| 超限则失败 | ✅ 注入 `{"entry":{"browser.js":1000}}` 后 exit=1，报错明确指出超标项与更新指引 |

### 13.3 复验证据（全量回归）

| 门 | 结果 |
|---|---|
| vitest | **108/108 通过** |
| SMOKE / DIST 探针 / SIZE / tsc | =0 / =0 / =0 / =0 |

### 13.4 结论

方案 §12「体积预算：每个插件产物设 bundle size 上限，CI 卡点」落地完成——测试与发布五项要求（golden-file / sanitize 回归 / zip 炸弹 fixture / 体积预算 CI / changesets）**全部齐备**。工程化仅剩 C3 分包（可选）。剩余格式缺口：mediainfo（D2）、邮件（D3），均 P2。

---

## 十四、2026-08-25 D2 收口验证（mediainfo 媒体元数据插件）

### 14.1 交付物（todo D2 / 方案 §5.6）

| 项 | 交付 |
|---|---|
| `packages/core/src/plugins/media.ts` | `mediaPlugin()`：mediainfo.js@**0.3.1**（BSD-2-Clause，锁定版本）动态 import 保持 external 不进主包；`analyzeData(() => file.size, (size, offset) => file.readRange(offset, offset + size))` 流式区间读取，不整文件加载；轨道白名单收敛为稳定键集（Format/CodecID/Duration/BitRate/Channels/SamplingRate/FrameRate/Width/Height 等）；`close()` 释放 WASM 实例堆内存（成功/失败均走 finally） |
| wasm 定位（locateFile 同步回调 → 先解析后闭包注入） | 三级策略：① `env.getAssetUrl('mediainfo.wasm')` 注入（CDN drop-in / 自托管，与 pdf.worker 同模式，呼应 CSP 指南）；② Node 端 `createRequire().resolve('mediainfo.js/MediaInfoModule.wasm')` 解析 exports 子路径为绝对 fs 路径；③ 均不可用时省略 locateFile 交 emscripten 默认前缀。注：方案 §5.6 原拟经 `env.loadWasm` 接管，但工厂 API 的 locateFile 必须返回字符串路径（emscripten 标准语义），故改用 getAssetUrl 注入点——与 pdf.ts 既有模式一致 |
| 轨道判定 | **以 Audio/Video 轨道为准**：实测 MediaInfo 对无法识别内容（纯文本）也会给出 General 轨，仅凭 General 放行会把任意二进制误判为媒体；无音/视频轨 → ERR_PARSE 由 router 交下一插件或降级 |
| 浏览器播放 src | `env.isBrowser && createObjectURL` 可用时产出：优先复用 `file.blob`（零拷贝），否则读入生成（router 的 maxBytes 护栏兜底大文件）；Node 端仅 metadata 不播放 |
| 注册与导出 | `plugins/index.ts` corePlugins() 并入 mediaPlugin（runsInWorker 默认 true，可进核心统一派发 Worker）；`src/index.ts` 导出 `mediaPlugin` |
| 测试 | `tests/media.test.ts` 9 用例：路由矩阵（11 音视频扩展名 + 音视频 MIME 命中 90 / zipHint 排除）/ 与 text·image·pdf·zip 互斥 / 真实 WASM 解析最小 WAV（Wave/PCM/8kHz/单声道数值化断言）/ 改名 .mp3 内容识别 / 损坏文件插件级 ERR_PARSE / browser src 契约（blob:mock）/ 管线集成（corePlugins() 下 .wav 出 media 不降级 binary）/ workerPlugins 包含 media |

### 14.2 验收标准逐条达成

| 验收项（todo D2） | 结果 |
|---|---|
| 真实音视频文件经 `mediaPlugin().preview` 产出 `media` 元数据 | ✅ 最小合法 WAV 经真实 mediainfo WASM 解析（非 mock）：general.Format=Wave、audio.Format=PCM、SamplingRate=8000(number)、Channels=1、Duration=0.2 数值化；端到端探针 152ms |
| 浏览器端 `env.createObjectURL` 给出可播放 src | ✅ isBrowser+createObjectURL 适配器下 `result.src='blob:…'`；Node 端无 src（仅 metadata） |
| vitest 用例（mock wasm 或最小样本） | ✅ 内联确定性 WAV fixture（44 字节头 + PCM），9 用例全绿 |

### 14.3 复验证据（全量回归）

| 门 | 结果 |
|---|---|
| vitest | **117/117 通过**（原 108 + media 9） |
| SMOKE / verify:browser 探针 / index.cjs require | =0 / =0 / OK |
| tsc --noEmit / BUILD（零 import.meta 警告） | =0 / =0 |
| check:size | exit=0 全预算内（browser.js 28.1K gz，基线 27.2K 仅 +0.9K 注册代码——mediainfo external 生效） |

### 14.4 结论

方案 §5.6「mediainfo.js(WASM) 提取元数据；浏览器生成播放 src；Node 仅 metadata」落地完成。方案点名的格式缺口自此**全部闭合**（§5.1–§5.7 全 ✅），仅剩 D3 邮件（P2 后置项）与 C3 分包（可选）。

### 14.5 独立复核（2026-08-25 验证驱动审计）

不以交付自述为准，按方案原文逐条回查源码与产物：

**静态核对（源码 ↔ 文档承诺）**

| 文档承诺 | 源码证据 | 判定 |
|---|---|---|
| §六 缓存「仅缓存轻量结果，跳过带 src 的 media」 | `cache.ts` `shouldCache`：`kind==='media' && r.src → false`，lightweight 集含 'media'（纯 metadata 可缓存） | ✅ 一致 |
| §7 渲染 media 分支（DOM + SSR 双侧） | `render.ts:49` DOM `createElement(result.mediaType)` + src；`render.ts:83/:104` `mediaToHtml`（controls/src/type/metadata，全部经 escapeHtml/escapeAttr 转义） | ✅ 一致 |
| 全局约束「test() 归一 number、>0 才匹配」 | `media.ts` test() 仅返回 90 / 0 字面量 | ✅ 一致 |
| 全局约束「解析层不碰 DOM、不拼最终 HTML」 | `media.ts` 无任何 DOM/document 引用，产出纯数据 `kind:'media'` | ✅ 一致 |
| 全局约束「大文件 readRange，禁整文件 arrayBuffer」 | 元数据提取走 `analyzeData`→`readRange` 区间读取；唯一 arrayBuffer 在浏览器 src 分支且 `file.blob` 缺失时兜底——router 的 maxBytes 护栏先于插件短路（`previewer.ts:88`），属方案允许的快捷路径 | ✅ 一致 |
| 全局约束「不 suppress 类型错误」 | 全文件无 as any/@ts-ignore/@ts-expect-error；第三方轨道经 `unknown→LooseRecord` 收敛访问 | ✅ 一致 |
| contractVersion:1 契约 | `mediaPlugin()` 声明 `contractVersion: 1` | ✅ 一致 |

**产物核对（external 契约实证）**

| 项 | 证据 | 判定 |
|---|---|---|
| mediainfo 实现不进产物 | 五入口均以 bare-specifier `import("mediainfo.js")` 动态导入；emscripten 内部 API（openBufferContinue 等）在全 dist **0 泄漏**；2.2MB MediaInfoModule.wasm 不在任何产物中 | ✅ external 生效 |
| 入口一致性 | ESM 主入口经 hash chunk（chunk-RHTQTGTV.js）承载实现，browser/index.cjs/worker.cjs 内联薄层——与 C2 体积预算「重库不进主包」结构吻合 | ✅ 一致 |

**动态门全新重跑（独立证据，非沿用交付时数字）**

| 门 | 结果 |
|---|---|
| tsc --noEmit | =0 |
| vitest | **117/117 通过** |
| BUILD（warning/import.meta 计数） | =0 |
| SMOKE / verify:browser 探针 / index.cjs require | =0 / =0 / OK |
| check:size | exit=0 全预算内（dist 总量 1359.0K / 上限 1843K raw） |

**复核结论**：D2 实现与方案 §5.6 及 todo 验收标准**无偏差**，全局约束六项逐一核实通过，未发现需修正项。

---

## 十五、2026-08-25 D3 收口验证（邮件 eml 插件 + 格式支持边界声明）

### 15.1 交付物（todo D3 / 方案 §5.7）

| 项 | 交付 |
|---|---|
| `packages/core/src/plugins/email.ts` | `emailPlugin()`：emailjs-mime-parser@**^2.0.7**(MIT) 动态 import external；RFC822/MIME 树解析 → `kind:'html'` 内容预览（头表 From/To/Cc/Date + mime-word 解码主题 + 纯文本正文 + 附件清单 filename/type/size）；8MB 读入上限（与 text/csv 同策略）+ 库内置 999 MIME 节点上限防内存耗尽（CWE-400） |
| 输出安全策略 | 正文优先 text/plain 纯文本展示；HTML-only 邮件以**转义源码形式**展示（`<details><pre>` 内 &lt;h1&gt; 形态），不做富渲染——避免未经净化的邮件 HTML 进渲染管线；所有动态值 escapeHtml 拼装，渲染层 env.sanitize 再清理（纵深防御） |
| CJS 双形态互操作 | `loadParser()` 兼容 Node ESM（parse 在 `mod.default.default`）与 bundler 互操作（`mod.default`）两种运行时形态（探针实证） |
| 类型声明 | `src/types/emailjs-mime-parser.d.ts` 最小空声明消除 TS7016；实际形状以插件内局部接口治理（上游无官方类型） |
| 注册与导出 | corePlugins() 并入 emailPlugin（runsInWorker 默认 true）；主入口导出 `emailPlugin` |
| 测试 | `tests/email.test.ts` 8 用例：路由矩阵 / 与 text·media·pdf·zip 互斥 / multipart 解析（mime-word 中文主题 + QP 正文 + base64 PDF 附件清单全链断言）/ HTML-only 转义源码边界（&lt;script&gt; 不可执行）/ 纯文本单段 / 损坏 ERR_PARSE / 管线集成不降级 / workerPlugins 包含 |

### 15.2 验收标准逐条达成

| 验收项（todo D3） | 结果 |
|---|---|
| `.eml` 产出结构化结果 | ✅ multipart/mixed 真实形态：QP 中文正文还原「第一行正文」、mime-word 主题解码「Hello 你好」（进 title）、地址格式化 `Alice <alice@example.com>`、附件 doc.pdf/application/pdf/字节数 全链断言 |
| 文档列出 font/3d/msg 支持边界 | ✅ README 新增「格式支持边界」节：font/3d/msg 明确走 binary 降级（方案 §5.7 原话"msg 暂不覆盖"），eml 为本插件唯一覆盖格式 |

### 15.3 上游已知边界（探针实证，如实记录）

未声明 `Content-Transfer-Encoding` 的非 ASCII「7bit」正文会被上游 `str2arr` 截断多字节字符。RFC 2045 下真实邮件的非 ASCII 文本必经 QP/base64 编码——两条路径经最小 fixture 探针验证 UTF-8 还原**正确**（base64/QP 中文均无损）。测试 fixture 采用 base64/QP 真实邮件形态。

### 15.4 复验证据（全量回归）

| 门 | 结果 |
|---|---|
| tsc --noEmit | =0 |
| vitest | **125/125 通过**（原 117 + email 8） |
| BUILD（warning/import.meta 计数） | =0 |
| SMOKE / verify:browser 探针 / index.cjs require | =0 / =0 / OK |
| check:size | exit=0（chunks 聚合 113.4K/170K gz，dist 总量 1377.2K/1843K raw） |
| external 核对 | emailjs-mime-parser 及传递依赖（ramda 等）在 dist **0 泄漏**，bare-specifier 动态导入 |

### 15.5 结论

方案 §5.7 邮件部分落地完成；font/3d/msg 按方案原意走 binary 降级并以文档明确边界（非缺陷，设计取舍）。todo D3 验收两项全达成。剩余：C3 分包（可选，P2）。

---

## 十六、2026-08-26 C3 分包验证（pdf / office / archive 拆独立包，方案 §9 多包结构收口）

### 16.1 交付物（todo C3a/C3b/C3c）

| 项 | 交付 |
|---|---|
| `packages/plugin-pdf` | `@file-preview/plugin-pdf@0.2.0`：`pdfPlugin()` 全量迁自 core（pdfjs-dist ^4.10.38 随迁；浏览器 PNG 页面渲染 / Node 文本提取、`env.getAssetUrl` 三资源注入、runsInWorker:false 契约不变） |
| `packages/plugin-office` | `@file-preview/plugin-office@0.2.0`：`officePlugin()` 迁出（mammoth ^1.9.0 / exceljs ^4.4.0 随迁；docx·xlsx·pptx 三件套 + pptx fflate 抽取文本不变） |
| `packages/plugin-archive` | `@file-preview/plugin-archive@0.2.0`：`zipPlugin()` + `ZipGuardLimits` 迁出（fflate ^0.8.2 随迁；炸弹四阈值防御不变） |
| core 收窄 | `corePlugins()` 默认集收窄为轻量七插件（image/text/markdown/csv/xml/media/email）；主入口不再导出 pdf/office/zip 三插件；dependencies 移除 pdfjs-dist/mammoth/exceljs/fflate（三包以 devDeps 源码级反向引用 core） |
| 零构建默认集保持完整 | `src/browser.ts` 内联三拆分包（§14 单文件全量默认能力）；`src/worker.ts` 默认集 = workerPlugins() + office/archive（pdf 因 runsInWorker:false 排除，与拆分前行为一致） |
| 免构建排序策略 | 三插件包 exports 直指 `./src/index.ts` 源码级（publishConfig 才切 dist），workspace 内消费零构建顺序问题；tsup 独立打包各插件，core 不再感知重库 external |
| 受影响测试显式组合 | `tests/helpers.ts` 组合 `[...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()]`；archive/office/email/media/error-codes/smoke 等 7 个测试文件改从 `@file-preview/plugin-*` 导入 |
| 体积预算重校准 | `scripts/check-size.mjs` 新基线注释（index.cjs gz 115.1K → 96.5K）+ 入口限额调整（browser.js 36K / index·worker.cjs 各 150K / worker.js 4K）；FPK_SIZE_BUDGET_JSON 覆盖通道保留 |

### 16.2 复验证据（2026-08-26 全量回归）

| 门 | 结果 |
|---|---|
| typecheck（4 workspaces） | =0 |
| vitest | **125/125 通过**（11 文件，与 D3 后持平——迁移零行为变化） |
| BUILD（4 包 tsup，warning/import.meta 计数） | =0 / =0 |
| SMOKE / verify:browser（jsdom render）/ probe-dist（dist 生产路径 zip+炸弹防御） | =0 / =0 / =0 |
| CJS require | core index.cjs OK 且 **pdfPlugin 0 泄漏**；plugin-pdf/office/archive 三 dist cjs require OK |
| check:size | exit=0：browser.js 29.2K/36K · index.cjs **96.5K**/150K · worker.cjs 96.5K/150K · worker.js 3.3K/4K · chunks 聚合 95.4K/170K · dist 总 raw 1156.9K/1843K |
| 主入口收益 | index.cjs gz **115.1K → 96.5K（-16%）**；dist 总量 1377.2K → 1156.9K raw |

### 16.3 变更记录

`.changeset/c3-plugin-split.md` 单条多包（core: minor + plugin-pdf/office/archive: minor），含按需组合迁移示例。README「包结构」表更新为已交付三分包 + 「按需组合插件」用法节。

### 16.4 结论

方案 §9「多包结构」自此收口：core 同构薄核心 + 重格式按需 plugin-* 包，changesets/CI（--workspaces 自动覆盖新包）全链路兼容。todo C3a/C3b/C3c 验收达成，方案后置 P2 清单全部清空。

### 16.5 独立复验对账（2026-08-26 第二轮 · 公共接缝实证）

> 方法：不信任首轮门禁结论，按 todo C3 验收标准与方案 §9 要求逐条在**公共接缝**（包导出 / dist 产物 / 运行时组合）重新取证。新增可复跑探针 `examples/node-ssr/probe-c3.mjs`（经 bare specifier 源码级 exports 组合四包并真实预览——同时实证「免构建排序」契约）。

#### todo C3 验收标准逐条对账

| 验收项（todo C3） | 实证方式 | 结果 |
|---|---|---|
| 拆分后 `corePlugins()` 仍聚合可用 | 探针 A：`[...corePlugins(), pdf/office/archive]` 组合后真实预览 txt→text / pdf→text(language=pdf) / zip→tree / 未识别→binary(ERR_UNSUPPORTED) 全链路 | ✅ |
| `npm test` 全绿 | vitest 125/125（11 文件）；smoke.test.ts 场景 8 断言 corePlugins 不含 pdf、全量集含、worker 集不含 | ✅ |
| 主包体积下降（C2 卡点验证） | check:size exit=0 且 index.cjs gz 115.1K→96.5K（**-16%**）；dist 总 raw 1377.2K→1156.9K | ✅ |

#### 方案 §9 多包结构要求逐条对账

| §9 要求 | 实证方式 | 结果 |
|---|---|---|
| 多 plugin-* 独立包 | packages/{plugin-pdf,plugin-office,plugin-archive} 各含独立 package.json/tsup.config.ts/src；npm workspaces 四包 typecheck/build 独立成功 | ✅ |
| 重依赖随插件走、不进主包 | 产物审计 B1/B4：core dist 内 pdfjs-dist/mammoth/exceljs/fflate **0 内联**（13 处命中全部为 `await import("lib")` 动态 external 兜底分支，0 静态导入）；三插件包 dist 仅 3.5–7.1K，重库同样 bare-specifier 动态导入 external 化 | ✅ |
| tsup 双产物 + sideEffects:false | 包契约审计 C：三插件包 publishConfig exports 同时含 import(esm)+require(cjs)，d.ts/d.cts 齐；sideEffects:false ×3（core 正确声明仅 browser 入口有副作用） | ✅ |
| contractVersion 契约延续 | 审计 C：四包 contractVersion=1；peerDependencies `@file-preview/core@^0.2.0` ×3 | ✅ |
| 免构建排序（workspace 消费无需先构建） | 探针 A 本身即证：node --experimental-strip-types 经 exports 直指 src 的 bare specifier 导入四包并跑通全链路 | ✅ |
| 零构建默认集完整（§14 联动） | 产物审计 B2/B3：dist/browser.js 内联 pdf+office+archive 三插件；dist/worker.js 内联 office+archive 且 pdfPlugin 已排除（runsInWorker:false 契约） | ✅ |

#### 已知边界（如实记录，均非 C3 引入，行为与拆分前一致）

1. **text 嗅探宽松面**：无 NUL/控制字节的短随机字节串（如 `DE AD BE EF`）会被 `isText` 判真而以替换字符展示为 text。文档化行为（NUL 字节 fixture → binary+ERR_UNSUPPORTED）由 smoke 场景 3 锁定；纯高位字节小文件属方案「可读率高则文本预览」口径的既有宽松面。
2. **纯零构建场景的重库解析**：browser.js 中 mammoth/exceljs/fflate 为动态 bare-specifier 导入——bundler 场景由打包器解析；纯 `<script type=module>` 场景需宿主 importmap 映射（pdfjs 已由 CDN URL 注入豁免，无此需求）。

#### 复验结论

C3 分包在公共接缝层面**零偏差**达成验收标准与 §9 结构要求；两条上游已知边界均有明确触发条件且不影响文档化契约。todo C3 验收三项 + 方案 §9 六项要求全部实证通过。

---

## 十七、2026-08-26 发布形态缺陷修复（publishConfig 替换失效 → prepack 清单替换）

### 17.1 缺陷（P1 发布干跑发现，探针实证）

npm@11.13.0 实测 **publishConfig 的 files/exports 字段替换不生效**（`npm pack` 与 `npm publish --dry-run` 双探针一致）：四包发布形态均为顶层 main/exports→`./src/index.ts` + `files:[]` 回退 .gitignore 规则——tarball 内是 src/tsconfig/tsup 而非 dist，且 exports 指向未打包路径。**若按此发布，四个包全部不可消费。**

### 17.2 修复

- 新增根 `scripts/apply-publish-manifest.mjs`：apply 态把各包 `publishConfig` 整体应用到顶层字段（exports/main/types/files…）并移除 publishConfig 键；restore 态从 `.fpk-publish-bak.json` 复原。幂等（残留备份先复位再应用）。
- 四包接入生命周期钩子：`"prepack": "… apply"` / `"postpack": "… restore"`（npm 生命周期全工具链可靠，不依赖 npm 版本行为）。

### 17.3 验证证据

| 门 | 结果 |
|---|---|
| `npm publish --dry-run` ×4 | 全部 dist-only（core 24 文件 / 三插件各 7 文件），src/tsconfig/tsup **零泄漏** |
| 真实 `npm pack` 解包核验（plugin-pdf） | tgz 内 exports→`./dist/index.js|index.cjs|index.d.ts`、files=[dist]、publishConfig 已移除 |
| postpack 复原 | `git status` 仅剩预期修改，无打包残留 |

### 17.4 结论

发布链路自此真实可用：`npm run release`（build→changeset publish）产出的 tarball 即正确形态。版本治理 P1 剩余仅 npm 凭据与实际发布动作。
