// 发布清单替换（方案 §9 / 进度文档 P1）：
// npm(≤11.13 实测) 的 publishConfig.files/exports 字段替换不生效——publish --dry-run
// 仍按顶层 main/exports→./src 打包，导致发布产物缺 dist 且指向不存在路径。
// 解法：prepack 时把 publishConfig 应用到顶层字段（npm 生命周期钩子全工具链可靠），
// postpack 恢复原样。备份文件 .fpk-publish-bak.json 保证两态原子切换。
//
// 用法（package.json scripts）：
//   "prepack":  "node ../../scripts/apply-publish-manifest.mjs apply"
//   "postpack": "node ../../scripts/apply-publish-manifest.mjs restore"
import { readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const mode = process.argv[2];
const pkgPath = join(process.cwd(), 'package.json');
const bakPath = join(process.cwd(), '.fpk-publish-bak.json');

if (mode === 'apply') {
  if (existsSync(bakPath)) {
    // 上次异常残留：先复位再重新 apply，保证幂等
    copyFileSync(bakPath, pkgPath);
    unlinkSync(bakPath);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const pub = pkg.publishConfig;
  if (!pub || Object.keys(pub).length === 0) {
    console.log('[manifest] 无 publishConfig，跳过');
    process.exit(0);
  }
  copyFileSync(pkgPath, bakPath);
  const out = { ...pkg };
  for (const [key, value] of Object.entries(pub)) {
    // 整体替换语义（与 npm publishConfig 文档一致）：files/exports/main/types/module…
    out[key] = value;
  }
  delete out.publishConfig; // 发布形态不再携带该字段
  writeFileSync(pkgPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`[manifest] applied: ${Object.keys(pub).join(', ')} → top-level`);
} else if (mode === 'restore') {
  if (!existsSync(bakPath)) process.exit(0); // 无备份即无需恢复（幂等）
  copyFileSync(bakPath, pkgPath);
  unlinkSync(bakPath);
  console.log('[manifest] restored package.json from backup');
} else {
  console.error('用法: node apply-publish-manifest.mjs <apply|restore>');
  process.exit(1);
}
