// 统一文件模型：流式/按需读取，避免整文件进内存。
export interface IFile {
  readonly name: string;
  readonly size: number;
  mimeType?: string;
  extension?: string;
  /** 内部字段：浏览器端底层 Blob，供 Worker 派发时 transfer（主线程不应直接读取内容） */
  blob?: Blob;

  /** 探测用：读文件头部（默认前 16KB），不加载全量 */
  header(maxBytes?: number): Promise<Uint8Array>;
  /** 按需区间读取，支持流式/大文件；插件不应假设整文件已在内存 */
  readRange(start: number, end: number): Promise<Uint8Array>;
  /** 懒加载整文件（小文件快捷路径）；大文件插件慎用 */
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FileTreeNode {
  name: string;
  size?: number;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

// 统一预览结果：解析层不碰 DOM、不拼最终 HTML。
export type PreviewResult =
  | { kind: 'html'; html: string; title?: string }
  | { kind: 'text'; text: string; language?: string }
  | { kind: 'image'; dataUrl: string; width?: number; height?: number; mimeType?: string }
  | { kind: 'media'; mediaType: 'video' | 'audio'; src?: string; mimeType?: string; metadata?: Record<string, unknown> }
  | { kind: 'table'; columns: string[]; rows: unknown[][]; sheetName?: string }
  | { kind: 'tree'; nodes: FileTreeNode[] }
  | { kind: 'json'; data: unknown }
  | { kind: 'binary'; hexDump?: string; info?: Record<string, unknown> }
  | { kind: 'iframe'; srcdoc?: string; sandbox?: string[] }
  | { kind: 'error'; message: string; code?: string };

export interface PreviewOptions {
  signal?: AbortSignal;
  timeout?: number; // 默认 30000ms
  onProgress?: (p: { phase: string; loaded: number; total?: number }) => void;
  maxBytes?: number; // 超过降级，默认 100MB
}

export interface DetectResult {
  mimeType: string;
  extension?: string;
  fileName: string;
  header: Uint8Array;
  zipHint: 'docx' | 'xlsx' | 'pptx' | 'zip' | null;
  isText?: boolean; // UTF-8 可读率高（兜底文本）
}

export interface WorkerHandle {
  post<T>(payload: unknown, opts?: { signal?: AbortSignal }): Promise<T>;
  terminate(): void;
}

// 环境适配层：抽离所有 DOM/window/fs/WASM/Worker/sanitize 差异。
export interface EnvAdapter {
  isBrowser: boolean;
  loadWasm(url: string): Promise<ArrayBuffer | WebAssembly.Module>;
  createObjectURL(data: Blob | Uint8Array, mimeType: string): string | null;
  revokeObjectURL(url: string): void;
  /** Worker 派发（核心统一派发模型）；Node 端可返回 null（主线程异步即可） */
  spawnWorker?(workerUrl: string): WorkerHandle | null;
  /** 解析外部资源 URL（wasm / pdfjs worker / pdfjs module 等），由运行环境注入 */
  getAssetUrl?(name: string): string | undefined;
  /** 唯一清理点：浏览器 DOMPurify / Node sanitize-html */
  sanitize(html: string, opts?: { iframe?: boolean }): string;
  /** 结构化日志（见方案第十六节） */
  log?(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void;
}

export interface PreviewPlugin {
  id: string;
  contractVersion: 1;
  /**
   * 是否可在「核心统一派发 Worker」中执行。
   * - 默认 true：纯 JS / 重 CPU 的插件（image/text/office）进 Worker，主线程不阻塞。
   * - false：插件自管 Worker（如 pdfjs），由主线程直接调用，避免「Worker 内嵌套 Worker」。
   */
  runsInWorker?: boolean;
  /** 返回 0=不匹配；>0 优先级，越大越优先（归一 number，杜绝布尔隐式） */
  test(ctx: DetectResult): number;
  /** opts 可省略：插件内部对 onProgress 等做空安全访问（直接调用插件的调用方可能不传） */
  preview(file: IFile, env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult>;
}
