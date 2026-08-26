import type { PreviewPlugin, DetectResult, IFile, EnvAdapter, PreviewOptions, PreviewResult } from '../types.ts';

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
      const dataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;
      const dims = mime === 'image/png' ? pngSize(buf) : {};
      return { kind: 'image', dataUrl, mimeType: mime, ...dims };
    },
  };
}
