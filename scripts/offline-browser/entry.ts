/**
 * 离线浏览器入口（无音频/媒体元数据版）：
 * - 内联全部依赖：core 六轻插件（image/text/markdown/csv/xml/email）+ pdf/office/archive 三插件
 *   + markdown-it/papaparse/dompurify/fast-xml-parser/fflate/emailjs-mime-parser/mammoth/exceljs/pdfjs(含 worker)
 * - 不含 media 插件与 mediainfo WASM：音视频文件走二进制降级卡片（README-BROWSER 有声明）
 * - pdfjs 主线程模式：globalThis.pdfjsWorker 注入 WorkerMessageHandler，无需 Worker 文件，file:// 可用
 * - 无任何网络请求、无裸说明符、无模块加载 —— IIFE 形态支持 file:// 双击直开
 *
 * 仅由 scripts/build-offline-browser-package.mjs 消费，不进入常规 npm 构建与类型检查。
 */
import * as core from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';
import * as pdfjsWorkerNS from 'pdfjs-dist/build/pdf.worker.min.mjs';

// ── pdfjs 主线程模式（必须在首次使用 pdfjs 前注入）──
(globalThis as any).pdfjsWorker = pdfjsWorkerNS;

// ── 插件工厂再导出（单文件内已含全部实现）──
export { pdfPlugin, PdfPluginOptions } from '@file-preview/plugin-pdf';
export { officePlugin, OfficePluginOptions } from '@file-preview/plugin-office';
export { zipPlugin, ZipGuardLimits } from '@file-preview/plugin-archive';

/** 全量默认插件集（无音频/媒体版：core 六轻插件 + 三拆分包，不含 mediaPlugin）。 */
export function allPlugins() {
  return [...core.corePlugins().filter((p) => p.id !== 'media'), pdfPlugin(), officePlugin(), zipPlugin()];
}

// ── 核心全 API 再导出 ──
export const PreviewErrorCode = core.PreviewErrorCode;
export const PreviewAbortError = core.PreviewAbortError;
export const PreviewTimeoutError = core.PreviewTimeoutError;
export const fileFromBrowser = core.fileFromBrowser;
export const fileFromNode = core.fileFromNode;
export const detectFile = core.detectFile;
export const createBrowserEnv = core.createBrowserEnv;
export const createNodeEnv = core.createNodeEnv;
export const createThumbnailer = core.createThumbnailer;
export const createPreviewer = core.createPreviewer;
export const Previewer = core.Previewer;
export const runPipeline = core.runPipeline;
export const generateHexDump = core.generateHexDump;
export const combineSignal = core.combineSignal;
export const createLruCache = core.createLruCache;
export const render = core.render;
export const renderToHtml = core.renderToHtml;
export const initNodeSanitizer = core.initNodeSanitizer;
export const corePlugins = core.corePlugins;
export const workerPlugins = core.workerPlugins;
export const imagePlugin = core.imagePlugin;
export const textPlugin = core.textPlugin;
export const markdownPlugin = core.markdownPlugin;
export const csvPlugin = core.csvPlugin;
export const xmlPlugin = core.xmlPlugin;
export const emailPlugin = core.emailPlugin;
export type { IFile, PreviewResult, PreviewOptions, EnvOptions } from '@file-preview/core';

/** 开箱即用的预览器（主线程派发——离线单文件形态不含独立 Worker 文件）。 */
export function createDefaultPreviewer() {
  return core.createPreviewer({ plugins: allPlugins(), dispatch: 'main' });
}
export const VERSION = '0.4.0-offline';
