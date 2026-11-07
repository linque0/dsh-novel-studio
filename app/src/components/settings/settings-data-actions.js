/* 数据页（备份 / 恢复 / 回收站 / 写作概览）的动作编排。
 *
 * 与 Vue 无关：纯函数（文件名、时间文案、备份校验、摘要口径）和有副作用的动作分开，
 * 副作用集中在 deps 里，单测与打桩替换这一处即可，不必为了验一行文案去开真浏览器。
 *
 * 数据口径：数据页写的是「此设备上的内容」，所以一律读全库（不看当前是否打开作品）；
 * 设定在 v3 之后是 mubu 节点树，回收站里旧库残留的 lore 行也一起算，迁移前后都不漏。
 */
import { db } from '../../db/database.js'
import { exportBackupJson } from '../../db/repo.js'
import { restoreBackup } from '../../services/exporter.js'
import { pickFiles, saveTextFile } from '../../services/fileio.js'
import { broadcastAppEvent } from '../../services/appbus.js'
import { summarizeLibrary } from './settings-summary.js'

export const BACKUP_PREFIX = '小说工坊-完整备份-'
export const RESTORE_SNAPSHOT_KEY = 'novelstudio:settings:restoreSnapshot'
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024
export const SNAPSHOT_TTL_MS = 10 * 60 * 1000
/* 恢复前给别的窗口留出「冲刷并丢弃在途脏数据」的时间（appbus 的 db-restore-begin 协议） */
export const RESTORE_SETTLE_MS = 200

export const RESTORE_UNREADABLE = '文件无法读取，请选择完整的JSON备份。'
export const RESTORE_INCOMPATIBLE = '这份备份的格式与当前工作区不兼容。'
export const RESTORE_UNDO_SKIPPED = '备份较大，恢复后无法撤销。'

export const TRASH_KINDS = [
  { kind: 'chapters', label: '正文', table: 'chapters' },
  { kind: 'characters', label: '人物', table: 'characters' },
  { kind: 'lore', label: '设定', table: 'mubu' },
  { kind: 'snippets', label: '灵感', table: 'snippets' }
]

export const kindLabel = (kind) => TRASH_KINDS.find((item) => item.kind === kind)?.label || '条目'

const deps = {
  exportBackupJson,
  restoreBackup,
  saveTextFile,
  pickFiles,
  broadcastAppEvent,
  putConfig: (key, value) => db.appconfig.put({ key, value }),
  reload: () => window.location.reload()
}

/* 测试接缝：只在单测/冒烟里整体替换副作用，界面层永远走真实实现 */
export function setDataActionDeps(patch = {}) {
  Object.assign(deps, patch)
}
export function getDataActionDeps() {
  return { ...deps }
}

export class DataActionError extends Error {
  constructor(message, code = '') {
    super(message)
    this.name = 'DataActionError'
    this.code = code
  }
}

/* ---------- 纯函数 ---------- */

/* 备份文件名只用上海时区的日期，和总稿 app.mjs:20 的 filenameDate 一致 */
export function buildBackupFilename(now = new Date()) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return `${BACKUP_PREFIX}${date}.json`
}

/* 时间文案：数值时间戳与 ISO 字符串都认（回收站里两种历史数据都存在）；
   认不出就返回空串，由调用方决定是「尚未创建备份」还是干脆不写。 */
export function formatStamp(value) {
  const ms = typeof value === 'number' ? value : Number.isFinite(Date.parse(value)) ? Date.parse(value) : Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
}

