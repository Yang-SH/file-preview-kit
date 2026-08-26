---
'@file-preview/core': minor
---

新增 `mediaPlugin`（方案 §5.6）：音频/视频文件经 mediainfo.js@0.3.1(WASM, BSD-2-Clause) 流式提取元数据，产出 `kind:'media'`；浏览器端经 `env.createObjectURL` 生成播放 src，Node 端仅 metadata。wasm 定位支持 `env.getAssetUrl('mediainfo.wasm')` 注入（CDN drop-in / 自托管），Node 自动解析包内 wasm 绝对路径。已并入 `corePlugins()` 默认插件集并从主入口导出。
