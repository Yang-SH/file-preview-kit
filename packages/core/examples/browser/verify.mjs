// 浏览器路径验证（jsdom 模拟 DOM）：确认 <file-preview> 自定义元素 + render() 真能跑。
// 需先 `npm run build` 生成 dist/browser.js。
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.URL = dom.window.URL;
// jsdom 的 Blob 未实现 slice().arrayBuffer()；验证用 Node 自带 Blob（真实浏览器原生支持）。
globalThis.Blob = (await import('node:buffer')).Blob;

await import('../../dist/browser.js');

const el = document.createElement('file-preview');
document.body.appendChild(el);

const blob = new Blob(['hello from browser\n第二行'], { type: 'text/plain' });
await el.preview(blob);

const pre = el.shadowRoot.querySelector('pre');
const ok = pre && pre.textContent.includes('hello from browser');
console.log('BROWSER <file-preview> render pre =', JSON.stringify(pre?.textContent));
if (!ok) {
  console.error('❌ BROWSER VERIFY FAILED');
  process.exit(1);
}
console.log('✅ 浏览器 render + <file-preview> 跑通 (jsdom)');
