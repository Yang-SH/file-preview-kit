// 探测层直测（此前零覆盖）：魔数表六签名、扩展名回退与优先级、zipHint 中央目录分类、文本嗅探语义。
// 方案 §四：魔数 + 扩展名 + MIME + zip 内部探测兜底。
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { detectFile } from '../src/index.ts';
import { memFile } from './helpers.ts';

const enc = (s: string) => new TextEncoder().encode(s);

/** 无扩展名且无声明 MIME 的裸文件，避免干扰魔数判定。 */
const bare = (bytes: Uint8Array) => memFile('probe.bin', bytes);

async function detect(bytes: Uint8Array, name = 'probe.bin', mimeType?: string) {
  return detectFile(memFile(name, bytes, mimeType));
}

describe('detectFile：魔数表（方案 §四 MAGIC）', () => {
  const cases: Array<[string, number[], string]> = [
    ['png', [0x89, 0x50, 0x4e, 0x47], 'image/png'],
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['gif', [0x47, 0x49, 0x46, 0x38], 'image/gif'],
    ['bmp', [0x42, 0x4d], 'image/bmp'],
    ['pdf', [0x25, 0x50, 0x44, 0x46], 'application/pdf'],
  ];
  for (const [label, sig, mime] of cases) {
    it(`magic ${label} → ${mime}`, async () => {
      const r = await detect(Uint8Array.from([...sig, 0, 0, 0, 0]));
      expect(r.mimeType).toBe(mime);
    });
  }
  it('magic webp（RIFF....WEBP）', async () => {
    const b = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect((await detect(b)).mimeType).toBe('image/webp');
  });
  it('magic zip（PK\\x03\\x04）→ application/zip + zipHint=zip', async () => {
    const r = await detect(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    expect(r.mimeType).toBe('application/zip');
    expect(r.zipHint).toBe('zip');
  });
});

describe('detectFile：扩展名回退与优先级（magic ?? declared ?? ext）', () => {
  it('无魔数时按扩展名映射（md → text/markdown）', async () => {
    const r = await detect(enc('plain'), 'readme.md');
    expect(r.mimeType).toBe('text/markdown');
    expect(r.extension).toBe('md');
  });

  it('声明 MIME 优先于扩展名推导（无魔数时）', async () => {
    const r = await detect(enc('plain'), 'x.md', 'application/x-custom');
    expect(r.mimeType).toBe('application/x-custom');
  });

  it('魔数最高优先：.md 扩展名但 PNG 魔数 → image/png', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    const r = await detect(png, 'x.md');
    expect(r.mimeType).toBe('image/png');
  });

  it('全部未知 → octet-stream', async () => {
    const r = await detect(Uint8Array.from([0x00, 0xff, 0x00, 0xfe]), 'mystery.bin');
    expect(r.mimeType).toBe('application/octet-stream');
  });
});

describe('detectFile：无扩展名 zip 家族中央目录分类（EOCD 扫描）', () => {
  // 用真实中央目录构造：fflate zipSync 的条目名会写入中央目录，可被尾部扫描命中前缀
  it('word/ 前缀 → docx', async () => {
    const r = await detect(zipSync({ 'word/document.xml': strToU8('<x/>') }), 'noext');
    expect(r.zipHint).toBe('docx');
  });
  it('xl/ 前缀 → xlsx', async () => {
    const r = await detect(zipSync({ 'xl/table.xml': strToU8('<x/>') }), 'noext');
    expect(r.zipHint).toBe('xlsx');
  });
  it('ppt/ 前缀 → pptx', async () => {
    const r = await detect(zipSync({ 'ppt/slides/slide1.xml': strToU8('<x/>') }), 'noext');
    expect(r.zipHint).toBe('pptx');
  });
});

describe('detectFile：isText 文本嗅探语义（octet-stream 门控）', () => {
  it('纯 ASCII 且未知类型 → isText=true', async () => {
    const r = await detect(enc('hello readable world'), 'file.dat');
    expect(r.isText).toBe(true);
  });

  it('含中文的合法 UTF-8 → isText=true（多字节宽松计数）', async () => {
    const r = await detect(enc('中文内容可读'), 'file.dat');
    expect(r.isText).toBe(true);
  });

  it('NUL 字节密集 → isText=false（走二进制）', async () => {
    const bytes = new Uint8Array(64);
    bytes[5] = 0x41;
    const r = await detect(bytes, 'file.dat');
    expect(r.isText).toBeFalsy();
  });

  it('已识别类型不参与文本嗅探（PNG 即便可打印头也非文本）', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x20, 0x20]);
    const r = await detect(png, 'a.bin');
    expect(r.mimeType).toBe('image/png');
    expect(r.isText).toBeFalsy();
  });

  it('空文件：header 空 → isText=false', async () => {
    const r = await detect(new Uint8Array(0), 'empty.dat');
    expect(r.isText).toBeFalsy();
  });
});
