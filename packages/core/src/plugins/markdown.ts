import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';

const MD_EXT = new Set(['md', 'markdown']);
const MAX_READ = 8 * 1024 * 1024; // 与 text 插件同策略：预览读入上限 8MB

// Markdown → HTML 插件（方案 §5.5）：markdown-it 渲染，产出 kind:'html'，渲染层 env.sanitize 做唯一清理。
// html:false —— 源码中的内联 HTML 被转义而非透传（纵深防御第一层），渲染层 sanitize 兜底第二层。
// 优先级 110 > textPlugin 的 100：专用插件先行，解析失败时 runPipeline 自动降级为纯文本展示。
// 重依赖动态 import（方案 §9），不进主包。
export function markdownPlugin(): PreviewPlugin {
  return {
    id: 'markdown',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.extension && MD_EXT.has(ctx.extension)) return 110;
      if (ctx.mimeType === 'text/markdown') return 110;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      const bytes = await file.readRange(0, Math.min(file.size, MAX_READ));
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      opts?.onProgress?.({ phase: 'markdown', loaded: bytes.length, total: file.size });

      const MarkdownIt = (await import('markdown-it')).default;
      const md = new MarkdownIt({ html: false, linkify: true });
      return { kind: 'html', html: md.render(text), title: file.name };
    },
  };
}
