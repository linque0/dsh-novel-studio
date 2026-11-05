/* link:app-deps —— 重建 app/node_modules 依赖联接。
 *
 * app/ 是独立前端工程，但本机无网、不能 npm install；app/node_modules 原本是指向
 * 桌面仓库 node_modules 的目录联接。这个脚本只做两件事：判断联接是否仍然可用；
 * 不可用时重建它。不联网、不装包、不碰 app/ 里的源码。
 *
 * 用法：npm run link:app-deps
 */
import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const APP_DIR = join(REPO, 'app')
const APP_MODULES = join(APP_DIR, 'node_modules')
const DESKTOP_MODULES = resolve(REPO, '..', 'novel-studio', 'node_modules')
const LOG = '[link:app-deps] '

function canResolveVite() {
  try {
    const require = createRequire(join(APP_DIR, 'package.json'))
    require.resolve('vite')
    return true
  } catch {
    return false
  }
}

async function stateOf(p) {
  try {
    const s = await lstat(p)
    if (s.isSymbolicLink()) return 'link'
    if (s.isDirectory()) return 'dir'
    return 'other'
  } catch {
    return 'none'
  }
}

async function main() {
  const state = await stateOf(APP_MODULES)

  if (state === 'link' || state === 'dir') {
    if (canResolveVite()) {
      const target = state === 'link' ? await readlink(APP_MODULES).catch(() => '?') : '(实体目录)'
      console.log(LOG + 'app/node_modules 已就绪（' + (state === 'link' ? '目录联接' : '实体目录') + ' -> ' + target + '），vite 可解析')
      console.log(LOG + '已是联接/已装依赖，无需动作，exit 0')
      return 0
    }
    console.log(LOG + 'FAIL：app/node_modules 存在（' + state + '）但解析不到 vite —— 联接已断或依赖不完整。')
    console.log(LOG + '处理：删掉 app/node_modules 后重跑 npm run link:app-deps；或 cd app && npm i 彻底独立。')
    return 1
  }

  if (!existsSync(DESKTOP_MODULES)) {
    console.log(LOG + 'FAIL：依赖源不存在 —— ' + DESKTOP_MODULES)
    console.log(LOG + '本机无网，二选一：')
    console.log(LOG + '  1) 在 ../novel-studio 执行 npm i 恢复桌面仓库依赖，再重跑 npm run link:app-deps')
    console.log(LOG + '  2) 彻底独立：cd app && npm i（产物自带 node_modules，不再依赖桌面仓库）')
    return 1
  }

  await mkdir(APP_DIR, { recursive: true })
  try {
    await symlink(DESKTOP_MODULES, APP_MODULES, 'junction')
  } catch (e) {
    console.log(LOG + 'FAIL：创建目录联接失败 —— ' + String(e && e.message || e))
    console.log(LOG + '可退回独立安装：cd app && npm i')
    return 1
  }
  if (!canResolveVite()) {
    console.log(LOG + 'FAIL：联接已建立但解析不到 vite，检查 ' + DESKTOP_MODULES + ' 里是否真有 vite')
    return 1
  }
  console.log(LOG + '已创建目录联接 app/node_modules -> ' + DESKTOP_MODULES + '，vite 可解析')
  return 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.log(LOG + 'FAIL：' + String(e && e.message || e))
  process.exit(1)
})
