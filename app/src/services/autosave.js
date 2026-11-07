import { mergeMemoryIntent } from './ai/memory-queue-core.js'
import { useUiStore } from '../stores/ui'
import { putRow, addRevision } from '../db/repo'
import { markChapterStale } from './ai/summarize'
import { SOURCE_TABLES } from './project/normalize.js'
import { captureWritingPositions, flushWritingPositions, discardWritingPositions } from './writing-position.js'

/**
 * 自动保存服务：
 * - mark() 登记脏实体，防抖 1s 后落盘（只写脏数据）
 * - 30s 定时兜底 / 窗口失焦 / 页面隐藏时 flushAll
 * - 章节落盘时按策略写版本快照（内容有变化且距上次快照 > 5min，或强制）
 * - 正文和码字统计（wordlog）同一事务落盘
 */
const pending = new Map() // `${table}:${id}` -> { table, row, forceSnapshot }
const flushing = new Set()
let activeFlush = null
let flushTimer = null
let started = false
const lastSnapshotAt = new Map()
const lastSnapshotContent = new Map()
/** 各章节本窗口上次落盘的正文内容：仅在正文较上次落盘变化时打 AI 摘要失效标记（方案 §四「仅变化章节重算」） */
const flushedChapterContent = new Map()
const flushHooks=new Set()
export function registerFlushHook(fn) {flushHooks.add(fn);return()=>flushHooks.delete(fn)}

const ui = () => useUiStore()

function schedule() {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => doFlush(), 1000)
}

async function doFlush() {
  if (activeFlush) { await activeFlush; if (pending.size) return doFlush(); return }
  activeFlush = flushBatch()
  try { await activeFlush } finally { activeFlush = null }
}
async function flushBatch() {
  if (!pending.size) return
  ui().autosave.saving = true
  const items = [...pending.values()]
  items.forEach((it) => flushing.add(`${it.table}:${it.row.id}`))
  pending.clear()
  ui().autosave.pending = 0
  try {
    for (const it of items) {
      const row = JSON.parse(JSON.stringify(it.row))
      row.updatedAt = Date.now()
      const saved = await putRow(it.table, row, { memoryIntent: it.memoryIntent, recordWordDelta: it.table === 'chapters' })
      if (saved.memoryJobId) {
        const detail={workId:row.workId,jobId:saved.memoryJobId}
        setTimeout(()=>{
          window.dispatchEvent(new CustomEvent('memory-queue-ready',{detail}))
          window.native?.appBroadcast?.({kind:'memory-queue-ready',data:detail})
        },0)
      }
      if (SOURCE_TABLES.includes(it.table)) {
        const data = { workId: row.workId || (it.table==='works'?row.id:null), table: it.table, id: row.id, origin: autosave.origin }
        window.dispatchEvent(new CustomEvent('ai-source-changed', { detail: data }))
        window.native?.appBroadcast?.({ kind: 'ai-source-changed', data })
      }
      if (it.table === 'chapters') {
        /* 章节落盘钩子（方案 §四/§七）：正文较上次落盘有变化 → 打 aisum 摘要失效标记
           （只标记不触发生成，下次 AI 任务前惰性重算）；首次落盘不标——跨窗口/窗口重开场景
           由 summarize.js 的 contentHash 比对兜底，避免误废仍有效的缓存 */
        if (flushedChapterContent.has(row.id) && row.content !== flushedChapterContent.get(row.id)) {
          markChapterStale(row.id)
        }
        flushedChapterContent.set(row.id, row.content)
        maybeSnapshot(row, it.forceSnapshot)
      }
    }
    ui().autosave.lastSavedAt = Date.now()
    ui().autosave.error = false
  } catch (err) {
    ui().autosave.error = true
    console.error('[autosave] 保存失败，已重新排队', err)
    for (const it of items) {
      const key=`${it.table}:${it.row.id}`
      pending.set(key, mergeMemoryIntent(it,pending.get(key)||{}))
    }
    ui().autosave.pending = pending.size
  } finally {
    items.forEach((it) => flushing.delete(`${it.table}:${it.row.id}`))
    ui().autosave.saving = false
  }
}

function maybeSnapshot(row, force) {
  const key = row.id
  const content = row.content || ''
  const changed = content !== (lastSnapshotContent.get(key) ?? null)
  const cooled = Date.now() - (lastSnapshotAt.get(key) || 0) > 5 * 60 * 1000
  if (!(force || (changed && cooled))) return
  lastSnapshotAt.set(key, Date.now())
  lastSnapshotContent.set(key, content)
  addRevision('chapter', row.id, content, row.fmt||'text').catch((e) => console.error('[snapshot]', e))
}

export const autosave = {
  origin: crypto.randomUUID(),
  hasPending(table, id) { return pending.has(`${table}:${id}`) || flushing.has(`${table}:${id}`) },
  mark(table, row, opts = {}) {
    if (!row || !row.id) return
    const key = `${table}:${row.id}`
    pending.set(key, mergeMemoryIntent(pending.get(key), { table, row, forceSnapshot: !!opts.forceSnapshot, ...opts }))
    ui().autosave.pending = pending.size
    schedule()
  },

  async flushAll() {
    clearTimeout(flushTimer)
    captureWritingPositions()
    await doFlush()
    await flushWritingPositions().catch(e=>console.warn('[writing-position]',e))
    await Promise.all([...flushHooks].map(fn=>fn()))
  },

  /** 丢弃全部待存脏行（不落盘）。用于「恢复备份」前：恢复语义以备份为准，
   *  队列里恢复前的旧状态若在恢复后落盘，会把备份内容覆盖回去（v1.0.22 修复）。 */
  discardPending() {
    clearTimeout(flushTimer)
    pending.clear()
    ui().autosave.pending = 0
    discardWritingPositions()
  }
}

export function startAutosave() {
  if (started) return
  started = true
  setInterval(() => {
    if (pending.size) doFlush()
  }, 30000)
  window.addEventListener('blur', () => autosave.flushAll())
  window.addEventListener('pagehide', () => autosave.flushAll())
  window.__flushNow = () => autosave.flushAll()
  window.__prepareForPanel = async () => {await autosave.flushAll();if(ui().autosave.pending)throw new Error('编辑尚未保存，无法移交编辑权')}
}
