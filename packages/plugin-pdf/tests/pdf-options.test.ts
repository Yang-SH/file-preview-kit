// PDF 插件 G1「数据透明版」单测（Node 路径）：maxPages 选项可接受且不影响 Node 全文提取；
// 浏览器渲染的 totalPages/renderedPages 元数据在真 Chromium 的 harness 中覆盖。
import { describe, it, expect } from 'vitest';
import { initNodeSanitizer, createNodeEnv } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';

/** 多页最小 PDF：每页含标记文本「MARK-PAGE-i」，供断言完整提取。 */
function makeMultiPagePdf(pages: number): Uint8Array {
  const fontObj = 3 + pages * 2; // 固定排在最后一个对象
  const objs: string[] = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  const kids: string[] = [];
  for (let i = 0; i < pages; i++) kids.push(`${3 + i * 2} 0 R`);
  objs[2] = `<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pages}>>`;
  for (let p = 0; p < pages; p++) {
    const pageObj = 3 + p * 2;
    const contentObj = pageObj + 1;
    objs[pageObj] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents ${contentObj} 0 R/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>`;
    const stream = `BT /F1 12 Tf 50 150 Td (MARK-PAGE-${p + 1}) Tj ET`;
    objs[contentObj] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  }
  objs[fontObj] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  const total = 2 + pages * 2 + 1;
  for (let i = 1; i <= total; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${total + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function memFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    extension: 'pdf',
    header: async () => bytes.subarray(0, 16),
    readRange: async (a: number, b: number) => bytes.subarray(a, Math.min(b, bytes.length)),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe('pdfPlugin maxPages（G1 数据透明版·Node 路径）', () => {
  it('P1 默认构造；Node 文本提取保持全量（maxPages 只约束浏览器渲染预算）', async () => {
    await initNodeSanitizer();
    const pv = pdfPlugin();
    const bytes = makeMultiPagePdf(5);
    const r = await pv.preview(memFile('multi.pdf', bytes) as any, createNodeEnv(), {});
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('MARK-PAGE-5');
  });

  it('P2 maxPages 选项被接受且不破坏 Node 全文提取语义', async () => {
    const pv = pdfPlugin({ maxPages: 2 });
    expect(typeof pv.preview).toBe('function');
    const bytes = makeMultiPagePdf(5);
    const r = await pv.preview(memFile('multi.pdf', bytes) as any, createNodeEnv(), {});
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('MARK-PAGE-5');
  });
});
