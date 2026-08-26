# @file-preview/core

同构文件预览核心（最小可运行骨架）。

```ts
import { createPreviewer, nodeAdapter, renderToHtml, fileFromNode, imagePlugin, textPlugin } from '@file-preview/core';

const previewer = createPreviewer({ plugins: [imagePlugin(), textPlugin()] });
const file = await fileFromNode('./doc.txt');
const result = await previewer.preview(file, nodeAdapter);
console.log(renderToHtml(result, nodeAdapter));
```

零构建浏览器引入（规划中的 `@file-preview/browser` 提供）：

```html
<script type="module" src="https://cdn.example.com/file-preview/browser.js"></script>
<file-preview><input type="file" slot="input" /></file-preview>
```

当前骨架包含 `image` / `text`（含 `json`）两个参考插件；PDF / Office / 媒体 / 压缩包 为后续 `plugin-*` 包。
