// 缩略图 API（G2 两档首发）：图片缩小 / PDF 首页真图；其余格式统一回退「图标＋文件名＋大小」文字卡。
// 设计对齐 G1「数据透明版」哲学：库产出数据（dataUrl / 卡片字段），列表 UI 由调用方自建。
// 插件通过可选 thumbnail() 方法参与；未实现或抛错的插件由本层兜底，调用方无需感知格式差异。
import type { IFile, EnvAdapter, PreviewPlugin, DetectResult, ThumbnailRequest, ThumbnailResult } from './types.ts';
import { detectFile } from './detect.ts';

export interface ThumbnailerOptions {
  plugins: PreviewPlugin[];
}

export interface Thumbnailer {
  /** 产出缩略图；永不 reject——一切失败收敛为 fallback-card（方案 §16 调用方按可预期结果分支）。 */
  thumbnail(file: IFile, env: EnvAdapter, req?: ThumbnailRequest): Promise<ThumbnailResult>;
}

const FAMILY_ICONS: Array<{ test: (d: DetectResult) => boolean; family: string; icon: string }> = [
  { family: 'image', icon: '🖼️', test: (d) => d.mimeType.startsWith('image/') },
  { family: 'video', icon: '🎬', test: (d) => d.mimeType.startsWith('video/') },
  { family: 'audio', icon: '🎵', test: (d) => d.mimeType.startsWith('audio/') },
  { family: 'pdf', icon: '📕', test: (d) => d.mimeType === 'application/pdf' },
  { family: 'archive', icon: '🗜️', test: (d) => d.zipHint === 'zip' || d.mimeType.includes('zip') },
  { family: 'word', icon: '📘', test: (d) => d.zipHint === 'docx' },
  { family: 'excel', icon: '📗', test: (d) => d.zipHint === 'xlsx' },
  { family: 'powerpoint', icon: '📙', test: (d) => d.zipHint === 'pptx' },
  { family: 'text', icon: '📄', test: (d) => d.isText === true || !!d.extension },
];

function fallbackCard(detected: DetectResult, file: IFile): ThumbnailResult {
  const hit = FAMILY_ICONS.find((f) => f.test(detected));
  return {
    via: 'fallback-card',
    formatFamily: hit?.family ?? 'binary',
    icon: hit?.icon ?? '❓',
    name: detected.fileName,
    size: file.size,
  };
}

export function createThumbnailer(opts: ThumbnailerOptions): Thumbnailer {
  return {
    async thumbnail(file, env, req): Promise<ThumbnailResult> {
      const detected = await detectFile(file);
      // 与 previewer 同源：以探测结论富化，插件消费准确 mimeType（D1 修复的同一契约）
      const routed: IFile = { ...file, mimeType: detected.mimeType };

      const candidates = opts.plugins
        .map((p) => ({ p, priority: p.test(detected) }))
        .filter((x) => x.priority > 0 && typeof x.p.thumbnail === 'function')
        .sort((a, b) => b.priority - a.priority);

      for (const { p } of candidates) {
        try {
          const r = await p.thumbnail!(routed, env, req);
          if (r && (r.via === 'image' || r.via === 'fallback-card')) return r;
        } catch (e) {
          env.log?.('warn', `[thumbnail] plugin ${p.id} failed, fallback to card`, e);
        }
      }
      return fallbackCard(detected, file);
    },
  };
}
