---
'@file-preview/core': minor
---

新增 `emailPlugin`（方案 §5.7）：`.eml` 邮件经 emailjs-mime-parser@^2.0.7 解析为 `kind:'html'` 结构化预览——头表（From/To/Cc/Date，mime-word 自动解码）、纯文本正文、附件清单。HTML-only 邮件以转义源码形式展示（安全边界）。已并入 `corePlugins()` 默认插件集并从主入口导出。同时在 README 声明 font/3d/msg 格式支持边界（binary 降级）。
