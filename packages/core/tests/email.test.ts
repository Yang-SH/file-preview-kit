// 邮件 eml 插件回归（方案 §5.7 / todo D3）：
// ① .eml → kind:html 结构化预览：头表（From/To/Date）+ mime-word 解码主题 + 纯文本正文 + 附件清单
// ② multipart/mixed + base64 附件（%PDF 魔数）+ QP 中文正文 —— 真实邮件形态
// ③ 损坏/非邮件内容 → 插件级 ERR_PARSE；管线级 .eml 不再降级 binary/text
// ④ 路由矩阵：扩展名/MIME message/rfc822 命中 90；zipHint 排除；与 text/media/pdf/zip 互斥
// ⑤ HTML-only 邮件：正文以【转义源码】形式展示（不做富渲染的安全边界）
import { describe, it, expect } from 'vitest';
import { emailPlugin } from '../src/plugins/email.ts';
import { textPlugin } from '../src/plugins/text.ts';
import { mediaPlugin } from '../src/plugins/media.ts';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { zipPlugin } from '@file-preview/plugin-archive';
import { createPreviewer } from '../src/previewer.ts';
import { nodeAdapter } from '../src/env.ts';
import { corePlugins, workerPlugins } from '../src/plugins/index.ts';
import { memFile } from './helpers.ts';

const ctxBase = { fileName: 'f', header: new Uint8Array(4) };

/** RFC2045 base64 编码 helper（确定性，无外部依赖）。 */
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const qpChinese = '=E7=AC=AC=E4=B8=80=E8=A1=8C=E6=AD=A3=E6=96=87';

/** 最小 multipart/mixed 邮件：QP 中文正文 + base64 PDF 附件。 */
function makeEml(): Uint8Array {
  const eml = [
    'From: Alice <alice@example.com>',
    'To: bob@example.com, Carol <carol@example.org>',
    'Subject: Hello =?UTF-8?B?5L2g5aW9?=',
    'Date: Mon, 24 Aug 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BOUND"',
    '',
    '--BOUND',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    qpChinese,
    '--BOUND',
    'Content-Type: application/pdf; name="doc.pdf"',
    'Content-Disposition: attachment; filename="doc.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    b64('%PDF-1.4 minimal'),
    '--BOUND--',
    '',
  ].join('\r\n');
  return new TextEncoder().encode(eml);
}

describe('email · 路由矩阵', () => {
  it('扩展名 eml 与 MIME message/rfc822 命中 90；zipHint 排除', () => {
    const p = emailPlugin();
    expect(p.test({ ...ctxBase, extension: 'eml', mimeType: 'application/octet-stream' } as never)).toBe(90);
    expect(p.test({ ...ctxBase, mimeType: 'message/rfc822' } as never)).toBe(90);
    expect(p.test({ ...ctxBase, zipHint: 'docx', extension: 'eml' } as never)).toBe(0);
    expect(p.test({ ...ctxBase, extension: 'xyz', mimeType: 'application/octet-stream' } as never)).toBe(0);
  });

  it('与 text/media/pdf/zip 插件互斥：.eml 只有 email 接管', () => {
    const ctx = {
      fileName: 'mail.eml',
      extension: 'eml',
      mimeType: 'application/octet-stream',
      header: makeEml().subarray(0, 16),
      zipHint: null,
    } as never;
    expect(emailPlugin().test(ctx)).toBe(90);
    expect(textPlugin().test(ctx)).toBe(0);
    expect(mediaPlugin().test(ctx)).toBe(0);
    expect(pdfPlugin().test(ctx)).toBe(0);
    expect(zipPlugin().test(ctx)).toBe(0);
  });
});

describe('email · 结构化解析', () => {
  it('multipart eml → html：mime-word 主题解码 + 地址格式化 + QP 正文 + 附件清单', async () => {
    const r = await createPreviewer({ plugins: corePlugins() }).preview(memFile('mail.eml', makeEml()), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    // 头部结构
    expect(r.html).toContain('Alice &lt;alice@example.com&gt;');
    expect(r.html).toContain('bob@example.com');
    expect(r.html).toContain('Mon, 24 Aug 2026');
    // mime-word 解码后的主题（title 与正文）
    expect(r.title).toContain('你好');
    expect(r.html).toContain('Hello 你好');
    // QP 正文还原
    expect(r.html).toContain('第一行正文');
    // 附件清单：文件名 + 类型 + 字节数
    expect(r.html).toContain('doc.pdf');
    expect(r.html).toContain('application/pdf');
  });

  it('HTML-only 邮件 → 正文以转义源码展示（不内联原始 HTML 的安全边界）', async () => {
    const eml = [
      'From: x@y.z',
      'Subject: html only',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64('<h1>Rich</h1><script>alert(1)</script>'),
      '',
    ].join('\r\n');
    const r = await createPreviewer({ plugins: corePlugins() }).preview(memFile('h.eml', new TextEncoder().encode(eml)), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    // 源码形式：< > 均被转义，script 标签不可执行
    expect(r.html).toContain('&lt;h1&gt;');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).not.toContain('<h1>');
  });

  it('纯文本单段邮件（无 multipart）正常解析', async () => {
    const eml = [
      'From: a@b.c',
      'Subject: simple',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64('plain body'),
      '',
    ].join('\r\n');
    const r = await emailPlugin().preview(memFile('s.eml', new TextEncoder().encode(eml)), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.html).toContain('plain body');
  });
});

describe('email · 错误处理与管线集成', () => {
  it('损坏/非邮件内容 → 插件级 ERR_PARSE', async () => {
    const garbage = new TextEncoder().encode('\u0000\u0001\u0002 binary garbage no mime here');
    const r = await emailPlugin().preview(memFile('broken.eml', garbage), nodeAdapter, {});
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.code).toBe('ERR_PARSE');
    expect(r.message).toContain('eml parse failed');
  });

  it('全默认插件集下 .eml 出 html，不再降级 binary/text', async () => {
    const pv = createPreviewer({ plugins: corePlugins() });
    const r = await pv.preview(memFile('mail.eml', makeEml()), nodeAdapter, {});
    expect(r.kind).toBe('html');
    if (r.kind !== 'html') return;
    expect(r.title).toContain('你好');
  });

  it('.eml 可进核心统一派发 Worker（未自管 Worker）', () => {
    expect(workerPlugins().some((p) => p.id === 'email')).toBe(true);
  });
});
