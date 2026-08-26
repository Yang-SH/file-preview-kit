# 测试覆盖矩阵（快照）

> 生成：2026-08-26 · 方法：以方案＋README 可测行为声明为清单源逐条映射现状测试。
> 性质：**快照**，非强制维护项；后续大改功能时建议参照重建。
> 图例：✅ 单测 ｜ 🔗 dist E2E ｜ 🌐 真 Chromium harness ｜ ⚠️ 部分（间接覆盖）｜ 🚫 豁免（环境受限/非本库职责）

## 一、方案 §二 核心抽象

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| IFile 流式三方法语义（header/readRange/arrayBuffer） | smoke / helpers 同构实现＋limits L1 大文件读取 | ✅ |
| PreviewResult 十种 kind 收敛 | types.ts 类型＋render 分支＋各格式测试 | ✅ |
| 插件 test()→number 归一路由（>0 命中） | error-codes / e2e B2 spy 零调用 | ✅ |
| contractVersion 契约字段 | probe-c3 / 各插件实例断言 | ✅ |
| onProgress 上报 | office/pdf 各格式 preview 内调用（间接） | ⚠️ |
| AbortSignal 取消 → ERR_ABORTED | error-codes B8/e2e B8 | ✅ |

## 二、方案 §三 环境适配与 Worker

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| spawnWorker 消息 id 路由/onerror reject | env.ts 实现；Node 无 Worker 返回 null（utils-edges U8） | ⚠️ |
| 核心统一派发：workerPlugins 过滤 runsInWorker:false | limits L4 ＋ probe-c3 | ✅ |
| 浏览器真实 Worker 派发结果一致 | harness b7（workerLoaded=true） | 🌐 |
| sanitize 双端默认（DOMPurify/sanitize-html） | sanitize-xss.test ＋ initNodeSanitizer 各处 | ✅ |

## 三、方案 §四 探测（此前零直测，本轮补齐）

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| MAGIC 六签名（png/jpeg/gif/bmp/pdf/webp） | detect.test D 组 | ✅ |
| zip PK 头 → application/zip | detect.test | ✅ |
| 无扩展名中央目录分类 word//xl//ppt/ | detect.test（fflate 构造真目录） | ✅ |
| EXT_MIME 扩展名回退（md→text/markdown 等） | detect.test | ✅ |
| 优先级 magic ?? declared ?? ext | detect.test 三例 | ✅ |
| looksLikeText 阈值语义（ASCII/中文宽计/NUL 拒绝/空头） | detect.test isText 五例 | ✅ |

## 四、方案 §5 格式路线（节选关键边界）

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| 图片 dataUrl＋PNG 尺寸抽取 | e2e A1/A1b、golden、b3 | ✅ |
| PDF Node 全文提取（不受 maxPages 限） | pdf-options P1/P2 | ✅ |
| PDF 浏览器 maxPages 上限＋totalPages/renderedPages 元数据 | plugin-pdf 实现＋harness（在线时元数据可见） | ⚠️🌐 |
| PDF 文本层 overlay（检索/复制，扫描版省略） | pdf-text-layer L1–L3 纯函数＋接入点 | ✅ |
| xlsx sheet 名称/序号选择＋maxRows＋sheetTotal | office-options O1–O3、e2e D-3 | ✅ |
| xlsx 默认 1000 行边界（README 声明） | limits L2/L3 | ✅ |
| pptx 幻灯片抽取＋空白页占位 | office.test（既有 8 用例） | ✅ |
| eml 解析／HTML-only 边界 | email.test（既有）；纯静态降级 harness b14 | ✅🌐 |
| media 元数据（mediainfo WASM 锁定 0.3.1） | media.test（既有 9 用例） | ✅ |
| XML 结构化＋XXE 不展开 | xml.test＋harness b6/b14 观测 | ✅ |

## 五、方案 §6/§11 路由·缓存·阈值

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| maxBytes 护栏先于插件短路 | e2e B2（spy 零调用）/b10 | ✅ |
| size==maxBytes 恰等放行 | e2e B3 | ✅ |
| zip 四阈值恰等 vs 超 1 逐项 | e2e B7 四组 | ✅ |
| LRU 容量淘汰＋轻量白名单 shouldCache | utils-edges U6＋e2e B10/b11 | ✅ |
| 缓存键构成 name:size:ext:fnv1a(header) | utils-edges U5（独立 FNV 复算） | ✅ |
| 默认超时 30000ms／timeout≤0 关闭 | error-codes＋utils-edges U3/U4 | ✅ |
| UNSUPPORTED 兜底 hexdump／D3 文本救援 | error-codes 双面用例＋e2e B1/B4/B5 | ✅ |

## 六、方案 §7/§16 渲染与生产就绪

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| render/renderToHtml 全 kind 分支与转义 | render-attrs/render-branches/B11/smoke | ✅ |
| iframe sandbox＋srcdoc sanitize（双形态） | render-branches I1/I2 | ✅ |
| image 稳定类名 fpk-image＋lazy/decoding（G5 钩子） | render-attrs R-attr | ✅ |
| media 原生 controls（G11） | render-branches I4 | ✅ |
| 内置文案可注入（G7 messages） | pdf-messages M1 | ✅ |
| 错误码五枚举稳定 | error-codes 首用例逐字断言 | ✅ |

## 七、README 部署与零构建

| 行为声明 | 用例位置 | 状态 |
| --- | --- | --- |
| `<file-preview>` 注册＋Worker 默认派发 | harness b1/b2/b7 | 🌐 |
| CJS 主入口可用且无重插件泄漏 | build-clean.test＋e2e C1 | ✅ |
| 纯静态部署降级体面（xml/eml→text 救援） | harness b6/b14 | 🌐 |
| thumbnail 两档契约（image/fallback-card） | thumbnailer T1–T4、e2e D-1、harness b12/b13 | ✅🔗🌐 |
| gzip 徽章数值 | check-size.mjs CI 门（非 vitest） | 🚫→CI |

## 八、豁免清单（🚫）

1. pdfjs/mammoth/exceljs 等重库的 **CDN 在线路径**——由 verify:offline vendor 页与其 21 断言自成体系覆盖。
2. **canvaskit-wasm Node 缩略图**——方案 §5.2 假设性条目，未实现，无行为可测。
3. **CSP 头实际拦截**——宿主部署环境职责，csp-guide 提供片段供人工核对。
4. **changesets 发布／CI 流水线执行**——基础设施动作，由 GitHub Actions 与 npm 凭据承载。
5. **Worker 线程内部实现细节**——线程间消息契约已由 harness b7 集成实证，线程内单测无意义。
6. **离线单文件页生成器本身**——其产物即验证载体（21 断言），自我证明循环。
