import { knowledgeSnapshot, replayForeshadows } from './knowledge'
import { tokens, withoutQuotes } from './contracts'
import { vectors, leaseJob, updateJob } from '../../db/ai-repo'
import { uid } from '../../db/database'
import { embed } from './provider'
import { hashContent } from './summarize'
import { queryTerms } from './booksource.js'
import { db } from '../../db/database.js'
import { vectorPolicy } from './retrieval-policy.js'

export function cosine(a, b) {
  if (!a.length || a.length !== b.length) return 0
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}
export function fuseRanks(lists) {
  const scores = new Map()
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + i + 1)))
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
export async function kbQuery({ work, task = 'chat', anchorId = null, asOfChapterId = null, query = '', kind = null, limitTokens = 2400, privacy = false, embeddings = null, opts = null,writingBoundary=null }) {
  const snap = await knowledgeSnapshot(work, asOfChapterId,writingBoundary)
  const seeds = queryTerms(query)
  const current = snap.index.get(asOfChapterId || anchorId) ?? snap.chapters.length - 1
  const hooks = replayForeshadows(snap.cards).filter((f) => f.status === 'active').slice(0, 8)
  const hookIds = new Set(hooks.flatMap((h) => h.actions))
  const byKeyword = new Map(), byRef = new Map()
  for (const card of snap.cards) {
    for (const key of [card.title, ...(card.keywords || [])]) {
      if (!byKeyword.has(key)) byKeyword.set(key, new Set())
      byKeyword.get(key).add(card.id)
    }
    const ref = card.refType + ':' + card.refId
    if (!byRef.has(ref)) byRef.set(ref, [])
    byRef.get(ref).push(card)
  }
  let ranked = snap.cards.filter((c) => c.kind !== 'entity' && (!kind || c.kind === kind)).map((card) => {
    const hay = [card.title, ...(card.keywords || []), JSON.stringify(card.body)].join(' ').toLowerCase()
    const hits = seeds.filter((s) => hay.includes(s)).length
    let weight = 1
    if (card.chapterId === anchorId) weight += 4
    if (card.refId === anchorId) weight += 3
    if (hookIds.has(card.id) && ['plot', 'outline', 'consistency'].includes(task)) weight += 2
    if (task === 'outline' && card.body.subtype === 'main') weight += 4
    if (task === 'character' && card.refId !== anchorId && !hits) weight = 0
    if (task === 'lore' && !hits && card.refId !== anchorId) weight = 0
    if (task === 'chat' && seeds.length && !hits) weight = 0
    const distance = card.kind === 'arc' ? 1 : 1 / (1 + 0.15 * Math.abs(current - card.orderIdx))
    return { card, score: weight * distance * (1 + Math.min(0.5, 0.1 * hits)) }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  const policy=vectorPolicy({privacy,embeddings,opts,query})
  let vectorFallback = false, vectorStatus={mode:'lexical',reason:policy.reason}
  if (policy.enabled) {
    try {
      const stored = await vectors(work.work.id)
      const applicable = stored.filter((v) => v.model === embeddings.model && (!v.provider || v.provider === opts.baseURL) && snap.cards.some((c) => c.id === v.cardId && v.sourceHash === hashContent(c.title + JSON.stringify(c.body))))
      if (applicable.length) {
        const queryResult = await embed({ ...opts, model: embeddings.model, texts: [query] })
        const q = queryResult.vectors[0]
        if(!q?.length||!q.every(Number.isFinite)||!applicable.some(v=>v.dim===q.length))throw new Error('向量维度或响应无效')
        opts.onUsage?.(queryResult.usage || { total_tokens: tokens(query), estimated: true })
        const semantic = applicable.filter((v) => v.dim === q.length).map((v) => ({ id: v.cardId, score: cosine(q, new Float32Array(v.vec)) })).sort((a, b) => b.score - a.score).slice(0, 20)
        const ids = fuseRanks([ranked.map((x) => x.card.id), semantic.map((x) => x.id)])
        ranked = ids.map((id) => ({ card: snap.cards.find((c) => c.id === id) })).filter((x) => x.card && x.card.kind!=='entity' && (!kind || x.card.kind === kind))
        vectorStatus={mode:'hybrid',reason:null}
      } else {
        vectorFallback=true;vectorStatus={mode:'lexical',reason:'no-current-vectors'}
      }
    } catch (e) { if (opts.signal?.aborted) throw e; vectorFallback = true;vectorStatus={mode:'lexical',reason:'embedding-unavailable'} }
  }
  const cards = [], blocks = [], omitted=[]
  let remaining = limitTokens
  for (const { card } of ranked) {
    const body = privacy ? withoutQuotes(card.body) : card.body
    const text = `◆ ${card.kind} [${card.id}] ${card.title}${card.chapterId ? ' · 《' + (snap.chapters.find((c) => c.id === card.chapterId)?.title || '') + '》 [sourceId=' + card.chapterId + ']' : ''}：${JSON.stringify(body)}`
    const cost = tokens(text) + 2
    if (cost > remaining) {omitted.push({id:card.id,reason:'retrieval-budget',sourceVersions:card.sourceVersions||card.dependencies||[],chapterId:card.chapterId,sourceHash:card.sourceHash});continue}
    remaining -= cost
    cards.push(card)
    blocks.push({ layer: 'L1.5', label: '知识库 · ' + card.kind + ' · ' + card.title, text: '【知识库：正文提取事实，须核对来源】\n' + text })
  }
  return { cards, blocks, snapshot: snap, byKeyword, byRef, vectorFallback,vectorStatus,omitted }
}
export async function rebuildVectors({ work, opts, model, onProgress, shouldPause = () => false, onUsage }) {
  const owner = uid(), id = 'knowledge:' + work.work.id
  if (!await leaseJob({ id, workId: work.work.id, type: 'vectors', owner })) throw new Error('另一窗口正在构建知识库或向量')
  const heartbeat = setInterval(() => updateJob(id, owner, { leaseUntil: Date.now() + 120000 }).catch(() => {}), 20000)
  try {
  const snap = await knowledgeSnapshot(work)
  const cards = snap.cards.filter((c) => ['event', 'loreterm'].includes(c.kind))
  const existing = await vectors(work.work.id)
  const rows = existing.filter((v) => v.model === model && (!v.provider || v.provider === opts.baseURL) && cards.some((c) => c.id === v.cardId && v.sourceHash === hashContent(c.title + JSON.stringify(c.body))))
  const pending = cards.filter((c) => !rows.some((r) => r.cardId === c.id))
  for (const card of pending) {
    if (shouldPause()) break
    const text = card.title + JSON.stringify(card.body)
    const r = await embed({ ...opts, model, texts: [text] })
    const vector = r.vectors[0]
    if (rows.length && rows[0].dim !== vector.length) throw new Error('向量维度发生变化，请重建向量')
    const row={ id: model + ':' + card.id, cardId: card.id,refType:'card',refId:card.id,provider:opts.baseURL, workId: work.work.id, model, dim: vector.length, sourceHash: hashContent(text), vec: new Float32Array(vector).buffer }
    rows.push(row)
    await db.aikbvec.put(row)
    onUsage?.(r.usage || { total_tokens: tokens(text), estimated: true })
    onProgress?.({ done: rows.length, total: cards.length })
  }
  const status = rows.length < cards.length ? 'paused' : 'completed'
  await updateJob(id, owner, { done: rows.length, total: cards.length, status, owner: null, leaseUntil: 0 })
  return { done: rows.length, total: cards.length, paused: status === 'paused' }
  } catch (e) { await updateJob(id, owner, { status: 'paused', error: e.message, owner: null, leaseUntil: 0 }); throw e }
  finally { clearInterval(heartbeat) }
}