export function formatBackupTime(value) {
  return formatStamp(value) || '尚未创建备份'
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

/* 备份规模：只数活着的行（回收站里的条目不算「恢复后会得到的内容」）；
   设定 = mubu 节点 + 旧库残留的 lore 行，迁移前后都不漏。 */
export function summarizeBackupDump(dump) {
  const data = dump?.data && typeof dump.data === 'object' ? dump.data : {}
  const count = (key) => (Array.isArray(data[key]) ? data[key].filter((row) => !row?.deletedAt).length : 0)
  return {
    works: count('works'),
    chapters: count('chapters'),
    characters: count('characters'),
    lore: count('mubu') + count('lore')
  }
}

/* 校验一份备份文本：读不出 → 不可读；结构不符 → 不兼容。
   只做「能不能用」的判断，不动库——真正的替换发生在用户勾选确认之后。 */
export function parseBackupText(text) {
  let dump
  try {
    dump = JSON.parse(String(text ?? ''))
  } catch {
    throw new DataActionError(RESTORE_UNREADABLE, 'unreadable')
  }
  if (!dump || typeof dump !== 'object' || !dump.data || typeof dump.data !== 'object') {
    throw new DataActionError(RESTORE_INCOMPATIBLE, 'incompatible')
  }
  for (const rows of Object.values(dump.data)) {
    if (!Array.isArray(rows)) throw new DataActionError(RESTORE_INCOMPATIBLE, 'incompatible')
  }
  return { text: String(text), createdAt: Number(dump.exportedAt) || 0, library: summarizeBackupDump(dump) }
}

const liveRows = (rows) => (Array.isArray(rows) ? rows.filter((row) => !row.deletedAt) : [])
const deadRows = (rows) => (Array.isArray(rows) ? rows.filter((row) => row.deletedAt) : [])
const stampOf = (row) => (typeof row.deletedAt === 'number' ? row.deletedAt : Date.parse(row.deletedAt) || 0)

export function trashRowName(kind, row) {
  if (kind === 'chapters') return String(row.title || '未命名章节')
  if (kind === 'characters') return String(row.name || '未命名人物')
  if (kind === 'lore') return String(row.text || '（空）').slice(0, 24)
  return String(row.content || '未命名灵感').slice(0, 24)
}

/* ---------- 有副作用的动作 ---------- */

/* 生成完整备份：文件名与「最近一次备份」时间戳都由这里定，备份文件已落盘才记时间 */
export async function createBackup(now = new Date()) {
  const filename = buildBackupFilename(now)
  const json = await deps.exportBackupJson()
  const saved = await deps.saveTextFile(filename, json)
  if (saved?.canceled) return { canceled: true, at: 0, filename }
  const at = Date.now()
  try {
    await deps.putConfig('settings:lastBackupAt', at)
  } catch {
    /* 文件已经生成，一行配置写失败不回滚整件事 */
  }
  return { canceled: false, at, filename }
}

function decodeBackupBytes(data) {
  if (typeof data === 'string') return data
  if (!data || !data.byteLength) throw new DataActionError(RESTORE_UNREADABLE, 'unreadable')
  try {
    return new TextDecoder('utf-8').decode(data)
  } catch {
    throw new DataActionError(RESTORE_UNREADABLE, 'unreadable')
  }
}

/* 选文件 + 校验；用户取消返回 null（不提示），校验失败抛 DataActionError（不打开弹窗） */
export async function pickBackupCandidate() {
  const files = await deps.pickFiles(['json'])
  if (!files || !files.length) return null
  return parseBackupText(decodeBackupBytes(files[0].data))
}

const sessionStore = () => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/* 恢复前的撤销快照：整份备份 JSON 写进 sessionStorage，刷新后还拿得到；
   超过 4MB 就不写（sessionStorage 有配额，写一半失败反而更糟）。 */
export async function writeRestoreSnapshot(storage = sessionStore()) {
  const json = await deps.exportBackupJson()
  const bytes = new TextEncoder().encode(json).length
  if (!storage) return { ok: false, bytes, oversize: false }
  if (bytes > SNAPSHOT_MAX_BYTES) {
    try { storage.removeItem(RESTORE_SNAPSHOT_KEY) } catch { /* 配额/隐私模式 */ }
    return { ok: false, bytes, oversize: true }
  }
  try {
    storage.setItem(RESTORE_SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), json }))
    return { ok: true, bytes, oversize: false }
  } catch {
    return { ok: false, bytes, oversize: false }
  }
}

