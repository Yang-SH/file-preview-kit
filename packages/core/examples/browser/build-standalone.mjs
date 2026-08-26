// 生成单文件离线验证页 verify-offline.html（双击即开，file:// 协议，页面零依赖零服务）。
//
// 架构（浏览器能力探针实证 2026-08-26）：
//   - file:// 下 blob URL 模块可 import、blob Worker 可用、模块加载前注入的 importmap 生效。
//   - 用 esbuild 把六个入口各自打包成【自包含】ESM：
//       core / cases —— 无任何外部静态导入；
//       plugin-pdf|office|archive —— 仅保留 "@file-preview/core" 裸引用（与 core 共享同一实例）；
//       browser —— 内联全部插件（§14 零构建默认集），重库保持动态 bare 导入；
//       worker —— 自包含 + 重库动态 bare 导入（Worker 不继承 importmap，
//                 因此含重库的格式在离线页会走「Worker 加载失败→主线程」降级路径，txt/md 纯管线可用）。
//   - 运行时 bootstrap 为每个 bundle 建 blob URL 并注入 importmap（@file-preview/* 与 CDN 重库映射）。
//   - mediainfo WASM 以 data: URL 内联；browser 入口的 WORKER_URL 改为可被 window.__FPK_WORKER_URL__ 覆盖。
//
// 用法：node examples/browser/build-standalone.mjs（cwd = packages/core）
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const root = process.cwd();
const p = (...x) => join(root, ...x);

const CDN_LIBS = {
  fflate: 'https://esm.sh/fflate@0.8.3',
  papaparse: 'https://esm.sh/papaparse@5.6.0',
  'markdown-it': 'https://esm.sh/markdown-it@15.0.0',
  'fast-xml-parser': 'https://esm.sh/fast-xml-parser@5.11.0',
  'emailjs-mime-parser': 'https://esm.sh/emailjs-mime-parser@2.0.7',
  'mediainfo.js': 'https://esm.sh/mediainfo.js@0.3.1',
  mammoth: 'https://esm.sh/mammoth@1.12.1',
  exceljs: 'https://esm.sh/exceljs@4.4.0',
  'pdfjs-dist': 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs',
};

async function bundle(entryFile) {
  const r = await esbuild.build({
    entryPoints: [p(entryFile)],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent',
    platform: 'browser',
    external: [
      ...Object.keys(CDN_LIBS),
      '@file-preview/core', '@file-preview/plugin-pdf', '@file-preview/plugin-office', '@file-preview/plugin-archive',
      // Node-only 分支的动态导入（如 createRequire 回退），浏览器路径不会触达
      'module', 'url', 'path', 'fs', 'node:module', 'node:path', 'node:url', 'node:fs',
    ],
  });
  return r.outputFiles[0].text;
}

const [coreSrc, pdfSrc, officeSrc, archiveSrc, browserRaw, workerSrc, casesSrc] = await Promise.all([
  bundle('dist/index.js'),
  bundle('../plugin-pdf/dist/index.js'),
  bundle('../plugin-office/dist/index.js'),
  bundle('../plugin-archive/dist/index.js'),
  bundle('dist/browser.js'),
  bundle('dist/worker.js'),
  bundle('examples/browser/verify-cases.mjs'),
]);

// browser 入口补丁：WORKER_URL 允许被宿主覆盖（单文件场景由 bootstrap 注入 blob worker）
let browserPatched = browserRaw.replace(
  /(var|let|const) WORKER_URL = ([^;]+);/,
  '$1 WORKER_URL = (typeof window !== "undefined" && window.__FPK_WORKER_URL__) || $2;',
);
if (!browserPatched.includes('__FPK_WORKER_URL__')) throw new Error('browser WORKER_URL 补丁失败');

// wasm 内联（data URL；emscripten 对 data:/非流式响应自动走 ArrayBuffer 实例化）
const wasmDataUrl = 'data:application/wasm;base64,' + readFileSync(p('../../node_modules/mediainfo.js/dist/MediaInfoModule.wasm')).toString('base64');

const html = buildHtml({ coreSrc, pdfSrc, officeSrc, archiveSrc, browserSrc: browserPatched, workerSrc, casesSrc, wasmDataUrl });

