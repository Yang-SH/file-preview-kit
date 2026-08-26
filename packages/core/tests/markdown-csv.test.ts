// markdown→html / csv→table 渲染器回归（方案 §5.5 / §13 阶梯 2 收尾）。
// 覆盖：渲染正确性、XSS 转义（html:false 第一层 + sanitize 第二层）、CSV 边界（引号/换行/空文件/截断）、
// 路由优先级（110 > text 100，失败降级纯文本）、worker 集包含、renderToHtml 输出。
import { describe, it, expect, beforeAll } from 'vitest';
import { createPreviewer, runPipeline } from '../src/previewer.ts';
import { nodeAdapter, initNodeSanitizer } from '../src/env.ts';
import { renderToHtml } from '../src/render.ts';
import { markdownPlugin } from '../src/plugins/markdown.ts';
import { csvPlugin } from '../src/plugins/csv.ts';
import { textPlugin } from '../src/plugins/text.ts';
import { corePlugins, workerPlugins } from '../src/plugins/index.ts';
import { memFile } from './helpers.ts';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const plugins = () => [markdownPlugin(), csvPlugin(), textPlugin()];

beforeAll(async () => {
  await initNodeSanitizer();
});

describe('markdown → html（markdown-it，html:false）', () => {
  it('标题/加粗/列表/代码块渲染为对应 HTML', async () => {
    const src = '# 标题一\n\n**加粗** 与 `code`\n\n- 项目甲\n- 项目乙\n';
    const r = await markdownPlugin().preview(memFile('doc.md', utf8(src)), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('<h1>标题一</h1>');
    expect(r.html).toContain('<strong>加粗</strong>');
    expect(r.html).toContain('<code>code</code>');
    expect(r.html).toContain('<ul>');
    expect(r.html).toContain('<li>项目甲</li>');
    expect(r.title).toBe('doc.md');
  });

  it('源码内联 HTML 被转义（html:false 纵深防御第一层）', async () => {
    const src = '正文\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n';
    const r = await markdownPlugin().preview(memFile('evil.md', utf8(src)), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    // 无「标签位置」的可执行构造；转义文本（&lt;...&gt;）无害且应保留
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('渲染层 sanitize 二次兜底：md 输出经 env.sanitize 后仍无脚本', async () => {
    const src = '<div onclick="x()">hi</div>\n\n<script>alert(1)</script>\n';
    const r = await markdownPlugin().preview(memFile('evil2.md', utf8(src)), nodeAdapter, {});
    if (r.kind !== 'html') return expect.fail('expected html');
    const clean = nodeAdapter.sanitize(r.html);
    expect(clean).not.toMatch(/<script/i);
    // 只断言「真实开标签内」无 on* 事件属性；转义文本中的 onclick 字样无害
    expect(clean).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect(clean).toContain('hi');
  });

  it('linkify：裸 URL 自动成链', async () => {
    const r = await markdownPlugin().preview(memFile('l.md', utf8('see https://example.com now')), nodeAdapter, {});
    if (r.kind !== 'html') return expect.fail('expected html');
    expect(r.html).toContain('<a href="https://example.com"');
  });
});

describe('csv → table（papaparse，首行表头）', () => {
  it('基础解析：columns/rows 精确', async () => {
    const r = await csvPlugin().preview(memFile('data.csv', utf8('Name,Age\nAlice,30\nBob,25\n')), nodeAdapter, {});
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.columns).toEqual(['Name', 'Age']);
    expect(r.rows).toEqual([['Alice', '30'], ['Bob', '25']]);
  });

  it('引号内逗号与引号内换行', async () => {
    const src = 'a,b\n"1,5","line1\nline2"\n';
    const r = await csvPlugin().preview(memFile('q.csv', utf8(src)), nodeAdapter, {});
    if (r.kind !== 'table') return expect.fail('expected table');
    expect(r.rows).toEqual([['1,5', 'line1\nline2']]);
  });

  it('仅表头 → rows 为空；空文件 → 全空', async () => {
    const headerOnly = await csvPlugin().preview(memFile('h.csv', utf8('H1,H2\n')), nodeAdapter, {});
    expect(headerOnly.kind).toBe('table');
    if (headerOnly.kind === 'table') {
      expect(headerOnly.columns).toEqual(['H1', 'H2']);
      expect(headerOnly.rows).toEqual([]);
    }
    const empty = await csvPlugin().preview(memFile('e.csv', utf8('')), nodeAdapter, {});
    expect(empty).toEqual({ kind: 'table', columns: [], rows: [] });
  });

  it('超过 1000 行截断（与 xlsx 同策略）', async () => {
    const lines = ['idx,name'];
    for (let i = 0; i < 1500; i++) lines.push(`${i},n${i}`);
    const r = await csvPlugin().preview(memFile('big.csv', utf8(lines.join('\n'))), nodeAdapter, {});
    if (r.kind !== 'table') return expect.fail('expected table');
    expect(r.rows.length).toBe(1000);
    expect(r.rows[999][0]).toBe('999');
  });

  it('renderToHtml 输出表格结构', async () => {
    const r = await csvPlugin().preview(memFile('t.csv', utf8('X,Y\n1,2\n')), nodeAdapter, {});
    if (r.kind !== 'table') return expect.fail('expected table');
    const html = renderToHtml(r, nodeAdapter);
    expect(html).toContain('<table class="fp-table">');
    expect(html).toContain('<th>X</th>');
    expect(html).toContain('<td>1</td>');
  });
});

describe('路由优先级与降级链（110 > text 100）', () => {
  it('.md / .csv 由专用插件接管，.txt 仍走 text', async () => {
    const pv = createPreviewer({ plugins: plugins() });
    const md = await pv.preview(memFile('a.md', utf8('# hi')), nodeAdapter);
    expect(md.kind).toBe('html');
    const csv = await pv.preview(memFile('b.csv', utf8('A\n1\n')), nodeAdapter);
    expect(csv.kind).toBe('table');
    const txt = await pv.preview(memFile('c.txt', utf8('plain')), nodeAdapter);
    expect(txt.kind).toBe('text');
  });

  it('全默认插件集下路由不变', async () => {
    const pv = createPreviewer({ plugins: corePlugins() });
    const md = await pv.preview(memFile('readme.md', utf8('**b**')), nodeAdapter);
    expect(md.kind).toBe('html');
    const csv = await pv.preview(memFile('sheet.csv', utf8('K\n1\n')), nodeAdapter);
    expect(csv.kind).toBe('table');
  });

  it('markdown 插件缺席时降级为纯文本展示', async () => {
    const pv = createPreviewer({ plugins: [textPlugin()] }); // 无 markdown 插件
    const r = await pv.preview(memFile('d.md', utf8('# hi')), nodeAdapter);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain('# hi');
  });

  it('markdown 插件解析抛错时 runPipeline 降级到 text 插件', async () => {
    const broken = { ...markdownPlugin(), preview: async () => { throw new Error('boom'); } };
    const r = await runPipeline(memFile('e.md', utf8('# hi')), nodeAdapter, {}, [broken, textPlugin()]);
    expect(r.kind).toBe('text');
  });
});

describe('Worker 集成', () => {
  it('markdown/csv 进入 workerPlugins（纯 JS 可后台解析）', () => {
    const ids = workerPlugins().map((p) => p.id);
    expect(ids).toContain('markdown');
    expect(ids).toContain('csv');
  });

  it('runPipeline + workerPlugins 跑通 md/csv', async () => {
    const md = await runPipeline(memFile('w.md', utf8('# worker')), nodeAdapter, {}, workerPlugins());
    expect(md.kind).toBe('html');
    const csv = await runPipeline(memFile('w.csv', utf8('A\n1\n')), nodeAdapter, {}, workerPlugins());
    expect(csv.kind).toBe('table');
  });
});
