// 演示台应用逻辑（离线单文件版）：样例画廊 + 拖拽投递 + 渲染舞台。
// 与验证台共用同一批内联 bundle；由生成器打包为 fpk-src-demoapp 注入。
// deps 与 runVerifyCases 一致：{ core, pdfMod, officeMod, zipMod, wasmUrl, pdfModuleUrl, pdfWorkerUrl }
import { zipSync } from 'fflate';

export async function initDemo(deps) {
  const { core, officeMod, zipMod, wasmUrl, pdfModuleUrl, pdfWorkerUrl } = deps;
  const $ = (s) => document.querySelector(s);

  const baseEnv = core.createBrowserEnv({
    pdfModuleUrl,
    pdfWorkerUrl,
    pdfFontsUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
  });
  const env = {
    ...baseEnv,
    getAssetUrl: (n) => (n === 'mediainfo.wasm' ? wasmUrl : baseEnv.getAssetUrl(n)),
  };
  const pv = core.createPreviewer({
    plugins: [...core.corePlugins(), deps.pdfMod.pdfPlugin(), officeMod.officePlugin(), zipMod.zipPlugin()],
  });

  const enc = (s) => new TextEncoder().encode(s);
  const b64Bytes = (u8) => { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s); };

  // ---------- 样例工厂（懒构建 + 缓存） ----------
  function canvasImage(type, draw) {
    return () => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 480; c.height = 300;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 480, 300);
      grad.addColorStop(0, '#4a7dbd'); grad.addColorStop(1, '#7ec4a2');
      g.fillStyle = grad; g.fillRect(0, 0, 480, 300);
      draw(g);
      c.toBlob((b) => res(b.arrayBuffer().then((ab) => new Uint8Array(ab))), type);
    });
  }
  function wavMelody() {
    const sr = 8000, notes = [[523, .3], [659, .3], [784, .3], [1047, .45], [784, .3], [1047, .6]];
    const total = Math.ceil(notes.reduce((s, [, d]) => s + d * sr, 0));
    const buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, total * 2, true);
    let i = 0;
    for (const [f, dur] of notes) {
      const n = Math.floor(dur * sr);
      for (let k = 0; k < n; k++, i++) {
        const envp = Math.min(1, k / 80) * Math.max(0, 1 - k / n);
        v.setInt16(44 + i * 2, Math.round(12000 * envp * Math.sin((2 * Math.PI * f * k) / sr)), true);
      }
    }
    return new Uint8Array(buf);
  }
  // 两页 PDF：对象数组 + 程序化 xref 偏移（内容流用 ASCII——非嵌入字体下 CJK 无字形）
  function twoPagePdf() {
    const esc = (s) => s.replace(/([()\\])/g, '\\$1');
    const streamObj = (lines) => {
      const s = 'BT /F1 16 Tf 56 720 Td 22 TL\n' + lines.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
      return `<</Length ${s.length}>>\nstream\n${s}\nendstream`;
    };
    const font = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
    const res = '<</Font<</F1 7 0 R>>>>';
    const objs = [
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>',
      `<</Type/Page/Parent 2 0 R/Resources${res}/MediaBox[0 0 612 792]/Contents 4 0 R>>`,
      streamObj(['file-preview-kit - PDF Demo (generated in browser)', '', 'Page 1: this file was built on-the-fly by the demo page.', 'pdf.js parses and renders it fully OFFLINE.']),
      `<</Type/Page/Parent 2 0 R/Resources${res}/MediaBox[0 0 612 792]/Contents 6 0 R>>`,
      streamObj(['Page 2 - escaping & i18n notes', '', 'Special chars: (parens) backslash \\ 100% done.', 'CJK lines need embedded fonts (cMaps) - see docs.']),
      font,
    ];
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += xref + `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${out.length}\n%%EOF`;
    return enc(out);
  }
  const builders = {
    'png': canvasImage('image/png', (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(150, 110, 60, 0, 7); g.fill(); g.fillRect(300, 60, 120, 120); g.fillStyle = '#22303f'; g.font = 'bold 26px sans-serif'; g.fillText('PNG 图像', 165, 270); }),
    'jpg': canvasImage('image/jpeg', (g) => { g.fillStyle = '#ffd27f'; g.beginPath(); g.moveTo(240, 40); g.lineTo(420, 260); g.lineTo(60, 260); g.closePath(); g.fill(); g.fillStyle = '#7a3b00'; g.font = 'bold 24px sans-serif'; g.fillText('JPEG 有损压缩', 130, 290); }),
    'svg': () => Promise.resolve(enc(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" rx="12" fill="#123"/><circle cx="80" cy="100" r="46" fill="#4ade80"/><path d="M150 140 L210 60 L280 140 Z" fill="#f59e0b"/><text x="90" y="185" fill="#fff" font-size="18">SVG 矢量图</text></svg>`)),
    'txt': () => Promise.resolve(enc('静夜思\n床前明月光，疑是地上霜。\n举头望明月，低头思故乡。\n\nThe quick brown fox jumps over the lazy dog. 0123456789')),
    'md': () => Promise.resolve(enc('# file-preview-kit\n\n**Markdown** 渲染演示：`行内代码`、列表与表格。\n\n- 流式 IFile\n- 插件路由 + LRU 缓存\n- sanitize 唯一清理点\n\n| 格式 | 结果 |\n|---|---|\n| md | html |\n| csv | table |\n\n> 提示：本页面完全离线运行。\n\n```js\nconst r = await previewer.preview(file);\n```\n')),
    'json': () => Promise.resolve(enc(JSON.stringify({ app: 'file-preview-kit', offline: true, formats: ['png', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'wav', 'eml'], limits: { maxBytes: '100MB', timeout: '30s' }, nested: { items: [{ id: 1 }, { id: 2 }] } }, null, 2))),
    'csv': () => Promise.resolve(enc('产品,类别,单价,库存\n机械键盘,外设,329,42\n4K 显示器,显示设备,1899,8\n无线鼠标,外设,129,156\n降噪耳机,音频,999,23\nUSB-C 扩展坞,配件,459,67\n固态硬盘 2T,存储,899,31')) ,
    'xml': () => Promise.resolve(enc('<?xml version="1.0" encoding="UTF-8"?>\n<config version="1.0">\n  <server host="0.0.0.0" port="8080"/>\n  <features>\n    <feature name="worker-dispatch" enabled="true"/>\n    <feature name="lru-cache" enabled="true"/>\n  </features>\n  <note>XXE 已加固：DOCTYPE 剥离 + 严格校验</note>\n</config>')),
    'pdf': twoPagePdf,
    'docx': () => Promise.resolve(zipSync({
      '[Content_Types].xml': enc('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': enc('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>季度报告</w:t></w:r></w:p><w:p><w:r><w:t>第一段：本项目所有重依赖均以动态导入方式按需加载。</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗文本：</w:t></w:r><w:r><w:t>浏览器端经 mammoth 转换为 HTML。</w:t></w:r></w:p></w:body></w:document>'),
    })),
    'xlsx': async () => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('销售明细');
      ws.addRow(['日期', '产品', '数量', '金额']);
      ws.addRow(['2026-08-01', '机械键盘', 12, 3948]);
      ws.addRow(['2026-08-02', '4K 显示器', 3, 5697]);
      ws.addRow(['2026-08-03', '降噪耳机', 7, 6993]);
      ws.addRow(['2026-08-04', '扩展坞', 15, 6885]);
      const ab = await wb.xlsx.writeBuffer();
      return new Uint8Array(ab);
    },
    'pptx': () => Promise.resolve(zipSync({
      '[Content_Types].xml': enc('<Types/>'), '_rels/.rels': enc('<Relationships/>'),
      'ppt/slides/slide1.xml': enc(slide(['产品简介', 'file-preview-kit 同构文件预览组件库'])),
      'ppt/slides/slide2.xml': enc(slide(['核心特性', '流式 IFile · 插件路由 · 统一派发 Worker', 'sanitize 唯一清理点 · 错误码稳定枚举'])),
      'ppt/slides/slide3.xml': enc(slide(['离线能力', '全部重依赖本地内联，断网环境完整可用'])),
    })),
    'zip': () => Promise.resolve(zipSync({
      'README.md': enc('# 示例项目\nzip 树预览演示'),
      'src/index.js': enc("console.log('hi')"),
      'src/util/format.js': enc('export const f = (x) => x.toFixed(2)'),
      'docs/说明.txt': enc('嵌套目录演示'),
    })),
    'wav': wavMelody,
    'eml': () => Promise.resolve(enc([
      'From: Product Team <product@example.com>', 'To: dev@example.com', 'Subject: =?UTF-8?B?' + b64Bytes(enc('【演示】离线邮件预览')) + '?=',
      'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="DEMO"',
      '', '--DEMO', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      b64Bytes(enc('各位好：\n附件是本周演示材料，请查收。\n—— 产品部')), '--DEMO',
      'Content-Type: application/pdf; name="demo.pdf"', 'Content-Disposition: attachment; filename="demo.pdf"',
      'Content-Transfer-Encoding: base64', '', b64Bytes(enc('%PDF-1.4 fake')), '--DEMO--',
    ].join('\r\n')), 'message/rfc822'),
    'bin': () => Promise.resolve(Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x46, 0x50, 0x4b, 0xff, 0xee])),
  };
  function slide(lines) {
    return '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
      lines.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('') +
      '</p:spTree></p:cSld></p:sld>';
  }

  const SAMPLES = [
    ['png', '🖼️ 图片 PNG'], ['jpg', '🌄 照片 JPEG'], ['svg', '✒️ SVG 矢量'],
    ['txt', '📄 文本'], ['md', '📝 Markdown'], ['json', '🧾 JSON'], ['csv', '📊 CSV 表格'], ['xml', '🔧 XML'],
    ['pdf', '📕 PDF 文档'], ['docx', '📘 Word'], ['xlsx', '📗 Excel'], ['pptx', '📙 PowerPoint'],
    ['zip', '🗜️ ZIP 压缩包'], ['wav', '🎵 音频 WAV'], ['eml', '📧 邮件 EML'], ['bin', '❓ 未知二进制'],
  ];
  const extOf = { png: 'png', jpg: 'jpg', svg: 'svg', txt: 'txt', md: 'md', json: 'json', csv: 'csv', xml: 'xml', pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', zip: 'zip', wav: 'wav', eml: 'eml', bin: 'bin' };
  const cache = {};
  async function sampleFile(id) {
    if (!cache[id]) {
      const data = await builders[id]();
      cache[id] = new File([data], `sample.${extOf[id]}`);
    }
    return cache[id];
  }

  // ---------- 渲染舞台 ----------
  const metaEl = $('#meta'), outEl = $('#stage');
  async function previewBlob(blobLike, fallbackName) {
    const f = blobLike instanceof File ? blobLike : new File([blobLike], fallbackName);
    const ext = f.name.includes('.') ? f.name.split('.').pop() : undefined;
    const t0 = performance.now();
    metaEl.innerHTML = '<span class="dim">解析中…</span>';
    outEl.innerHTML = '';
    try {
      const ifile = await core.fileFromBrowser(f, f.name, ext);
      const r = await pv.preview(ifile, env);
      const ms = Math.round(performance.now() - t0);
      const badgeOk = r.kind !== 'error';
      metaEl.innerHTML =
        `<b>${escape(f.name)}</b> · ${(f.size / 1024).toFixed(1)} KB · ` +
        `<span class="tag">kind=${r.kind}</span>` +
        (r.info?.code ? `<span class="tag warn">${r.info.code}</span>` : '') +
        `<span class="dim">${ms} ms · ${badgeOk ? '主线程管线' : ''}</span>`;
      core.render(r, outEl, env);
    } catch (e) {
      metaEl.innerHTML = `<span class="tag warn">异常</span>`;
      outEl.textContent = String(e);
    }
  }
  function escape(s) { return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]); }

  // ---------- 控件 ----------
  const chips = $('#chips');
  for (const [id, label] of SAMPLES) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label;
    b.onclick = async () => {
      chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      await previewBlob(await sampleFile(id));
    };
    chips.appendChild(b);
  }
  const pick = $('#pick');
  pick.onchange = () => { if (pick.files[0]) previewBlob(pick.files[0]); };
  const zone = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) previewBlob(f); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // 首屏自动演示 markdown
  const first = document.querySelector('.chip');
  if (first) first.click();
}
