import { memoryJob, recoverMemoryJob } from '../services/ai/memory-queue-core.js'
import { db, uid, now, todayStr } from './database'
import { htmlToMd, htmlToPlain } from '../services/importers'
import { suspendProjection, resumeProjection } from './project-repo.js'
import { DEFAULT_MUBU_SETS } from '../components/lore/lore-kinds.js'
import { readWritingPosition } from '../services/writing-position.js'
import { resolveWritingChapter } from '../services/writing-position-core.js'
import { STATS_TABLES, buildWritingStats, chapterWordChange, statsDates } from '../services/writing-stats-core.js'

/**
 * Repository 层：所有 Dexie 访问集中在此。
 * 后续迁移到 SQLite（Electron 主进程）时只需替换本模块实现，stores 无需改动。
 */

export async function loadWorkBundle(workId) {
  const [
    works, volumes, chapters, outlines, characters, relations,
    lorecats, lore, snippets, assetRows, links, mubu, annotations, lorelinks
  ] = await Promise.all([
    db.works.get(workId),
    db.volumes.where('workId').equals(workId).toArray(),
    db.chapters.where('workId').equals(workId).toArray(),
    db.outlines.where('workId').equals(workId).toArray(),
    db.characters.where('workId').equals(workId).toArray(),
    db.relations.where('workId').equals(workId).toArray(),
    db.lorecats.where('workId').equals(workId).toArray(),
    db.lore.where('workId').equals(workId).toArray(),
    db.snippets.where('workId').equals(workId).toArray(),
    db.assets.where('workId').equals(workId).toArray(),
    db.links.toArray(),
    db.mubu.where('workId').equals(workId).toArray(),
    db.annotations.where('workId').equals(workId).toArray(),
    db.lorelinks.where('workId').equals(workId).toArray()
  ])
  // 资产只保留元信息，blob 按需读取，避免大图全部驻留内存
  const assets = assetRows.map(({ blob, ...meta }) => meta)
  const olnodes = await db.olnodes.where('workId').equals(workId).toArray()
  return { work: works, volumes, chapters, outlines, characters, relations, lorecats, lore, snippets, assets, links, mubu, annotations, lorelinks, olnodes }
}

export async function listWorks() {
  const rows = await db.works.orderBy('updatedAt').reverse().toArray()
  const live = rows.filter((w) => !w.deletedAt)
  const result = []
  for (const w of live) {
    const chs = await db.chapters.where('[workId+deletedAt]').equals([w.id, null]).toArray() 
      .catch(() => db.chapters.where('workId').equals(w.id).filter((c) => !c.deletedAt).toArray())
    result.push({
      ...w,
      chapterCount: chs.length,
      totalWords: chs.reduce((s, c) => s + (c.wordCount || 0), 0)
    })
  }
  return result
}

/** 书架「首章白卡」用：该书首卷的首章（按卷序 → 章序，无卷章排在最后兜底）；没有则返回 null */
export async function firstChapterOf(workId) {
  const [vols, chs] = await Promise.all([
    db.volumes.where('workId').equals(workId).toArray(),
    db.chapters.where('[workId+deletedAt]').equals([workId, null]).toArray()
      .catch(() => db.chapters.where('workId').equals(workId).filter((c) => !c.deletedAt).toArray())
  ])
  const live = chs.filter((c) => !c.deletedAt)
  const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  const ofVol = (vid) => live.filter((c) => c.volumeId === vid).sort(bySort)
  for (const v of vols.filter((x) => !x.deletedAt).sort(bySort)) {
    const hit = ofVol(v.id)[0]
    if (hit) return hit
  }
  return ofVol(null)[0] || live.sort(bySort)[0] || null
}

/** Resume cards must show the same live chapter that opening the work selects. */
export async function resumeChapterOf(workId) {
  const [chapters,volumes,position] = await Promise.all([
    db.chapters.where('workId').equals(workId).toArray(),
    db.volumes.where('workId').equals(workId).toArray(),
    readWritingPosition(workId)
  ])
  return resolveWritingChapter({chapters,volumes},position)
}

