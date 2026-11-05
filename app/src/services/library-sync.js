/* 作品库同步层（M3）：把 Dexie 变成作品库的投影。
 * - 本地写：Dexie 事务提交后由 database.js 的 tap 交给我们 → 批量 submit 到库
 * - 远端写：轮询 pull → 在 pauseWriteTap 保护下 bulkPut 进 Dexie（避免回环）
 * - 冲突：库为准，重拉该批；本地待提交队列有界（默认 200），溢出丢最旧
 * 只在主进程提供 window.native.library* 时启用，否则整层静默不装。 */
import { db, setWriteTap, pauseWriteTap, resumeWriteTap } from '../db/database'
import { libraryAvailable, librarySnapshot, libraryPull, librarySubmit } from './library'
import {
  MAX_PENDING, applyRevisions, boundQueue, buildOps, groupByTable,
  revKey, revisionsFromJSON, revisionsToJSON, shouldSkipEcho,
} from './library-ops'

const REV_KEY = 'ns.library.revisions.v1'
const PULL_MS = 1500

let installed = false
let lastSeq = 0
let pending = []
let revisions = new Map()
let flushing = null
let pullTimer = null
let applying = 0
let conflicts = 0

function log(...args) {
  console.info('[library]', ...args)
}

function loadRevisions() {
  try {
    revisions = revisionsFromJSON(globalThis.localStorage?.getItem(REV_KEY))
  } catch {
    revisions = new Map()
  }
}

function saveRevisions() {
  try {
    globalThis.localStorage?.setItem(REV_KEY, revisionsToJSON(revisions))
  } catch {
    /* 存不下不影响内存态 */
  }
}

function pause() {
  applying += 1
  pauseWriteTap()
}

function resume() {
  applying = Math.max(0, applying - 1)
  resumeWriteTap()
}

/** 本地变更 → 待提交队列 */
function onLocalWrite(changes) {
  if (applying > 0) return
  const ops = buildOps(changes, revisions)
  if (!ops.length) return
  pending = boundQueue([...pending, ...ops], MAX_PENDING)
  void flush()
}

async function flush() {
  if (flushing || !pending.length || !libraryAvailable()) return
  flushing = (async () => {
    const batch = pending.splice(0, 50)
    const requestId = 'desk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    try {
      const result = await librarySubmit({ requestId, ops: batch, actor: { kind: 'human' } })
      applyRevisions(revisions, result?.revisions)
      saveRevisions()
      conflicts = 0
      if (result?.replayed) log('重复提交已被幂等吞掉', requestId)
    } catch (error) {
      if (error?.code === 'CONFLICT') {
        conflicts += 1
        if (conflicts > 2) {
          log('同一批连续冲突，改为以库为准丢弃本地这批改动', error.message)
          conflicts = 0
          await pullOnce()
        } else {
          log('本地与库版本冲突，刷新版本后重放这批改动', error.message)
          await refreshRevisions()
          const retried = batch.map((op) => ({ ...op, baseRevision: revisions.get(revKey(op.table, op.id)) ?? 0 }))
          pending = boundQueue([...retried, ...pending], MAX_PENDING)
          setTimeout(() => void flush(), 300)
        }
      } else {
        log('提交失败，回队重试', error?.code || error?.message)
        pending = boundQueue([...batch, ...pending], MAX_PENDING)
        setTimeout(() => void flush(), 2000)
      }
    }
  })().finally(() => {
    flushing = null
    if (pending.length) setTimeout(() => void flush(), 200)
  })
}

/** 库里的附件是 dataUrl（JSON 存不了 Blob），写回 Dexie 前转回 Blob。 */
async function toLocalRow(table, row) {
  if (table !== 'assets' || !row) return row
  const { dataUrl, ...meta } = row
  if (!dataUrl) return meta
  try {
    const blob = await (await fetch(dataUrl)).blob()
    return { ...meta, blob }
  } catch {
    return meta
  }
}

/** 把库里的 op 应用到 Dexie（暂停 tap 防回环） */
async function applyRemote(ops) {
  const { puts, dels } = groupByTable(ops)
  if (!puts.size && !dels.size) return
  pause()
  try {
    for (const [table] of puts) {
      const rows = []
      for (const row of puts.get(table)) rows.push(await toLocalRow(table, row))
      await db.table(table).bulkPut(rows)
    }
    for (const [table] of dels) {
      await db.table(table).bulkDelete(dels.get(table))
    }
  } finally {
    resume()
  }
}

/** 只刷新版本基线（用于冲突后重放），不动 Dexie。 */
async function refreshRevisions() {
  try {
    const snapshot = await librarySnapshot()
    for (const [key, revision] of Object.entries(snapshot?.revisions || {})) {
      if (Number.isSafeInteger(revision)) revisions.set(key, revision)
    }
    saveRevisions()
    lastSeq = Number(snapshot?.seq) || lastSeq
  } catch (error) {
    log('刷新版本基线失败', error?.code || error?.message)
  }
}

async function pullOnce() {
  if (!libraryAvailable()) return
  try {
    const result = await libraryPull(lastSeq)
    lastSeq = Number(result?.seq) || lastSeq
    const fresh = (result?.ops || []).filter((op) => !shouldSkipEcho(op, revisions))
    for (const op of result?.ops || []) applyRevisions(revisions, [{ table: op.table, id: op.id, revision: op.revision }])
    saveRevisions()
    if (fresh.length) await applyRemote(fresh)
  } catch (error) {
    log('拉取失败', error?.code || error?.message)
  }
}

function schedulePull() {
  clearTimeout(pullTimer)
  pullTimer = setTimeout(async () => {
    await pullOnce()
    schedulePull()
  }, PULL_MS)
}

/** 首次 hydrate：库有数据就以库为准灌进 Dexie（本地未提交的改动排在后面）。 */
async function hydrate() {
  const snapshot = await librarySnapshot()
  const tables = Object.keys(snapshot?.data || {})
  const rows = tables.reduce((sum, table) => sum + (snapshot.data[table]?.length || 0), 0)
  if (!rows) {
    log('作品库为空：保持本地数据，等作者迁移或首次写入')
    return { rows: 0 }
  }
  pause()
  try {
    for (const table of tables) {
      const list = snapshot.data[table] || []
      if (!list.length) continue
      const rows = []
      for (const row of list) rows.push(await toLocalRow(table, row))
      await db.table(table).bulkPut(rows)
    }
  } finally {
    resume()
  }
  // 版本基线：snapshot.revisions 形如 { 'chapters:c1': 3 }
  for (const [key, revision] of Object.entries(snapshot.revisions || {})) {
    if (Number.isSafeInteger(revision)) revisions.set(key, revision)
  }
  lastSeq = Number(snapshot?.seq) || 0
  saveRevisions()
  log('hydrate 完成：' + rows + ' 行')
  return { rows }
}

export async function installLibrarySync() {
  if (installed) return { enabled: false, reason: 'already' }
  if (!libraryAvailable()) {
    log('主进程未提供作品库通道：同步层不启用')
    return { enabled: false, reason: 'no-native' }
  }
  installed = true
  loadRevisions()
  await hydrate()
  setWriteTap(onLocalWrite)
  schedulePull()
  log('同步层已启用（本地写 → 库；库 → Dexie 每 ' + PULL_MS + 'ms）')
  return { enabled: true, pending: pending.length, seq: lastSeq }
}

export function librarySyncState() {
  return { installed, seq: lastSeq, pending: pending.length, revisions: revisions.size }
}

export async function flushLibraryNow() {
  await flush()
}
