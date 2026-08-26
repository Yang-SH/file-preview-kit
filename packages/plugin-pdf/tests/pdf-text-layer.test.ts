// G6 文本层纯函数单测：坐标变换、字号、越界过滤、HTML 转义。
// viewport.transform 采用 pdfjs 常见形式 [scale,0,0,-scale,-x0,y1]（y 翻转）。
import { describe, it, expect } from 'vitest';
import { buildTextLayerSpans } from '../src/index.ts';

const VT = [1.4, 0, 0, -1.4, 0, 840]; // scale=1.4，页高 600 → 画布高 840

describe('buildTextLayerSpans（G6 静态文本层）', () => {
  it('L1 单条目：位置/字号来自 transform 复合，str 被转义', () => {
    const items = [{ str: 'a<b', transform: [12, 0, 0, 12, 100, 200], width: 20, height: 12 }];
    const html = buildTextLayerSpans(items as any, VT, 840, 840);
    expect(html).toContain('position:absolute;left:140.00px;top:');
    expect(html).toContain('font-size:16.80px');
    expect(html).toContain('a&lt;b');
    expect(html).not.toContain('<b');
    // y 翻转：ty = a1*bx? → tx5 = (-1.4)*200 + 840 = 560；top = ty - fontHeight = 560 - 16.8 = 543.2
    expect(html).toContain('top:543.20px');
  });

  it('L2 空 str / 零字号条目被跳过', () => {
    const items = [
      { str: '', transform: [12, 0, 0, 12, 10, 10], width: 5, height: 5 },
      { str: 'ok', transform: [0, 0, 0, 0, 10, 10], width: 5, height: 5 },
      { str: 'kept', transform: [12, 0, 0, 12, 30, 40], width: 10, height: 12 },
    ];
    const html = buildTextLayerSpans(items as any, VT, 840, 840);
    expect(html).not.toContain('>ok<');
    expect(html).toContain('kept');
    expect((html.match(/<span /g) ?? []).length).toBe(1);
  });

  it('L3 远超画布范围的条目被过滤（防异常坐标污染）', () => {
    const items = [
      { str: 'inside', transform: [12, 0, 0, 12, 50, 50], width: 10, height: 12 },
      { str: 'faraway', transform: [12, 0, 0, 12, 50000, 50000], width: 10, height: 12 },
    ];
    const html = buildTextLayerSpans(items as any, VT, 840, 840);
    expect(html).toContain('inside');
    expect(html).not.toContain('faraway');
  });
});
