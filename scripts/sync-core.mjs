/* 把规范源 novel-studio/packages/novel-core/library.js 同步进插件。
 * 用法：
 *   node scripts/sync-core.mjs          写入
 *   node scripts/sync-core.mjs --check  只校验（不一致时退出码 1）
 * 规范源是唯一可编辑处；插件里的 src/core/library.js 是生成物。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../../novel-studio/packages/novel-core/library.js');
const TARGET = resolve(here, '../src/core/library.js');
const HEADER = [
  '/* ⚠ 生成文件，请勿直接编辑。',
  ' * 规范源：novel-studio/packages/novel-core/library.js',
  ' * 同步：cd dsh-novel-studio && node scripts/sync-core.mjs',
  ' */',
  '',
].join('\n');

const body = readFileSync(SOURCE, 'utf8');
const expected = HEADER + body.replace(/^\/\*[\s\S]*?\*\/\r?\n/, '');

if (process.argv.includes('--check')) {
  let actual = '';
  try {
    actual = readFileSync(TARGET, 'utf8');
  } catch {
    console.error('缺少生成文件：' + TARGET);
    process.exit(1);
  }
  if (actual !== expected) {
    console.error('作品库核心与规范源不一致：请运行 node scripts/sync-core.mjs');
    process.exit(1);
  }
  console.log('作品库核心与规范源一致（' + body.length + ' 字节）');
} else {
  writeFileSync(TARGET, expected, 'utf8');
  console.log('已同步作品库核心 → ' + TARGET);
}
