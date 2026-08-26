// 离线浏览器包构建器：产出 IIFE + ESM 双形态单文件库、双击即验 demo.html、README。
// 产物目录 packages/core/dist-offline-browser/（gitignore），并打包 zip 至仓库根（gitignore）。
// 用法：npm run build:browser-package
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages/core/dist-offline-browser');
const entry = join(root, 'scripts/offline-browser/entry.ts');
const wasmFile = join(root, 'node_modules/mediainfo.js/dist/MediaInfoModule.wasm');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Node 内建模块：仅存在于 Node 专属分支（extractInNode/createNodeEnv 等），
// 浏览器运行时永不触达；标 external 让动态导入在浏览器中安全地保持未解析。
const nodeExternals = ['node:module', 'node:url', 'node:path', 'node:fs/promises', 'node:fs'];

const common = {
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  globalName: 'FPK',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  loader: { '.wasm': 'base64' },
  define: { 'process.env.NODE_ENV': '"production"' },
  external: nodeExternals,
  alias: {
    // mediainfo.js 的 exports 未暴露 wasm 子路径，直指磁盘文件
    'mediainfo.js/dist/MediaInfoModule.wasm': wasmFile,
  },
};

console.log('[offline] building IIFE → fpk.browser.js');
await build({ ...common, outfile: join(outDir, 'fpk.browser.js') });

console.log('[offline] building ESM → fpk.browser.esm.js');
const { globalName: _omit, ...esmCommon } = common;
await build({ ...esmCommon, format: 'esm', outfile: join(outDir, 'fpk.browser.esm.js') });

// ── demo.html：file:// 双击即验 ──
const demo = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>file-preview-kit 离线包演示</title>
<style>body{font-family:system-ui;margin:24px;background:#111;color:#ddd}
button,input[type=file]{margin:4px 8px 12px 0}
#out{white-space:pre-wrap;background:#000;padding:12px;border-radius:8px;min-height:120px}
img{max-width:100%}video,audio{width:100%}</style></head><body>
<h2>file-preview-kit v0.4.0 离线浏览器包</h2>
<p>选择或拖入文件（txt/png/csv/md/xml/pdf/docx/xlsx/pptx/zip/eml/wav/mp4…）：</p>
<input type="file" id="f">
<div id="drop" style="border:2px dashed #555;padding:16px;border-radius:8px;margin-bottom:12px">也可把文件拖到这里</div>
<button data-gen="txt">生成示例 TXT</button><button data-gen="png">生成示例 PNG</button><button data-gen="csv">生成示例 CSV</button>
<div id="kind"></div><div id="out"></div>
<script src="./fpk.browser.js"></script>
<script>
const out=document.getElementById('out');
const kindEl=document.getElementById('kind');
async function preview(blob,name){
  kindEl.textContent='解析中…';out.textContent='';
  try{
    const env=FPK.createBrowserEnv();
    const f=await FPK.fileFromBrowser(blob,name);
    const r=await FPK.createDefaultPreviewer().preview(f,env);
    kindEl.textContent='kind = '+r.kind+(r.title?' | '+r.title:'');
    if(r.kind==='html'){out.innerHTML=r.html;}
    else{out.textContent=JSON.stringify(r,(k,v)=>typeof v==='string'&&v.length>2000?v.slice(0,2000)+'…':v,2);}
  }catch(e){kindEl.textContent='❌ '+e.message;out.textContent=e.stack||String(e);}
}
document.getElementById('f').addEventListener('change',e=>{const x=e.target.files[0];if(x)preview(x,x.name);});
const dz=document.getElementById('drop');
dz.addEventListener('dragover',e=>e.preventDefault());
dz.addEventListener('drop',e=>{e.preventDefault();const x=e.dataTransfer.files[0];if(x)preview(x,x.name);});
document.querySelectorAll('button[data-gen]').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.gen;let blob,name;
  if(t==='txt'){blob=new Blob(['hello offline package\\\\n第二行中文'],{type:'text/plain'});name='sample.txt';}
  else if(t==='csv'){blob=new Blob(['Name,Age\\\\nLee,3\\\\nAnn,5'],{type:'text/csv'});name='sample.csv';}
  else{const c=document.createElement('canvas');c.width=120;c.height=60;const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,120,60);gr.addColorStop(0,'#f66');gr.addColorStop(1,'#66f');
    g.fillStyle=gr;g.fillRect(0,0,120,60);c.toBlob(x=>{preview(x,'sample.png');},'image/png');return;}
  preview(blob,name);
}));
// 自检：全局 API 存在性
window.addEventListener('load',()=>{ if(typeof FPK==='undefined'){document.body.insertAdjacentHTML('afterbegin','<p style=color:#f66>FPK 未定义——请确认 fpk.browser.js 与本页同目录</p>');}});
</script></body></html>`;
writeFileSync(join(outDir, 'demo.html'), demo, 'utf8');

// ── README-BROWSER.md ──
const readme = `# file-preview-kit 离线浏览器包

单文件引入，浏览器直接运行（支持 **file:// 双击打开**，无需 Node/服务器/网络）。

## 引入方式

### 全局脚本（最简，含双击场景）
\`\`\`html
<script src="./fpk.browser.js"></script>
<script>
  // 全局对象 window.FPK
  const pv = FPK.createDefaultPreviewer();
  const env = FPK.createBrowserEnv();
  const file = await FPK.fileFromBrowser(input.files[0]);
  const result = await pv.preview(file, env);
  FPK.render(result, document.getElementById('box'), env);
</script>
\`\`\`

### ESM 工程
\`\`\`js
import { createDefaultPreviewer, createBrowserEnv, fileFromBrowser, render } from './fpk.browser.esm.js';
\`\`\`
> ESM 文件需经 http(s) 或打包器引入；file:// 场景请用上面的全局脚本形态。

## 能力矩阵（离线全量）

图片 / 文本 / Markdown / JSON / CSV / XML / PDF(canvas 前 N 页+可检索文本层) /
DOCX / XLSX(可选表) / PPTX / ZIP(炸弹防御) / EML / 音视频元数据(wasm 内联) / 十六进制兜底。

## 与 npm 包的差异

| 项 | 本离线包 | npm 包 |
| --- | --- | --- |
| Worker 派发 | 主线程（无独立 worker 文件） | 支持 dispatch:'worker' |
| pdfjs 资源 | 内联主线程模式 | CDN/自托管注入 |
| mediainfo wasm | base64 内联 Blob | getAssetUrl 注入 |
| 体积 | 单文件 ~4-7MB | 按需分包 |

其余 API 与 npm 包完全一致（createPreviewer/corePlugins/thumbnailer/render…）。
`;
writeFileSync(join(outDir, 'README-BROWSER.md'), readme, 'utf8');

const size = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
for (const f of ['fpk.browser.js', 'fpk.browser.esm.js', 'demo.html', 'README-BROWSER.md']) {
  const p = join(outDir, f);
  console.log(`[offline] ${f}  ${size(existsSync(p) ? statSync(p).size : 0)}`);
}
console.log(`[offline] 完成 → ${outDir}`);
