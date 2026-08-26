import DOMPurify from 'dompurify';
import { minimalSanitize } from './sanitize-shared.ts';

// DOMPurify 默认配置即禁止 <script>、事件处理器(on*)、外链脚本等；这里保持默认即可。
const HTML_CONFIG = {};
// iframe kind 内部 srcdoc 已是整页文档，但允许 <iframe> 自身嵌套（外层 render 会再 sandbox）。
const IFRAME_CONFIG = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'srcdoc', 'sandbox', 'scrolling', 'width', 'height'],
};

// 浏览器端 sanitizer：优先 DOMPurify，无 window（非浏览器）时降级 minimalSanitize。
export function browserSanitizer(html: string, opts?: { iframe?: boolean }): string {
  const dp = DOMPurify as unknown as { isSupported?: boolean; sanitize: (h: string, c?: object) => string };
  if (!dp.isSupported) return minimalSanitize(html);
  try {
    return dp.sanitize(html, opts?.iframe ? IFRAME_CONFIG : HTML_CONFIG);
  } catch {
    return minimalSanitize(html);
  }
}
