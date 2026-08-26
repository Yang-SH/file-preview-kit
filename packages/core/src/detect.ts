import type { IFile, DetectResult } from './types.ts';

const MAGIC: Array<{ sig: number[]; mime: string }> = [
  { sig: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { sig: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { sig: [0x47, 0x49, 0x46], mime: 'image/gif' },
  { sig: [0x42, 0x4d], mime: 'image/bmp' },
  { sig: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
];

function magicMime(h: Uint8Array): string | undefined {
  for (const m of MAGIC) {
    if (m.sig.every((b, i) => h[i] === b)) return m.mime;
  }
  // WEBP: RIFF....WEBP
  if (
    h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
    h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50
  ) {
    return 'image/webp';
  }
  // ZIP 家族: PK\x03\x04
  if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04) return 'application/zip';
  return undefined;
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  csv: 'text/csv', xml: 'application/xml', html: 'text/html',
  js: 'text/javascript', ts: 'text/typescript', css: 'text/css',
};

const ZIP_EXT_TO_HINT: Record<string, 'docx' | 'xlsx' | 'pptx'> = {
  docx: 'docx', docm: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx',
  pptx: 'pptx', pptm: 'pptx',
};

function extOf(name: string, declared?: string): string | undefined {
  if (declared) return declared.toLowerCase();
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : undefined;
}

// 无扩展名时：读尾部 64KB 定位 EOCD，扫描中央目录中的 word/ xl/ ppt/
async function classifyZipByContent(file: IFile): Promise<'docx' | 'xlsx' | 'pptx' | 'zip'> {
  const tailSize = Math.min(64 * 1024, file.size);
  if (tailSize <= 0) return 'zip';
  const tail = await file.readRange(file.size - tailSize, file.size);
  const eocd = findEocd(tail);
  if (!eocd) return 'zip';
  const cdEnd = Math.min(eocd.cdOffset + eocd.cdSize, file.size);
  const cd = await file.readRange(eocd.cdOffset, cdEnd);
  const s = new TextDecoder('latin1').decode(cd);
  if (s.includes('word/')) return 'docx';
  if (s.includes('xl/')) return 'xlsx';
  if (s.includes('ppt/')) return 'pptx';
  return 'zip';
}

function findEocd(buf: Uint8Array): { cdOffset: number; cdSize: number } | null {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const cdSize = buf[i + 12] | (buf[i + 13] << 8) | (buf[i + 14] << 16) | (buf[i + 15] << 24);
      const cdOffset = buf[i + 16] | (buf[i + 17] << 8) | (buf[i + 18] << 16) | (buf[i + 19] << 24);
      return { cdSize, cdOffset };
    }
  }
  return null;
}

// 兜底：octet-stream 且非 zip，UTF-8 可读率高则按文本处理。
// 导出供 previewer 的 fallbackResult 文本救援复用（方案 §四「无法识别 → UTF-8 解码兜底」）。
export function looksLikeText(h: Uint8Array): boolean {
  if (h.length === 0) return false;
  const sample = h.subarray(0, Math.min(h.length, 512));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) printable++;
    else if (b >= 0x80) printable++; // 宽松计数 utf-8 多字节
  }
  return printable / sample.length > 0.95;
}

export async function detectFile(file: IFile): Promise<DetectResult> {
  const header = await file.header();
  const ext = extOf(file.name, file.extension);
  const magic = magicMime(header);
  const isZip = magic === 'application/zip' || (header[0] === 0x50 && header[1] === 0x4b);

  let zipHint: DetectResult['zipHint'] = null;
  if (isZip) {
    const fromExt = ext ? ZIP_EXT_TO_HINT[ext] : undefined;
    zipHint = fromExt ?? (await classifyZipByContent(file));
  }

  const mimeFromExt = ext ? EXT_MIME[ext] : undefined;
  const mimeType = magic ?? file.mimeType ?? mimeFromExt ?? 'application/octet-stream';
  const isText = !isZip && mimeType === 'application/octet-stream' && looksLikeText(header);

  return { mimeType, extension: ext, fileName: file.name, header, zipHint, isText };
}
