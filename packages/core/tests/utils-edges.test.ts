// 工具层边界直测：generateHexDump 格式与截断标记 / combineSignal 超时关闭语义 /
// fileToCacheKey 构成 / LRU shouldCache 契约 / fileFromBrowser 命名解析 / env 资产映射。
import { describe, it, expect } from 'vitest';
import { generateHexDump, combineSignal, createLruCache, fileToCacheKey } from '../src/index.ts';
import { fileFromBrowser } from '../src/index.ts';
import { createBrowserEnv } from '../src/index.ts';

describe('generateHexDump（方案 §四 降级十六进制转储）', () => {
  it('U1 基础布局：8 位偏移列＋hex 列＋ASCII 列，非打印字符显示为点', async () => {
    const bytes = new TextEncoder().encode('AB');
    const dump = generateHexDump(bytes);
    const first = dump.split('\n')[0];
    expect(first.startsWith('00000000')).toBe(true);
    expect(first).toContain('41 42');
    expect(first).toContain('AB');
    expect(dump.split('\n').length).toBe(1); // 2 字节一行
  });

  it('U2 超 4096 字节（16×256）→ 截断并附 more bytes 标记', () => {
    const bytes = new Uint8Array(5000).map((_, i) => i % 256);
    const dump = generateHexDump(bytes);
    expect(dump).toContain('more bytes');
    expect(dump.split('\n').length).toBe(257); // 256 行 + 标记行
  });
});

describe('combineSignal：timeout≤0 关闭超时语义', () => {
  it('U3 timeout=0 → 不启动超时；signal 未中止、timedOut 恒 false', async () => {
    const { signal, timedOut } = combineSignal(undefined, 0);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(false);
    expect(timedOut()).toBe(false);
  });

  it('U4 timeout=-1 同样安全', () => {
    const { timedOut } = combineSignal(undefined, -1);
    expect(timedOut()).toBe(false);
  });
});

describe('fileToCacheKey（方案 §6 缓存键 name+size+ext+headerHash）', () => {
  it('U5 键格式为 name:size:ext:fnv1a(header前4KB)，哈希可独立复算', () => {
    // 独立实现 FNV-1a 作为真相源（防同源反复计算）
    const fnv1a = (bytes: Uint8Array) => {
      let h = 0x811c9dc5;
      for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(16);
    };
    const header = Uint8Array.from([1, 2, 3, 4]);
    const detected = { mimeType: 'x/y', extension: 'bin', fileName: 'f.bin', header, zipHint: null } as any;
    const file = { name: 'f.bin', size: 7 } as any;
    const key = fileToCacheKey(file, detected);
    expect(key).toBe(`f.bin:7:bin:${fnv1a(header)}`);
  });
});

describe('createLruCache.shouldCache（仅轻量结果入缓存）', () => {
  it('U6 image 不缓存；带 src 的 media 不缓存；纯 metadata media 与 text/table/tree/json 缓存', () => {
    const c = createLruCache(4);
    expect(c.shouldCache({ kind: 'image' } as any)).toBe(false);
    expect(c.shouldCache({ kind: 'media', mediaType: 'video', src: 'blob:x' } as any)).toBe(false);
    expect(c.shouldCache({ kind: 'media', mediaType: 'audio' } as any)).toBe(true);
    expect(c.shouldCache({ kind: 'text' } as any)).toBe(true);
    expect(c.shouldCache({ kind: 'table' } as any)).toBe(true);
  });
});

describe('fileFromBrowser 命名与元数据解析', () => {
  it('U7 无名 Blob → blob 兜底；显式参数优先；mimeType 取自 Blob.type', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'text/plain' }) as any;
    const f1 = await fileFromBrowser(blob);
    expect(f1.name).toBe('blob');
    expect(f1.mimeType).toBe('text/plain');

    const f2 = await fileFromBrowser(new Blob([new Uint8Array(1)]), 'named.txt', 'txt');
    expect(f2.name).toBe('named.txt');
    expect(f2.extension).toBe('txt');
    expect(f2.mimeType).toBeUndefined();
  });
});

describe('createBrowserEnv：资产 URL 映射与 Worker 兜底', () => {
  it('U8 getAssetUrl 三类 pdf 资产映射；Node 环境 spawnWorker 返回 null', () => {
    const env = createBrowserEnv({
      pdfModuleUrl: '/m.js',
      pdfWorkerUrl: '/w.js',
      pdfFontsUrl: '/fonts/',
    });
    expect(env.getAssetUrl?.('pdf.module')).toBe('/m.js');
    expect(env.getAssetUrl?.('pdf.worker')).toBe('/w.js');
    expect(env.getAssetUrl?.('pdf.fonts')).toBe('/fonts/');
    expect(env.getAssetUrl?.('unknown')).toBeUndefined();
    expect(env.spawnWorker?.('/any.js') ?? null).toBeNull(); // Node 无 Worker 构造器
  });
});
