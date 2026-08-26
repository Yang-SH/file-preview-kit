// 接缝② E2E 生成器：产出 browser-e2e.html —— 在真实 Chromium 中验证零构建入口。
// 与 examples/browser/build-standalone.mjs 的差异：本页【不 vendor 重依赖】，
// 直接以相对路径加载构建产物 ../../dist/{browser,index,worker}.js，
// 因此必须经 HTTP 静态伺服（file:// 下 ESM/Worker 会失效）。例如：
//   cd packages/core && npx serve .   →   打开 /tests/e2e/browser-e2e.html
// 覆盖范围（dist 自带 chunk 能支撑的格式）：txt/json/csv/md/xml/png +
// Web Component 完整链路 + 核心统一派发 Worker（真实模块 Worker）+ 边界用例。
// zip/pdf/office/wav/eml 的真浏览器覆盖由 verify:offline 离线页承担（vendor 模式）；
// Node 侧全格式覆盖见同目录 node-dist.e2e.test.ts。
// 结果暴露于 window.__FPK_E2E__ = { pass, fail, total, cases[] }，并在页面渲染明细。
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC';

// 用例脚本以字符串内嵌（页面自身即产物；生成器只负责落盘）。
const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<link rel="icon" href="data:," />
<title>file-preview-kit E2E（dist × 真 Chromium）</title>
<style>
  body { font-family: ui-monospace, Consolas, monospace; margin: 24px; background: #111; color: #ddd; }
  h1 { font-size: 16px; } .pass { color: #6f6; } .fail { color: #f66; }
  li { margin: 2px 0; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>seam② dist × 真 Chromium —— 运行中…</h1>
<ul id="list"></ul>
<script type="module">
const PNG_B64 = '${PNG_B64}';
const pngBytes = () => Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
const enc = (s) => new TextEncoder().encode(s);
function memFile(name, bytes, mimeType) {
  const ext = (/\\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase() || undefined;
  const blobPart = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([blobPart], mimeType ? { type: mimeType } : undefined);
  return {
    name, size: bytes.length,
    ...(mimeType ? { mimeType } : {}), ...(ext ? { extension: ext } : {}),
    ...(bytes.blobRef ? {} : {}),
    header: async (max = 16 * 1024) => bytes.subarray(0, Math.min(max, bytes.length)),
    readRange: async (a, b) => bytes.subarray(a, Math.max(a, Math.min(b, bytes.length))),
    arrayBuffer: async () => blob.arrayBuffer(),
    blob,
  };
}

const cases = [];
function record(name, pass, detail = '') { cases.push({ name, pass, detail }); }
function render() {
  const pass = cases.filter((c) => c.pass).length;
  const fail = cases.length - pass;
  window.__FPK_E2E__ = { pass, fail, total: cases.length, cases };
  document.querySelector('h1').textContent =
    'seam② dist × 真 Chromium —— ' + (fail === 0 ? '✅ 全部通过' : '❌ 存在失败') + ' (' + pass + '/' + cases.length + ')';
  const ul = document.getElementById('list');
  for (const c of cases) {
    const li = document.createElement('li');
    li.className = c.pass ? 'pass' : 'fail';
    li.textContent = (c.pass ? '✅ ' : '❌ ') + c.name + (c.detail ? ' | ' + c.detail : '');
    ul.appendChild(li);
  }
  document.title = fail === 0 ? 'E2E-PASS' : 'E2E-FAIL';
}

try {
  // ── b1 零构建入口注册 ──
  await import('../../dist/browser.js');
  record('b1 <file-preview> 自定义元素已注册', !!customElements.get('file-preview'));

  // ── b2 Web Component 完整链路：preview(Blob) → Shadow DOM 渲染 ──
  const el = document.createElement('file-preview');
  document.body.appendChild(el);
  await el.preview(new Blob([enc('hello wc-e2e\\n第二行')], { type: 'text/plain' }));
  const pre = el.shadowRoot?.querySelector('pre');
  record('b2 <file-preview>.preview(Blob) → shadowRoot pre 渲染', !!(pre && pre.textContent.includes('hello wc-e2e')), JSON.stringify(pre?.textContent?.slice(0, 40)));

  // ── 程序化接缝：dist/index.js 直连（浏览器默认 DOMPurify，无需 initNodeSanitizer）──
  const core = await import('../../dist/index.js');
  const plugins = [...core.corePlugins()];
  const env = core.createBrowserEnv();

  const pvProg = core.createPreviewer({ plugins });
  const rPng = await pvProg.preview(memFile('p.png', pngBytes(), 'image/png'), env);
  record('b3 程序化 API：PNG Blob → image(dataUrl:image/png)', rPng.kind === 'image' && /^data:image\\/png;base64,/.test(rPng.dataUrl || ''), rPng.kind);

  const rCsv = await pvProg.preview(memFile('t.csv', enc('Name,Age\\nLee,3')), env);
  record('b4 CSV Blob → table 列头', rCsv.kind === 'table' && JSON.stringify(rCsv.columns) === JSON.stringify(['Name', 'Age']), rCsv.kind);

  // 注意：<script> 字面量必须拆串书写，否则会提前终结本内联脚本块
  const SCRIPT_OPEN = '<scr' + 'ipt>';
  const SCRIPT_CLOSE = '</scr' + 'ipt>';
  const rMd = await pvProg.preview(memFile('r.md', enc('# T\\n\\n' + SCRIPT_OPEN + 'alert(1)' + SCRIPT_CLOSE + '**b**')), env);
  record('b5 Markdown 内联脚本被转义', rMd.kind === 'html' && !(rMd.html || '').includes(SCRIPT_OPEN), rMd.kind);

  // ── b6 XML（D4 观测点）：dist 对 fast-xml-parser 是运行时裸动态导入，
  // 纯静态伺服的零构建场景无法解析 → 当前契约 = 优雅降级 text（不崩）。
  // 结构化 json 的完整能力需 bundler/importmap/vendor（见 verify:offline 与 csp-guide）。
  const rXml = await pvProg.preview(memFile('x.xml', enc('<?xml version="1.0"?><root><v>1</v></root>')), env);
  record('b6 边界(D4 观测)：纯 dist 部署下 XML 无 FXP → 优雅降级不崩', ['text', 'json'].includes(rXml.kind),
    'kind=' + rXml.kind + (rXml.kind === 'text' ? '（D4：静默降级）' : ''));

  // ── b7 核心统一派发：真实模块 Worker 加载并返回一致结果 ──
  const workerUrl = new URL('../../dist/worker.js', import.meta.url).href;
  const pvWorker = core.createPreviewer({
    plugins,
    dispatch: 'worker',
    workerUrl,
  });
  const fTxt = memFile('via-worker.txt', enc('dispatched via worker'));
  const rW = await pvWorker.preview(fTxt, env);
  const workerLoaded = performance.getEntriesByType('resource').some((e) => e.name.includes('worker.js'));
  record('b7 Worker 统一派发（真实模块 Worker）', rW.kind === 'text' && (rW.text || '').includes('dispatched via worker') && workerLoaded,
    'workerLoaded=' + workerLoaded);

  // ── 边界：损坏图片声明 image/png → 不崩、不产破损图（D2 缺陷在真浏览器的表现观测）──
  const rCorrupt = await pvProg.preview(memFile('fake.png', enc('not a png at all'), 'image/png'), env);
  record('b8 边界：假 PNG（声明 image/png）→ 不抛异常', ['image', 'binary', 'error', 'text'].includes(rCorrupt.kind),
    'kind=' + rCorrupt.kind + (rCorrupt.kind === 'image' ? '（D2 观测点：破损图）' : ''));

  // ── 边界：空 Blob → 优雅降级 ──
  const rEmpty = await pvProg.preview(memFile('empty.bin', new Uint8Array(0)), env);
  record('b9 边界：空文件 → 优雅降级', ['binary', 'error'].includes(rEmpty.kind), rEmpty.kind);

  // ── 边界：maxBytes 护栏短路 ──
  const pvGuard = core.createPreviewer({ plugins, maxBytes: 10 });
  const rBig = await pvGuard.preview(memFile('big.bin', enc('0123456789ABCDEF')), env); // 16B > 10B
  record('b10 边界：size>maxBytes → ERR_TOO_LARGE 短路', rBig.kind === 'binary' && rBig.info?.code === 'ERR_TOO_LARGE', String(rBig.info?.code));

  // ── 边界：LRU 二次命中（真实存取桩：get 必须回放 store，否则永远 miss）──
  const store = new Map();
  let sets = 0;
  const spyCache = { get: (k) => store.get(k), set: (k, v) => { sets++; store.set(k, v); }, shouldCache: (r) => r.kind === 'text' };
  const pvLruReal = core.createPreviewer({ plugins, cache: spyCache });
  await pvLruReal.preview(memFile('l.txt', enc('lru-check')), env);
  const second = await pvLruReal.preview(memFile('l.txt', enc('lru-check')), env);
  record('b11 边界：LRU 同文件二次预览命中缓存（仅一次 set）', sets === 1 && second.kind === 'text' && second.text === 'lru-check', 'sets=' + sets);

  // ── G2：缩略图 API——图片走真实 canvas 等比缩小 ──
  const t = core.createThumbnailer({ plugins });
  const bigCanvas = document.createElement('canvas');
  bigCanvas.width = 200; bigCanvas.height = 100;
  bigCanvas.getContext('2d').fillRect(0, 0, 200, 100);
  const bigPngDataUrl = bigCanvas.toDataURL('image/png');
  const bigBytes = Uint8Array.from(atob(bigPngDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const thumb = await t.thumbnail(memFile('big.png', bigBytes, 'image/png'), env, { maxWidth: 50, maxHeight: 50 });
  record('b12 G2 缩略图：200x100 PNG → maxWidth=50 真实缩小',
    thumb.via === 'image' && !!thumb.width && thumb.width <= 50 && !!thumb.height && thumb.height <= 50,
    thumb.via === 'image' ? ('w=' + thumb.width + ',h=' + thumb.height) : ('via=' + thumb.via));

  // ── G2：PDF 封面依赖 CDN 的 pdfjs——可达则真图、不可达则优雅回退卡，两者皆契约合法 ──
  const pdfThumb = await Promise.race([
    t.thumbnail(memFile('cover.pdf', enc('%PDF-1.4 broken-but-magic'), undefined), env, { maxWidth: 64 }),
    new Promise((res) => setTimeout(() => res({ via: 'timeout' }), 15000)),
  ]);
  record('b13 G2 缩略图：PDF 路径不崩（真图或回退卡）', pdfThumb.via === 'image' || pdfThumb.via === 'fallback-card', 'via=' + pdfThumb.via);

  // ── D4 观测（eml）：emailjs-mime-parser 为运行时裸动态导入，纯静态部署不可解析
  // → 候选链耗尽后由文本救援接管（eml 本身是可读文本），契约 = 不崩且降级体面 ──
  const EML = ['From: alice@example.com', 'To: bob@example.com', 'Subject: hello', 'Content-Type: text/plain', '', 'plain eml body here'].join('\\r\\n');
  const rEml = await pvProg.preview(memFile('mail.eml', enc(EML)), env);
  record('b14 边界(D4 观测)：纯静态部署下 EML 优雅降级不崩', ['html', 'text'].includes(rEml.kind), 'kind=' + rEml.kind);
} catch (err) {
  record('harness 崩溃（视为失败）', false, String(err && err.stack || err));
}

render();
</script>
</body>
</html>
`;

writeFileSync(join(here, 'browser-e2e.html'), page, 'utf8');
console.log('[gen-browser-harness] 已生成 tests/e2e/browser-e2e.html（经 HTTP 打开后读取 window.__FPK_E2E__）');
