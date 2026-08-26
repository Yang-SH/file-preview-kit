// G8：office xlsx 参数化单测——sheet 名称/序号选择、maxRows、sheetTotal 透明字段。
import { describe, it, expect, beforeAll } from 'vitest';
import { initNodeSanitizer, createNodeEnv } from '@file-preview/core';
import { officePlugin } from '@file-preview/plugin-office';
import ExcelJS from 'exceljs';

async function makeTwoSheetXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Alpha');
  s1.addRow(['A1', 'B1']);
  s1.addRow(['a', 1]);
  const s2 = wb.addWorksheet('Beta');
  s2.addRow(['X1', 'Y1']);
  for (let i = 1; i <= 5; i++) s2.addRow([`r${i}`, i]);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function memFile(bytes: Uint8Array) {
  return {
    name: 'two.xlsx',
    size: bytes.length,
    extension: 'xlsx',
    header: async () => bytes.subarray(0, 16),
    readRange: async (a: number, b: number) => bytes.subarray(a, Math.min(b, bytes.length)),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe('officePlugin sheet/maxRows（G8 数据透明）', () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    await initNodeSanitizer();
    bytes = await makeTwoSheetXlsx();
  });

  it('O1 默认第 1 表（Alpha），结果携带 sheetName + sheetTotal=2', async () => {
    const r = await officePlugin().preview(memFile(bytes) as any, createNodeEnv(), {});
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.sheetName).toBe('Alpha');
    expect(r.sheetTotal).toBe(2);
  });

  it('O2 按名称选 Beta；maxRows=3 → 表头+2 行数据', async () => {
    const r = await officePlugin({ sheet: 'Beta', maxRows: 3 }).preview(memFile(bytes) as any, createNodeEnv(), {});
    expect(r.kind).toBe('table');
    if (r.kind !== 'table') return;
    expect(r.sheetName).toBe('Beta');
    expect(r.rows.length).toBe(2);
    expect(r.columns).toEqual(['X1', 'Y1']);
  });

  it('O3 按 1-based 序号选第 2 表；越界序号 → PARSE 错误交还候选链', async () => {
    const ok = await officePlugin({ sheet: 2 }).preview(memFile(bytes) as any, createNodeEnv(), {});
    expect(ok.kind).toBe('table');
    if (ok.kind === 'table') expect(ok.sheetName).toBe('Beta');

    const bad = await officePlugin({ sheet: 9 }).preview(memFile(bytes) as any, createNodeEnv(), {});
    expect(bad.kind).toBe('error');
  });
});
