import type { IFile } from './types.ts';

// 浏览器端：基于 Blob.slice，天然零拷贝区间读取。
// name/extension 可选：Worker 派发时收到的是无名的 Blob，需由调用方补回文件名。
export async function fileFromBrowser(file: File | Blob, name?: string, extension?: string): Promise<IFile> {
  const f = file as File;
  const resolvedName = name ?? (typeof f.name === 'string' && f.name ? f.name : 'blob');
  const mimeType = (file as Blob).type || undefined;
  return {
    name: resolvedName,
    size: file.size,
    mimeType,
    extension,
    blob: file instanceof Blob ? file : undefined,
    async header(maxBytes = 16 * 1024) {
      const end = Math.max(0, Math.min(maxBytes, file.size));
      return new Uint8Array(await file.slice(0, end).arrayBuffer());
    },
    async readRange(start, end) {
      return new Uint8Array(await file.slice(start, end).arrayBuffer());
    },
    async arrayBuffer() {
      return file.arrayBuffer();
    },
  };
}

// Node 端：每次读取独立 open/close fd，避免一次性 readFile，也不泄漏文件句柄。
export async function fileFromNode(filePath: string): Promise<IFile> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || undefined;
  const reader = async (start: number, len: number): Promise<Uint8Array> => {
    if (len <= 0) return new Uint8Array(0);
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, start);
      return new Uint8Array(buf);
    } finally {
      await fd.close();
    }
  };
  return {
    name: path.basename(filePath),
    size: stat.size,
    extension: ext,
    async header(maxBytes = 16 * 1024) {
      return reader(0, Math.min(maxBytes, stat.size));
    },
    async readRange(start, end) {
      return reader(start, end - start);
    },
    async arrayBuffer() {
      const buf = await fs.readFile(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}
