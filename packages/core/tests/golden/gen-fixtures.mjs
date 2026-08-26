// golden-file fixtures 生成器（方案 §12）：产出 tests/golden/fixtures/{sample.docx, sample.xlsx}。
// 运行：node tests/golden/gen-fixtures.mjs （工作区内解析 fflate / exceljs）
// - docx：最小合法 OOXML 包（[Content_Types].xml + _rels/.rels + word/document.xml），mammoth 可解析；
//   用 fflate 内联构建，内容确定、无外部样本依赖。
// - xlsx：exceljs 写单表（表头 name/score + 两行数据），与 office.ts 的 columns/rows 抽取约定对齐。
// 其余格式（png/txt/pdf/zip）复用 examples/browser/fixtures/ 既有真实文件；md/csv/json 由用例内联生成。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import ExcelJS from 'exceljs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures');
mkdirSync(outDir, { recursive: true });

// ---------- 1) 最小 docx ----------
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello DOCX golden</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段中文段落</w:t></w:r></w:p>
  </w:body>
</w:document>`;

writeFileSync(
  join(outDir, 'sample.docx'),
  Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(DOCUMENT_XML),
    }),
  ),
);

// ---------- 2) 最小 xlsx ----------
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Golden');
ws.addRow(['name', 'score']);
ws.addRow(['alice', 1]);
ws.addRow(['bob', 2]);
writeFileSync(join(outDir, 'sample.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));

console.log('golden fixtures written to', outDir);