export async function createWorkRow(payload) {
  const workId = uid()
  const t = now()
  const work = {
    id: workId,
    title: payload.title,
    author: payload.author || '',
    genre: payload.genre || '其他',
    intro: payload.intro || '',
    status: payload.status || '构思',
    kind: payload.kind || 'novel', // 封面款式（色带书封六选一，缺省虚构·克莱因蓝）
    createdAt: t,
    updatedAt: t,
    deletedAt: null
  }
  await db.works.add(work)
  await db.appconfig.put({ key: 'olcanvas:' + workId, value: { snap: true, density: 'detail', edgeStyle: 'ortho', edgeWidth: 1.8, arrowSize: 1 } })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '', updatedAt: t })
  return work
}

export async function seedWorkDefaults(workId, { withVolume = true } = {}) {
  const t = now()
  if (withVolume) {
    const volId = uid()
    await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  }
  // 新作品直接落六个默认设定集（与 ensureDefaultMubuSets 同一真源），不再写旧 lorecats
  for (const [i, set] of DEFAULT_MUBU_SETS.entries()) {
    await db.mubu.add({
      id: uid(), workId, parentId: null, sortOrder: i * 1000,
      text: set.text, html: null, fold: false, deletedAt: null,
      createdAt: t, updatedAt: t, kind: set.kind
    })
  }
}

export async function putRow(table, row, opts = {}) {
  row.updatedAt = now()
  if (table === 'chapters' && (opts.memoryIntent || opts.recordWordDelta)) {
    const job = opts.memoryIntent && !row.deletedAt ? memoryJob(row, opts.memoryIntent) : null
    const tables = [db.chapters, ...(job ? [db.airuns] : []), ...(opts.recordWordDelta ? [db.wordlog] : [])]
    await db.transaction('rw', tables, async () => {
      const delta = opts.recordWordDelta ? chapterWordChange(await db.chapters.get(row.id), row) : 0
      await db.chapters.put(JSON.parse(JSON.stringify(row)))
      if (delta) await addWordLog(row.workId, row.id, delta)
      if (job && !await db.airuns.get(job.id)) await db.airuns.put(job)
    })
    return job ? { ...row, memoryJobId: job.id } : row
  }
  await db.table(table).put(JSON.parse(JSON.stringify(row)))
  return row
}

export async function softDeleteRow(table, row) {
  row.deletedAt = now()
  row.updatedAt = row.deletedAt
  await db.table(table).put(JSON.parse(JSON.stringify(row)))
  return row
}

export async function restoreRow(table, row) {
  row.deletedAt = null
  row.updatedAt = now()
  await db.table(table).put(JSON.parse(JSON.stringify(row)))
  return row
}

export async function purgeRow(table, row) {
  await db.table(table).delete(row.id)
}

export async function addWordLog(workId, chapterId, delta) {
  if (!delta) return
  await db.wordlog.add({ id: uid(), workId, chapterId, date: todayStr(), delta, createdAt: now() })
}

export async function getWordLogs(workId) {
  return workId ? db.wordlog.where('workId').equals(workId).toArray() : db.wordlog.toArray()
}

/** One committed read, scoped by work ID. Historical logs need at most 90 local dates. */
export async function readWritingStats(workId, days = 30) {
  const today = todayStr(), start = statsDates(today, 90)[0]
  const source = await db.transaction('r', [...STATS_TABLES.map(name => db.table(name)), db.revisions], async () => {
    const works = (await db.works.toArray()).filter(w => !w.deletedAt)
    const selected = works.filter(w => workId == null || w.id === workId).map(w => w.id)
    const tables = STATS_TABLES.filter(name => !['works', 'wordlog'].includes(name))
    const rows = await Promise.all(tables.map(name => selected.length ? db.table(name).where('workId').anyOf(selected).toArray() : []))
    const workIds = new Set(selected)
    const wordlog = selected.length ? await db.wordlog.where('date').between(start, today, true, true).filter(row => workIds.has(row.workId)).toArray() : []
    const data = Object.fromEntries(tables.map((name, i) => [name, rows[i]]))
    const chapterOwners = new Map((data.chapters || []).filter(c=>!c.deletedAt).map(c=>[c.id,c.workId]))
    const revisions = []
    await db.revisions.where('createdAt').aboveOrEqual(new Date(start+'T00:00:00').getTime()).each(r=>{
      if(r.entityType==='chapter' && chapterOwners.has(r.entityId))revisions.push({id:r.id,entityType:r.entityType,entityId:r.entityId,workId:chapterOwners.get(r.entityId),createdAt:r.createdAt})
    })
    return { works, wordlog, revisions, ...data }
  })
  return {
    choices: source.works.map(w => ({ id: w.id, label: w.title || '未命名作品' })),
    stats: buildWritingStats(source, { workId, days, today })
  }
}

