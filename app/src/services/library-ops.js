/* 同步层的纯逻辑（无 Dexie / 无 window），供 library-sync.js 调用并单测覆盖。 */
import { SOURCE_TABLES } from './project/normalize.js'

export const SYNCABLE = new Set([...SOURCE_TABLES, 'appconfig', 'aipresets', 'aipresetstate'])
export const SECRET_PREFIX = 'ai.cred'
export const MAX_PENDING = 200

export const revKey = (table, id) => table + ':' + id

export function isSyncable(table) {
  return SYNCABLE.has(table)
}

export function isSecretRow(table, row) {
  return table === 'appconfig' && String(row?.key || '').startsWith(SECRET_PREFIX)
}

/** 事务变更集 → 提交用 ops；未知表与密钥行被丢弃。 */
export function buildOps(changes, revisions) {
  const out = []
  for (const change of changes || []) {
    const table = change?.table
    const row = change?.row
    if (!isSyncable(table) || !row?.id) continue
    if (isSecretRow(table, row)) continue
    out.push({
      table,
      id: row.id,
      kind: change.kind === 'delete' ? 'delete' : 'put',
      baseRevision: revisions.get(revKey(table, row.id)) ?? 0,
      ...(change.kind === 'delete' ? {} : { row }),
    })
  }
  return out
}

/** 库里推回来的 op 若版本与自己已知的一致，说明是自己刚提交的回声，跳过。 */
export function shouldSkipEcho(op, revisions) {
  if (!op || !op.table || !op.id) return true
  return revisions.get(revKey(op.table, op.id)) === op.revision
}

export function applyRevisions(revisions, written) {
  for (const item of written || []) {
    if (!item?.table || !item?.id) continue
    revisions.set(revKey(item.table, item.id), item.revision)
  }
  return revisions
}

/** 把 ops 按表分组，便于批量 bulkPut / bulkDelete。 */
export function groupByTable(ops) {
  const puts = new Map()
  const dels = new Map()
  for (const op of ops || []) {
    if (!op?.table || !op?.id) continue
    if (op.kind === 'delete') {
      if (!dels.has(op.table)) dels.set(op.table, [])
      dels.get(op.table).push(op.id)
    } else if (op.row) {
      if (!puts.has(op.table)) puts.set(op.table, [])
      puts.get(op.table).push(op.row)
    }
  }
  return { puts, dels }
}

/** 有界队列：保留最新的 limit 条（旧的高风险，丢了让库为准）。 */
export function boundQueue(queue, limit = MAX_PENDING) {
  if (!Array.isArray(queue)) return []
  return queue.length <= limit ? queue : queue.slice(queue.length - limit)
}

export function revisionsToJSON(revisions) {
  return JSON.stringify(Object.fromEntries(revisions))
}

export function revisionsFromJSON(text) {
  const map = new Map()
  if (!text) return map
  try {
    for (const [key, value] of Object.entries(JSON.parse(text))) {
      if (Number.isSafeInteger(value)) map.set(key, value)
    }
  } catch {
    /* 损坏就当空 */
  }
  return map
}
