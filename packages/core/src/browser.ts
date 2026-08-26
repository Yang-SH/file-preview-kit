import type { IFile, EnvAdapter, PreviewPlugin } from './types.ts';
import { createPreviewer, Previewer } from './previewer.ts';
import { fileFromBrowser } from './file.ts';
import { render } from './render.ts';
import { createBrowserEnv } from './env.ts';
import { corePlugins } from './plugins/index.ts';
// C3 分包：重插件包随 browser 入口打包（devDeps 源码级引用），保持 §14 零构建默认集完整。
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

// 零构建 HTML 引入 + Web Component（Shadow DOM 隔离；渲染仍走 render() + env.sanitize）。
// 默认启用「核心统一派发 Worker」：重解析在后台线程，主线程不阻塞 UI。
const PDFJS_VERSION = '4.10.38';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const WORKER_URL = new URL('./worker.js', import.meta.url).href;

const env: EnvAdapter = createBrowserEnv({
  // pdfjs 资源（CDN drop-in 场景；bundler 场景可省略，改由打包器解析裸 import）。
  pdfModuleUrl: `${PDFJS_CDN}/build/pdf.mjs`,
  pdfWorkerUrl: `${PDFJS_CDN}/build/pdf.worker.min.mjs`,
  pdfFontsUrl: `${PDFJS_CDN}/standard_fonts/`,
});

/** 零构建默认集 = core 内置 + 拆分插件包（§9/§14：browser 单文件自带全量默认能力）。 */
function defaultPlugins(): PreviewPlugin[] {
  return [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()];
}

export interface FilePreviewElement extends HTMLElement {
  preview(file: File | Blob): Promise<void>;
  plugins?: PreviewPlugin[];
}

class FilePreview extends HTMLElement implements FilePreviewElement {
  private container: HTMLDivElement;
  plugins?: PreviewPlugin[];
  private previewer: Previewer;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.container = document.createElement('div');
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.shadowRoot!.appendChild(this.container);
    this.previewer = createPreviewer({
      plugins: defaultPlugins(),
      dispatch: 'worker',
      workerUrl: WORKER_URL,
    });
  }

  connectedCallback() {
    const input = this.querySelector('input[slot="input"]') as HTMLInputElement | null;
    if (input) {
      input.addEventListener('change', (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void this.preview(f);
      });
    }
  }

  async preview(file: File | Blob): Promise<void> {
    if (this.plugins) {
      this.previewer.terminate();
      this.previewer = createPreviewer({ plugins: this.plugins, dispatch: 'worker', workerUrl: WORKER_URL });
    }
    const f: IFile = await fileFromBrowser(file);
    const result = await this.previewer.preview(f, env);
    this.container.innerHTML = '';
    render(result, this.container, env);
  }

  disconnectedCallback() {
    this.previewer.terminate();
  }
}

// 副作用：导入即注册自定义元素（零构建 HTML 引入）。
if (typeof customElements !== 'undefined' && !customElements.get('file-preview')) {
  customElements.define('file-preview', FilePreview);
}
