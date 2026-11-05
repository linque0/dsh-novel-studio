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
export async function clearKnowledge(workId) {
  await db.transaction('rw', db.aikb, db.aikbmeta, db.aikbvec, db.aikbblock, db.airuns, async () => {
    const jobs = await db.airuns.where('workId').equals(workId).toArray()
    if (jobs.some((j) => j.owner && j.leaseUntil > now() && ['knowledge','vectors'].includes(j.type))) throw new Error('另一窗口正在构建，请先暂停任务')
    for (const table of [db.aikb, db.aikbmeta, db.aikbvec, db.aikbblock]) await table.where('workId').equals(workId).delete()
  })
}
export async function replaceArcs(workId, cards) {
  return db.transaction('rw', db.aikb, async () => {
    await db.aikb.where('[workId+kind]').equals([workId, 'arc']).delete()
    if (cards.length) await db.aikb.bulkPut(json(cards))
  })
}
export async function leaseJob({ id, workId, type, owner, ttl = 120000, patch = {} }) {
  return db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id)
    if (row?.owner && row.owner !== owner && row.leaseUntil > now()) return null
    const next = { ...row, ...json(patch), id, workId, type, owner, status: 'running', leaseUntil: now() + ttl, updatedAt: now() }
    await db.airuns.put(next)
    return next
  })
}
export async function updateJob(id, owner, patch) {
  return db.transaction('rw', db.airuns, async () => {
    const row = await db.airuns.get(id)
    if (!row || row.owner !== owner) return false
    await db.airuns.put({ ...row, ...json(patch), updatedAt: now() })
    return true
  })
}
export const jobById = (id) => db.airuns.get(id)
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

export async function assertMemoryPublication(guard) {
  const job=await db.airuns.get(guard.id)
  if(!job||job.owner!==guard.owner||job.status!=='running'||job.leaseUntil<Date.now()||sourceManifest(await readSourceSnapshot(guard.workId)).hash!==guard.sourceVersion)throw new Error('记忆任务来源或租约已失效，结果未提交')
}
