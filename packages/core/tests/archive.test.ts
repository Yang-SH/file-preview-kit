// zip 插件 + 炸弹四阈值回归（方案 §5.4 / §11 / §12）。
// 阈值 fixture 策略：真实 100MB/1000+ 样本不现实，改用 zipPlugin(limits) 注入小阈值构造超限样本，
// 并另设「默认阈值」用例（11 层深、1001 条目）验证生产默认值本身生效。
// 安全根基断言：filter 恒返 false 永不解压 —— 由「谎报尺寸的 zip 也只走清单路径」的设计保证（无法 OOM）。
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { zipPlugin, type ZipGuardLimits } from '@file-preview/plugin-archive';
import { createPreviewer, runPipeline } from '../src/previewer.ts';
import { nodeAdapter, initNodeSanitizer } from '../src/env.ts';
import { renderToHtml } from '../src/render.ts';
import { corePlugins, workerPlugins } from '../src/plugins/index.ts';
import { memFile, allPlugins } from './helpers.ts';
import type { PreviewResult } from '../src/types.ts';

const Z = 'application/zip';

function expectDegradeTooLarge(r: PreviewResult, reasonPart: string): void {
  expect(r.kind).toBe('binary');
  if (r.kind !== 'binary') return;
  expect(r.info?.code).toBe('ERR_TOO_LARGE');
  expect(String(r.info?.reason)).toContain(reasonPart);
  expect(r.hexDump).toBeTruthy();
}

describe('zip → tree 基础功能', () => {
  it('文件 + 嵌套目录构建 FileTreeNode 树', async () => {
    const bytes = zipSync({ 'a.txt': strToU8('hello'), 'sub/b.txt': strToU8('world') });
    const r = await zipPlugin().preview(memFile('x.zip', bytes), nodeAdapter, {});
    expect(r.kind).toBe('tree');
    if (r.kind !== 'tree') return;
    expect(r.nodes).toEqual([
      { name: 'a.txt', type: 'file', size: 5 },
      { name: 'sub', type: 'dir', children: [{ name: 'b.txt', type: 'file', size: 5 }] },
    ]);
  });

  it('显式目录条目（dir/）与隐式路径合并为同一 dir 节点', async () => {
    const bytes = zipSync({ 'dir/': new Uint8Array(0), 'dir/f.txt': strToU8('x'), 'dir/sub/g.txt': strToU8('y') });
    const r = await zipPlugin().preview(memFile('d.zip', bytes), nodeAdapter, {});
    if (r.kind !== 'tree') return expect.fail('expected tree');
    expect(r.nodes).toEqual([
      {
        name: 'dir',
        type: 'dir',
        children: [
          { name: 'f.txt', type: 'file', size: 1 },
          { name: 'sub', type: 'dir', children: [{ name: 'g.txt', type: 'file', size: 1 }] },
        ],
      },
    ]);
  });

  it('空 zip → 空 tree', async () => {
    const bytes = zipSync({});
    const r = await zipPlugin().preview(memFile('empty.zip', bytes), nodeAdapter, {});
    expect(r).toEqual({ kind: 'tree', nodes: [] });
  });

  it('损坏 zip（PK 头 + 垃圾）→ ERR_PARSE 错误结果', async () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x98, 0x97, 0x96]);
    const r = await zipPlugin().preview(memFile('bad.zip', garbage), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_PARSE');
  });

  it('opts 省略时不抛错（回归：onProgress 空安全，dist 探针实证的契约 bug）', async () => {
    const bytes = zipSync({ 'a.txt': strToU8('hello') });
    const r = await zipPlugin().preview(memFile('nopts.zip', bytes), nodeAdapter);
    expect(r.kind).toBe('tree');
  });
});

