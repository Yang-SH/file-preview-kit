// 缩略图 API 单测（G2 两档首发）：图片缩小 / 回退文字卡。
// 运行于 vitest node/jsdom 环境——无真实 canvas 时实现必须优雅降级（原图透传 / 回退卡），这本身就是被测契约。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createThumbnailer } from '../src/index.ts';
import { memFile } from './helpers.ts';
import { createNodeEnv } from '../src/index.ts';

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC'),
  (c) => c.charCodeAt(0),
);

describe('createThumbnailer（G2 两档首发）', () => {
  it('T1 未注册任何插件 → 回退文字卡（图标+文件名+大小+格式族）', async () => {
    const t = createThumbnailer({ plugins: [] });
    const r = await t.thumbnail(memFile('doc.xyz', new TextEncoder().encode('whatever')), createNodeEnv());
    expect(r.via).toBe('fallback-card');
    if (r.via !== 'fallback-card') return;
    expect(r.name).toBe('doc.xyz');
    expect(typeof r.icon).toBe('string');
    expect(r.size).toBe(8);
  });

  it('T2 图片 → via:image dataUrl；无 canvas 环境（jsdom/Node）降级为原图透传', async () => {
    const { imagePlugin } = await import('../src/index.ts');
    const t = createThumbnailer({ plugins: [imagePlugin()] });
    const r = await t.thumbnail(memFile('p.png', PNG_1X1, 'image/png'), createNodeEnv(), { maxWidth: 32 });
    expect(r.via).toBe('image');
    if (r.via !== 'image') return;
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('T3 魔数不符的假图片 → 不产缩略图，落回退卡', async () => {
    const { imagePlugin } = await import('../src/index.ts');
    const t = createThumbnailer({ plugins: [imagePlugin()] });
    const r = await t.thumbnail(memFile('fake.png', new TextEncoder().encode('not a png'), 'image/png'), createNodeEnv());
    expect(r.via).toBe('fallback-card');
  });

  it('T4 zip（archive 插件未实现 thumbnail）→ 回退文字卡而非崩溃', async () => {
    const { zipPlugin } = await import('@file-preview/plugin-archive');
    const t = createThumbnailer({ plugins: [zipPlugin()] });
    // 最小 PK 头样本即可触发 archive 路由
    const z = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const r = await t.thumbnail(memFile('a.zip', z), createNodeEnv());
    expect(r.via).toBe('fallback-card');
  });
});
