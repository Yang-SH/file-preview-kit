import { minimalSanitize } from './sanitize-shared.ts';

// Node 端 sanitizer：sanitize-html（纯字符串解析，无 jsdom 依赖）。
// 采用动态 import + 懒初始化，使未安装 sanitize-html 时骨架仍可运行（降级 minimalSanitize）。
let _sanitize: ((html: string, opts?: { iframe?: boolean }) => string) | null = null;
let _loading: Promise<void> | null = null;
let _warned = false;

export function nodeSanitizer(html: string, opts?: { iframe?: boolean }): string {
  if (_sanitize) return _sanitize(html, opts);
  if (!_warned) {
    _warned = true;
    // 仅在尚未初始化真实 sanitizer 时退化；生产应调用 initNodeSanitizer()。
    console.warn('[file-preview] sanitize-html 未初始化，使用 minimalSanitize 降级（生产不安全）。请调用 initNodeSanitizer()。');
  }
  return minimalSanitize(html);
}

export async function initNodeSanitizer(): Promise<void> {
  if (_sanitize || _loading) return _loading ?? Promise.resolve();
  _loading = (async () => {
    const sanitizeHtml = (await import('sanitize-html')).default;
    _sanitize = (html, opts) => {
      if (opts?.iframe) {
        return sanitizeHtml(html, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(['iframe']),
          allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            iframe: ['src', 'srcdoc', 'sandbox', 'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'width', 'height'],
          },
        });
      }
      return sanitizeHtml(html);
    };
  })();
  return _loading;
}
