import type { EnvAdapter, PreviewResult, WorkerHandle } from './types.ts';
import { browserSanitizer } from './sanitize-browser.ts';
import { nodeSanitizer } from './sanitize-node.ts';
import { minimalSanitize } from './sanitize-shared.ts';

export { minimalSanitize } from './sanitize-shared.ts';
export { initNodeSanitizer } from './sanitize-node.ts';

export interface EnvOptions {
  sanitize?: (html: string, opts?: { iframe?: boolean }) => string;
  log?: EnvAdapter['log'];
  /** pdfjs ESM module URL（CDN drop-in 场景用，bundler 场景可省略走裸 import） */
  pdfModuleUrl?: string;
  /** pdfjs worker URL（必须；pdfjs 解析在 worker 中进行，主线程不阻塞） */
  pdfWorkerUrl?: string;
  /** pdfjs 标准字体目录 URL（非嵌入字体渲染用，缺省时 pdfjs 仅告警） */
  pdfFontsUrl?: string;
}

// 浏览器端 EnvAdapter：sanitize 默认用 DOMPurify（见方案 §7/§16）。
export function createBrowserEnv(opts: EnvOptions = {}): EnvAdapter {
  const getAssetUrl = (name: string): string | undefined => {
    if (name === 'pdf.module') return opts.pdfModuleUrl;
    if (name === 'pdf.worker') return opts.pdfWorkerUrl;
    if (name === 'pdf.fonts') return opts.pdfFontsUrl;
    return undefined;
  };
  return {
    isBrowser: true,
    async loadWasm(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`loadWasm failed: ${url} ${res.status}`);
      return res.arrayBuffer();
    },
    createObjectURL(data, mimeType) {
      const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
      return URL.createObjectURL(blob);
    },
    revokeObjectURL(url) {
      URL.revokeObjectURL(url);
    },
    // 核心统一派发：主线程创建 Worker，按消息 id 对应 Promise。
    spawnWorker(workerUrl: string): WorkerHandle | null {
      if (typeof Worker === 'undefined') return null;
      const w = new Worker(workerUrl, { type: 'module' });
      const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
      let seq = 0;
      w.onmessage = (ev: MessageEvent<{ id: number; result: PreviewResult }>) => {
        const p = pending.get(ev.data.id);
        if (p) {
          pending.delete(ev.data.id);
          p.resolve(ev.data.result);
        }
      };
      w.onerror = (e: ErrorEvent) => {
        const err = new Error(e.message || 'worker error');
        for (const [, p] of pending) p.reject(err);
        pending.clear();
      };
      return {
        post<T>(payload: unknown): Promise<T> {
          const id = ++seq;
          return new Promise<T>((resolve, reject) => {
            pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
            w.postMessage({ id, ...(payload as Record<string, unknown>) });
          });
        },
        terminate() {
          w.terminate();
        },
      };
    },
    getAssetUrl,
    sanitize: opts.sanitize ?? browserSanitizer,
    log: opts.log,
  };
}

// Node 端 EnvAdapter：sanitize 默认用 sanitize-html（需先 initNodeSanitizer()，否则降级 minimalSanitize）。
// Node 暂不做 Worker 派发（worker_threads 后续可加），spawnWorker 返回 null → 主线程异步。
export function createNodeEnv(opts: EnvOptions = {}): EnvAdapter {
  return {
    isBrowser: false,
    async loadWasm(url) {
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(url);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
    createObjectURL() {
      return null;
    },
    revokeObjectURL() {},
    spawnWorker() {
      return null;
    },
    getAssetUrl() {
      return undefined;
    },
    sanitize: opts.sanitize ?? nodeSanitizer,
    log: opts.log,
  };
}

export const browserAdapter = createBrowserEnv();
export const nodeAdapter = createNodeEnv();
