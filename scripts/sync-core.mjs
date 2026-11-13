/* 把规范源 novel-studio/packages/novel-core/{library,location}.js 同步进插件。
 * 用法：
 *   node scripts/sync-core.mjs          写入
 *   node scripts/sync-core.mjs --check  只校验（不一致时退出码 1）
 * 规范源是唯一可编辑处；插件里的 src/core/*.js 是生成物。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(here, '../../novel-studio/packages/novel-core');

/* generated：插件里的生成物；label：报错时给人看的名字 */
const FILES = [
  { name: 'library.js', label: '作品库核心' },
  { name: 'location.js', label: '作品库位置' },
];

const header = (name) => [
  '/* ⚠ 生成文件，请勿直接编辑。',
  ' * 规范源：novel-studio/packages/novel-core/' + name,
  ' * 同步：cd dsh-novel-studio && node scripts/sync-core.mjs',
  ' */',
  '',
].join('\n');

/* 只剥掉规范源顶部的"生成物提示"注释块，其余字节原样搬运。 */
const expectedOf = (name) => {
  const body = readFileSync(join(SOURCE_ROOT, name), 'utf8');
  return header(name) + body.replace(/^\/\*[\s\S]*?\*\/\r?\n/, '');
};

const check = process.argv.includes('--check');
let failed = 0;

for (const { name, label } of FILES) {
  const target = resolve(here, '../src/core/' + name);
  let expected = '';
  try {
    expected = expectedOf(name);
  } catch (error) {
    console.error(label + '的规范源读取失败：' + join(SOURCE_ROOT, name) + ' -> ' + (error?.message || error));
    failed += 1;
    continue;
  }

  if (check) {
    let actual = '';
    try {
      actual = readFileSync(target, 'utf8');
    } catch {
      console.error('缺少生成文件：' + target);
      failed += 1;
      continue;
    }
    if (actual !== expected) {
      console.error(label + '与规范源不一致：请运行 node scripts/sync-core.mjs');
      failed += 1;
      continue;
    }
    console.log(label + '与规范源一致（' + expected.length + ' 字节）');
    continue;
  }

  writeFileSync(target, expected, 'utf8');
  console.log('已同步' + label + ' → ' + target);
}

if (failed) process.exit(1);
