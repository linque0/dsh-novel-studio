/* 把小说工坊的构建产物复制进插件 assets/app（发布前置步骤）。 */
import { cp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../novel-studio/dist');
const target = resolve(here, '../assets/app');

try {
  const info = await stat(source);
  if (!info.isDirectory()) throw new Error('not a directory');
} catch {
  console.error('找不到小说工坊构建产物：' + source + '（先在 novel-studio 里跑 npm run build）');
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log('已复制 ' + source + ' -> ' + target);
