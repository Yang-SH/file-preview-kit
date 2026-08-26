import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';
import { PreviewErrorCode } from '../errors.ts';

// 邮件 .eml 插件（方案 §5.7）：emailjs-mime-parser(MIT) 解析 RFC822/MIME 树 → kind:'html' 内容预览。
// - 重依赖动态 import external（方案 §9），不进主包；锁定 ^2.0.7 于 packages/core dependencies。
// - 库内置 999 MIME 节点上限，天然防节点炸弹内存耗尽（CWE-400）；本插件另设 8MB 读入上限（与 text/csv 同策略）。
// - 输出策略（保守优先）：正文优先 text/plain 纯文本；无 plain 时 text/html 以【转义源码】形式展示——
//   富 HTML 邮件渲染需 DOMPurify 全量清洗管线，超出 P2 范围，避免把未经净化的邮件 HTML 当作可信片段。
//   所有动态值经 escapeHtml 拼装，渲染层 env.sanitize 再统一清理一次（纵深防御，方案 §7）。
// - 已知上游边界：未声明 Content-Transfer-Encoding 的非 ASCII「7bit」正文会被上游截断多字节字符；
//   RFC 2045 下真实邮件的非 ASCII 文本必经 QP/base64 编码，两条路径实测 UTF-8 还原正确（探针验证）。

const MAX_READ = 8 * 1024 * 1024;

interface ParsedAddress {
  address?: string;
  name?: string;
}

interface MimeHeaderValue {
  value: unknown;
  initial?: string;
  params?: Record<string, string>;
}

interface MimeNode {
  headers: Record<string, MimeHeaderValue[]>;
  contentType?: { value?: string; type?: string; params?: Record<string, string> };
  childNodes: MimeNode[];
  content?: Uint8Array;
}

type MimeParseFn = (chunk: string) => MimeNode;

export function emailPlugin(): PreviewPlugin {
  return {
    id: 'email',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.extension === 'eml') return 90;
      if (ctx.mimeType === 'message/rfc822') return 90;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      try {
        const bytes = await file.readRange(0, Math.min(file.size, MAX_READ));
        const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        opts?.onProgress?.({ phase: 'eml', loaded: bytes.length, total: file.size });

        const parse = await loadParser();
        const root = parse(raw);

        const subject = strHeader(root, 'subject');
        const from = addrHeader(root, 'from');
        const to = addrHeader(root, 'to');
        const cc = addrHeader(root, 'cc');
        const date = strHeader(root, 'date');

        const out: { plain?: string; htmlSrc?: string } = {};
        const attachments: Array<{ filename: string; type: string; size: number }> = [];
        walkTree(root, out, attachments);
        if (!out.plain && !out.htmlSrc && attachments.length === 0 && !subject && !from) {
          throw new Error('no mime structure recognized');
        }

        const rows: Array<[string, string]> = [['From', from]];
        if (to) rows.push(['To', to]);
        if (cc) rows.push(['Cc', cc]);
        if (date) rows.push(['Date', date]);

        let html = `<div class="fpk-eml"><table class="fp-table"><tbody>`;
        for (const [k, v] of rows) {
          html += `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
        }
        html += `</tbody></table>`;
        if (subject) html += `<h3 class="fpk-eml-subject">${escapeHtml(subject)}</h3>`;
        if (out.plain !== undefined) {
          html += `<pre class="fp-text">${escapeHtml(out.plain)}</pre>`;
        } else if (out.htmlSrc !== undefined) {
          html += `<details class="fpk-eml-htmlsrc"><summary>HTML 邮件正文（源码形式）</summary><pre>${escapeHtml(out.htmlSrc)}</pre></details>`;
        }
        if (attachments.length > 0) {
          html += `<table class="fp-table fpk-eml-attachments"><thead><tr><th>Attachment</th><th>Type</th><th>Size</th></tr></thead><tbody>`;
          for (const a of attachments) {
            html += `<tr><td>${escapeHtml(a.filename)}</td><td>${escapeHtml(a.type)}</td><td>${a.size} B</td></tr>`;
          }
          html += `</tbody></table>`;
        }
        html += `</div>`;
        return { kind: 'html', html, title: subject || file.name };
      } catch (e) {
        return {
          kind: 'error',
          code: PreviewErrorCode.PARSE,
          message: `eml parse failed: ${(e as Error).message}`,
        };
      }
    },
  };
}

async function loadParser(): Promise<MimeParseFn> {
  // CJS 双形态互操作：Node ESM 命名空间下 parse 位于 mod.default.default；
  // bundler（esbuild/tsup/vite）互操作下通常位于 mod.default。两种都兼容。
  const mod = (await import('emailjs-mime-parser')) as unknown as {
    default: MimeParseFn | { default: MimeParseFn };
  };
  return typeof mod.default === 'function' ? mod.default : mod.default.default;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function strHeader(node: MimeNode, key: string): string {
  const v = node.headers?.[key]?.[0]?.value;
  return typeof v === 'string' ? v : '';
}

/** 地址头（from/to/cc…）：value 为 [{name,address}] 数组，格式化为 "Name <addr>" 列表。 */
function addrHeader(node: MimeNode, key: string): string {
  const v = node.headers?.[key]?.[0]?.value;
  const arr = Array.isArray(v) ? (v as ParsedAddress[]) : [];
  return arr
    .map((a) => {
      const name = a?.name?.trim();
      const addr = a?.address?.trim();
      if (name && addr) return `${name} <${addr}>`;
      return addr || name || '';
    })
    .filter(Boolean)
    .join(', ');
}

function isDispositionAttachment(node: MimeNode): boolean {
  const disp = node.headers?.['content-disposition']?.[0];
  const v = typeof disp?.value === 'string' ? disp.value.toLowerCase().trim() : '';
  return v === 'attachment';
}

interface WalkOut {
  plain?: string;
  htmlSrc?: string;
}

interface AttachmentInfo {
  filename: string;
  type: string;
  size: number;
}

function walkTree(node: MimeNode, out: WalkOut, attachments: AttachmentInfo[]): void {
  const type = (node.contentType?.value ?? '').toLowerCase();
  const params = node.contentType?.params ?? {};
  const dispParams = node.headers?.['content-disposition']?.[0]?.params ?? {};
  const hasBody = node.content instanceof Uint8Array;

  if (hasBody) {
    const filename = dispParams.filename || params.name || '';
    if (isDispositionAttachment(node) || (!type.startsWith('text/') && filename)) {
      attachments.push({ filename: filename || '(unnamed)', type: type || 'application/octet-stream', size: node.content!.byteLength });
    } else if (type === 'text/plain') {
      out.plain ??= new TextDecoder('utf-8', { fatal: false }).decode(node.content!);
    } else if (type === 'text/html') {
      out.htmlSrc ??= new TextDecoder('utf-8', { fatal: false }).decode(node.content!);
    }
  }
  for (const child of node.childNodes ?? []) walkTree(child, out, attachments);
}
