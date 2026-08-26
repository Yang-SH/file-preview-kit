// C3 分包复验探针（TDD-REPORT §十六.5）：经公共包接口组合四包并真实预览。
// 与 smoke.ts 的差异：全部经 bare specifier（@file-preview/core / @file-preview/plugin-*）
// 解析——实证「源码级 exports 免构建排序」契约：workspace 消费方无需先构建任何包。
// 用法：node --experimental-strip-types examples/node-ssr/probe-c3.mjs
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';

const core = await import('@file-preview/core');
const { pdfPlugin } = await import('@file-preview/plugin-pdf');
const { officePlugin } = await import('@file-preview/plugin-office');
const { zipPlugin } = await import('@file-preview/plugin-archive');

let failed = 0;
function check(name, cond) {
  console.log(`  ${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failed++;
}

// 最小合法 PDF（与 tests/helpers.makePdf 同构，独立字面量防同源反复计算）
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF',
  'utf8',
);
const ZIP = Buffer.from(zipSync({ 'a.txt': new TextEncoder().encode('hello zip'), d: { 'r.txt': new TextEncoder().encode('leaf') } }));

async function main() {
  await core.initNodeSanitizer();

  // 契约1：core 默认集收窄 + 全量组合（archive 插件 id 为 'archive'，zip 是格式名）
  const cp = core.corePlugins();
  const all = [...cp, pdfPlugin(), officePlugin(), zipPlugin()];
  check('corePlugins() 收窄为轻量集且不含 pdf/office/archive', !['pdf', 'office', 'archive'].some((id) => cp.some((p) => p.id === id)));
  check('全量组合 = core 集三插件并入（含 pdf/office/archive）', ['pdf', 'office', 'archive'].every((id) => all.some((p) => p.id === id)));
  check('workerPlugins() 不含 runsInWorker:false 的 pdf', !core.workerPlugins().some((p) => p.id === 'pdf'));

  const previewer = core.createPreviewer({ plugins: all });
  const dir = mkdtempSync(join(tmpdir(), 'fpk-probe-c3-'));
  const nodeFile = async (name, buf) => {
    const p = join(dir, name);
    writeFileSync(p, buf);
    return core.fileFromNode(p);
  };

  // 契约2：三拆分包经公共接口真实路由 + 预览（Node 路径）
  const rTxt = await previewer.preview(await nodeFile('a.txt', Buffer.from('probe')), core.nodeAdapter);
  check(`core 集 text 路由 (kind=${rTxt.kind})`, rTxt.kind === 'text');

  const rPdf = await previewer.preview(await nodeFile('doc.pdf', PDF), core.nodeAdapter);
  check(
    `plugin-pdf Node 文本提取 (kind=${rPdf.kind}${rPdf.kind === 'text' ? `,language=${rPdf.language}` : ''})`,
    rPdf.kind === 'text' && rPdf.language === 'pdf',
  );

  const rZip = await previewer.preview(await nodeFile('arch.zip', ZIP), core.nodeAdapter);
  check(`plugin-archive zip→tree (kind=${rZip.kind})`, rZip.kind === 'tree');

  // 二进制降级契约：NUL 字节是二进制嗅探信号（与 tests/smoke 场景 3 同构 fixture）
  const rBin = await previewer.preview(
    await nodeFile('x.bin', Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef])),
    core.nodeAdapter,
  );
  check(`未识别降级 binary+ERR_UNSUPPORTED (code=${rBin.info?.code})`, rBin.kind === 'binary' && rBin.info?.code === 'ERR_UNSUPPORTED');

  if (failed > 0) {
    console.error(`\n[probe-c3] ❌ ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n[probe-c3] ✅ C3 分包公共接口组合全链路通过');
}

main().catch((e) => {
  console.error('[probe-c3] 探针崩溃:', e);
  process.exit(1);
});
