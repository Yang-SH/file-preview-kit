import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '@file-preview/core';
import { PreviewErrorCode } from '@file-preview/core';

// Office 文档插件（方案 §5.3 / §9 plugin-office 独立包）：
// - docx → mammoth.convertToHtml → kind 'html'（版式还原有限：内容预览契约，见 §5.3 caveat）。
// - xlsx → exceljs 读首个工作表前 1000 行 → kind 'table'。
// - pptx → fflate 解压 ppt/slides/slideN.xml + <a:t> 文本抽取 → kind 'html'（含解压预算防炸弹）。
// 候选链（candidateOrder）：按扩展名/MIME 提示排序 docx/xlsx/pptx 尝试顺序，全部失败返回最后一个
// ERR_PARSE（由 router 交下一插件或二进制降级）；重依赖均动态 import external（方案 §9）。

/** 候选解析顺序：按扩展名/mime 提示排序，未命中提示时 pptx 兜底在最后（改名 zip 场景仍可达）。 */
type OfficeKind = 'docx' | 'xlsx' | 'pptx';

function candidateOrder(file: IFile): OfficeKind[] {
  const looksDocx =
    file.extension === 'docx' ||
    file.extension === 'docm' ||
    (file.mimeType?.includes('wordprocessingml') ?? false);
  const looksPptx =
    file.extension === 'pptx' ||
    file.extension === 'pptm' ||
    (file.mimeType?.includes('presentationml') ?? false);
  if (looksDocx) return ['docx', 'xlsx', 'pptx'];
  if (looksPptx) return ['pptx', 'docx', 'xlsx'];
  return ['xlsx', 'docx', 'pptx'];
}

/** G8：office 插件选项——xlsx 工作表选择与行数预算；其余格式忽略。 */
export interface OfficePluginOptions {
  /** xlsx 工作表：1-based 序号或名称；默认第 1 个 */
  sheet?: number | string;
  /** xlsx 单表最大读取行数（含表头行）；默认 1000 */
  maxRows?: number;
}

export function officePlugin(options: OfficePluginOptions = {}): PreviewPlugin {
  return {
    id: 'office',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint === 'docx') return 90;
      if (ctx.zipHint === 'xlsx') return 90;
      if (ctx.zipHint === 'pptx') return 90;
      if (ctx.extension === 'docx' || ctx.extension === 'docm') return 90;
      if (ctx.extension === 'xlsx' || ctx.extension === 'xlsm') return 90;
      if (ctx.extension === 'pptx' || ctx.extension === 'pptm') return 90;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      let last: PreviewResult = { kind: 'error', code: PreviewErrorCode.PARSE, message: 'no parser attempted' };
      for (const kind of candidateOrder(file)) {
        const r =
          kind === 'docx' ? await previewDocx(file, opts)
          : kind === 'xlsx' ? await previewXlsx(file, opts, options)
          : await previewPptx(file, opts);
        if (r.kind !== 'error') return r;
        last = r;
      }
      return last;
    },
  };
}

async function previewDocx(file: IFile, opts?: PreviewOptions): Promise<PreviewResult> {
  try {
    const mammoth = (await import('mammoth')).default;
    // Node 走 buffer；浏览器应使用 mammoth 的 browser 构建并传 arrayBuffer（此处以 Node 路径为主）。
    const arg = typeof Buffer !== 'undefined' ? { buffer: Buffer.from(await file.arrayBuffer()) } : { arrayBuffer: await file.arrayBuffer() };
    const { value } = await mammoth.convertToHtml(arg as { buffer: Buffer });
    opts?.onProgress?.({ phase: 'docx', loaded: file.size, total: file.size });
    return { kind: 'html', html: value, title: file.name };
  } catch (e) {
    return { kind: 'error', code: PreviewErrorCode.PARSE, message: `docx parse failed: ${(e as Error).message}` };
  }
}

