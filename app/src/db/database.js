import Dexie from 'dexie'
import { SOURCE_TABLES } from '../services/project/normalize.js'
import { notifySourceChanged } from '../services/project/events.js'

/* 插件版（DSH 宿主）跑在宿主源的 IndexedDB 里：必须换库名，
 * 否则会和桌面版/其它插件在同一源内互踩。桌面版行为不变。 */
const HOST_DB_NAME = typeof window !== 'undefined' && window.__NS_AGENT__ === 'dsh' ? 'novel-studio@dsh' : 'novel-studio'

export const db = new Dexie(HOST_DB_NAME)

db.version(1).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key'
})

// v2：设定分类支持文件夹式嵌套（parentId）
db.version(2).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key'
})

// v3：设定模块改为幕布式统一节点树（取消文件夹/条目二分，任意节点平权）
db.version(3).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  mubu: 'id, workId, parentId, [workId+deletedAt], [workId+parentId]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key'
})

// v4：书签（章节快捷收藏）
db.version(4).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  mubu: 'id, workId, parentId, [workId+deletedAt], [workId+parentId]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key',
  bookmarks: 'id, workId, targetId, [workId+targetId]'
})

// v5：大纲节点树（8.8 思维导图方向）——总纲/卷纲/章纲/故事线/自定义条目统一为节点，
// 原 outlines 三级文本大纲首次打开时一次性迁移；节点富文本为 text+html 双字段
db.version(5).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  mubu: 'id, workId, parentId, [workId+deletedAt], [workId+parentId]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key',
  bookmarks: 'id, workId, targetId, [workId+targetId]',
  olnodes: 'id, workId, parentId, refId, [workId+deletedAt], [workId+parentId]'
})

// v6：正文批注——正文 HTML 内以 span[data-note-id] 锚点标记，批注正文与用途颜色存本表
db.version(6).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  mubu: 'id, workId, parentId, [workId+deletedAt], [workId+parentId]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key',
  bookmarks: 'id, workId, targetId, [workId+targetId]',
  olnodes: 'id, workId, parentId, refId, [workId+deletedAt], [workId+parentId]',
  annotations: 'id, workId, chapterId, [workId+deletedAt], [chapterId+deletedAt], createdAt'
})

// v7：AI 助手摘要缓存——章节（后续可扩展其他实体）的 AI 生成摘要存本表，
// 以 contentHash 与实体内容比对判定新旧：正文变化 → 摘要过期 → 下次任务前重算（services/ai/summarize.js）
db.version(7).stores({
  works: 'id, updatedAt, deletedAt',
  volumes: 'id, workId, [workId+sortOrder]',
  chapters: 'id, workId, volumeId, [workId+deletedAt], updatedAt',
  outlines: 'id, workId, level, refId, [workId+level]',
  characters: 'id, workId, [workId+deletedAt], name',
  relations: 'id, workId, fromId, toId',
  lorecats: 'id, workId, parentId, [workId+sortOrder]',
  lore: 'id, workId, categoryId, [workId+deletedAt]',
  mubu: 'id, workId, parentId, [workId+deletedAt], [workId+parentId]',
  snippets: 'id, workId, [workId+deletedAt], createdAt',
  assets: 'id, workId, [workId+deletedAt]',
  links: 'id, [entityType+entityId], assetId',
  revisions: 'id, [entityType+entityId], createdAt',
  wordlog: 'id, date, workId, [workId+date], [date+chapterId]',
  appconfig: 'key',
  bookmarks: 'id, workId, targetId, [workId+targetId]',
  olnodes: 'id, workId, parentId, refId, [workId+deletedAt], [workId+parentId]',
  annotations: 'id, workId, chapterId, [workId+deletedAt], [chapterId+deletedAt], createdAt',
  aisum: 'id, workId, [entityType+entityId], updatedAt'
})

// v8: AI-private facts, extraction coverage, durable jobs, author decisions and style profiles.
db.version(8).stores({
  aikb: 'id, workId, kind, chapterId, [workId+kind], [workId+chapterId], [workId+refType+refId]',
  aikbmeta: 'id, workId, [workId+chapterId]',
  airuns: 'id, workId, type, status, [workId+type], updatedAt',
  aidecisions: 'id, workId, [workId+key]',
  aistyle: 'id, workId, status, updatedAt'
})
db.version(9).stores({ aikbvec: 'id, workId, [workId+cardId], [workId+model]' })

db.version(10).stores({ aipresets: 'id, name, updatedAt', aipresetstate: 'id, workId' })

