// 回归：zip / 老版 .doc 预览不再裸落十六进制视图（方案 §修复）。
// 全部走公共 preview() / renderToHtml() 接口（seam=公共 API），不依赖内部实现。
// 设计约束：真正未知的文件仍保持 binary 十六进制降级（既有契约不破坏）。
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createPreviewer } from '../src/previewer.ts';
import { renderToHtml } from '../src/render.ts';
import { nodeAdapter } from '../src/env.ts';
import { allPlugins, memFile } from './helpers.ts';
import type { PreviewResult } from '../src/types.ts';

const pv = () => createPreviewer({ plugins: allPlugins() });

// 老版 .doc：Word 97–2003，OLE2 复合文档魔数
function ole2Doc(): Uint8Array {
  const b = new Uint8Array(128);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return b;
}

describe('老版 .doc（Word 97–2003 / OLE2）→ 友好提示而非十六进制', () => {
  it('OLE2 魔数 + .doc 扩展名 → kind:error 且提示转存 .docx，不是 kind:binary', async () => {
    const r: PreviewResult = await pv().preview(memFile('sample.doc', ole2Doc()), nodeAdapter);
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_UNSUPPORTED');
    expect(r.message).toMatch(/\.docx/i);
  });
});

describe('zip 加固：头部非 PK 的包裹 zip 也能列目录', () => {
  it('前缀包裹/自解压 zip（头部非 PK，尾部有 EOCD）→ kind:tree 列出内部文件', async () => {
    const inner = zipSync({ 'a.txt': strToU8('hello'), 'sub/b.txt': strToU8('world') });
    // 前缀（如 EXE 桩）使本地头不在偏移 0
    const prepended = new Uint8Array(inner.length + 4);
    prepended.set([0x4d, 0x5a, 0x00, 0x00], 0);
    prepended.set(inner, 4);

    const r: PreviewResult = await pv().preview(memFile('sfx.zip', prepended), nodeAdapter);
    expect(r.kind).toBe('tree');
    if (r.kind !== 'tree') return;
    expect(r.nodes.length).toBeGreaterThan(0);
  });
});

describe('zip 加固：fflate 无法解析的损坏 zip → 友好提示而非十六进制', () => {
  it('中央目录损坏导致 unzipSync 抛错 → kind:error 友好提示，不是 kind:binary', async () => {
    const good = zipSync({ 'a.txt': strToU8('hello') });
    const corrupted = good.slice();
    // 翻转中段字节制造非法结构（保留头部 PK 魔数，保留尾部 EOCD）
    for (let i = 10; i < corrupted.length - 10; i++) corrupted[i] ^= 0xff;

    const r: PreviewResult = await pv().preview(memFile('broken.zip', corrupted), nodeAdapter);
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.message).toBeTruthy();
    expect(r.message).not.toMatch(/^\s*$/);
  });
});

describe('render：error 结果渲染为友好提示（非 JSON 默认分支、非十六进制）', () => {
  it('renderToHtml(error) 产出 fp-error 且含转存提示，不含 fp-hex', () => {
    const html = renderToHtml(
      { kind: 'error', code: 'ERR_UNSUPPORTED', message: '不支持老版 Word 97–2003 (.doc) 格式，请另存为 .docx 后再预览' },
      nodeAdapter,
    );
    expect(html).toContain('fp-error');
    expect(html).toContain('.docx');
    expect(html).not.toContain('fp-hex');
  });
});

describe('契约保留：真正未知/伪文件仍降级为十六进制（不回归）', () => {
  it('伪 .zip（非 PK 且无 EOCD）→ kind:binary 十六进制', async () => {
    const r: PreviewResult = await pv().preview(memFile('fake.zip', new Uint8Array([1, 2, 3, 4, 5])), nodeAdapter);
    expect(r.kind).toBe('binary');
  });
  it('未知二进制 → kind:binary 十六进制', async () => {
    const r: PreviewResult = await pv().preview(memFile('mystery.bin', Uint8Array.from([0, 1, 2, 3])), nodeAdapter);
    expect(r.kind).toBe('binary');
  });
});
