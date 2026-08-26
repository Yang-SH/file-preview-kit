import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '@file-preview/core';
import { PreviewErrorCode } from '@file-preview/core';

// PDF 预览插件（方案 §5.2 / §9 plugin-pdf 独立包）：
// - 浏览器：pdfjs 把前 N 页渲染为 PNG dataURL，包装 <img> 的 html（经 render 的 env.sanitize 净化）。
//   pdfjs 解析在其自身 Worker 中进行，主线程不阻塞。
// - Node：pdfjs 提取每页文本 → kind 'text'（不渲染，避开 canvas 依赖）。
// 重依赖 pdfjs-dist 动态 import（不进主包，方案 §9）；worker/module/fonts URL 由 env.getAssetUrl 注入。
// runsInWorker:false —— pdfjs 自管 Worker，不应再被裹进「核心统一派发 Worker」（避免 Worker 嵌套）。
const MAX_PREVIEW_PAGES = 3;

export function pdfPlugin(): PreviewPlugin {
  return {
    id: 'pdf',
    contractVersion: 1,
    runsInWorker: false,
    test(ctx: DetectResult): number {
      if (ctx.mimeType === 'application/pdf') return 95;
      if (ctx.extension === 'pdf') return 95;
      return 0;
    },
    async preview(file: IFile, env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      try {
        const inBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
        return inBrowser ? await renderInBrowser(file, env, opts) : await extractInNode(file, opts);
      } catch (e) {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: `pdf parse failed: ${(e as Error).message}`,
        };
      }
    },
  };
}

async function loadPdfjs(env: EnvAdapter): Promise<any> {
  const modUrl = env.getAssetUrl?.('pdf.module');
  const pdfjs = modUrl ? await import(/* @vite-ignore */ modUrl) : await import('pdfjs-dist');
  const workerSrc = env.getAssetUrl?.('pdf.worker');
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}

async function renderInBrowser(file: IFile, env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
  const pdfjs = await loadPdfjs(env);
  const fontsUrl = env.getAssetUrl?.('pdf.fonts');
  const data = await file.arrayBuffer();
  const params: Record<string, unknown> = { data, isEvalSupported: false };
  if (fontsUrl) params.standardFontDataUrl = fontsUrl;

  const doc = await pdfjs.getDocument(params).promise;
  const n = Math.min(doc.numPages, MAX_PREVIEW_PAGES);
  const pages: string[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
    opts?.onProgress?.({ phase: `pdf:${i}`, loaded: i, total: n });
    page.cleanup();
  }

  const html =
    `<div class="fpk-pdf">` +
    pages
      .map(
        (src, idx) =>
          `<figure class="fpk-pdf-page"><img src="${src}" alt="第 ${idx + 1} 页" /><figcaption>第 ${idx + 1} 页</figcaption></figure>`,
      )
      .join('') +
    `</div>`;
  return { kind: 'html', html, title: `${file.name}（预览前 ${n}/${doc.numPages} 页）` };
}

async function extractInNode(file: IFile, opts?: PreviewOptions): Promise<PreviewResult> {
  // node:module 在部分 @types/node 下被解析为 export= 形式，解构 createRequire 会类型报错，故显式断言。
  const nodeModule = (await import('node:module')) as unknown as {
    createRequire: (url: string) => NodeRequire;
  };
  const { pathToFileURL } = await import('node:url');

  // require 基准目录：CJS 包装器原生提供 __filename；ESM（源码直跑/vitest/SSR dist）下退回 cwd。
  // 不写死 import.meta.url —— CJS 产物中它被置空，createRequire(undefined) 会抛错（复验实证）。
  // 仅用于裸说明符 require.resolve（下方两处均已 try/catch 优雅降级），
  // 标准 node_modules 布局（npm/pnpm 扁平 + symlink）下 cwd 与模块目录解析结果等价。
  const { join } = await import('node:path');
  const requireBase =
    typeof __filename === 'string' ? __filename : pathToFileURL(join(process.cwd(), 'index.js')).href;
  const require = nodeModule.createRequire(requireBase);

  // Node 环境走 legacy 构建（标准构建面向浏览器，会打印警告）。
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  } catch {
    // 解析不到 worker 文件时，pdfjs 会尝试 fake worker；Node 下文本提取仍可工作。
  }

  const data = new Uint8Array(await file.arrayBuffer());
  // Node 的 fetch 不支持 file://，standardFontDataUrl 会加载失败；
  // 改用自定义 StandardFontDataFactory，用 fs 直读标准字体（对齐 pdfjs Node 文档推荐做法）。
  let params: Record<string, unknown> = { data, isEvalSupported: false, useWorkerFetch: false };
  try {
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const pkgJson = require.resolve('pdfjs-dist/package.json');
    const fontsDir = path.join(path.dirname(pkgJson), 'standard_fonts');
    class NodeStandardFontDataFactory {
      baseUrl: string;
      constructor({ baseUrl }: { baseUrl?: string | null }) {
        this.baseUrl = baseUrl ?? '';
      }
      async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
        const buf = await fs.readFile(path.join(fontsDir, filename));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    }
    params.StandardFontDataFactory = NodeStandardFontDataFactory;
  } catch {
    // 字体目录解析失败时省略该参数，文本提取仍尽力而为。
  }
  const doc = await pdfjs.getDocument(params).promise;
  const lines: string[] = [];
  const n = doc.numPages;
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it: any) => ('str' in it ? it.str : '')).join(' ');
    lines.push(`—— 第 ${i} 页 ——\n${text}`);
    opts?.onProgress?.({ phase: `pdf:${i}`, loaded: i, total: n });
  }
  return { kind: 'text', text: lines.join('\n\n'), language: 'pdf' };
}
