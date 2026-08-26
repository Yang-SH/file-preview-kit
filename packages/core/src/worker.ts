// 核心统一派发 Worker 入口（独立 ESM bundle，dist/worker.js）。
// 主线程把原始 Blob + 选项 post 过来 → 这里重建 IFile → 跑统一管线 runPipeline → 回传纯数据 PreviewResult。
// sanitize 在 Worker 内走 identity：主线程 render() 会再执行唯一净化点，避免双重净化。
import type { PreviewResult, PreviewOptions, PreviewPlugin } from './types.ts';
import { runPipeline } from './previewer.ts';
import { createBrowserEnv } from './env.ts';
import { workerPlugins } from './plugins/index.ts';
import { fileFromBrowser } from './file.ts';
// C3 分包：Worker 默认集与 browser 入口保持同构（pdf 除外——runsInWorker:false，避免 Worker 嵌套）。
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

function defaultWorkerSet(): PreviewPlugin[] {
  return [...workerPlugins(), officePlugin(), zipPlugin()];
}

const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
};

const workerEnv = {
  ...createBrowserEnv({ sanitize: (html: string) => html }),
  // 不在 Worker 内再起嵌套 Worker；核心 worker 自身已是后台线程。
  spawnWorker: () => null,
};

interface WorkerRequest {
  id: number;
  name: string;
  size: number;
  mimeType?: string;
  extension?: string;
  blob: Blob;
  opts: PreviewOptions;
}
interface WorkerResponse {
  id: number;
  result: PreviewResult;
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id, name, size, mimeType, extension, blob, opts } = ev.data;
  try {
    const file = await fileFromBrowser(blob, name, extension);
    const f = Object.assign(file, { size, mimeType });
    const result = await runPipeline(f, workerEnv, opts, defaultWorkerSet());
    const res: WorkerResponse = { id, result };
    ctx.postMessage(res);
  } catch (e) {
    const res: WorkerResponse = {
      id,
      result: { kind: 'error', code: 'WORKER', message: (e as Error)?.message ?? String(e) },
    };
    ctx.postMessage(res);
  }
};
