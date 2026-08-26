// Office pptx 插件回归（方案 §5.3 / Milestone B，todo B3）：
// ① 最小 pptx → 内容预览 html（文字 + 幻灯片清单，不再降级 binary）
// ② 损坏 pptx（zip 结构但无幻灯片）→ 插件级 ERR_PARSE；管线级降级 binary（router 契约）
// ③ 全默认插件集集成：.pptx 经 corePlugins() 出 html
// ④ 路由优先级与互斥：office 对 zipHint/ext pptx 返回 90；archive 对 pptx 恒 0（既有断言保持）
// ⑤ 无扩展名改名场景：候选链兜底（xlsx→docx→pptx）仍可达内容预览
//
// fixture 策略对齐 archive.test.ts：fflate zipSync 内联构造确定性最小 pptx（无二进制样本入库）。
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';
import { createPreviewer } from '../src/previewer.ts';
import { nodeAdapter } from '../src/env.ts';
import { corePlugins } from '../src/plugins/index.ts';
import { memFile, allPlugins } from './helpers.ts';

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function slideXml(parasXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="${A_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${parasXml}</p:spTree></p:cSld></p:sld>`
  );
}

function para(text: string): string {
  return `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
}

/** 最小合法结构 pptx：Content_Types + 根 rels + presentation + 两页 slide。 */
function makePptx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        '</Relationships>',
    ),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      slideXml(para('Hello PPTX &amp; 中文标题') + `<a:p><a:r><a:t>第一页第二段</a:t></a:r></a:p>`),
    ),
    'ppt/slides/slide2.xml': strToU8(slideXml(para('&lt;转义&gt; 与 &quot;引号&quot;'))),
  });
}

/** 损坏样本：PK 头 zip 结构成立，但没有任何幻灯片条目。 */
function makeBrokenPptx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships/>'),
  });
}

describe('pptx · 路由优先级与互斥（B2）', () => {
  const base = { fileName: 'f', header: new Uint8Array(4) };
  it('office 对 zipHint=pptx 与扩展名 pptx/pptm 返回 90', () => {
    const p = officePlugin();
    expect(p.test({ ...base, zipHint: 'pptx' } as never)).toBe(90);
    expect(p.test({ ...base, extension: 'pptx' } as never)).toBe(90);
    expect(p.test({ ...base, extension: 'pptm' } as never)).toBe(90);
  });
  it('archive 对 pptx 恒 0（与 office 互斥，既有契约不破坏）', () => {
    const z = zipPlugin();
    expect(z.test({ ...base, zipHint: 'pptx' } as never)).toBe(0);
  });
});

describe('pptx · 内容预览（B1）', () => {
  it('最小 pptx → kind:html，两页文本 + 幻灯片清单 + 实体还原后转义', async () => {
    const r = await officePlugin().preview(memFile('deck.pptx', makePptx()), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.title).toContain('2 页幻灯片');
    expect(r.html).toContain('<section class="fpk-pptx-slide"><h3>幻灯片 1</h3>');
    expect(r.html).toContain('<h3>幻灯片 2</h3>');
    expect(r.html).toContain('Hello PPTX &amp; 中文标题');
    expect(r.html).toContain('第一页第二段');
    // &lt;转义&gt; 还原为字面 <> 后再按 HTML 转义回 &lt;/&gt; —— 不产生裸标签注入
    expect(r.html).toContain('&lt;转义&gt; 与 &quot;引号&quot;');
    expect(r.html).not.toMatch(/<转义>/);
  });

  it('无扩展名改名场景 → 候选链兜底仍出内容预览', async () => {
    const r = await officePlugin().preview(memFile('download', makePptx()), nodeAdapter, {});
    expect(r.kind).toBe('html');
  });

  it('空白幻灯片 → 占位段落，不产出空 section', async () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships/>'),
      'ppt/presentation.xml': strToU8('<p:presentation/>'),
      'ppt/slides/slide1.xml': strToU8(slideXml('')),
    });
    const r = await officePlugin().preview(memFile('blank.pptx', bytes), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('（空白页）');
  });
});

describe('pptx · 错误码与降级（B3 验收）', () => {
  it('插件级：损坏 pptx（无幻灯片条目）→ kind:error + ERR_PARSE', async () => {
    const r = await officePlugin().preview(memFile('broken.pptx', makeBrokenPptx()), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_PARSE');
  });

  it('管线级：损坏 pptx 经全插件集 → 二进制降级（router 契约：error 结果交下一插件/降级）', async () => {
    const pv = createPreviewer({ plugins: allPlugins() });
    const r = await pv.preview(memFile('broken.pptx', makeBrokenPptx()), nodeAdapter, {});
    expect(r.kind).toBe('binary');
    if (r.kind !== 'binary') return;
    expect(r.info?.code).toBe('ERR_UNSUPPORTED');
  });
});

describe('pptx · 全默认插件集集成（B3 验收）', () => {
  it('.pptx 经 corePlugins() 出 html，不再降级 binary', async () => {
    const pv = createPreviewer({ plugins: allPlugins() });
    const r = await pv.preview(memFile('deck.pptx', makePptx()), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('Hello PPTX &amp; 中文标题');
  });
});
