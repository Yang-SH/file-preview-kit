import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult, ThumbnailRequest, ThumbnailResult } from '@file-preview/core';
import { PreviewErrorCode } from '@file-preview/core';

// PDF 预览插件（方案 §5.2 / §9 plugin-pdf 独立包）：
// - 浏览器：pdfjs 把前 N 页渲染为 PNG dataURL，包装 <img> 的 html（经 render 的 env.sanitize 净化）。
//   pdfjs 解析在其自身 Worker 中进行，主线程不阻塞。
// - Node：pdfjs 提取每页文本 → kind 'text'（不渲染，避开 canvas 依赖）。
// 重依赖 pdfjs-dist 动态 import（不进主包，方案 §9）；worker/module/fonts URL 由 env.getAssetUrl 注入。
// runsInWorker:false —— pdfjs 自管 Worker，不应再被裹进「核心统一派发 Worker」（避免 Worker 嵌套）。
//
// G1 数据透明版：maxPages 可配（默认 3），结果元数据携带 totalPages/renderedPages，
// 翻页 UI 由调用方依据元数据自建——库保持「给数据不管交互」的渲染层哲学。
export interface PdfPluginOptions {
  /** 浏览器 canvas 渲染的页数上限；Node 文本提取不受此限（内容级完整阅读） */
  maxPages?: number;
  /**
   * G7：内置文案可注入（默认中文）。覆盖渲染层图注、标题与 Node 文本页头。
   * 函数式模板——调用方接 i18n 框架或返回任意语言文案。
   */
  messages?: PdfMessages;
}

export interface PdfMessages {
  figcaptionPage?: (index: number, totalPages: number) => string;
  nodePageHeader?: (index: number, totalPages: number) => string;
  titlePreview?: (name: string, rendered: number, total: number) => string;
}

const DEFAULT_PDF_MESSAGES: Required<PdfMessages> = {
  figcaptionPage: (i, total) => `第 ${i} 页`,
  nodePageHeader: (i, total) => `—— 第 ${i} 页 ——`,
  titlePreview: (name, rendered, total) => `${name}（预览前 ${rendered}/${total} 页）`,
};

const DEFAULT_MAX_PAGES = 3;

