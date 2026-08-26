// 媒体元数据插件回归（方案 §5.6 / todo D2）：
// ① 音频文件经 mediainfo.js(WASM) 真实解析 → kind:'media' 元数据（Wave/PCM/采样率/声道）
// ② Node 端仅 metadata 无播放 src；浏览器适配器经 createObjectURL 产出可播放 src
// ③ 损坏/非媒体内容 → 插件级 ERR_PARSE；全默认插件集下 .wav 不再降级 binary
// ④ 路由矩阵：音视频扩展名/MIME 命中 90，zipHint 排除，与 text/image/pdf/zip 互斥
import { describe, it, expect } from 'vitest';
import { mediaPlugin } from '../src/plugins/media.ts';
import { imagePlugin } from '../src/plugins/image.ts';
import { textPlugin } from '../src/plugins/text.ts';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { zipPlugin } from '@file-preview/plugin-archive';
import { createPreviewer } from '../src/previewer.ts';
import { nodeAdapter } from '../src/env.ts';
import type { EnvAdapter } from '../src/types.ts';
import { corePlugins, workerPlugins } from '../src/plugins/index.ts';
import { memFile } from './helpers.ts';

const ctxBase = { fileName: 'f', header: new Uint8Array(4) };

/** 最小合法 WAV：RIFF/WAVE + fmt(PCM 8kHz 单声道 16bit) + data(静音)。 */
function makeWav(): Uint8Array {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const samples = new Int16Array(1600); // 静音
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  let o = 0;
  const w = (s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i));
  };
  const u32 = (v: number) => {
    dv.setUint32(o, v, true);
    o += 4;
  };
  const u16 = (v: number) => {
    dv.setUint16(o, v, true);
    o += 2;
  };
  w('RIFF');
  u32(36 + dataLen);
  w('WAVE');
  w('fmt ');
  u32(16);
  u16(1); // PCM
  u16(numChannels);
  u32(sampleRate);
  u32((sampleRate * numChannels * bitsPerSample) / 8);
  u16((numChannels * bitsPerSample) / 8);
  u16(bitsPerSample);
  w('data');
  u32(dataLen);
  new Int16Array(buf, 44).set(samples);
  return new Uint8Array(buf);
}

describe('media · 路由矩阵', () => {
  it('音频/视频扩展名与 MIME 显式命中 90；zipHint 排除', () => {
    const p = mediaPlugin();
    for (const ext of ['wav', 'mp3', 'flac', 'ogg', 'm4a']) {
      // 对齐真实 detect 输出：mimeType 兜底 application/octet-stream（DetectResult 契约必填）
      expect(p.test({ ...ctxBase, extension: ext, mimeType: 'application/octet-stream' } as never)).toBe(90);
    }
    for (const ext of ['mp4', 'mkv', 'webm', 'mov', 'avi']) {
      expect(p.test({ ...ctxBase, extension: ext, mimeType: 'application/octet-stream' } as never)).toBe(90);
    }
    expect(p.test({ ...ctxBase, mimeType: 'audio/mpeg' } as never)).toBe(90);
    expect(p.test({ ...ctxBase, mimeType: 'video/mp4' } as never)).toBe(90);
    // zip 家族不是媒体
    expect(p.test({ ...ctxBase, zipHint: 'docx' } as never)).toBe(0);
    // 无扩展名/无名 MIME 不命中
    expect(p.test({ ...ctxBase, extension: 'xyz', mimeType: 'application/octet-stream' } as never)).toBe(0);
    expect(p.test({ ...ctxBase, mimeType: 'application/octet-stream' } as never)).toBe(0);
  });

  it('与 text/image/pdf/zip 插件互斥：.wav 只有 media 接管', () => {
    const wav = makeWav();
    const ctx = {
      fileName: 'tone.wav',
      extension: 'wav',
      mimeType: 'application/octet-stream',
      header: wav.subarray(0, 16),
      zipHint: null,
    } as never;
    expect(mediaPlugin().test(ctx)).toBe(90);
    expect(textPlugin().test(ctx)).toBe(0);
    expect(imagePlugin().test(ctx)).toBe(0);
    expect(pdfPlugin().test(ctx)).toBe(0);
    expect(zipPlugin().test(ctx)).toBe(0);
  });

  it('media 对图片/PDF/zip 上下文返回 0', () => {
    const p = mediaPlugin();
    expect(p.test({ ...ctxBase, extension: 'png', mimeType: 'image/png' } as never)).toBe(0);
    expect(p.test({ ...ctxBase, extension: 'pdf', mimeType: 'application/pdf' } as never)).toBe(0);
    expect(p.test({ ...ctxBase, extension: 'zip', mimeType: 'application/zip', zipHint: 'zip' } as never)).toBe(0);
  });

  it('media 可进核心统一派发 Worker（未自管 Worker）', () => {
    expect(workerPlugins().some((p) => p.id === 'media')).toBe(true);
  });
});

describe('media · 真实 WASM 解析', () => {
  it('.wav → kind:media(audio)，元数据含 Wave/PCM/采样率/声道（mediainfo.js@0.3.1 实测形状）', async () => {
    const r = await mediaPlugin().preview(memFile('tone.wav', makeWav()), nodeAdapter, {});
    expect(r.kind).toBe('media');
    if (r.kind !== 'media') return;
    expect(r.mediaType).toBe('audio');
    expect(r.src).toBeUndefined(); // Node 端仅 metadata，无播放 src
    expect(r.metadata?.general).toMatchObject({ Format: 'Wave' });
    expect(r.metadata?.audio).toMatchObject({
      Format: 'PCM',
      Channels: 1,
      SamplingRate: 8000,
    });
    // 数值字段已数值化（object 格式契约）
    const meta = r.metadata as Record<string, Record<string, unknown>>;
    expect(typeof meta.audio.SamplingRate).toBe('number');
  });

  it('改名 .mp3（实为 wav 内容）仍产出 media —— 扩展名路由 + 内容识别双保险', async () => {
    const r = await mediaPlugin().preview(memFile('clip.mp3', makeWav()), nodeAdapter, {});
    expect(r.kind).toBe('media');
    if (r.kind !== 'media') return;
    expect(r.mediaType).toBe('audio');
  });
});

describe('media · 错误处理与环境契约', () => {
  it('损坏/非媒体内容 → 插件级 ERR_PARSE（router 据此交下一插件或降级）', async () => {
    const garbage = new TextEncoder().encode('definitely not a media file, just plain text padding');
    const r = await mediaPlugin().preview(memFile('broken.mp3', garbage), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_PARSE');
    expect(r.message).toContain('media parse failed');
  });

  it('浏览器适配器契约：isBrowser+createObjectURL → 产出可播放 blob src', async () => {
    const browserLike: EnvAdapter = {
      ...nodeAdapter,
      isBrowser: true,
      createObjectURL(data, mimeType) {
        void data;
        return `blob:mock:${mimeType}`;
      },
    };
    const r = await mediaPlugin().preview(
      memFile('tone.wav', makeWav(), 'audio/wav'),
      browserLike,
      {},
    );
    expect(r.kind).toBe('media');
    if (r.kind !== 'media') return;
    expect(r.src).toBe('blob:mock:audio/wav');
    expect(r.mimeType).toBe('audio/wav');
  });
});

describe('media · 管线集成', () => {
  it('全默认插件集 corePlugins() 下 .wav 出 media，不再降级 binary/text', async () => {
    const pv = createPreviewer({ plugins: corePlugins() });
    const r = await pv.preview(memFile('tone.wav', makeWav()), nodeAdapter, {});
    expect(r.kind).toBe('media');
  });
});
