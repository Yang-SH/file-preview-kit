import type { IFile, EnvAdapter, PreviewPlugin, PreviewOptions, PreviewResult, DetectResult, WorkerHandle } from './types.ts';
import { detectFile, looksLikeText } from './detect.ts';
import { PreviewErrorCode, PreviewAbortError, PreviewTimeoutError } from './errors.ts';
import { fileToCacheKey, type PreviewCache } from './cache.ts';

export interface PreviewerOptions {
  plugins: PreviewPlugin[];
  cache?: PreviewCache;
  maxBytes?: number;
  /** 调度模式：'main' 主线程（默认，行为不变）；'worker' 走核心统一派发 Worker */
  dispatch?: 'main' | 'worker';
  /** Worker 入口 URL（dispatch='worker' 时必填，由调用方用 import.meta.url 解析） */
  workerUrl?: string;
}

export function createPreviewer(opts: PreviewerOptions) {
  return new Previewer(opts);
}

/**
 * 纯管线：detect → 大小护栏 → 超时合并 → 路由 → 逐个插件尝试 → 降级。
 * 被 Previewer（主线程）与 Worker 入口复用，是「核心统一派发」的唯一真相来源。
 */
export async function runPipeline(
  file: IFile,
  env: EnvAdapter,
  opts: PreviewOptions,
  plugins: PreviewPlugin[],
): Promise<PreviewResult> {
  const detected = await detectFile(file);

  // D1 修复：插件消费「探测结论」而非可选输入字段 file.mimeType。
  // fileFromNode 不填 mimeType（fileFromBrowser 的 Blob.type 也可能为空），
  // 若直传原始 file，image 等插件会把 dataUrl 误标 octet-stream 且丢失尺寸。
  // 探测优先级 magic ?? declared ?? extension 已在 detectFile 内收敛，此处统一富化。
  const routed: IFile = { ...file, mimeType: detected.mimeType };

  // 0) 大小护栏：先于任何插件，防 office 插件整文件 arrayBuffer() 爆内存
  if (routed.size > (opts.maxBytes ?? 100 * 1024 * 1024)) {
    return fallbackResult(routed, detected, PreviewErrorCode.TOO_LARGE, env);
  }

  // 1) 默认超时合并到 signal（防坏/恶意文件挂起主线程或 Worker）
  const { signal, timedOut } = combineSignal(opts.signal, opts.timeout ?? 30000);

  const matches = plugins
    .map((p) => ({ p, priority: p.test(detected) }))
    .filter((x) => x.priority > 0) // 归一 number，无布尔隐式
    .sort((a, b) => b.priority - a.priority);

  for (const { p } of matches) {
    try {
      const r = await p.preview(routed, env, { ...opts, signal });
      if (r.kind !== 'error') return r;
    } catch (e) {
      if (signal.aborted) {
        if (timedOut()) throw new PreviewTimeoutError();
        throw new PreviewAbortError();
      }
      env.log?.('error', `[preview] plugin ${p.id} failed`, e);
    }
  }
  return fallbackResult(routed, detected, PreviewErrorCode.UNSUPPORTED, env);
}

export class Previewer {
  private plugins: PreviewPlugin[];
  private cache?: PreviewCache;
  private maxBytes: number;
  private dispatch: 'main' | 'worker';
  private workerUrl?: string;
  private worker: WorkerHandle | null = null;

  constructor(opts: PreviewerOptions) {
    this.plugins = opts.plugins;
    this.cache = opts.cache;
    this.maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
    this.dispatch = opts.dispatch ?? 'main';
    this.workerUrl = opts.workerUrl;
  }

  /** 惰性获取 Worker 句柄（需 env.spawnWorker）。无 Worker 支持时返回 null → 退回主线程。 */
  private getWorker(env: EnvAdapter): WorkerHandle | null {
    if (this.dispatch !== 'worker' || !this.workerUrl) return null;
    if (this.worker) return this.worker;
    this.worker = env.spawnWorker?.(this.workerUrl) ?? null;
    return this.worker;
  }

  async preview(file: IFile, env: EnvAdapter, opts: PreviewOptions = {}): Promise<PreviewResult> {
    const detected = await detectFile(file);

    // 0) 大小护栏（与 runPipeline 一致，避免命中 Worker 前就爆内存）
    if (file.size > (opts.maxBytes ?? this.maxBytes)) {
      return fallbackResult(file, detected, PreviewErrorCode.TOO_LARGE, env);
    }

    // 1) 缓存命中（仅轻量结果）
    if (this.cache) {
      const key = fileToCacheKey(file, detected);
      const hit = this.cache.get(key);
      if (hit) return hit;
    }

    // 2) 统一派发：选中的插件可进 Worker 且环境支持 → 发到 Worker
    const worker = this.getWorker(env);
    if (worker && file.blob) {
      const best = this.bestPlugin(detected);
      if (best && (best.runsInWorker ?? true)) {
        try {
          const result = await worker.post<PreviewResult>({
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
            extension: file.extension,
            blob: file.blob,
            opts,
          });
          if (this.cache && this.cache.shouldCache(result)) {
            this.cache.set(fileToCacheKey(file, detected), result);
          }
          return result;
        } catch (e) {
          env.log?.('warn', '[preview] worker dispatch failed, fallback to main thread', e);
        }
      }
    }

    // 3) 主线程执行
    const result = await runPipeline(file, env, opts, this.plugins);
    if (this.cache && this.cache.shouldCache(result)) {
      this.cache.set(fileToCacheKey(file, detected), result);
    }
    return result;
  }

