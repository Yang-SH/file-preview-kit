import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';
import { PreviewErrorCode } from '../errors.ts';

const MAX_READ = 8 * 1024 * 1024; // 与 text/csv 插件同策略：预览读入上限 8MB

// XML → 结构化 JSON 插件（方案 §5.5：fast-xml-parser 默认禁实体扩展，天然防 XXE / 十亿笑话）。
// 产出 kind:'json'，复用既有 json 渲染器；解析失败返回 ERR_PARSE，
// 由 router 落到 textPlugin（扩展名 xml 仍命中 100）→ 纯文本优雅兜底。
//
// 路由优先级：
// - 显式命中（扩展名 xml / MIME application·text xml / 其它非图片 +xml 后缀）→ 110（与 md/csv 同级，> text 的 100）
//   `+xml` 后缀排除 image/*：`.svg` 归 image 插件（`<img>` 模式天然安全），避免被本插件截胡。
// - 内容嗅探（无扩展名/改名文件，头部 `<?xml`）→ 60（> isText 的 50，< 一切显式专家插件）
// - zipHint 存在（docx/xlsx/pptx 是 zip 不是纯 XML）→ 0
//
// XXE 安全根基（方案 §11）：fast-xml-parser 不解析 DTD、不展开外部/内部自定义实体——
// processEntities 仅处理内联字符实体（&amp; 等），`&evil;` 原样保留为字面文本，
// 无文件/网络读取行为，免疫实体展开炸弹。重依赖动态 import（方案 §9），不进主包。
export function xmlPlugin(): PreviewPlugin {
  return {
    id: 'xml',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      if (ctx.extension === 'xml') return 110;
      if (ctx.mimeType === 'application/xml' || ctx.mimeType === 'text/xml') return 110;
      if (ctx.mimeType?.endsWith('+xml') && !ctx.mimeType.startsWith('image/')) return 110;
      // 改名/无扩展名兜底：头部嗅探 <?xml 声明
      const head = new TextDecoder('utf-8', { fatal: false })
        .decode(ctx.header.subarray(0, 256))
        .replace(/^\uFEFF/, '')
        .trimStart();
      if (head.startsWith('<?xml')) return 60;
      return 0;
    },
    async preview(file: IFile, _env: EnvAdapter, opts?: PreviewOptions): Promise<PreviewResult> {
      try {
        const bytes = await file.readRange(0, Math.min(file.size, MAX_READ));
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        opts?.onProgress?.({ phase: 'xml', loaded: bytes.length, total: file.size });

        // XXE 加固第一层：整体剥离 DOCTYPE（含全部实体声明）——预览不需要 DTD，
        // 从源头消灭内部/外部实体定义，任何版本行为下都保证「不展开、不外联」。
        const noDtd = text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '');

        // 第二层：严格结构校验（fast-xml-parser 解析器本身对闭合错误宽松，须显式验证）
        const { XMLParser, XMLValidator } = await import('fast-xml-parser');
        const validation = XMLValidator.validate(noDtd, { allowBooleanAttributes: true });
        if (validation !== true) {
          throw new Error(`invalid xml: ${typeof validation === 'object' ? validation.err.msg : 'unknown'}`);
        }

        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@',
          parseAttributeValue: true,
          parseTagValue: true,
          trimValues: true,
          processEntities: true, // 仅内联字符实体（&amp; 等）；DOCTYPE 已剥离，无自定义实体可展开
        });
        const data = parser.parse(noDtd) as unknown;
        return { kind: 'json', data };
      } catch (e) {
        return { kind: 'error', code: PreviewErrorCode.PARSE, message: `xml parse failed: ${(e as Error).message}` };
      }
    },
  };
}
