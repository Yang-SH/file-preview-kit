# file-preview-kit

[![CI](https://github.com/Yang-SH/file-preview-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-SH/file-preview-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Core entry size](https://img.shields.io/badge/core%20gzip-96.5%20kB-blue)

**English** | [简体中文](./README.zh-CN.md)

An isomorphic file preview library for browser and Node.js: streaming file input, content sniffing, plugin-based parsing, a unified result model and dual renderers — with security hardening built in.

> Design spec & verification reports: [`项目方案.md`](./项目方案.md) (Chinese) · [`packages/core/TDD-REPORT.md`](./packages/core/TDD-REPORT.md).

## Features

- **Isomorphic core** — the same pipeline runs in browsers and Node.js (`IFile` streaming reads, `maxBytes` guard, merged timeout/AbortSignal, LRU cache).
- **Plugin architecture** — priority-based routing (`test() → number`), compose only what you need.
- **Unified result model** — every parser returns one of `image / text / json / table / html / media / tree / binary / error`.
- **Security first** — a single sanitize hook for all HTML output, DOCTYPE-stripping XXE hardening, four-threshold zip-bomb defense, stable error codes.
- **Zero-build friendly** — a `<script type="module">` Web Component entry ships the full default set; heavy libraries stay behind dynamic imports.
- **Fully offline capable** — a self-contained single-file demo page can be generated; no CDN or server required at runtime.

## Packages

| Package | Description |
| --- | --- |
| [`@file-preview/core`](./packages/core) | Isomorphic core: streaming `IFile`, detection, routing, env adapters, rendering. Ships lightweight plugins: `image`, `text`, `markdown`, `csv`, `xml` (XXE hardened), `media` (mediainfo.js WASM), `email` (eml). |
| [`@file-preview/plugin-pdf`](./packages/plugin-pdf) | PDF preview (pdfjs-dist; canvas pages in browser, text extraction in Node). |
| [`@file-preview/plugin-office`](./packages/plugin-office) | Office suite docx·xlsx·pptx (mammoth / exceljs / fflate slide extraction). |
| [`@file-preview/plugin-archive`](./packages/plugin-archive) | ZIP listing tree with four-threshold bomb defense (fflate). |

## Installation

```bash
npm install @file-preview/core @file-preview/plugin-pdf @file-preview/plugin-office @file-preview/plugin-archive
```

> **Status:** v0.3.0 is not yet published to npm. Until then, clone this repo and install locally:
>
> ```bash
> git clone https://github.com/Yang-SH/file-preview-kit.git
> cd file-preview-kit && npm install && npm run build --workspaces
> ```

## Quick Start

### On-demand composition (recommended)

```js
import { corePlugins, createPreviewer, createBrowserEnv, fileFromBrowser } from '@file-preview/core';
import { pdfPlugin } from '@file-preview/plugin-pdf';
import { officePlugin } from '@file-preview/plugin-office';
import { zipPlugin } from '@file-preview/plugin-archive';

const env = createBrowserEnv({
  // Optional pdfjs asset injection for CDN drop-in scenarios (bundlers can omit these)
  pdfModuleUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs',
  pdfWorkerUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
});

const previewer = createPreviewer({
  plugins: [...corePlugins(), pdfPlugin(), officePlugin(), zipPlugin()],
});

const file = await fileFromBrowser(new Blob([bytes], { type: 'application/pdf' }), 'doc.pdf', 'pdf');
const result = await previewer.preview(file, env);
// result.kind → 'image' | 'text' | 'json' | 'table' | 'html' | 'media' | 'tree' | 'binary' | 'error'
```

### Zero-build browser entry

```html
<file-preview></file-preview>
<script type="module" src="./node_modules/@file-preview/core/dist/browser.js"></script>
<script type="module">
  const el = document.querySelector('file-preview');
  el.preview(fileInput.files[0]); // File | Blob — worker dispatch enabled by default
</script>
```

The `/browser` entry registers the `<file-preview>` custom element with the full default set (core + pdf + office + archive) bundled in a single file.

### Node.js SSR

```js
import { createPreviewer, corePlugins, createNodeEnv, initNodeSanitizer, fileFromNode } from '@file-preview/core';
const { officePlugin } = await import('@file-preview/plugin-office');

await initNodeSanitizer(); // lazy-loads sanitize-html once
const previewer = createPreviewer({ plugins: [...corePlugins(), officePlugin()] });

const result = await previewer.preview(await fileFromNode('report.docx'), createNodeEnv());
console.log(result.kind, result.html?.slice(0, 200));
```

## Supported Formats

| Format | Capability | Result kind | Provided by |
| --- | --- | --- | --- |
| PNG / JPEG / GIF / WebP / BMP / SVG | dataURL + intrinsic size (SVG via safe `<img>`) | `image` | core |
| TXT and code files | UTF-8 text preview | `text` | core |
| Markdown | rendered HTML (inline HTML escaped) | `html` | core |
| JSON | lossless parse | `json` | core |
| CSV | header table (papaparse) | `table` | core |
| XML | structured object + XXE hardening (fast-xml-parser) | `json` | core |
| WAV / MP4 / … audio-video | metadata via mediainfo WASM; playback `src` in browser | `media` | core |
| EML email | headers table + body + attachment list | `html` | core |
| PDF | canvas pages in browser; text extraction in Node | `html` / `text` | plugin-pdf |
| DOCX | HTML conversion (mammoth) | `html` | plugin-office |
| XLSX | first-sheet table (exceljs) | `table` | plugin-office |
| PPTX | slide text extraction (fflate + XML) | `html` | plugin-office |
| ZIP | directory tree + bomb defense (fflate) | `tree` | plugin-archive |
| Unknown / binary | hex dump fallback | `binary` | built-in |

### Support boundaries (by design)

- **eml**: HTML-only bodies are shown escaped-as-source, never rendered rich.
- **msg (Outlook)**, **fonts**, **3D models**: binary fallback per the design spec.
- PDFs relying on non-embedded CJK fonts require hosting pdfjs `standard_fonts`/cMaps yourself ([CSP guide](./docs/csp-guide.md)).

## Security

- **Single sanitize point** — every `html` output passes through `env.sanitize`; inject DOMPurify (browser default), sanitize-html (Node, call `initNodeSanitizer()` once), or your own implementation.
- **XXE hardening** — DOCTYPE blocks are stripped before strict validation; entities are never expanded.
- **Zip-bomb defense** — entry count / total uncompressed / single entry / nesting depth thresholds; violations degrade to hex dump with `ERR_TOO_LARGE`.
- **Stable error codes** — `ERR_UNSUPPORTED / ERR_TOO_LARGE / ERR_PARSE / ERR_ABORTED / ERR_TIMEOUT`.
- Strict CSP pages: see [`docs/csp-guide.md`](./docs/csp-guide.md) for minimal snippets covering `blob:` / `data:` resources and pdfjs workers.

## Testing & Verification

```bash
npm test                # 125 vitest cases: smoke, sanitize XSS, error codes, golden files, build hygiene
npm run build           # ESM/CJS/DTS for all packages
npm run smoke           # end-to-end Node smoke (zero-install, strip-types)
cd packages/core && npm run verify:offline   # generates two fully-offline single-file HTML pages:
#   examples/browser/demo-offline.html    — interactive playground (16 samples + drag & drop)
#   examples/browser/verify-offline.html  — 21 automated assertions
```

Both offline pages run by simply double-clicking them (no server, no network); results are exposed on `window.__FPK_VERIFY__`.

CI runs typecheck → vitest → build → smoke → dist probes → size budget on every push and PR.

## Versioning & Release

Versioning and CHANGELOGs are managed with [changesets](https://github.com/changesets/changesets):

```bash
npx changeset      # record a user-facing change (patch/minor/major)
npm run version    # consume changesets → semver bump + CHANGELOG
npm run release    # build + publish (requires npm credentials; CI uses changesets/action)
```

Convention: **major** = breaking change to `PreviewResult` or plugin interface semantics; affected plugins bump their `contractVersion` together.

## License

[MIT](./LICENSE) © Yang-SH