async function previewXlsx(file: IFile, opts?: PreviewOptions, pluginOpts?: OfficePluginOptions): Promise<PreviewResult> {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    // G8：工作表可按 1-based 序号或名称选择；越界/未命中 → PARSE 错误交还候选链
    const sel = pluginOpts?.sheet ?? 1;
    const ws = typeof sel === 'number'
      ? wb.worksheets[sel - 1]
      : wb.getWorksheet(sel);
    if (!ws) return { kind: 'error', code: PreviewErrorCode.PARSE, message: `xlsx worksheet not found: ${sel}` };
    const maxRows = Math.max(1, pluginOpts?.maxRows ?? 1000);
    const rows = ws.getRows(1, Math.min(ws.rowCount || 0, maxRows)) ?? [];
    const first = (rows[0]?.values ?? []) as unknown[];
    const columns = first.slice(1).map((c) => String(c ?? ''));
    const dataRows = rows.slice(1).map((r) => (r.values as unknown[]).slice(1));
    opts?.onProgress?.({ phase: 'xlsx', loaded: file.size, total: file.size });
    // G8 数据透明：sheetTotal 让调用方知道还有多少表，配合 sheet 参数自建切换器
    return { kind: 'table', columns, rows: dataRows, sheetName: ws.name, sheetTotal: wb.worksheets.length };
  } catch (e) {
    return { kind: 'error', code: PreviewErrorCode.PARSE, message: `xlsx parse failed: ${(e as Error).message}` };
  }
}

// ---------- pptx（方案 §5.3：zip + slide XML，内容预览） ----------

/** pptx 解压预算：仅解压 ppt/slides/*.xml，且按中央目录声明值限制总解压量（防构造炸弹）。 */
const PPTX_MAX_SLIDE_BYTES = 64 * 1024 * 1024;

/** XML 具名实体还原（<a:t> 文本节点内的转义）。 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // &amp; 必须最后处理
}

/** HTML 文本转义：抽取出的纯文本回填 HTML 时统一转义（渲染层 env.sanitize 前的纵深第一层）。 */
function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!);
}

/** 单页 slide XML → 段落文本列表（按 <a:p> 分段，段内拼接 <a:t> run）。 */
function extractSlideParagraphs(slideXml: string): string[] {
  const out: string[] = [];
  const paras = slideXml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g);
  for (const p of paras) {
    const runs = [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const text = runs.join('').trim();
    if (text !== '') out.push(escapeHtmlText(text));
  }
  return out;
}

async function previewPptx(file: IFile, opts?: PreviewOptions): Promise<PreviewResult> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { unzipSync } = await import('fflate');
    let budget = PPTX_MAX_SLIDE_BYTES;
    let zipped: Record<string, Uint8Array>;
    try {
      zipped = unzipSync(bytes, {
        filter: (f) => {
          // 仅解压幻灯片 XML；预算按中央目录声明的 originalSize 扣减，超限拒绝该条目后续全部解压。
          const wanted = /^ppt\/slides\/slide\d+\.xml$/.test(f.name);
          if (!wanted) return false;
          budget -= f.originalSize;
          return budget >= 0;
        },
      });
    } catch (e) {
      return { kind: 'error', code: PreviewErrorCode.PARSE, message: `pptx unzip failed: ${(e as Error).message}` };
    }

    // 幻灯片顺序：按 slideN 的 N 数值序（与 presentation.xml 的 sldIdLst 在常规导出下一致；
    // 极端重排场景属版式细节，不在「内容预览」契约内）。
    const slideNames = Object.keys(zipped)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
        const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
        return na - nb;
      });
    if (slideNames.length === 0) {
      return { kind: 'error', code: PreviewErrorCode.PARSE, message: 'pptx has no ppt/slides/slideN.xml' };
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const sections = slideNames.map((name, idx) => {
      const paras = extractSlideParagraphs(decoder.decode(zipped[name]));
      const body =
        paras.length > 0
          ? paras.map((t) => `<p>${t}</p>`).join('')
          : '<p><em>（空白页）</em></p>';
      return `<section class="fpk-pptx-slide"><h3>幻灯片 ${idx + 1}</h3>${body}</section>`;
    });

    opts?.onProgress?.({ phase: 'pptx', loaded: file.size, total: file.size });
    return {
      kind: 'html',
      html: `<div class="fpk-pptx">${sections.join('')}</div>`,
      title: `${file.name}（${slideNames.length} 页幻灯片 · 内容预览）`,
    };
  } catch (e) {
    return { kind: 'error', code: PreviewErrorCode.PARSE, message: `pptx parse failed: ${(e as Error).message}` };
  }
}
