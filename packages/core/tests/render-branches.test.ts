// render 分支补测：iframe 双形态（DOM/HTML 字符串）、media controls、default JSON 兜底。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, renderToHtml } from '../src/index.ts';
import { createBrowserEnv } from '../src/index.ts';

const env = createBrowserEnv();

describe('render iframe 分支（方案 §七 整页隔离）', () => {
  it('I1 DOM 形态：sandbox token + srcdoc 经 sanitize + 满容器尺寸', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    render({ kind: 'iframe', srcdoc: '<p>hi</p><script>x</script>', sandbox: ['allow-same-origin'] } as any, container, env);
    const f = container.querySelector('iframe')!;
    expect(f).toBeTruthy();
    expect(f.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(f.srcdoc).toContain('<p>hi</p>');
    expect(f.srcdoc).not.toContain('<script>');
    expect(f.style.width).toBe('100%');
    container.remove();
  });

  it('I2 HTML 字符串形态：srcdoc 经 escapeAttr 包裹（属性值转义）', () => {
    const html = renderToHtml({ kind: 'iframe', srcdoc: '<b>ok</b>' } as any, env);
    expect(html).toContain('sandbox="allow-same-origin"');
    expect(html).toContain('&lt;b&gt;ok&lt;/b&gt;');
  });

  it('I3 default 分支：未知 kind → JSON 序列化转义兜底 pre', () => {
    const weird = { kind: 'mystery', payload: 42 } as any;
    const html = renderToHtml(weird, env);
    expect(html.startsWith('<pre>')).toBe(true);
    expect(html).toContain('&quot;kind&quot;');
    expect(html).toContain('mystery');
  });

  it('I4 DOM media 分支带原生 controls 属性（G11 基线）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    render({ kind: 'media', mediaType: 'video', src: 'blob:x' } as any, container, env);
    const v = container.querySelector('video')!;
    expect(v.hasAttribute('controls')).toBe(true);
    container.remove();
  });
});
