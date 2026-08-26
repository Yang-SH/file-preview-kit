// XML 插件回归（方案 §5.5 / §11 / todo D1）：
// ① .xml → kind:json 结构化解析（属性 + 文本），不再是纯文本兜底
// ② XXE 拒绝：DOCTYPE 内部/外部实体不展开（无文件读取、无实体炸弹）
// ③ malformed xml → 插件级 ERR_PARSE；管线级落回 textPlugin 纯文本兜底（router 契约）
// ④ 路由矩阵：显式命中 110 / 内容嗅探 60 / svg 不截胡 / zipHint 排除
import { describe, it, expect } from 'vitest';
import { xmlPlugin } from '../src/plugins/xml.ts';
import { imagePlugin } from '../src/plugins/image.ts';
import { createPreviewer } from '../src/previewer.ts';
import { nodeAdapter } from '../src/env.ts';
import { corePlugins } from '../src/plugins/index.ts';
import { memFile } from './helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const ctxBase = { fileName: 'f', header: new Uint8Array(4) };

describe('xml · 路由矩阵', () => {
  it('扩展名/MIME 显式命中 110；嗅探 60；svg 与 zipHint 排除', () => {
    const p = xmlPlugin();
    expect(p.test({ ...ctxBase, extension: 'xml' } as never)).toBe(110);
    expect(p.test({ ...ctxBase, mimeType: 'application/xml' } as never)).toBe(110);
    expect(p.test({ ...ctxBase, mimeType: 'text/xml' } as never)).toBe(110);
    expect(p.test({ ...ctxBase, mimeType: 'application/xhtml+xml' } as never)).toBe(110);
    // svg 归 image 插件：<img> 模式天然安全，不被 +xml 后缀规则截胡
    expect(p.test({ ...ctxBase, mimeType: 'image/svg+xml' } as never)).toBe(0);
    // zip 家族不是纯 XML
    expect(p.test({ ...ctxBase, zipHint: 'docx' } as never)).toBe(0);
    // 无扩展名改名：头部 <?xml 嗅探
    const head = new TextEncoder().encode('<?xml version="1.0"?><r/>');
    expect(p.test({ fileName: 'f', header: head } as never)).toBe(60);
    // 非	xml 头部不命中
    expect(p.test({ fileName: 'f', header: enc('<html>') } as never)).toBe(0);
  });

  it('svg 全默认插件集仍出 image（互斥集成）', async () => {
    const svg = enc('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect/></svg>');
    const pv = createPreviewer({ plugins: corePlugins() });
    const r = await pv.preview(memFile('icon.svg', svg), nodeAdapter, {});
    expect(r.kind).toBe('image');
    expect(imagePlugin().test({ ...ctxBase, extension: 'svg', mimeType: 'image/svg+xml' } as never)).toBe(100);
  });
});

describe('xml · 结构化解析', () => {
  it('.xml → kind:json，元素/属性/文本值还原（fast-xml-parser 形状契约）', async () => {
    const src =
      '<?xml version="1.0"?><root><item id="1">A</item><item>2</item><flag>true</flag></root>';
    const r = await createPreviewer({ plugins: corePlugins() }).preview(memFile('data.xml', enc(src)), nodeAdapter, {});
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') return;
    const root = (r.data as { root: Record<string, unknown> }).root;
    const items = root.item as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0]['@id']).toBe(1); // 属性数值化
    expect(items[0]['#text']).toBe('A'); // 有属性的元素文本走 #text
    expect(items[1]).toBe(2); // 纯文本元素直接数值化
    expect(root.flag).toBe(true);
  });

  it('内联字符实体照常处理（processEntities）', async () => {
    const src = '<r><t>a &amp; b &lt;c&gt;</t></r>';
    const r = await xmlPlugin().preview(memFile('e.xml', enc(src)), nodeAdapter, {});
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') return;
    expect((r.data as { r: { t: string } }).r.t).toBe('a & b <c>');
  });
});

describe('xml · XXE 安全（方案 §11）', () => {
  it('DOCTYPE 内部实体不展开：自定义实体保留字面量，注入标记不得出现', async () => {
    const src =
      '<?xml version="1.0"?>' +
      '<!DOCTYPE r [<!ENTITY xxe "INJECTED-MARKER<script>alert(1)</script>">]>' +
      '<r>&xxe;</r>';
    const pv = createPreviewer({ plugins: corePlugins() });
    const r = await pv.preview(memFile('xxe.xml', enc(src)), nodeAdapter, {});
    // 实体未被展开 → 输出不包含标记内容；解析本身不因 DOCTYPE 失败
    const raw = JSON.stringify(r);
    expect(raw).not.toContain('INJECTED-MARKER');
    expect(raw).not.toContain('<script>');
  });

  it('外部实体（file://）不读取：目标内容不可能出现于输出', async () => {
    const src =
      '<?xml version="1.0"?>' +
      '<!DOCTYPE r [<!ENTITY f SYSTEM "file:///C:/Windows/win.ini">]>' +
      '<r>&f;</r>';
    const r = await xmlPlugin().preview(memFile('xxe-file.xml', enc(src)), nodeAdapter, {});
    expect(r.kind).toBe('json');
    const raw = JSON.stringify(r);
    // win.ini 的 [fonts] 段不可能出现；实体名保留为字面量或值为空
    expect(raw.includes('[fonts]')).toBe(false);
    expect(raw.includes('&f;') || !(r as { data?: { r?: string } }).data?.r).toBeTruthy();
  });

  it('实体嵌套（十亿笑话缩小版）不展开、不膨胀', async () => {
    const src =
      '<?xml version="1.0"?>' +
      '<!DOCTYPE r [<!ENTITY a "&b;&b;&b;"><!ENTITY b "&c;&c;&c;"><!ENTITY c "hahaha">]>' +
      '<r>&a;</r>';
    const r = await xmlPlugin().preview(memFile('bomb.xml', enc(src)), nodeAdapter, {});
    const raw = JSON.stringify(r);
    expect(raw.length).toBeLessThan(500); // 若展开应为 hahaha×9
    expect(raw.split('hahaha').length - 1).toBe(0);
  });
});

describe('xml · 失败降级契约', () => {
  it('malformed xml：插件级 ERR_PARSE', async () => {
    const r = await xmlPlugin().preview(memFile('bad.xml', enc('<root><a></root>')), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_PARSE');
  });

  it('管线级：malformed xml 落回 textPlugin 纯文本兜底', async () => {
    const bad = '<root><a></root>';
    const r = await createPreviewer({ plugins: corePlugins() }).preview(memFile('bad.xml', enc(bad)), nodeAdapter, {});
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toContain(bad);
  });
});
