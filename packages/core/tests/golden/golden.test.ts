// golden-file 回归测试套件（方案 §12 —— 「每种格式的输入 → 期望 PreviewResult」长期护栏）。
//
// 约定：
// - 全部经 createPreviewer({ plugins: corePlugins() }) + nodeAdapter 驱动（对齐 archive/smoke 用例）。
// - png/txt/pdf/zip 复用 packages/core/examples/browser/fixtures/ 既有真实文件；
//   md/csv/json 由用例内联生成；docx/xlsx 为本目录 fixtures/ 下提交的确定性最小样本
//   （由 gen-fixtures.mjs 生成，可随时重跑再生）。
// - 确定性格式（text/table/tree/json）用精确断言；docx 的 mammoth HTML 可能随依赖版本漂移，
//   使用 toMatchSnapshot() 固化。快照漂移时的更新方式：npx vitest run -u tests/golden
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPreviewer } from '../../src/previewer.ts';
import { corePlugins } from '../../src/plugins/index.ts';
import { allPlugins } from '../helpers.ts';
import { nodeAdapter, initNodeSanitizer } from '../../src/env.ts';
import { memFile } from '../helpers.ts';
import type { Previewer } from '../../src/previewer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_FIXTURES = join(here, '..', '..', 'examples', 'browser', 'fixtures');
const GOLDEN_FIXTURES = join(here, 'fixtures');

const readFixture = (dir: string, name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(dir, name)));

let previewer: Previewer;

beforeAll(async () => {
  await initNodeSanitizer();
  previewer = createPreviewer({ plugins: allPlugins() });
});

describe('golden-file · image/png', () => {
  it('logo.png（带 mimeType 提示，对齐浏览器 File 现实）→ image/png Data URL + 1×1 尺寸', async () => {
    const r = await previewer.preview(
      memFile('logo.png', readFixture(EXAMPLE_FIXTURES, 'logo.png'), 'image/png'),
      nodeAdapter,
    );
    expect(r.kind).toBe('image');
    if (r.kind !== 'image') return;
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(r.mimeType).toBe('image/png');
    // 最小 PNG 为 1×1：尺寸抽取仅在 mime === image/png 时启用（image.ts pngSize）
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it('logo.png（无提示）→ D1 修复后消费探测结论：dataUrl 为 image/png', async () => {
    // D1 修复（previewer 以 detected.mimeType 富化 routed file）落地，
    // 按本用例原注释的约定同步更新：裸 IFile 也能得到正确 MIME。
    const r = await previewer.preview(memFile('logo.png', readFixture(EXAMPLE_FIXTURES, 'logo.png')), nodeAdapter);
    expect(r.kind).toBe('image');
    if (r.kind !== 'image') return;
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(r.mimeType).toBe('image/png');
    expect(r.width).toBe(1);
  });
});

describe('golden-file · text/plain', () => {
  it('hello.txt → kind:text，中英文内容无损', async () => {
    const r = await previewer.preview(memFile('hello.txt', readFixture(EXAMPLE_FIXTURES, 'hello.txt')), nodeAdapter);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('Hello file-preview-kit!');
    expect(r.text).toContain('第二行中文测试。');
    expect(r.language).toBeUndefined();
  });
});

describe('golden-file · markdown', () => {
  it('md → kind:html，标题与加粗渲染正确', async () => {
    const bytes = new TextEncoder().encode('# 标题 Golden\n\n**bold** 文本\n');
    const r = await previewer.preview(memFile('note.md', bytes), nodeAdapter);
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('<h1>标题 Golden</h1>');
    expect(r.html).toContain('<strong>bold</strong>');
  });
});

describe('golden-file · csv', () => {
  it('csv → kind:table，表头 + 字符串行（papaparse header:false 约定）', async () => {
    const bytes = new TextEncoder().encode('name,score\nalice,1\nbob,2\n');
    const r = await previewer.preview(memFile('scores.csv', bytes), nodeAdapter);
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.columns).toEqual(['name', 'score']);
    expect(r.rows).toEqual([
      ['alice', '1'],
      ['bob', '2'],
    ]);
  });
});

describe('golden-file · json', () => {
  it('json → kind:json，结构还原一致', async () => {
    const src = { kit: 'golden', n: 2, tags: ['a', 'b'], nested: { ok: true, nil: null } };
    const bytes = new TextEncoder().encode(JSON.stringify(src));
    const r = await previewer.preview(memFile('data.json', bytes), nodeAdapter);
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') return;
    expect(r.data).toEqual(src);
  });
});

describe('golden-file · office/docx', () => {
  // mammoth HTML 允许随依赖版本漂移：内容断言精确，整体结构用快照固化。
  it('sample.docx → kind:html，段落文本完整', async () => {
    const r = await previewer.preview(memFile('sample.docx', readFixture(GOLDEN_FIXTURES, 'sample.docx')), nodeAdapter);
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('Hello DOCX golden');
    expect(r.html).toContain('第二段中文段落');
    expect(r.html).toMatchSnapshot('docx-golden-html');
  });
});

describe('golden-file · office/xlsx', () => {
  it('sample.xlsx → kind:table，columns/rows/sheetName 与工作簿一致', async () => {
    const r = await previewer.preview(memFile('sample.xlsx', readFixture(GOLDEN_FIXTURES, 'sample.xlsx')), nodeAdapter);
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.sheetName).toBe('Golden');
    expect(r.columns).toEqual(['name', 'score']);
    expect(r.rows).toEqual([
      ['alice', 1],
      ['bob', 2],
    ]);
  });
});

describe('golden-file · pdf', () => {
  it('hello.pdf → kind:text，提取文本含 Hello PDF 与页标', async () => {
    const r = await previewer.preview(memFile('hello.pdf', readFixture(EXAMPLE_FIXTURES, 'hello.pdf')), nodeAdapter);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('Hello PDF');
    expect(r.text).toContain('第 1 页');
    expect(r.language).toBe('pdf');
  });
});

describe('golden-file · zip', () => {
  it('sample.zip → kind:tree，目录嵌套与条目尺寸确定', async () => {
    const r = await previewer.preview(memFile('sample.zip', readFixture(EXAMPLE_FIXTURES, 'sample.zip')), nodeAdapter);
    expect(r.kind).toBe('tree');
    if (r.kind !== 'tree') return;
    expect(r.nodes).toEqual([
      { name: 'd', type: 'dir', children: [{ name: 'x.txt', type: 'file', size: 2 }] },
      { name: 'r.txt', type: 'file', size: 4 },
    ]);
  });
});