/** Validate ownership again at expansion; historical text is never included in overview reads. */
export async function readWritingStatsRevision(id, workId, chapterId) {
  return db.transaction('r',db.chapters,db.revisions,async()=>{
    const chapter=await db.chapters.get(chapterId), revision=await db.revisions.get(id)
    if(!chapter||chapter.deletedAt||chapter.workId!==workId||!revision||revision.entityType!=='chapter'||revision.entityId!==chapterId)throw new Error('此版本已不存在或不属于当前章节')
    return {id:revision.id,createdAt:revision.createdAt,content:revision.content||'',fmt:['html','text'].includes(revision.fmt)?revision.fmt:null}
  })
}

/* ---- 版本快照 ---- */

export async function addRevision(entityType, entityId, content, fmt) {
  await db.revisions.add({ id: uid(), entityType, entityId, content, ...(['html','text'].includes(fmt)?{fmt}:{}), createdAt: now() })
  const all = await db.revisions.where('[entityType+entityId]').equals([entityType, entityId]).toArray()
  if (all.length > 30) {
    all.sort((a, b) => a.createdAt - b.createdAt)
    await db.revisions.bulkDelete(all.slice(0, all.length - 30).map((r) => r.id))
  }
}

export async function listRevisions(entityType, entityId) {
  const rows = await db.revisions.where('[entityType+entityId]').equals([entityType, entityId]).toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

/* ---- 资产 ---- */

export async function addAssetRow(workId, name, mime, blob) {
  const row = { id: uid(), workId, name, mime, size: blob.size, blob, createdAt: now(), deletedAt: null }
  await db.assets.add(row)
  const { blob: _b, ...meta } = row
  return meta
}

export async function getAssetBlob(id) {
  const row = await db.assets.get(id)
  return row ? row.blob : null
}

export async function deleteAssetRow(row, purge = false) {
  if (purge) {
    await db.assets.delete(row.id)
    const ls = await db.links.where('assetId').equals(row.id).toArray()
    await db.links.bulkDelete(ls.map((l) => l.id))
  } else {
    row.deletedAt = now()
    await db.assets.put({ ...row, deletedAt: row.deletedAt })
  }
}

export async function addLink(entityType, entityId, assetId, sortOrder = 0) {
  const row = { id: uid(), entityType, entityId, assetId, sortOrder }
  await db.links.add(row)
  return row
}

export async function removeLink(linkId) {
  await db.links.delete(linkId)
}

/* ---- 备份 / 恢复 ---- */

export async function exportBackupJson() {
  const tables = ['works', 'volumes', 'chapters', 'outlines', 'characters', 'relations', 'lorecats', 'lore', 'mubu', 'lorelinks', 'snippets', 'links', 'wordlog', 'appconfig', 'bookmarks', 'olnodes', 'annotations', 'aisum', 'aikb', 'aikbmeta', 'airuns', 'aidecisions', 'aistyle', 'aikbvec', 'aipresets', 'aipresetstate']
  const dump = { version: 1, exportedAt: now(), assets: [], data: {} }
  for (const t of tables) {
    const rows = await db.table(t).toArray()
    /* 密钥绝不进备份 JSON（方案 §三/§六.4）：appconfig 的 ai.credential / ai.cred.<供应商id>（safeStorage 密文）
       导出时按 ai.cred 前缀整体剔除，恢复备份后需在模型设置重新配置 API 密钥 */
    dump.data[t] = t === 'appconfig' ? rows.filter((r) => !String(r?.key || '').startsWith('ai.cred')) : t === 'aikbvec' ? rows.map((r) => ({ ...r, vec: Array.from(new Float32Array(r.vec)) })) : t === 'airuns' ? rows.map((r) => (recoverMemoryJob({ ...r, owner: null, leaseUntil: 0, status: r.status === 'running' ? (r.type==='memory-queue'?'interrupted':'paused') : r.status }))) : rows
  }
  const assetRows = await db.assets.toArray()
  for (const a of assetRows) {
    const base64 = a.blob ? await blobToDataUrl(a.blob) : null
    const {blob,...meta}=a
    dump.assets.push({ ...meta, dataUrl: base64 })
  }
  return JSON.stringify(dump)
}

export async function importBackupJson(text) {
  const dump = JSON.parse(text)
  if (!dump || !dump.data) throw new Error('备份文件格式不正确')
  // Validate before clearing; old backups may omit new AI tables.
  for (const [t, rows] of Object.entries(dump.data)) {
    if (!db.tables.some((table) => table.name === t) || !Array.isArray(rows)) throw new Error('备份包含未知数据表或无效条目：' + t)
  }
  const assets = []
  for (const a of dump.assets || []) {
    const { dataUrl, ...meta } = a
    if (dataUrl && !/^data:/.test(dataUrl)) throw new Error('备份资源必须为内嵌数据')
    const blob = dataUrl ? await (await fetch(dataUrl)).blob() : null
    assets.push({ ...meta, blob })
  }
  window.dispatchEvent(new CustomEvent('memory-queue-cancel'))
  suspendProjection()
  try { await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    for (const [t, rows] of Object.entries(dump.data)) {
      const restored = t === 'aikbvec' ? rows.map((r) => ({ ...r, vec: new Float32Array(r.vec || []).buffer })) : t === 'airuns' ? rows.map((r) => (recoverMemoryJob({ ...r, owner: null, leaseUntil: 0, status: r.status === 'running' ? (r.type==='memory-queue'?'interrupted':'paused') : r.status }))) : t === 'appconfig' ? rows.filter((r) => !String(r?.key || '').startsWith('ai.cred')) : rows
      if (restored.length) await db.table(t).bulkPut(restored)
    }
    if (assets.length) await db.assets.bulkPut(assets)
  }) } finally { resumeProjection() }
  return true
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/* ---- 全书导出 ---- */

