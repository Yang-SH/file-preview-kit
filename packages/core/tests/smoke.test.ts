// 鍐掔儫 9 鍦烘櫙锛坋xamples/node-ssr/smoke.ts 缂栧彿 0鈥?锛夊浐鍖栦负姝ｅ紡鐢ㄤ緥锛堟柟妗?搂12 golden-file 鎬濊矾鐨勬渶灏忚惤鍦帮級銆?// 鏂█寮轰簬 console.log锛氫笉浠呯湅 kind锛岃繕鏍￠獙鍐呭銆佸昂瀵搞€佺紦瀛樿鏁颁笌闄嶇骇鐮併€?
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileFromNode, fileFromBrowser } from '../src/file.ts';
import { nodeAdapter, initNodeSanitizer } from '../src/env.ts';
import { createPreviewer, runPipeline } from '../src/previewer.ts';
import { renderToHtml } from '../src/render.ts';
import { imagePlugin } from '../src/plugins/image.ts';
import { textPlugin } from '../src/plugins/text.ts';
import { officePlugin } from '@file-preview/plugin-office';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { corePlugins, workerPlugins } from '../src/plugins/index.ts';
import { makePng, makePdf, spyLruCache, makeTempDir, writeTempFile, allPlugins } from './helpers.ts';

const plugins = () => [officePlugin(), pdfPlugin(), imagePlugin(), textPlugin()];

let dir: string;
let txtPath: string;
let jsonPath: string;
let binPath: string;
let pdfPath: string;

beforeAll(async () => {
  await initNodeSanitizer();
  dir = makeTempDir();
  txtPath = writeTempFile(dir, 'hello.txt', 'Hello file-preview-kit!\n第二行中文测试。\n');
  jsonPath = writeTempFile(dir, 'data.json', JSON.stringify({ name: 'kit', ok: true, n: 42 }));
  binPath = writeTempFile(
    dir,
    'unknown.bin',
    Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]),
  );
  pdfPath = writeTempFile(dir, 'doc.pdf', makePdf());
});

describe('鍐掔儫鍦烘櫙鍥哄寲锛坰moke 0鈥?锛?', () => {
  it('0) sanitize 瀹夊叏鑷锛歩frame/object 娉ㄥ叆琚墺绂汇€佽壇鎬у唴瀹逛繚鐣?', () => {
    const evil = '<div>hi</div><iframe src="javascript:alert(1)"></iframe><object data="x"></object>';
    const clean = nodeAdapter.sanitize(evil);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
    expect(clean).toContain('hi');
  });

  it('1) 鏂囨湰棰勮锛歬ind=text锛屽惈涓嫳鏂囧唴瀹癸紝renderToHtml 杈撳嚭 pre.fp-text', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const r = await pv.preview(await fileFromNode(txtPath), nodeAdapter);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('Hello file-preview-kit!');
    expect(r.text).toContain('第二行中文测试。');
    const html = renderToHtml(r, nodeAdapter);
    expect(html).toContain('<pre class="fp-text">');
    expect(html).toContain('第二行中文测试。');
  });

  it('2) JSON 棰勮锛歬ind=json锛屾暟鎹棤鎹熻繕鍘?', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const r = await pv.preview(await fileFromNode(jsonPath), nodeAdapter);
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') return;
    expect(r.data).toEqual({ name: 'kit', ok: true, n: 42 });
  });

  it('3) 鏈煡浜岃繘鍒堕檷绾э細kind=binary + hexDump + info.code=ERR_UNSUPPORTED', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const r = await pv.preview(await fileFromNode(binPath), nodeAdapter);
    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.hexDump).toBeTruthy();
    expect(r.hexDump!.toLowerCase()).toContain('de ad be ef');
    expect(r.info?.code).toBe('ERR_UNSUPPORTED');
  });

  it('4) 鍥剧墖锛圔lob 璺緞锛夛細kind=image锛宒ataUrl + 1x1 灏哄鎻愬彇', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const f = await fileFromBrowser(new Blob([makePng()], { type: 'image/png' }));
    const r = await pv.preview(f, nodeAdapter);
    expect(r.kind).toBe('image');
    if (r.kind !== 'image') return;
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it('5) 缂撳瓨鍛戒腑锛氬悓鏂囦欢浜屾棰勮鍛戒腑 LRU锛坓et 璁℃暟鍙娴嬶級', async () => {
    const { cache, stats } = spyLruCache();
    const pv = createPreviewer({ plugins: plugins(), cache });
    const f = await fileFromNode(txtPath);

    const r1 = await pv.preview(f, nodeAdapter);
    expect(stats.sets).toBe(1); // 棣栨棰勮鍚庡啓鍏ョ紦瀛?    expect(stats.hits).toBe(0);

    const r2 = await pv.preview(f, nodeAdapter);
    expect(stats.hits).toBe(1); // 浜屾棰勮鍛戒腑
    expect(r2.kind).toBe('text');
    if (r1.kind !== 'text' || r2.kind !== 'text') return;
    expect(r2.text).toBe(r1.text);
  });

  it('6) Office xlsx锛歟xceljs 鈫?kind=table锛坈olumns/rows/sheetName锛?', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.getCell('A1').value = 'Name';
    ws.getCell('B1').value = 'Age';
    ws.getCell('A2').value = 'Alice';
    ws.getCell('B2').value = 30;
    const xlsxPath = writeTempFile(dir, 'sheet.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));

    const pv = createPreviewer({ plugins: plugins() });
    const r = await pv.preview(await fileFromNode(xlsxPath), nodeAdapter);
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.columns).toEqual(['Name', 'Age']);
    expect(r.rows).toEqual([['Alice', 30]]);
    expect(r.sheetName).toBe('Data');
  });

  it('7) PDF Node 鏂囨湰鎻愬彇锛歬ind=text 鍚?"Hello PDF"锛宭anguage=pdf', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const r = await pv.preview(await fileFromNode(pdfPath), nodeAdapter);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('Hello PDF');
    expect(r.language).toBe('pdf');
  });

  it('8) Worker 娲惧彂鍒嗘祦锛歱df 鎺掗櫎鍑?worker 闆嗭紱Blob 閲嶅缓 IFile 缁?runPipeline 璺戦€?', async () => {
    expect(workerPlugins().some((p) => p.id === 'pdf')).toBe(false);
    // C3 分包：pdf 不再在 core 内置集，但全量组合集（core + plugin-* 包）仍包含
    expect(corePlugins().some((p) => p.id === 'pdf')).toBe(false);
    expect(allPlugins().some((p) => p.id === 'pdf')).toBe(true);

    const blob = new Blob([readFileSync(txtPath)], { type: 'text/plain' });
    const wFile = await fileFromBrowser(blob, 'hello.txt', 'txt');
    const r = await runPipeline(wFile, nodeAdapter, {}, workerPlugins());
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('Hello file-preview-kit!');
  });
});
