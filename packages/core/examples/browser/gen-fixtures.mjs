// 真机实证 fixture 生成器：产出 hello.txt / logo.png / sample.zip / hello.pdf 到 examples/browser/fixtures/。
// 运行：node examples/browser/gen-fixtures.mjs（工作区内解析 fflate）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures');
mkdirSync(outDir, { recursive: true });

// 1) 文本（含中文，验证 DOM 渲染与 Worker 传输不损编码）
writeFileSync(join(outDir, 'hello.txt'), 'Hello file-preview-kit!\n第二行中文测试。\n');

// 2) 1x1 PNG（与 smoke 同源 b64）
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC';
writeFileSync(join(outDir, 'logo.png'), Buffer.from(pngB64, 'base64'));

// 3) zip（嵌套目录，验证 fflate 清单路径 + tree 构建）
writeFileSync(join(outDir, 'sample.zip'), Buffer.from(zipSync({ 'r.txt': strToU8('root'), 'd/x.txt': strToU8('in') })));

// 4) 最小合法 PDF（xref 正确，含 "Hello PDF"，供 pdfjs canvas 渲染）
function makePdf() {
  const objs = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
  const stream = 'BT /F1 12 Tf 50 150 Td (Hello PDF) Tj ET';
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
writeFileSync(join(outDir, 'hello.pdf'), makePdf());

console.log('fixtures written to', outDir);
