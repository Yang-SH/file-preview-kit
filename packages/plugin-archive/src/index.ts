import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult, FileTreeNode } from '@file-preview/core';
import { PreviewErrorCode, generateHexDump } from '@file-preview/core';

// zip 炸弹防御阈值（方案 §11 具体化；§12 fixture 测试见 core tests/archive.test.ts，用注入的小阈值构造超限样本）。
export interface ZipGuardLimits {
  /** 解压后总大小上限（声明值），默认 100MB */
  maxTotalUncompressed?: number;
  /** 条目数上限，默认 1000 */
  maxEntries?: number;
  /** 路径嵌套层数上限，默认 10 */
  maxDepth?: number;
  /** 单条目解压上限（声明值），默认 50MB */
  maxSingleEntry?: number;
}

const DEFAULTS: Required<ZipGuardLimits> = {
  maxTotalUncompressed: 100 * 1024 * 1024,
  maxEntries: 1000,
  maxDepth: 10,
  maxSingleEntry: 50 * 1024 * 1024,
};

interface EntryMeta {
  name: string;
  originalSize: number;
  depth: number;
  isDir: boolean;
}

// 由路径清单构建 FileTreeNode 树：中间段为 dir，显式目录条目（'a/'）合并进同名 dir。
function buildTree(entries: EntryMeta[]): FileTreeNode[] {
  const rootChildren: FileTreeNode[] = [];
  const dirs = new Map<string, FileTreeNode>();
  const ensureDir = (path: string): FileTreeNode[] => {
    if (path === '') return rootChildren;
    const existing = dirs.get(path);
    if (existing) return existing.children!;
    const idx = path.lastIndexOf('/');
    const parentPath = idx === -1 ? '' : path.slice(0, idx);
    const name = idx === -1 ? path : path.slice(idx + 1);
    const node: FileTreeNode = { name, type: 'dir', children: [] };
    ensureDir(parentPath).push(node);
    dirs.set(path, node);
    return node.children!;
  };
  for (const e of entries) {
    if (e.isDir) {
      ensureDir(e.name.replace(/\/+$/, ''));
      continue;
    }
    const idx = e.name.lastIndexOf('/');
    const parentPath = idx === -1 ? '' : e.name.slice(0, idx);
    const base = idx === -1 ? e.name : e.name.slice(idx + 1);
    ensureDir(parentPath).push({ name: base, type: 'file', size: e.originalSize });
  }
  return rootChildren;
}

// 超限降级：hex dump + 稳定码 ERR_TOO_LARGE（方案 §16：调用方按 code 分支，不靠文案）。
async function degrade(file: IFile, mimeType: string, reason: string): Promise<PreviewResult> {
  try {
    const head = await file.readRange(0, 64 * 1024);
    return {
      kind: 'binary',
      hexDump: generateHexDump(head),
      info: { size: file.size, mimeType, code: PreviewErrorCode.TOO_LARGE, reason },
    };
  } catch {
    return { kind: 'error', code: PreviewErrorCode.TOO_LARGE, message: reason };
  }
}

// 压缩包插件（方案 §5.4）：zip → kind:'tree'。
// 炸弹防御根基：fflate filter 恒返 false —— 只读中央目录清单，任何条目都不解压。
// 即便中央目录谎报 originalSize，预览路径也无解压行为，内存上界 = 输入文件本身。
/** 定位首个本地文件头 PK\x03\x04；返回其偏移（0 表示已在偏移 0，>0 表示需剥离前缀）。 */
function findLocalHeaderOffset(bytes: Uint8Array): number {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      return i;
    }
  }
  return 0;
}

export function zipPlugin(limits?: ZipGuardLimits): PreviewPlugin {
  const lim = { ...DEFAULTS, ...limits };
  return {
    id: 'archive',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      // 仅接管通用 zip；docx/xlsx/pptx 由 office 插件负责（zipHint 互斥）。
      return ctx.zipHint === 'zip' ? 80 : 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts: PreviewOptions): Promise<PreviewResult> {
      const bytes = new Uint8Array(await file.arrayBuffer());
      opts?.onProgress?.({ phase: 'zip:listing', loaded: bytes.length, total: file.size });

      const { unzipSync } = await import('fflate');
      const parse = (data: Uint8Array): EntryMeta[] => {
        const meta: EntryMeta[] = [];
        unzipSync(data, {
          filter: (f) => {
            meta.push({
              name: f.name,
              originalSize: f.originalSize,
              depth: f.name.split('/').filter(Boolean).length,
              isDir: f.name.endsWith('/'),
            });
            return false; // 永不解压
          },
        });
        return meta;
      };

      // 前缀剥离：自解压/前缀包裹 zip 的本地文件头不在偏移 0。
      // 先定位首个 PK\x03\x04 再决定解析起点——直接用带前缀的 buffer 会让 fflate 误读 originalSize 触发炸弹防御。
      const off = findLocalHeaderOffset(bytes);
      const target = off > 0 ? bytes.subarray(off) : bytes;

      let meta: EntryMeta[];
      try {
        meta = parse(target);
      } catch (e) {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: `无法解析该 zip 压缩包（可能加密或采用了不支持的压缩方式）：${(e as Error).message}`,
        };
      }

      // 四阈值快速失败（顺序：条目数 → 总量 → 单条目 → 嵌套）
      if (meta.length > lim.maxEntries) {
        return degrade(file, 'application/zip', `zip bomb guard: ${meta.length} entries > max ${lim.maxEntries}`);
      }
      const total = meta.reduce((s, m) => s + m.originalSize, 0);
      if (total > lim.maxTotalUncompressed) {
        return degrade(file, 'application/zip', `zip bomb guard: total uncompressed ${total} > max ${lim.maxTotalUncompressed}`);
      }
      const single = meta.reduce((s, m) => Math.max(s, m.originalSize), 0);
      if (single > lim.maxSingleEntry) {
        return degrade(file, 'application/zip', `zip bomb guard: single entry ${single} > max ${lim.maxSingleEntry}`);
      }
      const depth = meta.reduce((s, m) => Math.max(s, m.depth), 0);
      if (depth > lim.maxDepth) {
        return degrade(file, 'application/zip', `zip bomb guard: nesting depth ${depth} > max ${lim.maxDepth}`);
      }

      meta.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { kind: 'tree', nodes: buildTree(meta) };
    },
  };
}