  /** 主线程先轻量路由，决定最佳插件（用于 Worker 派发的分流判定） */
  private bestPlugin(detected: DetectResult): PreviewPlugin | null {
    const matches = this.plugins
      .map((p) => ({ p, priority: p.test(detected) }))
      .filter((x) => x.priority > 0)
      .sort((a, b) => b.priority - a.priority);
    return matches[0]?.p ?? null;
  }

  /** 释放 Worker 资源（SPA 卸载时调用） */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

async function fallbackResult(file: IFile, detected: DetectResult, code: string, env: EnvAdapter): Promise<PreviewResult> {
  try {
    const head = await file.readRange(0, 64 * 1024);
    // D3 修复：仅「无插件可处理」（UNSUPPORTED）时文本救援优先于 hexdump
    // （方案 §四「无法识别 → 尝试 UTF-8 解码」）。
    // 注意不得拦截 ERR_TOO_LARGE——§16 契约中该码本身即调用方分支依据（降级元数据/十六进制）。
    if (code === PreviewErrorCode.UNSUPPORTED) {
      // 已知但本库不支持的格式 → 友好提示，避免裸十六进制（修复 zip/doc 预览问题）。
      if (detected.legacyOffice) {
        const label =
          detected.legacyOffice === 'xls'
            ? 'Excel 97–2003 (.xls)'
            : detected.legacyOffice === 'ppt'
              ? 'PowerPoint 97–2003 (.ppt)'
              : 'Word 97–2003 (.doc)';
        return {
          kind: 'error',
          code: PreviewErrorCode.UNSUPPORTED,
          message: `不支持老版 ${label} 格式，请另存为 .docx/.xlsx/.pptx 后再预览`,
        };
      }
      // 已被识别为 zip 但插件解析失败（加密/不支持的压缩方式等）→ 友好提示而非十六进制。
      if (detected.zipHint === 'zip') {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: '无法解析该 zip 压缩包（可能加密或采用了不支持的压缩方式），无法预览内容',
        };
      }
      if (looksLikeText(head)) {
        return { kind: 'text', text: new TextDecoder('utf-8', { fatal: false }).decode(head) };
      }
    }
    return {
      kind: 'binary',
      hexDump: generateHexDump(head),
      info: { size: file.size, mimeType: detected.mimeType, code },
    };
  } catch (e) {
    env.log?.('error', '[preview] fallback read failed', e);
    return { kind: 'error', code, message: 'preview failed and fallback read failed' };
  }
}

export function generateHexDump(bytes: Uint8Array, bytesPerLine = 16, maxLines = 256): string {
  const lines: string[] = [];
  const limit = Math.min(bytes.length, bytesPerLine * maxLines);
  for (let i = 0; i < limit; i += bytesPerLine) {
    const slice = bytes.subarray(i, i + bytesPerLine);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(bytesPerLine * 3)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`... (${bytes.length - limit} more bytes)`);
  return lines.join('\n');
}

// 把 opts.signal 与 AbortSignal.timeout(opts.timeout) 合并；任一触发即中断。
export function combineSignal(
  user?: AbortSignal,
  timeout = 30000,
): { signal: AbortSignal; timedOut: () => boolean } {
  if (timeout > 0 && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    let timedOut = false;
    const t = AbortSignal.timeout(timeout);
    if (!user) {
      t.addEventListener('abort', () => (timedOut = true), { once: true });
      return { signal: t, timedOut: () => timedOut };
    }
    // 修复：已中止的 signal 不会再派发 abort 事件（监听器不追溯生效）。
    // 若照常注册监听器，取消意图会被静默丢弃、插件挂起直到超时并以 ERR_TIMEOUT 收场。
    // 直接原样返回该 signal：aborted 状态即刻可见（runPipeline/plugin 均检查 .aborted），reason 也自然保留。
    if (user.aborted) {
      return { signal: user, timedOut: () => false };
    }
    const ctrl = new AbortController();
    user.addEventListener('abort', () => ctrl.abort(), { once: true });
    t.addEventListener(
      'abort',
      () => {
        timedOut = true;
        ctrl.abort();
      },
      { once: true },
    );
    return { signal: ctrl.signal, timedOut: () => timedOut };
  }
  return { signal: user ?? new AbortController().signal, timedOut: () => false };
}
