/* 把桌面版插件构建产物 dist-plugin 复制进本仓库 assets/app（先 rm -rf 再 cp -r）。
 * --check 只比对两边文件数与总字节，不一致 exit 1。
 * 源目录默认 ../novel-studio/dist-plugin，可用 NS_PLUGIN_DIST 覆盖。 */
import { cp, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const source = resolve(process.env.NS_PLUGIN_DIST || join(here, '../../novel-studio/dist-plugin'));
const target = resolve(here, '../assets/app');

async function sourceReady() {
  try {
    const info = await stat(source);
    if (info.isDirectory()) return true;
  } catch { /* 统一在下面报错 */ }
  console.error('找不到插件版构建产物：' + source);
  console.error('先在 novel-studio 仓库执行 npm run build:plugin（产物在 dist-plugin/），或用 NS_PLUGIN_DIST 指向实际目录。');
  return false;
}

async function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await measure(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(full)).size;
    }
  }
  return { files, bytes };
}

async function measureOr(dir, label) {
  try {
    return await measure(dir);
  } catch {
    console.error('读不到' + label + '：' + dir);
    return null;
  }
}

if (!(await sourceReady())) process.exit(1);

if (checkOnly) {
  const from = await measureOr(source, '源目录');
  if (!from) process.exit(1);
  const to = await measureOr(target, '目标目录');
  if (!to) process.exit(1);
  console.log('源   ' + from.files + ' 文件 / ' + from.bytes + ' 字节：' + source);
  console.log('目标 ' + to.files + ' 文件 / ' + to.bytes + ' 字节：' + target);
  if (from.files !== to.files || from.bytes !== to.bytes) {
    console.error('不一致：先跑 npm run copy-plugin-app 重新同步产物');
    process.exit(1);
  }
  console.log('一致');
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
const copied = await measureOr(target, '目标目录');
console.log('已复制 ' + source + ' -> ' + target + (copied ? '（' + copied.files + ' 文件 / ' + copied.bytes + ' 字节）' : ''));
