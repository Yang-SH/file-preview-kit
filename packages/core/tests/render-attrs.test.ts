// G5/G11：render 输出的稳定类名与基线属性断言（宿主 CSS 挂钩与 a11y 契约）。
import { describe, it, expect } from 'vitest';
import { renderToHtml, createNodeEnv } from '../src/index.ts';

describe('renderToHtml 稳定类名与基线属性（G5/G11）', () => {
  it('R-attr image：fpk-image 类 + lazy/decoding', () => {
    const html = renderToHtml({ kind: 'image', dataUrl: 'data:image/png;base64,AA==' }, createNodeEnv());
    expect(html).toContain('class="fpk-image"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('R-attr table/tree/hex 保持稳定类名', () => {
    const env = createNodeEnv();
    expect(renderToHtml({ kind: 'table', columns: ['A'], rows: [[1]] } as any, env)).toContain('class="fp-table"');
    expect(renderToHtml({ kind: 'tree', nodes: [] } as any, env)).toContain('fp-tree');
    expect(renderToHtml({ kind: 'binary', hexDump: 'x' } as any, env)).toContain('fp-hex');
  });
});
