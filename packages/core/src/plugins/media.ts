import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';
import { PreviewErrorCode } from '../errors.ts';

// 媒体元数据插件（方案 §5.6）：mediainfo.js(WASM, BSD-2-Clause) 按需区间读取提取音视频元数据。
// - 重依赖动态 import（方案 §9），不进主包；锁定 mediainfo.js@0.3.1（上游停更，见 .changeset/README.md 版本纪律）。
// - analyzeData(getSize, readChunk) 与流式 IFile 天然契合：只读 MediaInfo 需要的区间，不整文件加载。
// - 浏览器端经 env.createObjectURL 生成播放 src；Node 端仅 metadata 不播放（方案 §5.6）。
// - wasm 定位：locateFile 是同步回调 → 先异步解析好 URL 再传闭包。注入优先级：
//   ① env.getAssetUrl('mediainfo.wasm')（CDN drop-in / 自托管，与 pdf.worker 同模式）
//   ② Node 端 createRequire 解析 exports 子路径 'mediainfo.js/MediaInfoModule.wasm' → 绝对 fs 路径
//   ③ 都不可用时省略 locateFile，交 emscripten 默认前缀解析（bundler 场景需消费方注入 ①）。

const AUDIO_EXT = new Set([
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'aif', 'amr',
]);
const VIDEO_EXT = new Set([
  'mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', '3gp',
]);

/** 元数据白名单：结果收敛为稳定键集，避免全量 track 字段随库版本漂移进调用方 UI。 */
const META_KEYS = [
  'Format', 'CodecID', 'CodecID_String', 'Duration', 'BitRate', 'OverallBitRate',
  'Channels', 'SamplingRate', 'FrameRate', 'Width', 'Height', 'FileSize',
] as const;

type LooseRecord = Record<string, unknown>;

function pickTrack(track: unknown): LooseRecord | undefined {
  if (!track || typeof track !== 'object') return undefined;
  const src = track as LooseRecord;
  const out: LooseRecord = {};
  for (const k of META_KEYS) {
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mediaPlugin(): PreviewPlugin {
  return {
    id: 'media',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.mimeType.startsWith('audio/') || ctx.mimeType.startsWith('video/')) return 90;
      if (ctx.extension && (AUDIO_EXT.has(ctx.extension) || VIDEO_EXT.has(ctx.extension))) return 90;
      return 0;
    },
    async preview(file: IFile, env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      try {
        opts?.signal?.throwIfAborted?.();
        const mediainfo = await createMediaInfo(env);
        try {
          const result = (await mediainfo.analyzeData(
            () => file.size,
            (size, offset) => file.readRange(offset, offset + size),
          )) as { media?: { track?: unknown[] } };

          const tracks = result.media?.track ?? [];
          const general = tracks.find((t) => (t as LooseRecord)?.['@type'] === 'General');
          const audio = tracks.find((t) => (t as LooseRecord)?.['@type'] === 'Audio');
          const video = tracks.find((t) => (t as LooseRecord)?.['@type'] === 'Video');
          // 判定以音/视频轨道为准：MediaInfo 对无法识别的内容也可能给出 General 轨
          // （实测纯文本输入亦然），仅凭 General 放行会把任意二进制误判为媒体。
          if (!audio && !video) {
            throw new Error('no audio/video track recognized');
          }
          const mediaType: 'video' | 'audio' = video ? 'video' : 'audio';

          // 浏览器播放 src：优先复用底层 Blob（零拷贝），否则读入生成（router 的 maxBytes 护栏兜底大文件）。
          let src: string | undefined;
          if (env.isBrowser && typeof env.createObjectURL === 'function') {
            const data: Blob | Uint8Array =
              file.blob ?? new Uint8Array(await file.arrayBuffer());
            src = env.createObjectURL(data, file.mimeType ?? 'application/octet-stream') ?? undefined;
          }

          const metadata: Record<string, Record<string, unknown>> = {};
          const g = pickTrack(general);
          const a = pickTrack(audio);
          const v = pickTrack(video);
          if (g) metadata.general = g;
          if (a) metadata.audio = a;
          if (v) metadata.video = v;

          opts?.onProgress?.({ phase: 'mediainfo', loaded: file.size, total: file.size });
          return {
            kind: 'media',
            mediaType,
            ...(src ? { src } : {}),
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            metadata,
          };
        } finally {
          // 释放 WASM 实例堆内存；analyzeData 失败同样走此路径。
          mediainfo.close();
        }
      } catch (e) {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: `media parse failed: ${(e as Error).message}`,
        };
      }
    },
  };
}

async function createMediaInfo(env: EnvAdapter): Promise<MediaInfoInstance> {
  const wasmUrl = env.getAssetUrl?.('mediainfo.wasm') ?? (await resolveNodeWasmPath());
  const mod = (await import('mediainfo.js')) as {
    default: (opts?: { locateFile?: (path: string, prefix: string) => string }) => Promise<MediaInfoInstance>;
  };
  return mod.default(wasmUrl ? { locateFile: () => wasmUrl } : {});
}

interface MediaInfoInstance {
  analyzeData(
    size: (() => number) | number,
    readChunk: (size: number, offset: number) => Promise<Uint8Array> | Uint8Array,
  ): Promise<unknown>;
  close(): void;
}

/** Node 端解析 wasm 绝对路径；浏览器端返回 undefined（交给注入点或 emscripten 默认）。 */
async function resolveNodeWasmPath(): Promise<string | undefined> {
  // 与 pdf.ts 相同的浏览器判定：存在 document/window 视为浏览器，不走 node:module。
  if (typeof document !== 'undefined' || typeof window !== 'undefined') return undefined;
  try {
    const nodeModule = (await import('node:module')) as unknown as {
      createRequire: (url: string) => NodeRequire;
    };
    // require 基准目录：CJS 包装器原生提供 __filename；ESM 直跑下退回 cwd（对齐 pdf.ts 的既有结论：
    // CJS 产物中 import.meta.url 被置空，不可作为基准）。
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const requireBase =
      typeof __filename === 'string' ? __filename : pathToFileURL(join(process.cwd(), 'index.js')).href;
    return nodeModule.createRequire(requireBase).resolve('mediainfo.js/MediaInfoModule.wasm');
  } catch {
    return undefined;
  }
}
