import type { PreviewResult, EnvAdapter } from './types.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

// 浏览器渲染（vanilla DOM，框架无关）。唯一 sanitize 清理点在 env.sanitize。
export function render(result: PreviewResult, container: HTMLElement, env: EnvAdapter): void {
  container.innerHTML = '';
  switch (result.kind) {
    case 'html':
      container.innerHTML = env.sanitize(result.html);
      break;
    case 'iframe': {
      const f = document.createElement('iframe');
      // setAttribute 形式等价规范语义，且兼容无 sandbox 属性反射的环境
      f.setAttribute('sandbox', (result.sandbox ?? ['allow-same-origin']).join(' '));
      f.srcdoc = env.sanitize(result.srcdoc ?? '');
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.border = '0';
      container.appendChild(f);
      break;
    }
    case 'image': {
      // G5/G11：稳定类名供调用方 CSS 挂钩（缩放/旋转配方见 README）；lazy/decoding 利好列表与长页
      const img = document.createElement('img');
      img.className = 'fpk-image';
      img.src = result.dataUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      if (result.width) img.width = result.width;
      if (result.height) img.height = result.height;
      container.appendChild(img);
      break;
    }
    case 'text':
    case 'json': {
      const pre = document.createElement('pre');
      pre.className = 'fp-pre';
      pre.textContent = result.kind === 'json' ? JSON.stringify(result.data, null, 2) : result.text;
      container.appendChild(pre);
      break;
    }
    case 'media': {
      const el = document.createElement(result.mediaType);
      if (result.src) el.src = result.src;
      el.setAttribute('controls', ''); // G11：原生控制条（播放/音量）缺省可用
      container.appendChild(el);
      if (result.metadata) {
        const pre = document.createElement('pre');
        pre.className = 'fp-meta';
        pre.textContent = JSON.stringify(result.metadata, null, 2);
        container.appendChild(pre);
      }
      break;
    }
    case 'table': {
      // 与 renderToHtml 同源：tableToHtml 内部逐格 escapeHtml
      container.innerHTML = tableToHtml(result.columns, result.rows);
      break;
    }
    case 'tree': {
      const pre = document.createElement('pre');
      pre.className = 'fp-tree';
      pre.textContent = JSON.stringify(result.nodes, null, 2);
      container.appendChild(pre);
      break;
    }
    case 'binary': {
      const pre = document.createElement('pre');
      pre.className = 'fp-hex';
      pre.textContent = result.hexDump ?? '(empty)';
      container.appendChild(pre);
      break;
    }
    default: {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(result, null, 2);
      container.appendChild(pre);
    }
  }
}

// Node SSR 直出 HTML（服务端 sanitize 后产出完整片段）。
export function renderToHtml(result: PreviewResult, env: EnvAdapter): string {
  switch (result.kind) {
    case 'html':
      return `<div class="fp-html">${env.sanitize(result.html)}</div>`;
    case 'iframe':
      return `<iframe sandbox="allow-same-origin" style="width:100%;height:100%;border:0" srcdoc="${escapeAttr(env.sanitize(result.srcdoc ?? ''))}"></iframe>`;
    case 'text':
      return `<pre class="fp-text">${escapeHtml(result.text)}</pre>`;
    case 'image':
      // G5/G11：同 DOM 分支——稳定类名 + lazy/decoding；交互配方见 README「宿主职责」
      return `<img class="fpk-image" src="${result.dataUrl}" alt="" loading="lazy" decoding="async" />`;
    case 'table':
      return tableToHtml(result.columns, result.rows);
    case 'media':
      return mediaToHtml(result.mediaType, result.src, result.mimeType, result.metadata);
    case 'tree':
      return `<pre class="fp-tree">${escapeHtml(JSON.stringify(result.nodes, null, 2))}</pre>`;
    case 'json':
      return `<pre class="fp-json">${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`;
    case 'binary':
      return `<pre class="fp-hex">${escapeHtml(result.hexDump ?? '')}</pre>`;
    default:
      return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
  }
}

function tableToHtml(columns: string[], rows: unknown[][]): string {
  const th = columns.map((c) => `<th>${escapeHtml(String(c))}</th>`).join('');
  const tr = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="fp-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function mediaToHtml(
  type: 'video' | 'audio',
  src?: string,
  mime?: string,
  meta?: Record<string, unknown>,
): string {
  const srcAttr = src ? ` src="${escapeAttr(src)}"` : '';
  const typeAttr = mime ? ` type="${escapeAttr(mime)}"` : '';
  const metaJson = meta ? `<pre class="fp-meta">${escapeHtml(JSON.stringify(meta, null, 2))}</pre>` : '';
  return `<${type} controls${srcAttr}${typeAttr}></${type}>${metaJson}`;
}
