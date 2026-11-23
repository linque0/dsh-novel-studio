/**
 * AI 知识库、向量检索、任务租约与每日用量配额的 Dexie 持久化仓。
 * 所有跨窗口共享的 AI 后台作业（知识提取/向量重建/记忆队列）均通过 airuns 租约与来源校验保证并发安全。
 */
import { readSourceSnapshot } from './project-repo.js'
import { SOURCE_TABLES, sourceManifest } from '../services/project/normalize.js'
import { db, now } from './database'
import { chapterHash } from '../services/ai/contracts'

const json = (value) => JSON.parse(JSON.stringify(value))
export async function aiRows(table, workId) {
  return db.table(table).where('workId').equals(workId).toArray()
}
export const kbRows = (workId) => aiRows('aikb', workId)
export const kbMeta = (workId) => aiRows('aikbmeta', workId)
export const decisions = (workId) => aiRows('aidecisions', workId)
export const putAiRow = (table, row) => db.table(table).put(json({ ...row, updatedAt: now() }))

/** 原子替换单章知识卡片与元数据：写前校对章节正文/哈希与任务租约，防止提取期间正文被改或租约过期覆盖新结果。 */
export async function replaceChapterKnowledge(workId, chapterId, cards, meta, expectedContent) {
  return db.transaction('rw', [...new Set([db.aikb, db.aikbmeta, db.chapters, db.airuns, ...(meta.queueGuard?SOURCE_TABLES.map(t=>db.table(t)):[])])], async () => {
    if(meta.queueGuard)await assertMemoryPublication(meta.queueGuard)
    const chapter = await db.chapters.get(chapterId)
    if (!chapter || chapter.workId !== workId || chapter.deletedAt || chapter.content !== expectedContent || chapterHash(chapter) !== meta.sourceHash) throw new Error('章节在提取期间已变化，结果未提交')
    if (meta.runId) {
      const run = await db.airuns.get(meta.runId)
      if (!run || run.owner !== meta.owner || run.status !== 'running' || run.leaseUntil < now()) throw new Error('知识库任务租约已失效')
    }
    await db.aikb.where('[workId+chapterId]').equals([workId, chapterId]).delete()
    if (cards.length) await db.aikb.bulkPut(json(cards))
    await db.aikbmeta.put(json(meta))
  })
}
/** 清空指定作品的全部知识库与向量缓存；若检测到其他窗口持有未过期构建租约则拒绝。 */
export async function clearKnowledge(workId) {
  await db.transaction('rw', db.aikb, db.aikbmeta, db.aikbvec, db.aikbblock, db.airuns, async () => {
    const jobs = await db.airuns.where('workId').equals(workId).toArray()
    if (jobs.some((j) => j.owner && j.leaseUntil > now() && ['knowledge','vectors'].includes(j.type))) throw new Error('另一窗口正在构建，请先暂停任务')
    for (const table of [db.aikb, db.aikbmeta, db.aikbvec, db.aikbblock]) await table.where('workId').equals(workId).delete()
  })
}
/** 全量替换作品的故事弧线（arc）卡片。 */
export async function replaceArcs(workId, cards) {
  return db.transaction('rw', db.aikb, async () => {
    await db.aikb.where('[workId+kind]').equals([workId, 'arc']).delete()
    if (cards.length) await db.aikb.bulkPut(json(cards))
  })
}
/** 申请或续占 airuns 分布式任务租约；若被其他窗口占用且尚未过期则返回 null。 */
export async function leaseJob({ id, workId, type, owner, ttl = 120000, patch = {} }) {
  return db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id)
    if (row?.owner && row.owner !== owner && row.leaseUntil > now()) return null
    const next = { ...row, ...json(patch), id, workId, type, owner, status: 'running', leaseUntil: now() + ttl, updatedAt: now() }
    await db.airuns.put(next)
    return next
  })
}
/** 仅在仍持有当前任务 owner 时更新任务状态/心跳。 */
export async function updateJob(id, owner, patch) {
  return db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id)
    if (!row || row.owner !== owner) return false
    await db.airuns.put({ ...row, ...json(patch), updatedAt: now() })
    return true
  })
}
export const jobById = (id) => db.airuns.get(id)
/** 预占当日 AI Token 配额（含过期预占清理），超出每日上限 cap 时返回 false。 */
export async function reserveDaily(owner, amount, cap) {
  const date = new Date().toLocaleDateString('en-CA')
  const id = 'daily:' + date
  return db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id) || { id, workId: '*', type: 'usage', used: 0, reservations: {} }
    row.reservations = Object.fromEntries(Object.entries(row.reservations || {}).filter(([, r]) => typeof r === "number" ? row.updatedAt + 120000 > now() : r.until > now()))
    if (row.used + Object.values(row.reservations).reduce((a, r) => a + (typeof r === "number" ? r : r.amount), 0) + amount > cap) return false
    row.reservations[owner] = { amount, until: now() + 300000 }
    row.updatedAt = now()
    await db.airuns.put(row)
    return id
  })
}
/** 结算每日配额：移除本次预占并将实际消耗累加到 used。 */
export async function settleDaily(id, owner, amount) {
  if (!id) return
  await db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id)
    if (!row) return
    delete row.reservations[owner]
    row.used += amount
    await db.airuns.put(row)
  })
}
export async function vectors(workId) { return aiRows('aikbvec', workId) }
export async function replaceVectors(workId, rows) {
  await db.transaction('rw', db.aikbvec, async () => {
    await db.aikbvec.where('workId').equals(workId).delete()
    if (rows.length) await db.aikbvec.bulkPut(rows)
  })
}

/** 校验记忆队列发布前条件：租约未过期且全书来源快照哈希与任务启动时一致。 */
export async function assertMemoryPublication(guard) {
  const job=await db.airuns.get(guard.id)
  if(!job||job.owner!==guard.owner||job.status!=='running'||job.leaseUntil<Date.now()||sourceManifest(await readSourceSnapshot(guard.workId)).hash!==guard.sourceVersion)throw new Error('记忆任务来源或租约已失效，结果未提交')
}