describe('炸弹四阈值（注入小阈值构造超限）', () => {
  it('条目数超限', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 4; i++) files[`f${i}.txt`] = strToU8('x');
    const r = await zipPlugin({ maxEntries: 3 }).preview(memFile('m.zip', zipSync(files)), nodeAdapter, {});
    expectDegradeTooLarge(r, 'entries');
  });

  it('解压后总大小超限', async () => {
    const bytes = zipSync({ 'big.txt': strToU8('x'.repeat(100)) });
    const r = await zipPlugin({ maxTotalUncompressed: 10 }).preview(memFile('t.zip', bytes), nodeAdapter, {});
    expectDegradeTooLarge(r, 'total uncompressed');
  });

  it('单条目超限（总量未超）', async () => {
    const bytes = zipSync({ 'a.txt': strToU8('x'.repeat(6)), 'b.txt': strToU8('y'.repeat(6)) });
    const r = await zipPlugin({ maxSingleEntry: 5, maxTotalUncompressed: 1000 }).preview(memFile('s.zip', bytes), nodeAdapter, {});
    expectDegradeTooLarge(r, 'single entry');
  });

  it('嵌套层数超限', async () => {
    const bytes = zipSync({ 'a/b/c.txt': strToU8('deep') });
    const r = await zipPlugin({ maxDepth: 2 }).preview(memFile('deep.zip', bytes), nodeAdapter, {});
    expectDegradeTooLarge(r, 'nesting depth');
  });
});

describe('默认阈值生效（生产配置，无注入）', () => {
  it('默认嵌套上限 10：11 层深降级', async () => {
    const deep = Array.from({ length: 11 }, (_, i) => `l${i + 1}`).join('/') + '/f.txt';
    const r = await zipPlugin().preview(memFile('deep.zip', zipSync({ [deep]: strToU8('x') })), nodeAdapter, {});
    expectDegradeTooLarge(r, 'nesting depth');
  });

  it('默认条目上限 1000：1001 条降级', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 1001; i++) files[`f${i}.txt`] = strToU8('x');
    const r = await zipPlugin().preview(memFile('many.zip', zipSync(files)), nodeAdapter, {});
    expectDegradeTooLarge(r, 'entries');
  });

  it('默认阈值内正常出树（深度语义 = 路径段数：9 层目录 + 文件 = 10 段不降级）', async () => {
    const ok = Array.from({ length: 9 }, (_, i) => `l${i + 1}`).join('/') + '/f.txt';
    const r = await zipPlugin().preview(memFile('ok.zip', zipSync({ [ok]: strToU8('x') })), nodeAdapter, {});
    expect(r.kind).toBe('tree');
  });
});

describe('路由互斥与集成', () => {
  it('archive 不接管 docx/xlsx/pptx（office 插件专属）', () => {
    const p = zipPlugin();
    const base = { fileName: 'f', header: new Uint8Array(4), mimeType: Z };
    expect(p.test({ ...base, zipHint: 'docx' })).toBe(0);
    expect(p.test({ ...base, zipHint: 'xlsx' })).toBe(0);
    expect(p.test({ ...base, zipHint: 'pptx' })).toBe(0);
    expect(p.test({ ...base, zipHint: 'zip' })).toBe(80);
    expect(p.test({ ...base, zipHint: null })).toBe(0);
  });

  it('全默认插件集：真实 .zip 经 detect → tree', async () => {
    const bytes = zipSync({ 'r.txt': strToU8('root'), 'd/x.txt': strToU8('in') });
    const pv = createPreviewer({ plugins: allPlugins() });
    const r = await pv.preview(memFile('real.zip', bytes), nodeAdapter);
    expect(r.kind).toBe('tree');
    if (r.kind !== 'tree') return;
    expect(r.nodes.length).toBe(2);
  });

  it('伪 .zip（非 PK 字节）无 zipHint → archive 让位 → UNSUPPORTED 降级', async () => {
    const pv = createPreviewer({ plugins: [zipPlugin()] });
    const r = await pv.preview(memFile('fake.zip', new Uint8Array([1, 2, 3, 4, 5])), nodeAdapter);
    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.info?.code).toBe('ERR_UNSUPPORTED');
  });

  it('runPipeline + workerPlugins 跑通 zip', async () => {
    const workerSet = [...workerPlugins(), zipPlugin()];
    expect(workerSet.map((p) => p.id)).toContain('archive');
    const r = await runPipeline(memFile('w.zip', zipSync({ 'w.txt': strToU8('worker zip') })), nodeAdapter, {}, workerSet);
    expect(r.kind).toBe('tree');
  });
});

describe('渲染', () => {
  it('renderToHtml 输出 fp-tree 结构', async () => {
    await initNodeSanitizer();
    const r = await zipPlugin().preview(memFile('v.zip', zipSync({ 'v.txt': strToU8('v') })), nodeAdapter, {});
    if (r.kind !== 'tree') return expect.fail('expected tree');
    const html = renderToHtml(r, nodeAdapter);
    expect(html).toContain('<pre class="fp-tree">');
    expect(html).toContain('v.txt');
  });
});
