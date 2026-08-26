import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileFromNode, fileFromBrowser } from '../../src/file.ts';
import { nodeAdapter, initNodeSanitizer } from '../../src/env.ts';
import { createPreviewer, runPipeline } from '../../src/previewer.ts';
import { renderToHtml } from '../../src/render.ts';
import { imagePlugin } from '../../src/plugins/image.ts';
import { textPlugin } from '../../src/plugins/text.ts';
import { officePlugin } from '@file-preview/plugin-office';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { zipPlugin } from '@file-preview/plugin-archive';
import { corePlugins, workerPlugins } from '../../src/plugins/index.ts';
import { allPlugins } from '../../tests/helpers.ts';
import { createLruCache } from '../../src/cache.ts';

function makePng(): Uint8Array<ArrayBuffer> {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// 鏈€灏忎絾 xref 姝ｇ‘鐨?PDF锛堝惈 "Hello PDF" 鏂囨湰锛夛紝鐢ㄤ簬楠岃瘉 PDF 鎻掍欢 Node 鍒嗘敮銆?
function makePdf(): Uint8Array {
  const objs: string[] = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
  const stream = 'BT /F1 12 Tf 50 150 Td (Hello PDF) Tj ET';
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function main() {
  await initNodeSanitizer();

  const dir = mkdtempSync(join(tmpdir(), 'fp-smoke-'));

  const txt = join(dir, 'hello.txt');
  writeFileSync(txt, 'Hello file-preview-kit!\n绗簩琛屼腑鏂囨祴璇曘€俓n');
  const json = join(dir, 'data.json');
  writeFileSync(json, JSON.stringify({ name: 'kit', ok: true, n: 42 }));
  const bin = join(dir, 'unknown.bin');
  writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]));
  const pdf = join(dir, 'doc.pdf');
  writeFileSync(pdf, makePdf());

  const pv = createPreviewer({
    plugins: [officePlugin(), pdfPlugin(), imagePlugin(), textPlugin(), zipPlugin()],
    cache: createLruCache(),
  });

  // 0) sanitize 瀹夊叏鑷
  const evil = '<div>hi</div><iframe src="javascript:alert(1)"></iframe><object data="x"></object>';
  const clean = nodeAdapter.sanitize(evil);
  console.log('SANITIZE iframe 娈嬬暀 =', clean.includes('<iframe'), '| object 娈嬬暀 =', clean.includes('<object'));

  // 1) 鏂囨湰
  const f1 = await fileFromNode(txt);
  const r1 = await pv.preview(f1, nodeAdapter);
  console.log('TEXT   kind =', r1.kind, '|', renderToHtml(r1, nodeAdapter).slice(0, 50).replace(/\n/g, ' '));

  // 2) JSON
  const r2 = await pv.preview(await fileFromNode(json), nodeAdapter);
  console.log('JSON   kind =', r2.kind, r2.kind === 'json' ? `| keys=${Object.keys(r2.data as object).join(',')}` : '');

  // 3) 鏈煡浜岃繘鍒?鈫?闄嶇骇 hex
  const r3 = await pv.preview(await fileFromNode(bin), nodeAdapter);
  console.log('BINARY kind =', r3.kind, r3.kind === 'binary' ? '| hexDump generated' : '');

  // 4) image (minimal PNG, via Blob path)
  const f4 = await fileFromBrowser(new Blob([makePng()], { type: 'image/png' }) as unknown as File);
  const r4 = await pv.preview(f4, nodeAdapter);
  console.log('IMAGE  kind =', r4.kind, r4.kind === 'image' ? `| ${r4.width}x${r4.height}` : '');

  // 5) 缂撳瓨鍛戒腑
  const r1b = await pv.preview(f1, nodeAdapter);
  console.log('CACHE  hit =', r1b.kind === 'text');

  // 6) Office xlsx
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'Name';
  ws.getCell('B1').value = 'Age';
  ws.getCell('A2').value = 'Alice';
  ws.getCell('B2').value = 30;
  const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
  const xlsx = join(dir, 'sheet.xlsx');
  writeFileSync(xlsx, xbuf);
  const r6 = await pv.preview(await fileFromNode(xlsx), nodeAdapter);
  console.log('XLSX   kind =', r6.kind, r6.kind === 'table' ? `| cols=${r6.columns.join(',')} rows=${r6.rows.length}` : JSON.stringify(r6));

  // 7) PDF锛圢ode 璧版枃鏈彁鍙栧垎鏀?鈫?kind 'text'锛?
const r7 = await pv.preview(await fileFromNode(pdf), nodeAdapter);
  console.log('PDF    kind =', r7.kind, r7.kind === 'text' ? `| 鍚?Hello PDF"=${r7.text.includes('Hello PDF')}` : JSON.stringify(r7));

  // 8) Worker 娲惧彂閫昏緫楠岃瘉锛氭ā鎷?Worker 鏀跺埌 Blob 鈫?閲嶅缓 IFile 鈫?runPipeline锛堣瘉鏄庢牳蹇冩淳鍙戞纭級
  const txtBlob = new Blob([readFileSync(txt)], { type: 'text/plain' });
  const wFile = await fileFromBrowser(txtBlob, 'hello.txt', 'txt');
  const wResult = await runPipeline(wFile, nodeAdapter, {}, workerPlugins());
  console.log('WORKER kind =', wResult.kind, '| pdf 宸叉帓闄ゅ嚭 worker 闆?=', !workerPlugins().some((p) => p.id === 'pdf'));
  console.log('        corePlugins 鍚?pdf =', allPlugins().some((p) => p.id === 'pdf'));

  // 9) 鍘嬬缉鍖?zip 鈫?tree锛堢湡瀹?.zip 缁?detect 璺敱鍒?archive 鎻掍欢锛?
const { zipSync, strToU8 } = await import('fflate');
  const zipBytes = zipSync({ 'r.txt': strToU8('root'), 'd/x.txt': strToU8('in') });
  const zipPath = join(dir, 'bundle.zip');
  writeFileSync(zipPath, zipBytes);
  const r9 = await pv.preview(await fileFromNode(zipPath), nodeAdapter);
  console.log(
    'ZIP    kind =',
    r9.kind,
    r9.kind === 'tree' ? `| roots=${r9.nodes.map((n) => n.name).join(',')}` : JSON.stringify(r9),
  );

  // 10) zip 鐐稿脊闃插尽锛堟敞鍏ュ皬闃堝€硷級锛? 鏉＄洰 > maxEntries 2 鈫?ERR_TOO_LARGE 闄嶇骇锛屼笉瑙ｅ帇浠讳綍鏉＄洰
  const bombFiles: Record<string, Uint8Array> = {};
  for (let i = 0; i < 3; i++) bombFiles[`f${i}.txt`] = strToU8('x');
  const bombPath = join(dir, 'bomb.zip');
  writeFileSync(bombPath, zipSync(bombFiles));
  const guard = zipPlugin({ maxEntries: 2 });
  const r10 = await guard.preview(await fileFromNode(bombPath), nodeAdapter, {});
  console.log(
    'BOMB   kind =',
    r10.kind,
    r10.kind === 'binary' ? `| code=${r10.info?.code} reason=${String(r10.info?.reason).slice(0, 40)}` : JSON.stringify(r10),
  );

  console.log('\n[OK] packages/core smoke passed (sanitizer / Office / PDF / Worker / zip bomb guard)')
}

main().catch((e) => {
  console.error('SMOKE FAILED', e);
  process.exit(1);
});
