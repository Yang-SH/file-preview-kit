// C2 · 体积预算卡点（方案 §12「体积预算：每个插件产物设 bundle size 上限，CI 卡点」）。
//
// 度量口径：gzip 后字节数（CDN 传输的真实成本）；dist 总量用原始字节（防整体膨胀）。
// 结构：
//   - entries：固定文件名的入口产物，逐文件限额；
//   - chunks ：其余 *.js/*.cjs（文件名含 content-hash，不可硬编码）——聚合总额限。
// 预算基线（2026-08-25 实测，余量 ~30%）：
//   browser.js gz 27.9K / index.cjs gz 116.9K / worker.cjs gz 114.6K / markdown-it chunk 62.4K …
// 重依赖（mammoth/exceljs/pdfjs/sanitize-html/fast-xml-parser）均为动态 import external，
// 不计入任何入口体积——这是「重库不进主包」契约的一部分（方案 §9）。
//
// 用法：node scripts/check-size.mjs（需先 npm run build）。
// 测试/临时调整：环境变量 FPK_SIZE_BUDGET_JSON 可深度合并覆盖默认预算（供负向验证使用）。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const ENTRY_LIMITS_GZ = {
  // 零构建 Web Component 入口（§14 P0 分发路径；C3 后内联 pdf/office/archive 插件源码）
  'browser.js': 36 * KB,
  // Node SSR 主入口（CJS 消费者）；C3 分包后重插件逻辑移出，基线 115.1K → 96.5K gz
  'index.cjs': 150 * KB,
  'worker.cjs': 150 * KB,
  // ESM 薄入口（re-export 型，理应极小）；worker.js 自 C3 起内联 office/archive 组合集
  'index.js': 3 * KB,
  'worker.js': 4 * KB,
};

const CHUNKS_TOTAL_GZ = 170 * KB; // 动态 import 的共享 chunk 聚合（markdown-it/papaparse/dompurify 等）
const DIST_TOTAL_RAW = 1.8 * KB * KB; // dist 目录整体膨胀护栏

function mergeBudget(overrides) {
  if (!overrides) return { entry: ENTRY_LIMITS_GZ, chunksTotalGz: CHUNKS_TOTAL_GZ, distTotalRaw: DIST_TOTAL_RAW };
  const parsed = JSON.parse(overrides);
  return {
    entry: { ...ENTRY_LIMITS_GZ, ...(parsed.entry ?? {}) },
    chunksTotalGz: parsed.chunksTotalGz ?? CHUNKS_TOTAL_GZ,
    distTotalRaw: parsed.distTotalRaw ?? DIST_TOTAL_RAW,
  };
}

const distDir = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'dist');
if (!existsSync(distDir)) {
  console.error('[size] dist/ 不存在——请先运行 npm run build');
  process.exit(1);
}

const budget = mergeBudget(process.env.FPK_SIZE_BUDGET_JSON);

/** @type {{name:string,gz:number,raw:number}[]} */
const files = [];
for (const name of readdirSync(distDir)) {
  if (!/\.(js|cjs)$/.test(name)) continue;
  const raw = readFileSync(join(distDir, name));
  files.push({ name, raw: raw.length, gz: gzipSync(raw).length });
}
if (files.length === 0) {
  console.error('[size] dist/ 内没有 js/cjs 产物——请先运行 npm run build');
  process.exit(1);
}

const violations = [];
let printed = 0;

console.log('file'.padEnd(30), 'gz'.padStart(10), 'limit'.padStart(10));
for (const [name, limit] of Object.entries(budget.entry)) {
  const f = files.find((x) => x.name === name);
  if (!f) {
    violations.push(`缺少预期入口产物 ${name}（构建配置被破坏？）`);
    continue;
  }
  console.log(name.padEnd(30), `${(f.gz / KB).toFixed(1)}K`.padStart(10), `${(limit / KB).toFixed(0)}K`.padStart(10));
  if (f.gz > limit) violations.push(`${name}: gzip ${f.gz}B > 预算 ${limit}B`);
  f._counted = true;
  printed++;
}

const chunks = files.filter((f) => !f._counted);
const chunksGz = chunks.reduce((s, f) => s + f.gz, 0);
console.log('(dynamic chunks total)'.padEnd(30), `${(chunksGz / KB).toFixed(1)}K`.padStart(10), `${(budget.chunksTotalGz / KB).toFixed(0)}K`.padStart(10));
if (chunksGz > budget.chunksTotalGz) violations.push(`动态 chunks 聚合 gzip ${chunksGz}B > 预算 ${budget.chunksTotalGz}B`);

const totalRaw = files.reduce((s, f) => s + f.raw, 0);
console.log('(dist total raw)'.padEnd(30), `${(totalRaw / KB).toFixed(1)}K`.padStart(10), `${(budget.distTotalRaw / KB).toFixed(0)}K`.padStart(10));
if (totalRaw > budget.distTotalRaw) violations.push(`dist 总原始字节 ${totalRaw}B > 护栏 ${budget.distTotalRaw}B`);

if (violations.length > 0) {
  console.error('\n[size] ❌ 体积预算超标：');
  for (const v of violations) console.error('  -', v);
  console.error('\n如为有意的新能力导致，请更新 scripts/check-size.mjs 的预算并在 PR 说明。');
  process.exit(1);
}
console.log(`\n[size] ✅ 全部预算通过（${printed} 个入口 + ${chunks.length} 个动态 chunk）`);
