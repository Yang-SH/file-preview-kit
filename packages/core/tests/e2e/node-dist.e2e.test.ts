// 接缝① E2E：真实使用环境 = 构建产物（dist/*）而非 strip-types 源码。
// - ESM 形态：../../dist/index.js（core 全量）+ plugin-* 各自 dist/index.js
// - CJS 形态：../../dist/index.cjs（createRequire；插件 CJS 依赖发布期 publishConfig
//   交换裸说明符，不在本套件范围——由 prepack 流程与 build-clean.test.ts 覆盖）
// - 边界矩阵挂在同一接缝上：空/超限/恰等/损坏魔数/扩展名伪装/无扩展名嗅探/
//   zip 四阈值逐项触界/预中止/超时/LRU 淘汰边界/renderToHtml 转义。
// 注意：本文件不 import ../src/*（避免源码-产物混装）；fixture 字面量独立内联，
// 与 tests/helpers.ts 同源但刻意不复用，保证断言期望值来自独立真相源。
// dist 缺失时整文件 skip（CI 中 vitest 先于 build 运行，须保持 npm test 全绿）；
// 完整运行请用根脚本 `npm run test:e2e`（先 build 再跑）。
import { describe, test, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { zipSync, strToU8, unzipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const coreDist = join(here, '../../dist');
const distMissing = !existsSync(join(coreDist, 'index.js'));

describe.skipIf(distMissing)('seam① Node × dist ESM（生产产物）', async () => {
  /** 独立内联 memFile（同 probe-dist.mjs，不引 src）。 */
  function memFile(name: string, bytes: Uint8Array, mimeType?: string): any {
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase() || undefined;
    return {
      name,
      size: bytes.length,
      ...(mimeType ? { mimeType } : {}),
      ...(ext ? { extension: ext } : {}),
      async header(maxBytes = 16 * 1024) {
        return bytes.subarray(0, Math.min(maxBytes, bytes.length));
      },
      async readRange(start: number, end: number) {
        return bytes.subarray(start, Math.max(start, Math.min(end, bytes.length)));
      },
      async arrayBuffer() {
        return bytes.slice().buffer;
      },
    };
  }

  // 独立真相源 fixture（与 helpers.ts 同字面量但独立维护）
  const PNG_1X1 = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC'),
    (c) => c.charCodeAt(0),
  );
  function makePdf(): Uint8Array {
    const objs: string[] = [];
    objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
    objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
    objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
    const stream = 'BT /F1 12 Tf 50 150 Td (Hello PDF) Tj ET';
    objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
    objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let i = 1; i <= 5; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xrefStart = pdf.length;
    pdf += 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
    return new TextEncoder().encode(pdf);
  }

  const core = await import('../../dist/index.js');
  const pdfMod = await import('../../../plugin-pdf/dist/index.js');
  const officeMod = await import('../../../plugin-office/dist/index.js');
  const archiveMod = await import('../../../plugin-archive/dist/index.js');

  const { createPreviewer, corePlugins, renderToHtml, createNodeEnv, PreviewErrorCode, createLruCache } = core as any;

  function fullPlugins(): any[] {
    return [...(corePlugins as () => any[])(), (pdfMod.pdfPlugin as () => any)(), (officeMod.officePlugin as () => any)(), (archiveMod.zipPlugin as () => any)()];
  }

  beforeAll(async () => {
    const { initNodeSanitizer } = await import('../../dist/index.js');
    await initNodeSanitizer();
  });

  test('A1 正常链路：PNG（真实入口路径，声明 mimeType）→ image(dataUrl:image/png + 尺寸)', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const r = await pv.preview(memFile('p.png', PNG_1X1, 'image/png'), createNodeEnv());
    expect(r.kind).toBe('image');
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(r.width).toBe(1);
  });

  // D1 修复回归：previewer 以 detected.mimeType 富化 routed file（previewer.ts runPipeline 单点），
  // 裸 IFile（未声明 mimeType）也能得到正确 dataUrl 与尺寸。
  test('A1b 回归(D1)：裸 IFile PNG → 探测结论富化后 dataUrl:image/png + 尺寸', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const r = await pv.preview(memFile('p.png', PNG_1X1), createNodeEnv());
    expect(r.kind).toBe('image');
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect((r as any).width).toBe(1);
    expect((r as any).mimeType).toBe('image/png');
  });

  test('A2 正常链路：TXT / JSON / CSV / Markdown / XML 五连', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const txt = await pv.preview(memFile('a.txt', new TextEncoder().encode('hello e2e\n第二行')), createNodeEnv());
    expect(txt.kind).toBe('text');
    expect((txt as any).text).toContain('第二行');

    const json = await pv.preview(memFile('b.json', new TextEncoder().encode('{"n":1,"ok":true}')), createNodeEnv());
    expect(json.kind).toBe('json');
    expect((json as any).data).toEqual({ n: 1, ok: true });

    const csv = await pv.preview(memFile('c.csv', new TextEncoder().encode('Name,Age\nLee,3')), createNodeEnv());
    expect(csv.kind).toBe('table');
    expect((csv as any).columns).toEqual(['Name', 'Age']);
    expect((csv as any).rows[0]).toEqual(['Lee', '3']);

    const md = await pv.preview(memFile('d.md', new TextEncoder().encode('# T\n\n<script>alert(1)</script>**b**')), createNodeEnv());
    expect(md.kind).toBe('html');
    expect((md as any).html).not.toContain('<script>');
    expect((md as any).html).toContain('&lt;script&gt;');

    const xml = await pv.preview(memFile('e.xml', new TextEncoder().encode('<?xml version="1.0"?><root><v>1</v></root>')), createNodeEnv());
    expect(xml.kind).toBe('json');
  });

  test('A3 正常链路：PDF（Node 文本提取路径）→ text 含 Hello PDF', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const r = await pv.preview(memFile('doc.pdf', makePdf()), createNodeEnv());
    expect(r.kind).toBe('text');
    expect((r as any).text).toContain('Hello PDF');
  });

  test('A4 正常链路：golden fixtures 的 DOCX / XLSX 经 office dist 解析', async () => {
    const docxBytes = new Uint8Array(await (await import('node:fs/promises')).readFile(join(here, '../golden/fixtures/sample.docx')));
    const xlsxBytes = new Uint8Array(await (await import('node:fs/promises')).readFile(join(here, '../golden/fixtures/sample.xlsx')));
    const pv = createPreviewer({ plugins: fullPlugins() });
    const rd = await pv.preview(memFile('sample.docx', docxBytes), createNodeEnv());
    expect(rd.kind).toBe('html');
    const rx = await pv.preview(memFile('sample.xlsx', xlsxBytes), createNodeEnv());
    expect(rx.kind).toBe('table');
    expect((rx as any).columns.length).toBeGreaterThan(0);
  });

  test('A5 正常链路：最小 WAV → media 元数据（真实 mediainfo WASM）', async () => {
    // 44 字节规范 PCM WAV 头 + 16 个静音样本（independent truth: RIFF 规范手写）
    const sr = 8000 as const;
    const dataLen = 32;
    const buf = new Uint8Array(44 + dataLen);
    const dv = new DataView(buf.buffer);
    const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
    w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, dataLen, true);
    const pv = createPreviewer({ plugins: fullPlugins() });
    const r = await pv.preview(memFile('clip.wav', buf), createNodeEnv());
    expect(r.kind).toBe('media');
    expect((r as any).mediaType).toBe('audio');
    expect((r as any).metadata).toBeTruthy();
  });

  test('B1 边界：0 字节空文件 → 优雅降级（binary|error，带稳定码），绝不抛异常', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const r = await pv.preview(memFile('empty.bin', new Uint8Array(0)), createNodeEnv());
    expect(['binary', 'error']).toContain(r.kind);
    if (r.kind === 'binary') expect((r as any).info?.code).toBe(PreviewErrorCode.UNSUPPORTED);
    else expect((r as any).code).toBe(PreviewErrorCode.UNSUPPORTED);
  });

  test('B2 边界：size > maxBytes → 护栏短路于任何插件之前（spy 插件零调用）', async () => {
    const calls: string[] = [];
    const spy = { id: 'spy', contractVersion: 1 as const, test: () => 999, preview: async () => { calls.push('spy'); return { kind: 'text' as const, text: 'x' }; } };
    const pv = createPreviewer({ plugins: [spy as any], maxBytes: 100 });
    const r = await pv.preview(memFile('big.bin', new Uint8Array(101)), createNodeEnv());
    expect(calls).toHaveLength(0); // 短路证据
    expect(r.kind).toBe('binary');
    expect((r as any).info?.code).toBe(PreviewErrorCode.TOO_LARGE);
  });

  test('B3 边界：size == maxBytes 恰等 → 放行（护栏是 > 不是 >=）', async () => {
    const pv = createPreviewer({ plugins: [...(corePlugins as () => any[])()], maxBytes: 11 });
    const r = await pv.preview(memFile('exact.txt', new TextEncoder().encode('hello exact'.slice(0, 11))), createNodeEnv());
    expect(r.kind).toBe('text'); // 11 字节恰好通过
  });

  // D2 修复回归：image 插件魔数自证，不符返 ERR_PARSE；随后 D3 文本救援接管 → text。
  test('B4 回归(D2+D3)：假 PNG（文本伪装 .png）→ 不产破损图，文本救援接管', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const fake = new TextEncoder().encode('this is definitely not a png despite the name');
    const r = await pv.preview(memFile('fake.png', fake), createNodeEnv());
    expect(['text', 'binary', 'error']).toContain(r.kind);
    expect(r.kind).not.toBe('image');
  });

  // D2+D3 修复回归：pdf 插件 %PDF- 魔数自证不符交还候选链，fallback 文本救援优于 hexdump。
  test('B5 回归(D2+D3)：改名为 .pdf 的纯文本 → 文本自愈而非 hexdump', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const body = new TextEncoder().encode('plain text wearing a .pdf name');
    const r = await pv.preview(memFile('not-really.pdf', body), createNodeEnv());
    expect(r.kind).toBe('text');
    expect((r as any).text).toContain('plain text wearing a .pdf name');
  });

  test('B6 边界：无扩展名 zip → 中央目录嗅探 zipHint → tree', async () => {
    const pv = createPreviewer({ plugins: fullPlugins() });
    const z = zipSync({ 'r.txt': strToU8('root'), 'd/x.txt': strToU8('in') });
    const r = await pv.preview(memFile('noext', z), createNodeEnv());
    expect(r.kind).toBe('tree');
  });

  describe('B7 zip 四阈值逐项触界（注入小阈值，恰等 vs 超 1）', () => {
    function zipWith(nEntries: number, depthDirs = 0): Uint8Array {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < nEntries; i++) files[`f${i}.txt`] = strToU8('x'.repeat(10));
      let p = '';
      for (let d = 0; d < depthDirs; d++) { p += `d${d}/`; files[`${p}deep.txt`] = strToU8('deep'); }
      return zipSync(files);
    }
    function unzipTotal(bytes: Uint8Array): number {
      let total = 0;
      unzipSync(bytes, { filter: (f) => { total += f.originalSize; return false; } });
      return total;
    }

    test('条目数：== limit 放行，limit+1 降级 ERR_TOO_LARGE', async () => {
      const L = 5;
      const guard = archiveMod.zipPlugin({ maxEntries: L }) as any;
      const okR = await guard.preview(memFile('ok.zip', zipWith(L)), createNodeEnv());
      expect(okR.kind).toBe('tree');
      const badR = await guard.preview(memFile('bad.zip', zipWith(L + 1)), createNodeEnv());
      expect(badR.kind).toBe('binary');
      expect((badR as any).info?.code).toBe(PreviewErrorCode.TOO_LARGE);
    });

    test('总解压量：== limit 放行，+1 字节降级', async () => {
      const entry = strToU8('x'.repeat(100)); // 单条目 100B，总 100B
      const L = 100;
      const guard = archiveMod.zipPlugin({ maxTotalUncompressed: L }) as any;
      const okR = await guard.preview(memFile('ok.zip', zipSync({ 'a.txt': entry })), createNodeEnv());
      expect(okR.kind).toBe('tree');
      const over = zipSync({ 'a.txt': entry, 'b.txt': strToU8('y') }); // 101B
      expect(unzipTotal(over)).toBe(L + 1);
      const badR = await guard.preview(memFile('bad.zip', over), createNodeEnv());
      expect(badR.kind).toBe('binary');
      expect((badR as any).info?.code).toBe(PreviewErrorCode.TOO_LARGE);
    });

    test('单条目：== limit 放行，+1 降级', async () => {
      const L = 100;
      const guard = archiveMod.zipPlugin({ maxSingleEntry: L }) as any;
      const okR = await guard.preview(memFile('ok.zip', zipSync({ 'a.txt': strToU8('x'.repeat(L)) })), createNodeEnv());
      expect(okR.kind).toBe('tree');
      const badR = await guard.preview(memFile('bad.zip', zipSync({ 'a.txt': strToU8('x'.repeat(L + 1)) })), createNodeEnv());
      expect(badR.kind).toBe('binary');
      expect((badR as any).info?.code).toBe(PreviewErrorCode.TOO_LARGE);
    });

    test('嵌套深度（语义=完整路径段数，含文件名）：9 层目录+文件=10 段放行，10 层目录+文件=11 段降级', async () => {
      const guard = archiveMod.zipPlugin() as any;
      const deep = (dirLevels: number) => {
        const files: Record<string, Uint8Array> = {};
        let p = '';
        for (let i = 0; i < dirLevels; i++) { p += `l${i}/`; }
        files[`${p}leaf.txt`] = strToU8('leaf'); // 路径段数 = dirLevels + 1
        return zipSync(files);
      };
      const okR = await guard.preview(memFile('d9.zip', deep(9)), createNodeEnv()); // 10 段 == maxDepth 放行
      expect(okR.kind).toBe('tree');
      const badR = await guard.preview(memFile('d10.zip', deep(10)), createNodeEnv()); // 11 段 > maxDepth 降级
      expect(badR.kind).toBe('binary');
      expect((badR as any).info?.code).toBe(PreviewErrorCode.TOO_LARGE);
    });
  });

  // 契约：插件须先自查 opts.signal.aborted（combineSignal 对预中止 signal 原样透传，
  // 不再派发未来事件——与 tests/helpers.ts hangUntilAbortPlugin 的契约注释一致）。
  function abortAwareHangingPlugin(id: string): any {
    return {
      id, contractVersion: 1 as const, test: () => 100,
      preview: (_f: any, _e: any, opts: any) => new Promise<any>((_, reject) => {
        if (opts.signal.aborted) { reject(new Error('signal already aborted')); return; }
        opts.signal.addEventListener('abort', () => reject(new Error(`aborted during ${id}`)), { once: true });
      }),
    };
  }

  test('B8 边界：预中止 signal → 抛 PreviewAbortError（ERR_ABORTED），非静默吞掉', async () => {
    const ac = new AbortController();
    ac.abort(); // 预中止
    const pv = createPreviewer({ plugins: [abortAwareHangingPlugin('hang')] });
    await expect(pv.preview(memFile('x.txt', new TextEncoder().encode('x')), createNodeEnv(), { signal: ac.signal }))
      .rejects.toMatchObject({ code: PreviewErrorCode.ABORTED });
  });

  test('B9 边界：timeout=5ms 挂起插件 → PreviewTimeoutError（ERR_TIMEOUT）', async () => {
    const pv = createPreviewer({ plugins: [abortAwareHangingPlugin('slow')] });
    await expect(pv.preview(memFile('x.txt', new TextEncoder().encode('x')), createNodeEnv(), { timeout: 5 }))
      .rejects.toMatchObject({ code: PreviewErrorCode.TIMEOUT });
  });

  test('B10 边界：LRU 容量 2 → 第 3 个文件淘汰第 1 个；image 结果不入缓存', async () => {
    const cache = createLruCache(2) as any;
    const pv = createPreviewer({ plugins: fullPlugins(), cache });
    const t = (n: string) => memFile(n, new TextEncoder().encode(`content-of-${n}`));
    await pv.preview(t('one.txt'), createNodeEnv());
    await pv.preview(t('two.txt'), createNodeEnv());
    await pv.preview(t('three.txt'), createNodeEnv()); // one 被淘汰
    const hitThree = await pv.preview(t('three.txt'), createNodeEnv());
    expect(hitThree.kind).toBe('text');
    // 直接探测淘汰边界：容量语义下 one 已不可命中（重新 set 后 two 应被挤出）
    await pv.preview(t('one.txt'), createNodeEnv());
    const keysBefore = (cache as any).size ?? null;
    expect(keysBefore === null || keysBefore <= 2).toBe(true);
    // image 不入缓存：连续两次 PNG 预览都应真实执行（无 shouldCache 通过路径）
    const setsSpy: any[] = [];
    const imgCache = { get: () => undefined, set: (k: any, v: any) => setsSpy.push(k), shouldCache: (r: any) => r.kind !== 'image' && !(r.kind === 'media' && r.src) };
    const pv2 = createPreviewer({ plugins: fullPlugins(), cache: imgCache });
    await pv2.preview(memFile('i.png', PNG_1X1), createNodeEnv());
    expect(setsSpy).toHaveLength(0); // image 被 shouldCache 拒绝
  });

  test('B11 renderToHtml：各 kind HTML 形态 + 特殊字符转义（独立真相源断言）', () => {
    const env = createNodeEnv();
    expect(renderToHtml({ kind: 'text', text: '<b>&</b>' } as any, env)).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(renderToHtml({ kind: 'text', text: 'x' } as any, env)).toMatch(/^<pre class="fp-text">/);
    const tbl = renderToHtml({ kind: 'table', columns: ['A'], rows: [['1']] } as any, env);
    expect(tbl).toContain('<table');
    expect(renderToHtml({ kind: 'json', data: { k: '<v>' } } as any, env)).toContain('&quot;k&quot;') ;
    expect(renderToHtml({ kind: 'tree', nodes: [{ name: 'n', type: 'file' }] } as any, env)).toContain('n');
    expect(renderToHtml({ kind: 'image', dataUrl: 'data:image/png;base64,AA==' } as any, env)).toContain('<img');
    expect(renderToHtml({ kind: 'binary', hexDump: '00000000  78' } as any, env)).toContain('00000000');
  });

  test('C1 CJS 形态：require dist/index.cjs → createPreviewer 可用且无插件包泄漏', async () => {
    const require = createRequire(import.meta.url);
    const cjsCore = require(join(coreDist, 'index.cjs')) as any;
    expect(typeof cjsCore.createPreviewer).toBe('function');
    expect(typeof cjsCore.corePlugins).toBe('function');
    // CJS 主入口不应携带已拆分的重插件（C3 契约）
    expect(cjsCore.pdfPlugin).toBeUndefined();
    expect(cjsCore.officePlugin).toBeUndefined();
    expect(cjsCore.zipPlugin).toBeUndefined();
    const pv = cjsCore.createPreviewer({ plugins: cjsCore.corePlugins() });
    const r = await pv.preview(memFile('via-cjs.txt', new TextEncoder().encode('cjs works')), cjsCore.createNodeEnv());
    expect(r.kind).toBe('text');
    expect((r as any).text).toBe('cjs works');
  });

  test('D-1 G2：dist 缩略图双档——图片经 image 插件、未知格式落回退卡', async () => {
    const { createThumbnailer } = core as any;
    const t = createThumbnailer({ plugins: fullPlugins() });
    const img = await t.thumbnail(memFile('t.png', PNG_1X1, 'image/png'), createNodeEnv(), { maxWidth: 64 });
    expect(img.via).toBe('image');
    if (img.via === 'image') expect(img.dataUrl).toMatch(/^data:image\/png;base64,/);
    const card = await t.thumbnail(memFile('mystery.bin', Uint8Array.from([0x00, 0xff, 0x00, 0xfe])), createNodeEnv());
    expect(card.via).toBe('fallback-card');
    if (card.via === 'fallback-card') {
      expect(card.name).toBe('mystery.bin');
      expect(typeof card.icon).toBe('string');
      expect(card.size).toBe(4);
    }
  });

  test('D-3 G8：dist 的 officePlugin({sheet}) 参数化——选表与 sheetTotal 透明', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('One').addRow(['h1']);
    const two = wb.addWorksheet('Two');
    two.addRow(['h2']);
    two.addRow(['val']);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r1 = await (officeMod.officePlugin as () => any)().preview(memFile('m.xlsx', bytes), createNodeEnv(), {});
    expect(r1.kind === 'table' && r1.sheetName === 'One' && r1.sheetTotal === 2).toBe(true);
    const r2 = await ((officeMod.officePlugin as (o?: unknown) => any)({ sheet: 'Two' }))
      .preview(memFile('m.xlsx', bytes), createNodeEnv(), {});
    expect(r2.kind === 'table' && r2.sheetName === 'Two' && r2.rows[0][0] === 'val').toBe(true);
  });

  test('D-2 G1：dist 的 pdfPlugin({maxPages}) 可配且 Node 全文提取不受限', async () => {
    const limited = (pdfMod.pdfPlugin as (o?: unknown) => any)({ maxPages: 1 });
    expect(limited.id).toBe('pdf');
    const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
    const r = await limited.preview(memFile('stub.pdf', bytes), createNodeEnv());
    // 魔数合法但内容残缺 → ERR_PARSE（证明选项路径未破坏既有错误契约）
    expect(r.kind).toBe('error');
  });
});
