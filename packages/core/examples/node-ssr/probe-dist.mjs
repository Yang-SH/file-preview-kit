// dist 产物探针：证明 @file-preview/core 与 @file-preview/plugin-archive 的构建产物（dist/*，非 strip-types 源码）
// 在 Node 生产路径下可直接消费，且 zip 插件与炸弹防御在产物中同样生效。
// 运行：node packages/core/examples/node-ssr/probe-dist.mjs （fflate 由工作区提升安装解析）
import { createPreviewer } from '../../dist/index.js';
import { zipPlugin } from '../../../plugin-archive/dist/index.js';
import { zipSync, strToU8 } from 'fflate';

/** 内存 IFile（与 tests/helpers.ts memFile 同构，探针独立内联避免引源码）。 */
function memFile(name, bytes) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase() || undefined;
  return {
    name,
    size: bytes.length,
    ...(ext ? { extension: ext } : {}),
    async header(maxBytes = 16 * 1024) {
      return bytes.subarray(0, Math.min(maxBytes, bytes.length));
    },
    async readRange(start, end) {
      return bytes.subarray(start, Math.max(start, Math.min(end, bytes.length)));
    },
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
}

let fail = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' | ' + extra : ''}`);
  if (!ok) fail++;
}

const pv = createPreviewer({ plugins: [zipPlugin()] });

// 1) 正常 zip → tree
const okZip = zipSync({ 'r.txt': strToU8('root'), 'd/x.txt': strToU8('in') });
const r1 = await pv.preview(memFile('probe.zip', okZip));
check('DIST zip → tree', r1.kind === 'tree', r1.kind === 'tree' ? `roots=${r1.nodes.map((n) => n.name).join(',')}` : JSON.stringify(r1));

// 2) 炸弹防御（注入小阈值）：3 条目 > maxEntries 2 → binary ERR_TOO_LARGE
const bombFiles = {};
for (let i = 0; i < 3; i++) bombFiles[`f${i}.txt`] = strToU8('x');
const guard = zipPlugin({ maxEntries: 2 });
const r2 = await guard.preview(memFile('bomb.zip', zipSync(bombFiles)));
check(
  'DIST zip 炸弹防御降级',
  r2.kind === 'binary' && r2.info?.code === 'ERR_TOO_LARGE',
  r2.kind === 'binary' ? String(r2.info?.reason).slice(0, 48) : JSON.stringify(r2),
);

if (fail > 0) process.exit(1);
console.log('\n✅ dist 产物生产路径消费通过（含 zip 插件 + 炸弹防御）');
