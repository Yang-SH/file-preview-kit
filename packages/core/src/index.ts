export type {
  IFile,
  PreviewResult,
  PreviewOptions,
  PreviewPlugin,
  DetectResult,
  EnvAdapter,
  WorkerHandle,
  FileTreeNode,
} from './types.ts';

export { PreviewErrorCode } from './errors.ts';
export { PreviewAbortError, PreviewTimeoutError } from './errors.ts';

export { fileFromBrowser, fileFromNode } from './file.ts';

export { createBrowserEnv, createNodeEnv, browserAdapter, nodeAdapter, minimalSanitize, initNodeSanitizer } from './env.ts';
export type { EnvOptions } from './env.ts';

export { detectFile } from './detect.ts';

export { Previewer, createPreviewer, runPipeline, generateHexDump, combineSignal } from './previewer.ts';
export type { PreviewerOptions } from './previewer.ts';
export type { PreviewCache } from './cache.ts';

export { createLruCache, fileToCacheKey } from './cache.ts';
export { createThumbnailer } from './thumbnailer.ts';
export type { Thumbnailer, ThumbnailerOptions } from './thumbnailer.ts';
export type { ThumbnailRequest, ThumbnailResult } from './types.ts';

export { render, renderToHtml } from './render.ts';

export { imagePlugin } from './plugins/image.ts';
export { textPlugin } from './plugins/text.ts';
export { markdownPlugin } from './plugins/markdown.ts';
export { csvPlugin } from './plugins/csv.ts';
export { xmlPlugin } from './plugins/xml.ts';
export { mediaPlugin } from './plugins/media.ts';
export { emailPlugin } from './plugins/email.ts';
export { corePlugins, workerPlugins } from './plugins/index.ts';

// 默认 Worker 入口 URL（由构建产物 dist/worker.js 解析；调用方传给 createPreviewer({ workerUrl })）。
// CJS 产物中 import.meta 被 esbuild 置空 → new URL 直接抛 RangeError，会让整个 index.cjs require 失败
// （复验实证）。故捕获后降级为空串：CJS 消费者需显式传 workerUrl（Node 端 spawnWorker 本就为 null）。
export const defaultWorkerUrl: string = (() => {
  try {
    return new URL('./worker.js', import.meta.url).href;
  } catch {
    return '';
  }
})();