export function pdfPlugin(options: PdfPluginOptions = {}): PreviewPlugin {
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const msg: Required<PdfMessages> = { ...DEFAULT_PDF_MESSAGES, ...(options.messages ?? {}) };
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
        // D2 同源修复：扩展名/MIME 可伪造，解析前以 %PDF- 魔数自证；不符交还候选链。
        const head = await file.header(8);
        const magic = new TextDecoder('latin1').decode(head);
        if (!magic.startsWith('%PDF-')) {
          return {
            kind: 'error',
            code: PreviewErrorCode.PARSE,
            message: `pdf magic mismatch: ${JSON.stringify(magic.slice(0, 5))}`,
          };
        }
        const inBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
        return inBrowser ? await renderInBrowser(file, env, opts, maxPages, msg) : await extractInNode(file, opts, msg);
      } catch (e) {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: `pdf parse failed: ${(e as Error).message}`,
        };
      }
    },
    /** G2：PDF 首页缩略图——浏览器 canvas 小尺寸渲染；Node 无 canvas，抛错交由 thumbnailer 落回退卡。 */
    async thumbnail(file: IFile, env: EnvAdapter, req?: ThumbnailRequest): Promise<ThumbnailResult> {
      if (typeof document === 'undefined') throw new Error('pdf thumbnail requires browser canvas');
      const pdfjs = await loadPdfjs(env);
      const fontsUrl = env.getAssetUrl?.('pdf.fonts');
      const data = await file.arrayBuffer();
      const params: Record<string, unknown> = { data, isEvalSupported: false };
      if (fontsUrl) params.standardFontDataUrl = fontsUrl;
      const doc = await pdfjs.getDocument(params).promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      // 等比适配请求上限（默认 320），scale 下限保护避免过小
      const maxW = req?.maxWidth ?? 320;
      const maxH = req?.maxHeight ?? 320;
      const scale = Math.min(1, maxW / base.width, maxH / base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d canvas context unavailable');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      return { via: 'image', dataUrl, width: canvas.width, height: canvas.height, mimeType: 'image/png' };
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

async function renderInBrowser(
  file: IFile,
  env: EnvAdapter,
  opts: PreviewOptions | undefined,
  maxPages: number,
  msg: Required<PdfMessages>,
): Promise<PreviewResult> {
  const pdfjs = await loadPdfjs(env);
  const fontsUrl = env.getAssetUrl?.('pdf.fonts');
  const data = await file.arrayBuffer();
  const params: Record<string, unknown> = { data, isEvalSupported: false };
  if (fontsUrl) params.standardFontDataUrl = fontsUrl;

  const doc = await pdfjs.getDocument(params).promise;
  const n = Math.min(doc.numPages, maxPages);
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
    const src = canvas.toDataURL('image/png');

    // G6：静态文本层 overlay——透明 span 绝对定位在 canvas 上，
    // 原生 Ctrl+F 可检索、文字可选中复制；纯渲染期计算，无运行时状态。
    let layerHtml = '';
    try {
      const tc = await page.getTextContent();
      layerHtml = buildTextLayerSpans(tc.items as any[], viewport.transform, viewport.width, viewport.height);
    } catch {
      // 文本层失败不影响页面图（如扫描版无文本）
    }

    const caption = msg.figcaptionPage(i, doc.numPages);
    pages.push(
      `<figure class="fpk-pdf-page" style="position:relative;margin:0">` +
      `<img src="${src}" alt="${escapeAttrPdf(caption)}" />` +
      (layerHtml ? `<div class="fpk-pdf-textlayer">${layerHtml}</div>` : '') +
      `<figcaption>${escapeAttrPdf(caption)}</figcaption></figure>`,
    );
    opts?.onProgress?.({ phase: `pdf:${i}`, loaded: i, total: n });
    page.cleanup();
  }

  const html =
    `<div class="fpk-pdf">` +
    pages.join('') +
    `</div>`;
  // G1 数据透明：调用方据 totalPages/renderedPages 自建「查看全部 N 页」或分页控件
  return { kind: 'html', html, title: msg.titlePreview(file.name, n, doc.numPages), totalPages: doc.numPages, renderedPages: n };
}

/** HTML 属性转义（文本层 span 的 str 与 alt 使用）。 */
function escapeAttrPdf(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!);
}

/**
 * G6 纯函数：pdfjs 文本内容 → 绝对定位透明 span 云。
 * 坐标系：viewport.transform × item.transform 得设备像素坐标，相对画布原尺寸绝对定位；
 * 容器（fpk-pdf-textlayer）与画布同尺寸，随图片缩放由调用方 CSS 负责。
 * 导出仅为可测性——消费方请走 pdfPlugin()。
 */
export function buildTextLayerSpans(
  items: Array<{ str: string; transform: number[]; width: number; height: number }>,
  viewportTransform: number[],
  viewportWidth: number,
  viewportHeight: number,
): string {
  const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const out: string[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const tx = mul(viewportTransform, it.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (!(fontHeight > 0)) continue;
    const left = tx[4];
    const top = tx[5] - fontHeight;
    if (left < -viewportWidth || top < -viewportHeight || left > viewportWidth * 2 || top > viewportHeight * 2) continue;
    const style =
      `position:absolute;left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;` +
      `font-size:${fontHeight.toFixed(2)}px;line-height:${fontHeight.toFixed(2)}px;` +
      `white-space:pre;transform-origin:0 0;color:transparent;cursor:text;`;
    out.push(`<span style="${style}">${escapeAttrPdf(it.str)}</span>`);
  }
  return out.join('');
}

async function extractInNode(file: IFile, opts: PreviewOptions | undefined, msg: Required<PdfMessages>): Promise<PreviewResult> {
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
    lines.push(`${msg.nodePageHeader(i, n)}\n${text}`);
    opts?.onProgress?.({ phase: `pdf:${i}`, loaded: i, total: n });
  }
  return { kind: 'text', text: lines.join('\n\n'), language: 'pdf' };
}
