/* 卸载本地安装（与 install-local.mjs 对称，幂等）。 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE = 'dsh-novel-studio';
const PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json');
const PROFILE_ENTRY = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', PACKAGE);
const LINK_DIR = join(homedir(), 'dsh-plugins', PACKAGE);

if (existsSync(PROFILE)) {
  const pkg = JSON.parse(readFileSync(PROFILE, 'utf8'));
  let changed = false;
  if (pkg.dependencies && pkg.dependencies[PACKAGE]) {
    delete pkg.dependencies[PACKAGE];
    changed = true;
  }
  const bundles = (pkg.dsh?.profile?.bundles || []).filter((name) => name !== PACKAGE);
  if (bundles.length !== (pkg.dsh?.profile?.bundles || []).length) {
    pkg.dsh.profile.bundles = bundles;
    changed = true;
  }
  if (changed) {
    const backup = PROFILE + '.bak-' + Date.now();
    copyFileSync(PROFILE, backup);
    writeFileSync(PROFILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('已从 profile 移除 ' + PACKAGE + '（备份：' + backup + '）');
  } else {
    console.log('profile 里没有 ' + PACKAGE + '，无需修改');
  }
}

for (const target of [PROFILE_ENTRY, LINK_DIR]) {
  if (existsSync(target)) {
    try {
      rmSync(target, { recursive: true, force: true });
      console.log('已删除联接：' + target);
    } catch (error) {
      console.warn('删除失败（可能需要管理员）：' + target + ' → ' + (error?.message || error));
    }
  }
}
console.log('作品库数据未删除（默认在 %LOCALAPPDATA%\\novel-studio\\library）');
console.log('卸载完成，重启 DSH 生效。');
