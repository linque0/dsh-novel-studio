/* 本地安装：把本插件挂进 DSH 桌面 profile（幂等、可回退）。
 * 做法与 dsh-whale-widget 一致：先建无空格的目录联接，再用 link: 依赖 + bundles 装载。
 * 注意：改完必须重启 DSH 才生效（会话启动时读取 profile）。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..');
const PACKAGE = 'dsh-novel-studio';
const LINK_ROOT = join(homedir(), 'dsh-plugins');
const LINK_DIR = join(LINK_ROOT, PACKAGE);
const PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json');

const isWindows = process.platform === 'win32';

function ensureJunction() {
  if (existsSync(join(LINK_DIR, 'package.json'))) {
    console.log('联接已存在：' + LINK_DIR);
    return;
  }
  mkdirSync(LINK_ROOT, { recursive: true });
  if (isWindows) {
    execFileSync('cmd', ['/c', 'mklink', '/J', LINK_DIR, pluginDir], { stdio: 'inherit' });
  } else {
    execFileSync('ln', ['-s', pluginDir, LINK_DIR], { stdio: 'inherit' });
  }
  console.log('已建立联接：' + LINK_DIR + ' -> ' + pluginDir);
}

function patchProfile() {
  if (!existsSync(PROFILE)) {
    console.error('找不到 DSH profile：' + PROFILE);
    process.exit(1);
  }
  const raw = readFileSync(PROFILE, 'utf8');
  const pkg = JSON.parse(raw);
  const specifier = 'link:' + LINK_DIR.split('\\').join('/');
  pkg.dependencies = pkg.dependencies || {};
  const already = pkg.dependencies[PACKAGE] === specifier;
  pkg.dependencies[PACKAGE] = specifier;
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = new Set(pkg.dsh.profile.bundles || []);
  const hadBundle = bundles.has(PACKAGE);
  bundles.add(PACKAGE);
  pkg.dsh.profile.bundles = Array.from(bundles);
  if (already && hadBundle) {
    console.log('profile 已是目标状态，无需修改');
    return;
  }
  const backup = PROFILE + '.bak-' + Date.now();
  copyFileSync(PROFILE, backup);
  writeFileSync(PROFILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('已更新 profile（备份：' + backup + '）');
  console.log('  dependencies["' + PACKAGE + '"] = ' + specifier);
  console.log('  bundles 追加 ' + PACKAGE);
}

function ensureProfileEntry() {
  const modules = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules');
  const entry = join(modules, PACKAGE);
  if (existsSync(entry)) {
    console.log('profile 解析入口已存在：' + entry);
    return;
  }
  mkdirSync(modules, { recursive: true });
  execFileSync(process.execPath, ['-e', 'require("fs").symlinkSync(process.argv[1],process.argv[2],"junction")', pluginDir, entry], { stdio: 'inherit' });
  console.log('已建立 profile 解析入口：' + entry + ' -> ' + pluginDir);
}

ensureJunction();
ensureProfileEntry();
patchProfile();
console.log('');
console.log('下一步：完全退出并重启 DSH，然后看左侧栏底部是否出现「小说工坊」按钮。');
console.log('回退：删除 profile 里的依赖与 bundles 条目，或恢复上面那份 .bak 文件。');