// Rebuildable read model. Author decisions remain in aidecisions and backups.
db.version(11).stores({
  aidoc: 'rowKey, id, workId, [workId+generation], [workId+generation+sourceType], sourceId',
  aichunk: 'rowKey, id, workId, [workId+generation], [generation+docId+idx], hash',
  aiindex: 'workId, status, updatedAt',
  aikbblock: 'id, workId, docId, cacheKey',
  aientity: 'rowKey, id, workId, [workId+generation], [workId+generation+kind]',
  aiedge: 'rowKey, id, workId, [workId+generation], [generation+fromId], [generation+toId]',
  aikbmeta: 'id, workId, [workId+chapterId], [workId+docId]',
  aikbvec: 'id, workId, [workId+cardId], [workId+model], [workId+refType+refId]'
}).upgrade((tx) => tx.table('aikbvec').toCollection().modify((row) => {
  row.refType = row.refType || 'card'
  row.refId = row.refId || row.cardId
}))

// v12：条目级「关联关系」（关系链接）——设定↔设定 / 设定↔人物 的类型化关系，
// 单向存储（from→to + label/reverseLabel）双向展示；由 SOURCE_TABLES 接入 AI 投影与变更通知。
db.version(12).stores({ lorelinks: 'id, workId' })

// Covers direct deletes/imports and all source writes, not just autosave's list.
/* 写入出口（M3）：作品库同步层注册一个 tap，拿到每次事务提交后的变更集。
 * 用 pauseWriteTap 包住"从库灌入 Dexie"的写入，避免回环。 */
let writeTap = null
let writeTapPaused = 0
export function setWriteTap(fn) {
  writeTap = fn
}
export function pauseWriteTap() {
  writeTapPaused += 1
}
export function resumeWriteTap() {
  writeTapPaused = Math.max(0, writeTapPaused - 1)
}

async function notifyCommitted(changes) {
  const works=new Map()
  for(const {table,row} of changes.values()) {
    let workId=table==='works'?row.id:row.workId
    if(!workId&&table==='links') {
      workId=(await db.assets.get(row.assetId))?.workId
      if(!workId)for(const t of ['works','chapters','volumes','characters','outlines','olnodes','mubu','snippets']) {
        const owner=await db.table(t).get(row.entityId)
        if(owner){workId=t==='works'?owner.id:owner.workId;break}
      }
    }
    if(workId)works.set(workId,{table,row:{...row,workId}})
  }
  for(const {table,row} of works.values())notifySourceChanged(table,row)
  if (writeTap && writeTapPaused === 0) {
    try {
      writeTap([...changes.values()])
    } catch (error) {
      console.warn('[library] 写入出口失败', error)
    }
  }
}
function trackSource(transaction,table,row,kind='put') {
  if(!transaction._bookSourceChanges) {
    transaction._bookSourceChanges=new Map()
    transaction.on('complete',()=>notifyCommitted(transaction._bookSourceChanges).catch(console.error))
  }
  transaction._bookSourceChanges.set(table+':'+row.id+':'+(row.workId||''),{table,row,kind})
}
for (const table of SOURCE_TABLES) {
  db.table(table).hook('creating', function (_key, row, transaction) { this.onsuccess = () => trackSource(transaction,table,row) })
  db.table(table).hook('updating', function (changes, _key, row, transaction) { this.onsuccess = () => {trackSource(transaction,table,row);if(changes.workId&&changes.workId!==row.workId)trackSource(transaction,table,{...row,workId:changes.workId})} })
  db.table(table).hook('deleting', function (_key, row, transaction) { this.onsuccess = () => trackSource(transaction,table,row,'delete') })
}

// History remains local; its commit notifications refresh analysis without adding it to project/source sync.
let historyChannel
function trackWritingHistory(transaction) {
  if(transaction._writingHistoryChanged)return
  transaction._writingHistoryChanged=true
  transaction.on('complete',()=>{
    if(typeof window==='undefined')return
    window.dispatchEvent(new CustomEvent('writing-history-changed'))
    try {
      if(!historyChannel&&typeof BroadcastChannel==='function')historyChannel=new BroadcastChannel('novel-studio-writing-history')
      historyChannel?.postMessage({kind:'history-committed'})
    } catch { /* The current window still receives its committed notification. */ }
  })
}
for(const table of ['revisions','wordlog']){
  db.table(table).hook('creating',function(_key,_row,transaction){this.onsuccess=()=>trackWritingHistory(transaction)})
  db.table(table).hook('updating',function(_changes,_key,_row,transaction){this.onsuccess=()=>trackWritingHistory(transaction)})
  db.table(table).hook('deleting',function(_key,_row,transaction){this.onsuccess=()=>trackWritingHistory(transaction)})
}

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' +
      Date.now().toString(36) +
      '-' +
      Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('')

export const now = () => Date.now()

export const todayStr = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 打开数据库（带重试）。
 * Chromium 偶发 IndexedDB open() UnknownError；另一实例占用数据目录时也会打开失败。
 */
export async function openDbWithRetry(tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      await db.open()
      return true
    } catch (err) {
      console.warn('[db] open failed, retry', i + 1, String(err))
      try {
        db.close()
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
  return false
}
