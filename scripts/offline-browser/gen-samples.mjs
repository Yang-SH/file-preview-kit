// 离线浏览器包验证样例生成（无音频版）：pdf/zip/eml/xlsx → dist-offline-browser/s.*
// 用法：npm run build:browser-package 之后，node scripts/offline-browser/gen-samples.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import ExcelJS from 'exceljs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../packages/core/dist-offline-browser');

// pdf
const objs = [];
objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 6 0 R>>>>>>';
const st = 'BT /F1 12 Tf 50 150 Td (OFFLINE-PDF-OK) Tj ET';
objs[4] = `<</Length ${st.length}>>\nstream\n${st}\nendstream`;
objs[6] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
let p = '%PDF-1.4\n';
const off = [];
for (let i = 1; i <= 6; i++) { off[i] = p.length; if (objs[i]) p += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
const x = p.length;
p += 'xref\n0 7\n0000000000 65535 f \n';
for (let i = 1; i <= 6; i++) p += `${String(off[i]).padStart(10, '0')} 00000 n \n`;
p += `trailer<</Size 7/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
writeFileSync(`${dir}/s.pdf`, p);

// zip
writeFileSync(`${dir}/s.zip`, zipSync({ 'a.txt': strToU8('hello'), 'd/b.txt': strToU8('deep') }));

// eml
writeFileSync(`${dir}/s.eml`, 'From: a@b.c\r\nTo: d@e.f\r\nSubject: hi\r\nContent-Type: text/plain\r\n\r\noffline eml body');

// xlsx 两表
const wb = new ExcelJS.Workbook();
const s1 = wb.addWorksheet('Alpha'); s1.addRow(['N', 'V']); s1.addRow(['x', 1]);
const s2 = wb.addWorksheet('Beta'); s2.addRow(['M']); s2.addRow(['y']);
wb.xlsx.writeBuffer().then((b) => {
  writeFileSync(`${dir}/s.xlsx`, new Uint8Array(b));
  console.log('[gen-samples] done:', ['s.pdf', 's.zip', 's.eml', 's.xlsx'].map((f) => `${dir}/${f}`).join(', '));
});
