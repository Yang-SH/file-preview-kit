// 全格式可用性矩阵（方案 §四）：除音频外，每个「声明支持」的格式都必须给出其
// 正确的预览形态 —— 绝不允许落 binary 十六进制兜底。seam = 公共 preview() / renderToHtml()。
//
// 分层说明：
// - manual-fixtures/ 下是用户实测出问题的真实样本（回归锁）；
// - 其余格式用内联合成的最小合法样本（与既有套件同策略），期望值以 docs 规格与
//   既有套件断言为独立真相源（csv/table、md/html、xml/json、docx・pptx・eml/html、xlsx/table、zip/tree）。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewer } from '../src/previewer.ts';
import { renderToHtml } from '../src/render.ts';
import { nodeAdapter } from '../src/env.ts';
import { allPlugins, memFile } from './helpers.ts';
import type { PreviewResult } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL_FIXTURES = join(here, 'manual-fixtures');

const pv = () => createPreviewer({ plugins: allPlugins() });

/** 读真实样本文件 → memFile；fixture 缺失时由调用方 skipIf 兜底。 */
function realFile(dir: string, name: string) {
  const bytes = new Uint8Array(readFileSync(join(dir, name)));
  return memFile(name, bytes);
}

const NOT_HEX = (r: PreviewResult) => {
  // 可用性核心不变量：只要不是「真正未知二进制」，就不许出现十六进制兜底
  if (r.kind === 'binary') throw new Error(`预期外的 binary 十六进制兜底：${JSON.stringify(r).slice(0, 200)}`);
};

/** 每个格式走完 preview 后顺手过渲染层：产物不允许是 fp-hex 十六进制卡片。 */
async function previewAndRender(name: string, bytes: Uint8Array): Promise<PreviewResult> {
  const r = await pv().preview(memFile(name, bytes), nodeAdapter);
  NOT_HEX(r);
  const html = renderToHtml(r, nodeAdapter);
  expect(html).not.toContain('fp-hex');
  return r;
}

// ─────────────────────────────────────────────────────────────
// 第①层：用户实测出现十六进制的原始文件（回归锁，永不许再退化）
// ─────────────────────────────────────────────────────────────
describe('真实样本回归：user-reported hex-display 文件', () => {
  const zipPath = join(MANUAL_FIXTURES, 'real-word-zip.zip');
  const docPath = join(MANUAL_FIXTURES, 'real-word2003.doc');

  it.skipIf(!existsSync(zipPath))(
    '真实 测试.zip → kind:tree 列出条目（不是 binary/hex）',
    async () => {
      const r: PreviewResult = await pv().preview(realFile(MANUAL_FIXTURES, 'real-word-zip.zip'), nodeAdapter);
      expect(r.kind).toBe('tree');
      if (r.kind !== 'tree') return;
      expect(r.nodes.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!existsSync(docPath))(
    '真实 Word 2003 .doc → kind:error 友好转存提示（不是 binary/hex）',
    async () => {
      const r: PreviewResult = await pv().preview(realFile(MANUAL_FIXTURES, 'real-word2003.doc'), nodeAdapter);
      expect(r.kind).toBe('error');
      if (r.kind !== 'error') return;
      expect(r.message).toMatch(/\.docx/i);
    },
  );
});

// ─────────────────────────────────────────────────────────────
// 第②层：文本家族（text/markdown/csv/xml/json/html）
// ─────────────────────────────────────────────────────────────
describe('文本家族可用性', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('.txt → kind:text 且渲染层含文本内容', async () => {
    const r = await previewAndRender('note.txt', enc('hello 可用性\nsecond line'));
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('hello 可用性');
  });

  it('.json → kind:json（解析结果对象）', async () => {
    const r = await previewAndRender('data.json', enc('{"a":1,"b":[2,3]}'));
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') return;
    expect((r.data as { a: number }).a).toBe(1);
  });

  it('.md → kind:html（markdown-it 渲染含 h1）', async () => {
    const r = await previewAndRender('readme.md', enc('# 标题一\n\n段落文本'));
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('<h1>');
    expect(r.html).toContain('标题一');
  });

  it('.csv → kind:table（表头 + 行）', async () => {
    const r = await previewAndRender('sheet.csv', enc('Name,Age\nLee,3\nAnn,5'));
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.columns).toEqual(['Name', 'Age']);
    expect(r.rows.length).toBe(2);
  });

  it('.xml → kind:json（xml→JSON 结构化）', async () => {
    const r = await previewAndRender('conf.xml', enc('<?xml version="1.0"?><root><x>1</x><y>2</y></root>'));
    expect(r.kind).toBe('json');
  });

  it('.html → kind:text(language=html)，不落 hex', async () => {
    const r = await previewAndRender('page.html', enc('<!doctype html><html><body><p>hi</p></body></html>'));
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.language).toBe('html');
  });
});

