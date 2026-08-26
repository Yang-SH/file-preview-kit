// G7：PDF 内置文案注入（Node 路径验证 nodePageHeader；浏览器图注/标题由 harness 覆盖）
import { describe, it, expect } from 'vitest';
import { initNodeSanitizer, createNodeEnv } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';

function makePdf(): Uint8Array {
  const objs: string[] = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 6 0 R>>>>>>';
  const stream = 'BT /F1 12 Tf 50 150 Td (HELLO) Tj ET';
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  objs[6] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = pdf.length;
    if (objs[i]) pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size 7/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function memFile(bytes: Uint8Array) {
  return {
    name: 'm.pdf',
    size: bytes.length,
    extension: 'pdf',
    header: async () => bytes.subarray(0, 16),
    readRange: async (a: number, b: number) => bytes.subarray(a, Math.min(b, bytes.length)),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe('pdfPlugin messages（G7 i18n 注入·Node 路径）', () => {
  it('M1 默认文案为中文页头；注入自定义 nodePageHeader 后被采用', async () => {
    await initNodeSanitizer();
    const env = createNodeEnv();
    const bytes = makePdf();

    const rDefault = await pdfPlugin().preview(memFile(bytes) as any, env, {});
    expect(rDefault.kind).toBe('text');
    if (rDefault.kind !== 'text') return;
    expect(rDefault.text).toContain('—— 第 1 页 ——');

    const rCustom = await pdfPlugin({ messages: { nodePageHeader: (i) => `[page ${i}]` } })
      .preview(memFile(bytes) as any, env, {});
    expect(rCustom.kind).toBe('text');
    if (rCustom.kind !== 'text') return;
    expect(rCustom.text).toContain('[page 1]');
    expect(rCustom.text).not.toContain('—— 第 1 页 ——');
  });
});
