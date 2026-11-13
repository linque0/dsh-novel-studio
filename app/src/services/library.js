/* 作品库桥（渲染进程）：只有 Electron 主进程提供 window.native.library* 时可用。
 * M2 阶段只做"导出备份 → 导入作品库 → 核对"，不改变任何既有写入路径；
 * 真正把 Dexie 降级为投影是 M3 的事。 */

const bridge = () => (typeof window !== 'undefined' ? window.native : null)

/** 两种宿主两种返回形状：
 *  - 桌面版 IPC：{ ok: true, value } / { ok: false, error }
 *  - 插件版 shim：直接返回 value（HTTP RPC 已在 shim 里解过信封）
 * 这里统一兼容，避免"作品库操作失败"这种没有信息量的报错。 */
function unwrap(result) {
  if (result === undefined || result === null) throw new Error('主进程未提供作品库通道')
  if (result && result.ok === true) return result.value
  if (result && result.ok === false) {
    const error = new Error(result.error?.message || '作品库操作失败')
    error.code = result.error?.code || 'ERROR'
    throw error
  }
  return result
}

export function libraryAvailable() {
  const native = bridge()
  return !!(native && typeof native.libraryStatus === 'function')
}

export async function libraryPointer() {
  return unwrap(await bridge().libraryPointer())
}

export async function libraryStatus(options = {}) {
  return unwrap(await bridge().libraryStatus(options))
}

export async function libraryVerify(options = {}) {
  return unwrap(await bridge().libraryVerify(options))
}

export async function libraryPull(after = 0, options = {}) {
  return unwrap(await bridge().libraryPull({ ...options, after }))
}

export async function librarySnapshot(options = {}) {
  return unwrap(await bridge().librarySnapshot(options))
}

export async function librarySubmit(payload) {
  return unwrap(await bridge().librarySubmit(payload))
}

/**
 * 首次迁移：把当前 Dexie 数据导出为 dump 并写入作品库。
 * 不覆盖已有库（force: false），失败时抛错且不动本地数据。
 */
export async function migrateToLibrary({ onProgress } = {}) {
  const native = bridge()
  if (!native?.libraryImport) throw new Error('当前环境不支持作品库导入')
  const { exportBackupJson } = await import('../db/repo.js')
  onProgress?.('导出本地备份…')
  const dump = JSON.parse(await exportBackupJson())
  onProgress?.('写入作品库…')
  const imported = unwrap(await native.libraryImport({ dump, force: false }))
  onProgress?.('核对作品库…')
  const verify = unwrap(await native.libraryVerify())
  return { imported: imported.imported, seq: imported.seq, verify }
}

/* 作品数据存储位置（隐现设置·数据页）：桌面走 IPC，插件走 shim 转 RPC，两边方法名相同。
 * 插件版的 libraryBrowse / libraryRelocate 由 shim 实现（服务端列目录 + 移动式迁移）。
 * 三个函数调用前都先确认宿主确实挂了同名方法：纯网页（npm run dev 的桌面仓库）里 bridge()
 * 有对象却没有这三个通道，unwrap(await undefined) 抛出来的是没有信息量的话。 */
function libraryChannel(method) {
  const native = bridge()
  if (typeof native?.[method] !== 'function') throw new Error('未检测到作品库通道，当前环境不支持更改数据存储位置')
  return native
}

export async function libraryLocation() {
  return unwrap(await libraryChannel('libraryLocation').libraryLocation())
}

export async function libraryBrowse(dir = '') {
  return unwrap(await libraryChannel('libraryBrowse').libraryBrowse(dir))
}

export async function libraryRelocate(dir) {
  return unwrap(await libraryChannel('libraryRelocate').libraryRelocate(dir))
}