/* 读撤销快照：过期（10 分钟）或损坏的直接丢弃并清键，避免下次刷新又弹一次 */
export function readRestoreSnapshot(storage = sessionStore(), now = Date.now()) {
  if (!storage) return null
  let raw = null
  try {
    raw = storage.getItem(RESTORE_SNAPSHOT_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const at = Number(parsed?.at) || 0
  const fresh = now - at <= SNAPSHOT_TTL_MS
  if (!parsed || typeof parsed.json !== 'string' || !at || !fresh) {
    clearRestoreSnapshot(storage)
    return null
  }
  return { at, json: parsed.json, bytes: new TextEncoder().encode(parsed.json).length }
}

export function clearRestoreSnapshot(storage = sessionStore()) {
  try {
    storage?.removeItem(RESTORE_SNAPSHOT_KEY)
  } catch {
    /* 隐私模式取不到 storage，没有键可清 */
  }
}

/* 恢复：先广播 begin（让别的窗口落盘并丢弃在途数据）→ 替换库 → 广播 restored → 重载 */
export async function applyBackupJson(text) {
  const buffer = new TextEncoder().encode(String(text ?? '')).buffer
  deps.broadcastAppEvent('db-restore-begin')
  await new Promise((resolve) => setTimeout(resolve, RESTORE_SETTLE_MS))
  await deps.restoreBackup(buffer)
  deps.broadcastAppEvent('db-restored')
  deps.reload()
}

/* ---------- 全库读数 ---------- */

const toArraySafe = (table, workId) => {
  if (workId) return db.table(table).where('workId').equals(workId).toArray().catch(() => db.table(table).toArray())
  return db.table(table).toArray()
}

/* 数据页右栏与「写作概览」共用一份读数：六项摘要 + 回收站条目 */
export async function loadLibrarySummary() {
  const [works, chapters, characters, mubu, lore, snippets] = await Promise.all([
    db.works.toArray(),
    db.chapters.toArray(),
    db.characters.toArray(),
    db.mubu.toArray(),
    db.lore.toArray(),
    db.snippets.toArray()
  ])
  const library = {
    works: liveRows(works),
    chapters: liveRows(chapters),
    characters: liveRows(characters),
    lore: [...liveRows(mubu), ...liveRows(lore)],
    trash: [...deadRows(chapters), ...deadRows(characters), ...deadRows(mubu), ...deadRows(lore), ...deadRows(snippets)]
  }
  return { ...summarizeLibrary(library), trashCount: library.trash.length }
}

/* 回收站列表：全库软删条目，按删除时间倒序；raw 留着交给 store 的还原/清除动作 */
export async function loadTrash() {
  const [works, chapters, characters, mubu, lore, snippets] = await Promise.all([
    db.works.toArray(),
    db.chapters.toArray(),
    db.characters.toArray(),
    db.mubu.toArray(),
    db.lore.toArray(),
    db.snippets.toArray()
  ])
  const workTitle = new Map(liveRows(works).map((row) => [row.id, row.title || '未命名作品']))
  const rows = []
  const push = (kind, table, list, nameOf) => {
    for (const raw of deadRows(list)) {
      rows.push({ id: raw.id, table, kind, workId: raw.workId || null, work: workTitle.get(raw.workId) || '', name: nameOf(raw), deletedAt: stampOf(raw), raw })
    }
  }
  push('chapters', 'chapters', chapters, (row) => trashRowName('chapters', row))
  push('characters', 'characters', characters, (row) => trashRowName('characters', row))
  push('lore', 'mubu', mubu, (row) => trashRowName('lore', row))
  push('lore', 'lore', lore, (row) => trashRowName('lore', row))
  push('snippets', 'snippets', snippets, (row) => trashRowName('snippets', row))
  rows.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
  const counts = { all: rows.length }
  for (const { kind } of TRASH_KINDS) counts[kind] = rows.filter((row) => row.kind === kind).length
  return { rows, counts }
}

/* 还原一条：设定走 mubuRestore（连子节点一起回来），其余走 restoreItem。
   设定节点只在「当前打开的作品」里才认得出子孙，跨作品的节点只能用通用还原。 */
export async function restoreTrashRow(work, row) {
  const inLoadedWork = work?.work?.id && work.work.id === row.workId
  if (row.table === 'mubu' && inLoadedWork && typeof work.mubuRestore === 'function') {
    work.mubuRestore(row.id)
    return row.name
  }
  await work.restoreItem(row.table, row.raw)
  return row.name
}

export async function purgeTrashRow(work, row) {
  const inLoadedWork = work?.work?.id && work.work.id === row.workId
  if (row.table === 'mubu' && inLoadedWork && typeof work.mubuPurge === 'function') {
    await work.mubuPurge(row.id)
    return row.name
  }
  await work.purgeItem(row.table, row.raw)
  return row.name
}

/* ---------- 导出 ---------- */

export async function loadExportWorks() {
  const works = liveRows(await db.works.toArray())
  return works.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export async function loadWorkChapters(workId) {
  if (!workId) return { volumes: [], chapters: [] }
  const [volumes, chapters] = await Promise.all([toArraySafe('volumes', workId), toArraySafe('chapters', workId)])
  return {
    volumes: liveRows(volumes),
    chapters: liveRows(chapters).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }
}
