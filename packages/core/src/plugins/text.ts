import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'log', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
  'yaml', 'yml', 'toml', 'ini', 'sh', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sql', 'tex',
]);

// 参考插件：纯文本 / 代码 / JSON（markdown/csv 骨架阶段按文本展示，后续独立插件）。
export function textPlugin(): PreviewPlugin {
  return {
    id: 'text',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.mimeType.startsWith('text/')) return 100;
      if (ctx.extension && TEXT_EXT.has(ctx.extension)) return 100;
      if (ctx.isText) return 50;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      const maxRead = Math.min(file.size, 8 * 1024 * 1024); // 文本上限 8MB
      const bytes = await file.readRange(0, maxRead);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      opts?.onProgress?.({ phase: 'decode', loaded: bytes.length, total: file.size });

      if (file.extension === 'json' || file.mimeType === 'application/json') {
        try {
          return { kind: 'json', data: JSON.parse(text) };
        } catch {
          // 解析失败仍按文本展示
        }
      }
      return { kind: 'text', text, language: languageOf(file.extension, file.mimeType) };
    },
  };
}

function languageOf(ext?: string, mime?: string): string | undefined {
  if (mime === 'application/json') return 'json';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'xml' || mime === 'application/xml') return 'xml';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js') return 'javascript';
  if (ext === 'ts') return 'typescript';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return undefined;
}
