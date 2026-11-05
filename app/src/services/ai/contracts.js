import { hashContent } from './summarize'
import { plainChapter as normalizedChapter, rowHash } from '../project/text.js'
import { projectBook, TABLE_FOR_TYPE } from '../project/normalize.js'

export const plainChapter = normalizedChapter
export const clone = (value) => JSON.parse(JSON.stringify(value))
export const chapterHash = (ch) => hashContent(JSON.stringify([ch?.title, ch?.fmt, ch?.content, !!ch?.deletedAt]))
export const entityHash = rowHash
export const namesOf = (c) => [c.name, ...(c.aliases || '').split(/[,，、/\s]+/)].filter(Boolean)
export function snapshotWork(work) {
  const snap = Object.fromEntries(['work', 'volumes', 'chapters', 'outlines', 'characters', 'relations', 'lorelinks', 'mubu', 'olnodes', 'lore', 'lorecats', 'snippets', 'annotations', 'assets', 'links'].map((key) => [key, clone(work[key] || (key === 'work' ? null : []))]))
  snap.liveCharacters = snap.characters.filter((c) => !c.deletedAt)
  snap.liveChapters = snap.chapters.filter((c) => !c.deletedAt)
  snap.liveOlnodes = () => snap.olnodes.filter((c) => !c.deletedAt)
  snap.liveMubu = () => snap.mubu.filter((c) => !c.deletedAt)
  snap.olnodeChildren = (id) => snap.olnodes.filter((n) => !n.deletedAt && (n.parentId || null) === (id || null)).sort((a, b) => a.sortOrder - b.sortOrder)
  snap.mubuChildren = (id) => snap.mubu.filter((n) => !n.deletedAt && (n.parentId || null) === (id || null)).sort((a, b) => a.sortOrder - b.sortOrder)
  return snap
}
export function tokens(text = '') {
  let count = 0
  for (const ch of String(text)) count += ch.codePointAt(0) > 0x2e7f ? 1 : 0.25
  return Math.ceil(count)
}
export const messageTokens = (messages) => messages.reduce((n, m) => n + tokens(m.content) + 8, 0)
export function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}
export class JsonParseError extends Error {
  constructor(message) { super(message); this.name = 'JsonParseError' }
}
export function parseObject(raw) {
  try {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const obj = JSON.parse(text)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('顶层应为对象')
    return obj
  } catch (e) { throw new JsonParseError(`JSON 解析失败：${e.message}`) }
}
export const string = (v, max = 20000) => typeof v === 'string' ? v.trim().slice(0, max) : ''

/** Budget the complete request. Never cut JSON or silently cut the user's instruction. */
export function fitMessages(messages, { budget = 10000, contextWindow = 0, maxTokens = 2048 } = {}) {
  const output = Math.max(128, Math.floor(Number(maxTokens) || 2048))
  const cap = Math.floor(Math.min(budget, contextWindow > 0 ? contextWindow : budget) - output - 128)
  const fitted = messages.map((m) => ({ ...m }))
  let dropped = 0
  // Intermediate exchanges are always removed as pairs; system and latest user remain.
  while (messageTokens(fitted) > cap && fitted.length > 3) {
    const count = fitted.length >= 5 ? 2 : 1
    fitted.splice(2, Math.min(count, fitted.length - 3))
    dropped += count
  }
  if (cap < 128 || messageTokens(fitted) > cap) throw new Error('完整消息超出模型预算，请提高上下文预算或缩小任务范围')
  return { messages: fitted, inputTokens: messageTokens(fitted), maxTokens: output, dropped }
}

/** Preserve complete items and an explicit cursor, never slice serialized JSON. */
export function paginate(items, { cursor = 0, limit = 10, maxTokens = 1600 } = {}) {
  const start = Math.max(0, Math.floor(Number(cursor) || 0))
  const out = []
  let oversized = false
  for (const item of items.slice(start, start + Math.min(50, Math.max(1, Number(limit) || 10)))) {
    if (tokens(JSON.stringify([...out, item])) > maxTokens) { oversized = !out.length; break }
    out.push(item)
  }
  const consumed = oversized ? 1 : out.length
  return { items: out, oversized, ...(oversized ? { error: "单条结果超出预算，请缩小读取范围" } : {}), truncated: start + consumed < items.length, nextCursor: start + consumed < items.length ? start + consumed : null, total: items.length }
}

/** Privacy strips all verbatim evidence and externally supplied samples from derived knowledge. */
export function withoutQuotes(value) {
  if (Array.isArray(value)) return value.map(withoutQuotes)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([k]) => !['quote', 'evidence', 'original', 'sample', 'text', 'excerpt'].includes(k)).map(([k, v]) => [k, withoutQuotes(v)]))
}

export function resolveEvidence(ref, work, { privacy = false } = {}) {
  if (!ref || typeof ref !== 'object') return null
  const type = ref.sourceType || 'chapter', table=type==='lore'?'mubu':type==='outline'&&!ref.docId?'olnodes':TABLE_FOR_TYPE[type]
  const source = table==='works'?work.work:work[table]?.find((c)=>c.id===ref.sourceId&&!c.deletedAt)
  if (!source || (table === 'works' ? source.id : source.workId) !== work.work.id) return null
  const sourceHash=type==='chapter'?chapterHash(source):entityHash(source)
  if(ref.sourceHash && ref.sourceHash!==sourceHash)return null
  const candidates=projectBook(work).docs.filter((d)=>d.sourceTable===table&&d.sourceId===ref.sourceId&&(!ref.docId||d.id===ref.docId)&&(type!=='outlineconnection'||d.sourceType===type))
  const matched=ref.quote?candidates.filter(d=>d.plainText.includes(string(ref.quote,1000))):candidates
  if(type==='outlineconnection'&&matched.length!==1)return null
  const doc=matched[0]||candidates[0]
  if(ref.docId&&!doc)return null
  if(ref.textHash&&ref.textHash!==doc?.textHash)return null
  const text = doc?.plainText ?? (type === 'chapter' ? plainChapter(source) : type === 'character' ? [source.name, source.content, ...Object.values(source.fields || {})].filter(Boolean).join('\n') : source.text || source.content || source.name || '')
  const quote = string(ref.quote, 1000)
  if (quote && !text.includes(quote)) return null
  if (quote && ref.start != null && (!Number.isInteger(ref.start) || ref.start < 0 || text.slice(ref.start, ref.start + quote.length) !== quote)) return null
  const start=quote?(Number.isInteger(ref.start)&&text.slice(ref.start,ref.start+quote.length)===quote?ref.start:text.indexOf(quote)):null
  if(quote&&ref.start==null&&text.indexOf(quote,start+1)>=0)return null
  return { sourceType: type, sourceId: source.id, sourceHash, label: source.title || source.name || (source.text || '').slice(0, 24) || doc?.title, ...(privacy ? {} : { quote, start,docId:doc?.id,textHash:doc?.textHash }) }
}
