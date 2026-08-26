import type { IFile, PreviewResult, DetectResult } from './types.ts';

export interface PreviewCache {
  get(key: string): PreviewResult | undefined;
  set(key: string, value: PreviewResult): void;
  shouldCache(r: PreviewResult): boolean;
}

// FNV-1a 对 header 前缀做快速哈希，避免仅用 name:size:ext 造成不同文件碰撞（计划 §6/§12）。
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function fileToCacheKey(file: IFile, detected: DetectResult): string {
  const head = detected.header.subarray(0, Math.min(detected.header.length, 4096));
  return `${file.name}:${file.size}:${detected.extension ?? ''}:${fnv1a(head)}`;
}

// 仅缓存轻量结果（text/table/tree/json/media-metadata），跳过 image / 带 dataUrl 的 media。
export function createLruCache(max = 64): PreviewCache {
  const map = new Map<string, PreviewResult>();
  const lightweight = new Set(['text', 'table', 'tree', 'json', 'media']);
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest) map.delete(oldest);
      }
    },
    shouldCache(r) {
      if (r.kind === 'image') return false;
      if (r.kind === 'media' && r.src) return false;
      return lightweight.has(r.kind);
    },
  };
}