/** 组装导出章节序列：按卷排序，可选 onlyIds 过滤（v1.0.4 按章节勾选导出）；返回 [{ vol, ch }] */
export function collectExportChapters(volumes, chapters, onlyIds) {
  const keep = (c) => !c.deletedAt && (!onlyIds || onlyIds.has(c.id))
  const vols = volumes.filter((v) => !v.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const out = []
  const used = new Set()
  for (const v of vols) {
    const chs = chapters.filter((c) => keep(c) && c.volumeId === v.id).sort((a, b) => a.sortOrder - b.sortOrder)
    for (const c of chs) {
      used.add(c.id)
      out.push({ vol: v, ch: c })
    }
  }
  for (const c of chapters.filter((x) => keep(x) && !used.has(x.id)).sort((a, b) => a.sortOrder - b.sortOrder)) {
    out.push({ vol: null, ch: c })
  }
  return out
}

export async function buildBookText(work, volumes, chapters, asMarkdown, onlyIds = null) {
  const asFmt = (c) => {
    /* fmt 缺失但内容含标签（历史数据）也按 html 处理 */
    if (c.fmt === 'html' || (c.fmt !== 'text' && /<[a-z][\s\S]*>/i.test(c.content || ''))) return asMarkdown ? htmlToMd(c.content) : htmlToPlain(c.content)
    return c.content || ''
  }
  const rows = collectExportChapters(volumes, chapters, onlyIds)
  const lines = []
  lines.push(asMarkdown ? `# ${work.title}` : `${work.title}`)
  if (work.author) lines.push(asMarkdown ? `> 作者：${work.author}` : `作者：${work.author}`)
  lines.push('')
  let lastVol = undefined
  for (const { vol, ch } of rows) {
    if (vol && vol !== lastVol) {
      lines.push(asMarkdown ? `## ${vol.title}` : `【${vol.title}】`, '')
      lastVol = vol
    }
    if (!vol && lastVol !== null) lastVol = null
    lines.push(asMarkdown ? `### ${ch.title}` : ch.title, '', asFmt(ch), '', '')
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}
