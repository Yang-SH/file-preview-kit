// @vitest-environment jsdom
// sanitize XSS 回归（方案 §12 / §7 / §16：渲染层是唯一清理点，双端实现都要挡住注入）。
// - Node 端：sanitize-html（initNodeSanitizer 后的 nodeAdapter.sanitize）
// - 浏览器端：DOMPurify（browserSanitizer，jsdom 提供 window，验证真实生产路径而非降级）
// - 兜底：minimalSanitize（未装依赖时的安全网）
// 样本覆盖任务要求：iframe / object / script 注入；外加 onerror、javascript: 伪协议、svg 向量。
import { describe, it, expect, beforeAll } from 'vitest';
import DOMPurify from 'dompurify';
import { nodeAdapter, initNodeSanitizer } from '../src/env.ts';
import { browserSanitizer } from '../src/sanitize-browser.ts';
import { minimalSanitize } from '../src/sanitize-shared.ts';

interface XssSample {
  label: string;
  html: string;
  /** sanitize 输出必须不命中的模式 */
  forbidden: RegExp[];
  /** sanitize 输出必须保留的良性标记 */
  keep?: string;
}

const SAMPLES: XssSample[] = [
  {
    label: '<script> 块注入',
    html: '<div>safe-marker</div><script>alert("xss")</script>',
    forbidden: [/<script/i, /alert\(/],
    keep: 'safe-marker',
  },
  {
    label: '<img onerror> 内联事件注入',
    html: '<img src="ok.png" alt="pic" onerror="alert(1)">',
    forbidden: [/onerror/i],
  },
  {
    label: '<iframe javascript:> 注入（含 srcdoc 夹带 script）',
    html: '<iframe src="javascript:alert(1)" srcdoc="<script>alert(1)</script>"></iframe>',
    forbidden: [/<iframe/i, /javascript:/i, /<script/i],
  },
  {
    label: '<object>/<embed> 插件注入',
    html: '<object data="evil.html"></object><embed src="evil.swf">',
    forbidden: [/<object/i, /<embed/i],
  },
  {
    label: 'javascript: 伪协议链接',
    html: '<a href="javascript:alert(1)">click</a>',
    forbidden: [/javascript:/i],
  },
  {
    label: '<svg onload> 事件向量',
    html: '<svg onload="alert(1)"><circle r="1"/></svg>',
    forbidden: [/onload/i, /alert\(/],
  },
  {
    label: '<svg><foreignObject> 包裹 iframe',
    html: '<svg><foreignObject><iframe src="javascript:x"></iframe></foreignObject></svg>',
    forbidden: [/<iframe/i, /javascript:/i],
  },
];

function assertClean(sanitized: string, s: XssSample): void {
  for (const re of s.forbidden) {
    expect(sanitized, `[${s.label}] 应剥离 ${re}`).not.toMatch(re);
  }
  if (s.keep !== undefined) {
    expect(sanitized, `[${s.label}] 应保留良性内容`).toContain(s.keep);
  }
}

describe('Node 端 sanitizer（sanitize-html）', () => {
  beforeAll(() => initNodeSanitizer());

  it.each(SAMPLES)('$label 被剥离', (s) => {
    assertClean(nodeAdapter.sanitize(s.html), s);
  });

  it('良性结构与文本保留', () => {
    const out = nodeAdapter.sanitize('<div class="x"><p>正文 <b>加粗</b></p></div>');
    expect(out).toContain('<div');
    expect(out).toContain('正文');
    expect(out).toContain('<b>');
  });

  it('iframe 模式契约：允许 <iframe> 本体（供 render sandbox 包裹），同级脚本仍被剥离', () => {
    const out = nodeAdapter.sanitize('<iframe sandbox="allow-same-origin"></iframe><script>alert(1)</script>', {
      iframe: true,
    });
    expect(out).toContain('<iframe');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(/);
  });
});

describe('浏览器端 sanitizer（DOMPurify + jsdom）', () => {
  it('jsdom 下 DOMPurify 为 supported（走真实生产路径，非 minimalSanitize 降级）', () => {
    const dp = DOMPurify as unknown as { isSupported?: boolean };
    expect(dp.isSupported).toBe(true);
  });

  it.each(SAMPLES)('$label 被剥离', (s) => {
    assertClean(browserSanitizer(s.html), s);
  });

  it('良性结构与文本保留', () => {
    const out = browserSanitizer('<div class="x"><p>正文 <b>加粗</b></p></div>');
    expect(out).toContain('<div');
    expect(out).toContain('正文');
    expect(out).toContain('<b>');
  });

  it('iframe 模式契约：ADD_TAGS 允许 <iframe> 本体，脚本仍被剥离', () => {
    const out = browserSanitizer('<iframe sandbox="allow-same-origin"></iframe><script>alert(1)</script>', {
      iframe: true,
    });
    expect(out).toContain('<iframe');
    expect(out).not.toMatch(/<script/i);
  });
});

describe('minimalSanitize 兜底回归（无真实 sanitizer 时的安全网）', () => {
  it('剥离 <script> 成对与游离开标签（大小写不敏感）', () => {
    expect(minimalSanitize('<p>a</p><script>alert(1)</script>')).toBe('<p>a</p>');
    const mixedCase = minimalSanitize('<SCRIPT src="x"></SCRIPT>b');
    expect(mixedCase).not.toMatch(/<script/i);
    expect(mixedCase).toContain('b');
    expect(minimalSanitize('<ScRiPt>alert(1)</ScRiPt>')).not.toMatch(/alert\(/);
  });

  it('移除 on* 事件属性（双引号/单引号/无引号三种写法）', () => {
    const out = minimalSanitize('<img src=x onerror=alert(1)><body onload=\'go()\'><a onclick="h()">y</a>');
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).toContain('<img src=x'); // 非 on* 属性保留
    expect(out).toContain('y'); // 文本保留
  });

  it('javascript: 伪协议 href/src 中和为 #', () => {
    const out = minimalSanitize('<a href="javascript:alert(1)">z</a><img src="javascript:x">');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="#"');
    expect(out).toContain('src="#"');
  });

  it('良性内容原样保留', () => {
    const html = '<div class="w"><p>普通文本</p></div>';
    expect(minimalSanitize(html)).toBe(html);
  });
});
