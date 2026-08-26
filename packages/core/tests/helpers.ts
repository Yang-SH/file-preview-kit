// 测试公共 fixture：与冒烟脚本（examples/node-ssr/smoke.ts）同源的构造器，
// 供 smoke / error-codes 用例复用，避免各文件重复。
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IFile, PreviewPlugin, PreviewResult } from '../src/types.ts';
import { createLruCache, type PreviewCache } from '../src/cache.ts';
import { corePlugins } from '../src/plugins/index.ts';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

/**
 * 全量默认插件集（测试用）：core 内置 + C3 拆分的 plugin-* 包，
 * 与 browser.ts 的 defaultPlugins() / worker.ts 的 defaultWorkerSet() 同构。
 */
export function allPlugins(): PreviewPlugin[] {
  return [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()];
}

/** 最小合法 PNG（1x1，与冒烟脚本一致）。返回 ArrayBuffer 背景的数组，可直接作为 BlobPart。 */
export function makePng(): Uint8Array<ArrayBuffer> {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** 最小但 xref 正确的 PDF（含 "Hello PDF" 文本），与冒烟脚本一致。 */
export function makePdf(): Uint8Array {
  const objs: string[] = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
  const stream = 'BT /F1 12 Tf 50 150 Td (Hello PDF) Tj ET';
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

/** 内存 IFile：调度器/错误码回归用，不落盘。header/readRange 语义对齐 fileFromNode。 */
export function memFile(name: string, bytes: Uint8Array, mimeType?: string): IFile {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase() || undefined;
  return {
    name,
    size: bytes.length,
    ...(mimeType ? { mimeType } : {}),
    ...(ext ? { extension: ext } : {}),
    async header(maxBytes = 16 * 1024) {
      return bytes.subarray(0, Math.min(maxBytes, bytes.length));
    },
    async readRange(start, end) {
      return bytes.subarray(start, Math.max(start, Math.min(end, bytes.length)));
    },
    async arrayBuffer() {
      return bytes.slice().buffer as ArrayBuffer;
    },
  };
}

export interface CacheStats {
  gets: number;
  hits: number;
  sets: number;
}

/** 带 get/set 计数的 LRU 包装：用于断言「缓存命中」而非仅看返回值。 */
export function spyLruCache(): { cache: PreviewCache; stats: CacheStats } {
  const inner = createLruCache();
  const stats: CacheStats = { gets: 0, hits: 0, sets: 0 };
  return {
    stats,
    cache: {
      get(key) {
        stats.gets++;
        const v = inner.get(key);
        if (v !== undefined) stats.hits++;
        return v;
      },
      set(key, value) {
        stats.sets++;
        inner.set(key, value);
      },
      shouldCache(r: PreviewResult) {
        return inner.shouldCache(r);
      },
    },
  };
}

/** 固定优先级插件：test 恒返 priority，preview 记录调用序并产出固定结果。 */
export function staticPlugin(
  id: string,
  priority: number,
  produce: () => PreviewResult | Promise<PreviewResult>,
  callLog?: string[],
): PreviewPlugin {
  return {
    id,
    contractVersion: 1,
    test: () => priority,
    async preview(file, env, opts) {
      callLog?.push(id);
      return produce();
    },
  };
}

/** 挂起直到 signal 中止的插件：驱动 ERR_ABORTED / ERR_TIMEOUT 路径。 */
export function hangUntilAbortPlugin(id = 'hang'): PreviewPlugin {
  return {
    id,
    contractVersion: 1,
    test: () => 100,
    preview(_file, _env, opts) {
      return new Promise<PreviewResult>((_resolve, reject) => {
        const s = opts?.signal;
        if (s?.aborted) {
          reject(new Error('signal already aborted'));
          return;
        }
        s?.addEventListener('abort', () => reject(new Error('aborted during preview')), { once: true });
      });
    },
  };
}

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fpk-test-'));
}

export function writeTempFile(dir: string, name: string, content: string | Uint8Array): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}