writeFileSync(p('examples/browser/verify-offline.html'), html, 'utf8');
console.log(`[standalone] 已生成 examples/browser/verify-offline.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);

function buildHtml(d) {
  const embed = (id, src) => `<script id="${id}" type="fpk/module">${src.replace(/<\/(script)/gi, '<\\/$1')}</script>`;
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>file-preview-kit 全功能验证台（离线单文件 · 可直接双击打开）</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1.5rem auto; max-width: 960px; color: #222; }
  h1 { font-size: 1.25rem; } h2 { font-size: 1.05rem; margin-top: 1.5rem; }
  small { color: #777; font-weight: 400; }
  section { border: 1px solid #ddd; border-radius: 8px; padding: .75rem 1rem; margin: 1rem 0; }
  #summary { font-weight: 700; padding: .5rem .75rem; border-radius: 6px; background: #f0f3f7; }
  .case { display: flex; gap: .6rem; align-items: baseline; padding: .2rem 0; border-bottom: 1px dashed #eee; }
  .badge { min-width: 52px; text-align: center; border-radius: 4px; font-size: .78rem; padding: .05rem .3rem; }
  .pass .badge { background: #d9f2e0; color: #0a7d32; } .fail .badge { background: #fde0e0; color: #c62828; }
  .detail { color: #555; font-size: .82rem; font-family: ui-monospace, monospace; word-break: break-all; }
  file-preview { display: block; min-height: 180px; border: 1px dashed #bbb; border-radius: 6px; padding: .5rem; }
  button { padding: .3rem .8rem; cursor: pointer; }
</style>
</head>
<body>
<h1>file-preview-kit 全功能验证台 <small>离线单文件版 · 双击直接打开（重库经 CDN，需联网）</small></h1>
<div id="summary">运行中…</div>

<section>
  <h2>A · 程序化断言矩阵（21 项）</h2>
  <div id="cases"></div>
</section>

<section>
  <h2>B · Web Component 手动体验（&lt;file-preview&gt; 零构建默认集）</h2>
  <button id="demo-png">载入示例 PNG（canvas 生成）</button>
  <file-preview id="wc"></file-preview>
  <p class="detail">说明：离线场景 Worker 以内联 blob 启动；含重库的格式（office/csv 等）在 Worker 内无 importmap，将自动降级主线程处理。</p>
</section>

${embed('fpk-src-core', d.coreSrc)}
${embed('fpk-src-pdf', d.pdfSrc)}
${embed('fpk-src-office', d.officeSrc)}
${embed('fpk-src-archive', d.archiveSrc)}
${embed('fpk-src-browser', d.browserSrc)}
${embed('fpk-src-worker', d.workerSrc)}
${embed('fpk-src-cases', d.casesSrc)}
<script id="fpk-wasm" type="fpk/data">${d.wasmDataUrl}</script>

<script>
(function () {
  function src(id) { return document.getElementById(id).textContent; }
  var urls = {};
  ['core', 'pdf', 'office', 'archive', 'browser', 'worker', 'cases'].forEach(function (n) {
    urls[n] = URL.createObjectURL(new Blob([src('fpk-src-' + n)], { type: 'text/javascript' }));
  });
  window.__FPK_URLS__ = urls;
  var imports = {
    '@file-preview/core': urls.core,
    '@file-preview/plugin-pdf': urls.pdf,
    '@file-preview/plugin-office': urls.office,
    '@file-preview/plugin-archive': urls.archive,
    'fpk:cases': urls.cases,
  };
  for (var lib in ${JSON.stringify(CDN_LIBS)}) imports[lib] = ${JSON.stringify(CDN_LIBS)}[lib];
  var im = document.createElement('script');
  im.type = 'importmap';
  im.textContent = JSON.stringify({ imports: imports });
  document.head.appendChild(im); // 必须先于任何模块执行（探针实证 file:// 下生效）
  window.__FPK_WORKER_URL__ = urls.worker;
})();
</script>
<script type="module">
  const urls = window.__FPK_URLS__;
  const core = await import(urls.core);
  const pdfMod = await import(urls.pdf);
  const officeMod = await import(urls.office);
  const zipMod = await import(urls.archive);
  const { runVerifyCases } = await import(urls.cases);

  // ---------- A 区：断言矩阵 ----------
  const report = await runVerifyCases({
    core, pdfMod, officeMod, zipMod,
    wasmUrl: document.getElementById('fpk-wasm').textContent,
    workerUrl: window.__FPK_WORKER_URL__,
  });
  const box = document.querySelector('#cases');
  for (const c of report.cases) {
    const div = document.createElement('div');
    div.className = 'case ' + (c.pass ? 'pass' : 'fail');
    div.innerHTML = '<span class="badge">' + (c.pass ? 'PASS' : 'FAIL') + '</span><b></b><span class="detail"></span>';
    div.querySelector('b').textContent = c.name;
    div.querySelector('.detail').textContent = c.detail;
    box.appendChild(div);
  }
  const ok = report.fail === 0;
  const summary = document.querySelector('#summary');
  summary.textContent = (ok ? '✅ 全部通过' : '❌ 存在失败') + '：' + report.pass + '/' + (report.pass + report.fail);
  summary.style.background = ok ? '#d9f2e0' : '#fde0e0';
  window.__FPK_VERIFY__ = report;

  // ---------- B 区：Web Component（side-effect 注册自 browser bundle）----------
  await import(urls.browser); // 定义 <file-preview>（其内部默认集与 Worker 均已内联/覆盖）
  const wc = document.querySelector('#wc');
  const drawPng = () => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 60;
    const g = c.getContext('2d');
    g.fillStyle = '#4a7dbd'; g.fillRect(0, 0, 120, 60);
    g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText('offline ✓', 22, 36);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  };
  document.querySelector('#demo-png').onclick = async () => {
    wc.preview(new File([await drawPng()], 'demo.png', { type: 'image/png' }));
  };
  wc.addEventListener('dragover', (e) => e.preventDefault());
  wc.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) wc.preview(f); });
</script>
</body>
</html>`;
}