// ─────────────────────────────────────────────────────────────
// 第③层：图片家族（png/jpeg/gif/bmp/webp/svg）
// 约定：preview 只校验魔数（matchesImageMagic），样本用「合法魔数 + 最小体」即可。
// ─────────────────────────────────────────────────────────────
describe('图片家族可用性', () => {
  function withMagic(magic: number[]): Uint8Array {
    const b = new Uint8Array(64);
    b.set(magic, 0);
    return b;
  }
  const png = (() => {
    const b = new Uint8Array(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG 签名 + IHDR 占位
    return b;
  })();

  const cases: Array<[string, Uint8Array]> = [
    ['a.png', png],
    ['b.jpg', withMagic([0xff, 0xd8, 0xff, 0xe0])],
    ['c.gif', withMagic([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ['d.bmp', withMagic([0x42, 0x4d, 0x36, 0x00])],
    ['e.webp', withMagic([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])],
    ['f.svg', new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ];

  for (const [name, bytes] of cases) {
    it(`${name} → kind:image（dataUrl data URI，不落 hex）`, async () => {
      const r = await previewAndRender(name, bytes);
      expect(r.kind).toBe('image');
      if (r.kind !== 'image') return;
      expect(r.dataUrl).toMatch(/^data:image\//);
      expect(r.mimeType).toMatch(/^image\//);
    });
  }

  it('.svg 允许 XML 声明前缀（<?xml 开头仍归 image 插件）', async () => {
    const r = await previewAndRender('g.svg', new TextEncoder().encode('<svg width="1" height="1"><rect/></svg>'));
    expect(r.kind).toBe('image');
  });
});

// ─────────────────────────────────────────────────────────────
// 第④层：办公 / PDF / 邮件 / 压缩包
// docx/xlsx 复用 golden 确定性样本；pptx/pdf/eml/zip 内联合成（与既有套件同构）。
// ─────────────────────────────────────────────────────────────
import { zipSync, strToU8 } from 'fflate';

const GOLDEN_FIXTURES = join(here, 'golden', 'fixtures');

function slideXml(text: string): string {
  return `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

describe('办公 / PDF / 邮件 / 压缩包可用性', () => {
  it.skipIf(!existsSync(join(GOLDEN_FIXTURES, 'sample.docx')))(
    '.docx → kind:html（mammoth 内容预览，不落 hex）',
    async () => {
      const r = await previewAndRender('sample.docx', new Uint8Array(readFileSync(join(GOLDEN_FIXTURES, 'sample.docx'))));
      expect(r.kind).toBe('html');
      if (r.kind !== 'html') return;
      expect(r.html.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!existsSync(join(GOLDEN_FIXTURES, 'sample.xlsx')))(
    '.xlsx → kind:table（columns/rows/sheetName）',
    async () => {
      const r = await previewAndRender('sample.xlsx', new Uint8Array(readFileSync(join(GOLDEN_FIXTURES, 'sample.xlsx'))));
      expect(r.kind).toBe('table');
      if (r.kind !== 'table') return;
      expect(r.rows.length).toBeGreaterThan(0);
      expect(typeof r.sheetName).toBe('string');
    },
  );

  it('.pptx → kind:html（幻灯片文本抽取）', async () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships/>'),
      'ppt/presentation.xml': strToU8('<p:presentation/>'),
      'ppt/slides/slide1.xml': strToU8(slideXml('可用性检查幻灯片')),
    });
    const r = await previewAndRender('deck.pptx', bytes);
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('可用性检查幻灯片');
  });

  it('.pdf → kind:html|text（Node 提取路径），不落 hex/error', async () => {
    const { makePdf } = await import('./helpers.ts');
    const r = await pv().preview(memFile('doc.pdf', makePdf()), nodeAdapter);
    NOT_HEX(r);
    expect(['html', 'text']).toContain(r.kind);
  });

  it('.eml → kind:html（MIME 解析正文）', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'To: bob@example.com',
      'Subject: availability',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'email body 可用性',
      '',
    ].join('\r\n');
    const r = await previewAndRender('mail.eml', new TextEncoder().encode(eml));
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('email body');
  });

  it('.zip（合成普通包）→ kind:tree', async () => {
    const bytes = zipSync({ 'a.txt': strToU8('hello'), 'sub/b.txt': strToU8('world') });
    const r = await previewAndRender('normal.zip', bytes);
    expect(r.kind).toBe('tree');
    if (r.kind !== 'tree') return;
    expect(r.nodes.map((n) => n.name)).toContain('a.txt');
  });
});

// ─────────────────────────────────────────────────────────────
// 第⑤层：视频（media 插件 / mediainfo wasm）
// 手造最小 MP4（ftyp+moov[mvhd/trak(vide)/mdat]）：实测 mediainfo 可识别
// General=MPEG-4、Video=AVC 轨道 —— 独立真相源为上方探针输出的字面量。
// ─────────────────────────────────────────────────────────────
describe('视频可用性', () => {
  function box(type: string, ...payload: Uint8Array[]): Uint8Array {
    const body = payload.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(8 + body);
    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let o = 8;
    for (const p of payload) { out.set(p, o); o += p.length; }
    return out;
  }
  function u32(...vals: number[]): Uint8Array {
    const out = new Uint8Array(vals.length * 4); const dv = new DataView(out.buffer);
    vals.forEach((v, i) => dv.setUint32(i * 4, v)); return out;
  }
  function u16(...vals: number[]): Uint8Array {
    const out = new Uint8Array(vals.length * 2); const dv = new DataView(out.buffer);
    vals.forEach((v, i) => dv.setUint16(i * 2, v)); return out;
  }
  const bytes = (...vals: number[]) => Uint8Array.from(vals);
  const str = (s: string) => new TextEncoder().encode(s);
  const concat = (...arrs: Uint8Array[]) => {
    const total = arrs.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };

  /**
   * 最小合法 MP4：isom 品牌 + 单条 AVC 视频轨（320×240），无音频轨。
   * 字节布局与探针验证版（mediainfo 实测解析出 General=MPEG-4 / Video=AVC）
   * 逐字节一致；mvhd 矩阵段保持探针的 17×u32 填充，不要随手"规范化"偏移。
   */
  function makeMp4(): Uint8Array {
    const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('isom'), str('mp41'));
    const mvhd = box('mvhd', bytes(0, 0, 0, 0), u32(0, 0, 1000, 1000, 0x00010000, 0x0100),
      u32(0, 0, 0, 0, 0, 0, 0x00010000, 0, 0, 0, 0, 0x00010000, 0, 0, 0, 0, 0x40000000), u32(2));
    const tkhd = box('tkhd', bytes(0, 0, 0, 7), u32(0, 0, 1, 0, 1000, 0, 0),
      u16(0), u16(0), u32(0),
      u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000),
      u32(320 << 16, 240 << 16));
    const nullTerm = (s: string) => { const o = new Uint8Array(s.length + 1); o.set(str(s)); return o; };
    const mdhd = box('mdhd', bytes(0, 0, 0, 0), u32(0, 0, 600, 600), u16(0x55c4), u16(0));
    const hdlr = box('hdlr', bytes(0, 0, 0, 0), u32(0), str('vide'), u32(0, 0, 0), nullTerm('VideoHandler'));
    const vmhd = box('vmhd', bytes(0, 0, 0, 1), u16(0), u16(0, 0, 0, 0));
    const dinf = box('dinf', box('dref', bytes(0, 0, 0, 0), u32(1), box('url ', bytes(0, 0, 0, 1))));
    const stsdEntry = concat(
      bytes(0, 0, 0, 0, 0, 0), u16(1),
      bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      u16(320, 240), u32(0x00480000, 0x00480000, 0), u16(1), str('\0'.repeat(32)), u16(0x18), u16(0xffff),
    );
    const stbl = box('stbl',
      box('stsd', bytes(0, 0, 0, 0), u32(1), box('avc1', stsdEntry)),
      box('stts', bytes(0, 0, 0, 0), u32(0)),
      box('stsc', bytes(0, 0, 0, 0), u32(0)),
      box('stsz', bytes(0, 0, 0, 0), u32(0), u32(0)),
      box('stco', bytes(0, 0, 0, 0), u32(0)));
    const minf = box('minf', vmhd, dinf, stbl);
    const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
    const moov = box('moov', mvhd, trak);
    return concat(ftyp, moov, box('mdat', u32(0)));
  }

  it('.mp4 → kind:media(video)，元数据含 MPEG-4/AVC/宽高，不落 hex', async () => {
    const r = await previewAndRender('video.mp4', makeMp4());
    expect(r.kind).toBe('media');
    if (r.kind !== 'media') return;
    expect(r.mediaType).toBe('video');
    expect(r.metadata?.general?.Format).toBe('MPEG-4');
    expect(r.metadata?.video?.Format).toBe('AVC');
    expect(r.metadata?.video?.Width).toBe(320);
    expect(r.metadata?.video?.Height).toBe(240);
  });
});
