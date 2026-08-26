import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult, ThumbnailRequest, ThumbnailResult } from '../types.ts';
import { PreviewErrorCode } from '../errors.ts';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

// PNG: IHDR 位于 offset 16，宽/高各 4 字节。
function pngSize(bytes: Uint8Array): { width?: number; height?: number } {
  if (bytes.length > 24 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  return {};
}

// D2 修复：扩展名/MIME 可被伪造（无魔数时 detect 采信扩展名），路由命中后须以魔数自证，
// 不符返 ERR_PARSE 交还候选链降级，避免把垃圾字节渲染成破损 <img>。SVG 为文本格式走标记校验。
function matchesImageMagic(bytes: Uint8Array, mime: string): boolean {
  const svgHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256)).trimStart();
  if (mime === 'image/svg+xml') return svgHead.startsWith('<') && (svgHead.includes('<svg') || svgHead.startsWith('<?xml'));
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return mime === 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return mime === 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return mime === 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return mime === 'image/bmp';
  if (bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return mime === 'image/webp';
  return false;
}

// 参考插件：图片（含 SVG via <img> 天然安全，无需剥离）。
export function imagePlugin(): PreviewPlugin {
  return {
    id: 'image',
    contractVersion: 1,
    test(ctx: DetectResult): number {
      if (ctx.zipHint) return 0;
      return ctx.mimeType.startsWith('image/') ? 100 : 0;
    },
    async preview(file: IFile, _env: EnvAdapter, _opts: PreviewOptions): Promise<PreviewResult> {
      const buf = new Uint8Array(await file.arrayBuffer());
      const mime = file.mimeType ?? 'application/octet-stream';
      if (!mime.startsWith('image/') || !matchesImageMagic(buf, mime)) {
        // 候选链语义：返回 error 由 router 尝试下一插件（文本救援/兜底）
        return { kind: 'error', code: PreviewErrorCode.PARSE, message: `image magic mismatch for ${mime}` };
      }
      const dataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;
      const dims = mime === 'image/png' ? pngSize(buf) : {};
      return { kind: 'image', dataUrl, mimeType: mime, ...dims };
    },
    /** G2：图片缩略图——浏览器 canvas 等比缩小；无 canvas 环境（Node/jsdom）原图透传。 */
    async thumbnail(file: IFile, env: EnvAdapter, req?: ThumbnailRequest): Promise<ThumbnailResult> {
      const buf = new Uint8Array(await file.arrayBuffer());
      const mime = file.mimeType ?? 'application/octet-stream';
      if (!mime.startsWith('image/') || !matchesImageMagic(buf, mime)) {
        // 与 preview 契约一致：魔数不符交由 thumbnailer 兜底为回退卡
        throw new Error(`image magic mismatch for ${mime}`);
      }
      const b64 = bytesToBase64(buf);
      const passthrough = (): ThumbnailResult => ({ via: 'image', dataUrl: `data:${mime};base64,${b64}`, mimeType: mime });
      const maxW = req?.maxWidth ?? 320;
      const maxH = req?.maxHeight ?? 320;

      // SVG 是矢量文本，直接透传（浏览器 <img> 自适应）
      if (mime === 'image/svg+xml') return passthrough();

      try {
        // 无 canvas 能力的环境（jsdom/Node）直接透传，避免 Image 加载挂死
        const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
        if (typeof document === 'undefined' || !probe) return passthrough();
        const img = document.createElement('img');
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('thumb decode failed'));
          img.src = `data:${mime};base64,${b64}`;
        });
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return passthrough(); // 无 2d 上下文（jsdom/Node）→ 原样透传
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/png');
        return { via: 'image', dataUrl: out, width: w, height: h, mimeType: 'image/png' };
      } catch {
        env.log?.('warn', '[thumbnail:image] downscale unavailable, passthrough original');
        return passthrough();
      }
    },
  };
}
