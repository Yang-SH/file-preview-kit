// 共享断言矩阵（方案 §5.1–§5.7 + 错误码/护栏/缓存/Worker/XSS）。
// 由 verify-all.html（http 静态伺服）与 verify-offline.html（file:// 单文件）共同消费——
// 两页共用同一套用例，保证「在线版」与「离线单文件版」验证的是同一份行为契约。
//
// deps:
//   core / pdfMod / officeMod / zipMod —— 四包运行时命名空间（dist 产物）
//   wasmUrl    —— mediainfo WASM 资产地址（http 路径或 data: URL）
//   workerUrl  —— 核心统一派发 Worker 入口（http 路径或 blob: URL）
import { zipSync } from 'fflate';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38';

export async function runVerifyCases(deps) {
  const { core, pdfMod, officeMod, zipMod, wasmUrl, workerUrl, pdfModuleUrl, pdfWorkerUrl } = deps;

  const baseEnv = core.createBrowserEnv({
    // 离线单文件版注入本地 blob；缺省回退 CDN drop-in（http 静态伺服版）
    pdfModuleUrl: pdfModuleUrl ?? `${PDFJS}/build/pdf.mjs`,
    pdfWorkerUrl: pdfWorkerUrl ?? `${PDFJS}/build/pdf.worker.min.mjs`,
    pdfFontsUrl: `${PDFJS}/standard_fonts/`,
  });
  const env = {
    ...baseEnv,
    getAssetUrl: (n) => (n === 'mediainfo.wasm' ? wasmUrl : baseEnv.getAssetUrl(n)),
  };

  const all = [...core.corePlugins(), pdfMod.pdfPlugin(), officeMod.officePlugin(), zipMod.zipPlugin()];
  const pv = core.createPreviewer({ plugins: all });
  const mkFile = (name, data, type) => new File([data], name, type ? { type } : undefined);
  const preview = async (name, data, type) => {
    const ext = name.includes('.') ? name.split('.').pop() : undefined;
    const f = await core.fileFromBrowser(mkFile(name, data, type), name, ext);
    return pv.preview(f, env);
  };

  // ---------- fixtures ----------
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const PDF = new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF',
  );
  const BAD_PDF = new TextEncoder().encode('%PDF-1.4\ngarbage-not-a-pdf');
  const enc = (s) => new TextEncoder().encode(s);
  function wavBytes() {
    const sr = 8000, n = sr / 10, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    return new Uint8Array(buf);
  }
  const SCRIPT = '<scr' + 'ipt>'; // 防 HTML 解析器提前终结本脚本块
  const slideXml = '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>Hello PPTX 幻灯片一</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>';
  const docxXml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX 文档</w:t></w:r></w:p></w:body></w:document>';
  const emlText = [
    'From: Alice <alice@example.com>', 'To: bob@example.com', 'Subject: =?UTF-8?B?5L2g5aW9IOmqjOivgemCruS7tg==?=',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="BOUND"',
    '', '--BOUND', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    b64('第一行正文 你好'), '--BOUND',
    'Content-Type: application/pdf; name="report.pdf"', 'Content-Disposition: attachment; filename="report.pdf"',
    'Content-Transfer-Encoding: base64', '', b64Bytes(PDF), '--BOUND--',
  ].join('\r\n');
  function b64(s) { return btoa(String.fromCharCode(...enc(s))); }
  function b64Bytes(u8) { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s); }

  const cases = [
    ['§5.1 图片 PNG → dataUrl+尺寸', async () => {
      const r = await preview('dot.png', PNG, 'image/png');
      return [r.kind === 'image' && r.width === 1 && r.height === 1 && String(r.dataUrl).startsWith('data:image/png'), `kind=${r.kind} ${r.width}x${r.height}`];
    }],
    ['§5.5 文本 → kind:text 中英文还原', async () => {
      const r = await preview('note.txt', enc('Hello 验证台\n第二行'));
      return [r.kind === 'text' && r.text.includes('Hello') && r.text.includes('第二行'), `kind=${r.kind}`];
    }],
    ['§5.5 JSON → 数据无损', async () => {
      const r = await preview('data.json', enc(JSON.stringify({ ok: true, n: 42 })));
      return [r.kind === 'json' && r.data.ok === true && r.data.n === 42, `kind=${r.kind}`];
    }],
    ['§5.5 CSV → 表格', async () => {
      const r = await preview('sheet.csv', enc('Name,Age\nAlice,30'));
      return [r.kind === 'table' && String(r.columns) === 'Name,Age' && String(r.rows[0]) === 'Alice,30', `kind=${r.kind}`];
    }],
    ['§5.5 Markdown → HTML 且内联脚本被转义', async () => {
      const r = await preview('readme.md', enc(`# 标题\n${SCRIPT}alert(1)</scr${'i'}pt>`));
      const safe = r.kind === 'html' && r.html.includes('<h1>') && !r.html.includes(SCRIPT);
      return [safe, `kind=${r.kind} script已转义=${!r.html.includes(SCRIPT)}`];
    }],
    ['§5.5 XML → 结构化 JSON', async () => {
      const r = await preview('cfg.xml', enc('<?xml version="1.0"?><root><a>1</a><b x="y"/></root>'));
      return [r.kind === 'json' && String(r.data?.root?.a) === '1', `kind=${r.kind}`];
    }],
    ['§5.5 XXE 实体攻击 → 不展开不外联', async () => {
      const evil = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>';
      const r = await preview('evil.xml', enc(evil));
      const leak = JSON.stringify(r).includes('/etc/passwd') && !JSON.stringify(r).includes('&xxe;');
      return [(r.kind === 'json' || r.kind === 'text') && !leak, `kind=${r.kind}(实体未展开)`];
    }],
    ['§5.4 ZIP → 目录树', async () => {
      const z = zipSync({ 'hello.txt': enc('Hi zip'), d: { 'r.txt': enc('leaf') } });
      const r = await preview('arch.zip', z, 'application/zip');
      return [r.kind === 'tree' && Array.isArray(r.nodes), `kind=${r.kind} 节点=${r.nodes?.length}`];
    }],
    ['§5.4 ZIP 炸弹防御 → ERR_TOO_LARGE 降级', async () => {
      const strict = core.createPreviewer({ plugins: [zipMod.zipPlugin({ maxEntries: 2 })] });
      const bomb = zipSync({ a: enc('x'), b: enc('y'), c: enc('z') });
      const ff = await core.fileFromBrowser(mkFile('bomb.zip', bomb, 'application/zip'), 'bomb.zip', 'zip');
      const r = await strict.preview(ff, env);
      return [r.kind === 'binary' && r.info?.code === 'ERR_TOO_LARGE' && /zip bomb/.test(String(r.info?.reason)), `code=${r.info?.code} ${String(r.info?.reason).slice(0, 40)}`];
    }],
    ['§5.3 PPTX → 幻灯片文本抽取', async () => {
      const z = zipSync({ '[Content_Types].xml': enc('<Types/>'), '_rels/.rels': enc('<Relationships/>'), 'ppt/slides/slide1.xml': enc(slideXml), 'ppt/slides/slide2.xml': enc(slideXml.replace('一', '二')) });
      const r = await preview('deck.pptx', z);
      return [r.kind === 'html' && r.html.includes('Hello PPTX 幻灯片一') && r.html.includes('幻灯片 2'), `kind=${r.kind}`];
    }],
    ['§5.3 DOCX → mammoth HTML', async () => {
      const z = zipSync({ '[Content_Types].xml': enc('<Types/>'), '_rels/.rels': enc('<Relationships/>'), 'word/document.xml': enc(docxXml) });
      const r = await preview('doc.docx', z);
      return [r.kind === 'html' && r.html.includes('Hello DOCX'), `kind=${r.kind}`];
    }],
    ['§5.3 XLSX → 表格(exceljs 构建)', async () => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
      ws.getCell('A1').value = 'Name'; ws.getCell('A2').value = 'Alice';
      const ab = await wb.xlsx.writeBuffer();
      const r = await preview('book.xlsx', ab);
      return [r.kind === 'table' && r.sheetName === 'Data' && String(r.columns) === 'Name' && String(r.rows[0]) === 'Alice', `kind=${r.kind} sheet=${r.sheetName}`];
    }],
    ['§5.2 PDF 浏览器渲染 → canvas 页面图', async () => {
      const r = await preview('doc.pdf', PDF, 'application/pdf');
      return [r.kind === 'html' && r.html.includes('data:image/png;base64,'), `kind=${r.kind} 含PNG页面=${r.html?.includes('data:image/png')}`];
    }],
    ['§5.6 媒体 WAV → mediainfo 元数据(WASM 注入)', async () => {
      const r = await preview('tone.wav', wavBytes(), 'audio/wav');
      return [r.kind === 'media', `kind=${r.kind} keys=${Object.keys(r).join(',')}`];
    }],
    ['§5.7 邮件 EML → 头表+正文+附件清单', async () => {
      const r = await preview('mail.eml', enc(emlText), 'message/rfc822');
      const html = r.html ?? '';
      const ok = r.kind === 'html' && html.includes('alice@example.com') && html.includes('report.pdf') && html.includes('你好 验证邮件');
      return [ok, `kind=${r.kind} ${ok ? '' : 'HTML片段: ' + html.replace(/<[^>]+>/g, '|').slice(0, 110)}`];
    }],
    ['未知格式 → 二进制降级 hexDump+ERR_UNSUPPORTED', async () => {
      const r = await preview('unknown.bin', Uint8Array.from([0x00, 0x01, 0xde, 0xad, 0xbe, 0xef]));
      return [r.kind === 'binary' && r.hexDump.toLowerCase().includes('de ad be ef') && r.info?.code === 'ERR_UNSUPPORTED', `code=${r.info?.code}`];
    }],
    ['损坏 PDF → 插件级 ERR_PARSE', async () => {
      const r = await pdfMod.pdfPlugin().preview(await core.fileFromBrowser(mkFile('broken.pdf', BAD_PDF, 'application/pdf')), env);
      return [r.kind === 'error' && r.code === 'ERR_PARSE', `code=${r.code}`];
    }],
    ['maxBytes 护栏 → ERR_TOO_LARGE 短路', async () => {
      const tiny = core.createPreviewer({ plugins: all, maxBytes: 5 });
      const r = await tiny.preview(await core.fileFromBrowser(mkFile('big.png', PNG, 'image/png')), env);
      return [r.info?.code === 'ERR_TOO_LARGE', `code=${r.info?.code}`];
    }],
    ['LRU 缓存 → 同文件二次预览命中', async () => {
      let hits = 0, sets = 0; const c = core.createLruCache();
      const spy = { get: (k) => (hits++, c.get(k)), set: (k, v) => (sets++, c.set(k, v)), shouldCache: c.shouldCache.bind(c) };
      const p2 = core.createPreviewer({ plugins: all, cache: spy });
      const f = await core.fileFromBrowser(mkFile('cached.txt', enc('same')), 'cached.txt', 'txt');
      await p2.preview(f, env); const r2 = await p2.preview(f, env);
      return [hits >= 1 && r2.kind === 'text', `hits=${hits} sets=${sets}`];
    }],
    [`Worker 统一派发 → dispatch:worker 结果一致`, async () => {
      const pw = core.createPreviewer({ plugins: all, dispatch: 'worker', workerUrl });
      const r = await pw.preview(await core.fileFromBrowser(new Blob(['worker 派发 OK'], { type: 'text/plain' }), 'w.txt'), env);
      return [r.kind === 'text' && r.text.includes('worker 派发 OK'), `kind=${r.kind} workerUrl=${String(workerUrl).slice(0, 18)}…`];
    }],
    ['渲染层 renderToHtml → 唯一清理点产物', async () => {
      const r = await preview('r.txt', enc('render me'));
      const html = core.renderToHtml(r, env);
      return [typeof html === 'string' && html.includes('fp-text') && html.includes('render me'), html.slice(0, 60)];
    }],
  ];

  const report = { pass: 0, fail: 0, cases: [] };
  for (const [name, fn] of cases) {
    try {
      const [pass, detail] = await fn();
      report.cases.push({ name, pass: !!pass, detail: String(detail) });
      pass ? report.pass++ : report.fail++;
    } catch (e) {
      report.cases.push({ name, pass: false, detail: `异常: ${e.message}` });
      report.fail++;
    }
  }
  return report;
}

function b64(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
function b64Bytes(u8) { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s); }
