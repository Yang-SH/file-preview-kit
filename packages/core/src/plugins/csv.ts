import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';

const MAX_READ = 8 * 1024 * 1024; // 与 text 插件同策略：预览读入上限 8MB
const MAX_ROWS = 1000; // 与 xlsx 插件同策略（方案 §5.3）：预览用途截断

// CSV → 表格插件（方案 §5.5）：papaparse 解析（自动识别分隔符/引号内逗号/引号内换行）。
// 首行作表头 → kind:'table'，复用既有 tableToHtml 渲染器。
// 优先级 110 > textPlugin 的 100：专用插件先行，失败时 runPipeline 自动降级为纯文本展示。
// 重依赖动态 import（方案 §9），不进主包。
export function csvPlugin(): PreviewPlugin {
  return {
    id: 'csv',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.extension === 'csv' || ctx.mimeType === 'text/csv') return 110;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      const bytes = await file.readRange(0, Math.min(file.size, MAX_READ));
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      opts?.onProgress?.({ phase: 'csv', loaded: bytes.length, total: file.size });

      const Papa = (await import('papaparse')).default;
      const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
      const all = parsed.data ?? [];
      if (all.length === 0) return { kind: 'table', columns: [], rows: [] };

      const columns = all[0].map((c) => String(c ?? ''));
      const rows = all.slice(1, 1 + MAX_ROWS).map((r) => r.map((c) => c ?? ''));
      return { kind: 'table', columns, rows };
    },
  };
}
