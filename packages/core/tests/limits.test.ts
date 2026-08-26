// 文档声明的限制边界直测：text 8MB 截断（README 支持边界）/ xlsx 默认 1000 行 / worker 插件过滤。
import { describe, it, expect, beforeAll } from 'vitest';
import { initNodeSanitizer, createNodeEnv, createPreviewer, workerPlugins, corePlugins } from '../src/index.ts';
import { memFile } from './helpers.ts';
import { officePlugin } from '@file-preview/plugin-office';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import ExcelJS from 'exceljs';

const env = createNodeEnv();
const enc = (s: string) => new TextEncoder().encode(s);

describe('文档声明边界：text 8MB 截断', () => {
  it('L1 超过 8MB 的文本 → 结果恰为前 8MB 字节解码，尾部丢弃', async () => {
    await initNodeSanitizer();
    const head = 'A'.repeat(8 * 1024 * 1024);
    const bytes = enc(head + 'TAIL-MARKER');
    const pv = createPreviewer({ plugins: corePlugins() });
    const r = await pv.preview(memFile('big.txt', bytes), env);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text.length).toBe(8 * 1024 * 1024);
    expect(r.text.startsWith('AAAA')).toBe(true);
    expect(r.text.includes('TAIL-MARKER')).toBe(false);
  }, 60_000);
});

describe('文档声明边界：xlsx 默认 maxRows=1000', () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    await initNodeSanitizer();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Big');
    ws.addRow(['H']);
    for (let i = 1; i <= 1002; i++) ws.addRow([i]); // 共 1003 行
    bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  });

  it('L2 默认：1000 行预算 → 表头 + 999 行数据', async () => {
    const r = await officePlugin().preview(memFile('rows.xlsx', bytes) as any, env, {});
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.rows.length).toBe(999);
    expect(r.sheetTotal).toBe(1);
  });

  it('L3 显式 maxRows=1001 → 表头 + 1000 行数据（覆盖默认值）', async () => {
    const r = await officePlugin({ maxRows: 1001 }).preview(memFile('rows.xlsx', bytes) as any, env, {});
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.rows.length).toBe(1000);
  });
});

describe('workerPlugins 过滤契约（方案 §三 核心统一派发）', () => {
  it('L4 内置七插件全部可进 Worker；手工组合集过滤掉 runsInWorker:false 的 pdf', () => {
    const wp = workerPlugins();
    expect(wp.length).toBe(corePlugins().length);
    expect(wp.every((p) => p.runsInWorker !== false)).toBe(true);

    const composed = [...corePlugins(), pdfPlugin()];
    const filtered = composed.filter((p) => p.runsInWorker !== false);
    expect(filtered.some((p) => p.id === 'pdf')).toBe(false);
    expect(filtered.length).toBe(composed.length - 1);
  });
});
