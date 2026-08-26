import type { PreviewPlugin } from '../types.ts';
import { imagePlugin } from './image.ts';
import { textPlugin } from './text.ts';
import { markdownPlugin } from './markdown.ts';
import { csvPlugin } from './csv.ts';
import { xmlPlugin } from './xml.ts';
import { mediaPlugin } from './media.ts';
import { emailPlugin } from './email.ts';

// 全部内置插件（主线程 / Web Component 默认集）。
// 注意（C3 分包，方案 §9）：pdf / office / archive 已拆至 @file-preview/plugin-* 独立包，
// 不再随 core 内置——调用方按需组合（browser/worker 入口已默认组合，见 src/browser.ts）：
//   const plugins = [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()];
export function corePlugins(): PreviewPlugin[] {
  return [
    imagePlugin(),
    textPlugin(),
    markdownPlugin(),
    csvPlugin(),
    xmlPlugin(),
    mediaPlugin(),
    emailPlugin(),
  ];
}

// 可放进「核心统一派发 Worker」的插件：排除自管 Worker 的插件（如 pdfjs，避免 Worker 嵌套）。
export function workerPlugins(): PreviewPlugin[] {
  return corePlugins().filter((p) => p.runsInWorker !== false);
}
