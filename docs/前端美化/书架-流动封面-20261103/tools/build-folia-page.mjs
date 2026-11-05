// tools/build-folia-page.mjs — 把 latent-gl.js 与 blue-noise.js 内联进设计稿，
// 让 index.html 仍然是"双击就能开"的单文件（file:// 下 ESM 会被 CORS 拦）。
// 用法：node tools/build-folia-page.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('docs/前端美化/书架-流动封面-20261103');
const pagePath = path.join(dir, 'index.html');
const MARKER = '/* @@INLINE@@ */';

const stripExports = source => source.replace(/^export\s+/gm, '');

const noise = stripExports(readFileSync(path.join(dir, 'blue-noise.js'), 'utf8'));
const latent = stripExports(readFileSync(path.join(dir, 'latent-gl.js'), 'utf8'))
  + '\nwindow.createLatentBackdrop = createLatentBackdrop;\nwindow.paintCoverArt = paintCoverArt;\n';

let page = readFileSync(pagePath, 'utf8');

/* 反复构建时要能覆盖上一次的内联结果 */
const START = '/* ==== inline:begin ==== */';
const END = '/* ==== inline:end ==== */';
page = page.replace(new RegExp(START.replace(/[.*+?^\^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^\^${}()|[\]\\]/g, '\\$&')), MARKER);
if (!page.includes(MARKER)) throw new Error('找不到内联标记 ' + MARKER);

const payload = [START, noise, latent, END].join('\n');
page = page.replace(MARKER, payload);
writeFileSync(pagePath, page);

console.log(JSON.stringify({
  page: pagePath,
  noiseBytes: noise.length,
  latentBytes: latent.length,
  pageBytes: page.length
}));
