// A2 冒烟断言（方案 §14 / 进度文档「工程缺陷」项）：
// 锁定「tsup 构建零 import.meta 警告」与「CJS 消费者可正常 require 且 worker URL 行为明确」两条护栏：
// 1. 全量重建一次（clean），断言退出码 0 且输出无 [empty-import-meta] 警告；
// 2. browser 入口仅出 ESM（dist/browser.cjs 不应存在 —— CJS 无法承载 import.meta 的 Worker 解析）；
// 3. require('@file-preview/core')（index.cjs）不再抛 RangeError，defaultWorkerUrl 为空串
//    （CJS 无 import.meta，调用方需显式传 workerUrl；Node 端 spawnWorker 本就为 null）；
// 4. ESM 入口的 defaultWorkerUrl 指向同目录 dist/worker.js（零构建 verify.html 依赖此行为）。
import { describe, it, expect } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const execAsync = promisify(exec);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('A2 · 构建产物卫生（import.meta 警告修复回归）', () => {
  let buildStdout = '';
  let buildStderr = '';

  it('全量构建成功且无 empty-import-meta 警告', async () => {
    const { stdout, stderr } = await execAsync('npm run build', {
      cwd: pkgDir,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    buildStdout = stdout;
    buildStderr = stderr;
    const combined = `${stdout}\n${stderr}`;
    expect(combined).not.toMatch(/empty-import-meta/i);
    expect(combined).toMatch(/Build success/u);
  }, 150_000);

  it('browser 入口仅产出 ESM（无 browser.cjs）', () => {
    expect(buildStdout + buildStderr).toBeTruthy(); // 前序用例已完成构建
    expect(existsSync(join(pkgDir, 'dist', 'browser.js'))).toBe(true);
    expect(existsSync(join(pkgDir, 'dist', 'browser.cjs'))).toBe(false);
  });

  it('CJS：require(index.cjs) 可用，defaultWorkerUrl 为空串（显式传 workerUrl 契约）', async () => {
    const { createRequire } = await import('node:module');
    const requireFromPkg = createRequire(join(pkgDir, 'package.json'));
    const cjs = requireFromPkg('./dist/index.cjs') as { defaultWorkerUrl?: string };
    expect(typeof cjs.defaultWorkerUrl).toBe('string');
    // CJS 下无法模块相对解析 worker：契约是空串 + 调用方显式传 workerUrl（README「CJS 分发边界」）
    expect(cjs.defaultWorkerUrl).toBe('');
  });

  it('ESM：defaultWorkerUrl 指向同目录 dist/worker.js', async () => {
    const esm = (await import(fileURLToPath(new URL('../dist/index.js', import.meta.url)))) as {
      defaultWorkerUrl: string;
    };
    expect(esm.defaultWorkerUrl.replace(/\\/g, '/')).toContain('/dist/worker.js');
  });
});
