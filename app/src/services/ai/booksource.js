import { projectBook, sourceManifest, orderedChapters, PROJECTION_VERSION } from '../project/normalize.js'
import { projectGraph } from '../project/graph.js'
import { tokens, checkAbort, sourceChanged, chapterHash, plainChapter } from '../project/text.js'
import { chunkText } from '../project/chunker.js'
import { getChapterSummary } from './summarize.js'
import { readProjection } from '../../db/project-repo.js'

const sessions = new WeakMap()
export function createBookAccess(work, { asOfChapterId = null, allowedIds, privacy = false, authorProfiles = false, planScope = 'all', sourceRevision, signal, writingBoundary=null } = {}) {
  const chapters = orderedChapters(work), index = chapters.findIndex((c) => c.id === asOfChapterId)
  if (asOfChapterId && index < 0) throw new Error('截至章节不存在')
  const allowed = chapters.slice(0, asOfChapterId ? index + 1 : chapters.length).map((c) => c.id)
  return { workId: work.work.id, asOfChapterId, allowedIds: allowedIds ? allowed.filter((id) => allowedIds.includes(id)) : allowed,
    privacy: !!privacy, authorProfiles:!!authorProfiles && !privacy, planScope, sourceRevision: sourceRevision || sourceManifest(work).hash, signal,writingBoundary }
}
export function bookSession(work, access = {}, projection = null) {
  checkAbort(access.signal)
  if (!work.work || work.work.deletedAt) throw new Error('作品不存在')
  if (access.workId && access.workId !== work.work.id) throw new Error('不能读取其他作品')
  const policy = createBookAccess(work,access), manifest = sourceManifest(work)
  if (manifest.hash !== policy.sourceRevision) throw sourceChanged()
  const key = JSON.stringify([manifest.hash,policy.asOfChapterId,policy.allowedIds,policy.privacy,policy.authorProfiles,policy.planScope,policy.writingBoundary])
  let cache = sessions.get(work)
  if (!cache) { cache = new Map(); sessions.set(work,cache) }
  if (cache.has(key)) return cache.get(key)
  const model = projection || projectBook(work), graph = projection || projectGraph(work,model.docs), allowed = new Set(policy.allowedIds), chapters = orderedChapters(work)
  const boundary=policy.writingBoundary,boundaryChapter=boundary&&chapters.find(ch=>ch.id===boundary.chapterId)
  if(boundary&&(!boundaryChapter||!Number.isInteger(boundary.end)||boundary.end<0||boundary.end>plainChapter(boundaryChapter).length||!allowed.has(boundary.chapterId)))throw new Error('正文读取位置无效')
  const bounded=boundary&&boundary.end<plainChapter(boundaryChapter).length
  const documents = model.docs.filter((d) => {
    if(bounded&&((d.sourceType==='annotation'&&d.meta.chapterId===boundary.chapterId)||(d.semanticClass==='summary'&&d.meta.sourceChapterVersions?.some(v=>v.id===boundary.chapterId))))return false
    if (d.sourceType === 'chapter' || d.sourceType === 'annotation') return allowed.has(d.meta.chapterId)
    if (d.sourceType === 'relation' && policy.asOfChapterId) {
      const relation=work.relations.find(r=>r.id===d.sourceId)
      if(relation?.effectiveChapterId && !allowed.has(relation.effectiveChapterId))return false
    }
    if (d.semanticClass === 'summary') return (d.meta.sourceChapterVersions || []).length>0 && d.meta.sourceChapterVersions.every(v=>allowed.has(v.id)&&chapters.some(ch=>ch.id===v.id&&chapterHash(ch)===v.hash))
    if (d.semanticClass === 'plan' && policy.planScope === 'none') return false
    if (d.semanticClass === 'plan' && policy.planScope === 'current' && d.meta.chapterId) return allowed.has(d.meta.chapterId)
    return true
  }).map(d=>bounded&&d.sourceType==='chapter'&&d.sourceId===boundary.chapterId?{...d,plainText:d.plainText.slice(0,boundary.end),markdown:d.plainText.slice(0,boundary.end),paragraphs:d.paragraphs.filter(p=>p.start<boundary.end).map(p=>({...p,end:Math.min(p.end,boundary.end)}))}:d)
  const docIds = new Set(documents.map((d) => d.id))
  const clipped=bounded?documents.find(d=>d.sourceType==='chapter'&&d.sourceId===boundary.chapterId):null
  const session = { work, access: policy, docs: documents, chunks: [...model.chunks.filter((c) => docIds.has(c.docId)&&c.docId!==clipped?.id),...(clipped?chunkText(clipped.plainText,{docId:clipped.id,paragraphs:clipped.paragraphs}):[])],
    entities: graph.entities.filter(e=>docIds.has(e.docId)), edges: graph.edges.filter((e) => docIds.has(e.docId)&&e.docId!==clipped?.id), issues: (projection?projection.index.issues:[...model.issues,...graph.issues]).filter(i=>!bounded||i.sourceId!==boundary.chapterId), manifest,
    dataSource:projection?'indexed-projection':'snapshot-projection' }
  session.chunksByDoc=new Map()
  for(const chunk of session.chunks){if(!session.chunksByDoc.has(chunk.docId))session.chunksByDoc.set(chunk.docId,[]);session.chunksByDoc.get(chunk.docId).push(chunk)}
  cache.set(key,session)
  return session
}
export function documentView(doc, session) {
  const base = { docId: doc.id, sourceType: doc.sourceType, sourceId: doc.sourceId, sourceHash: doc.sourceHash, textHash: doc.textHash,
    title: doc.title, headingPath: doc.headingPath, semanticClass: doc.semanticClass, temporalStatus: doc.meta.temporalStatus || (doc.semanticClass === 'fact' ? 'chapter' : 'author-record'), sourceVersions: doc.deps }
  if (session.access.privacy) return { ...base, text: session.summaries?.get(doc.sourceId) || '', withheld: !session.summaries?.has(doc.sourceId), summaryOnly:true }
  if (session.access.asOfChapterId && !session.access.authorProfiles && ['character','relation','lorelink'].includes(doc.sourceType)) {
    return { ...base, text: doc.sourceType === 'character' ? doc.title : '', withheld: true, temporalStatus: 'unknown', warning: '当前作者档案未标记历史生效范围；历史状态须查正文证据' }
  }
  if(session.access.authorProfiles && ['character','relation','lorelink'].includes(doc.sourceType))return {...base,text:doc.plainText,temporalStatus:'author-profile',warning:'作者人物与条目关联设定是创作约束；未标明阶段的资料不能推断为当前已发生事实，阶段状态以正文证据为准'}
  return { ...base, text: doc.plainText }
}
export async function readBook(work, access = {}) {
  checkAbort(access.signal)
  const stored=await readProjection(work.work.id)
  const session = bookSession(work,access,stored?.index.projectionVersion===PROJECTION_VERSION&&stored.index.sourceRevision===sourceManifest(work).hash&&stored.index.status==='ready'?stored:null)
  if (session.access.privacy && !session.summaries) {
    const summaries = new Map()
    for (const ch of orderedChapters(work).filter((c) => session.access.allowedIds.includes(c.id))) {
      if(session.access.writingBoundary?.chapterId===ch.id&&session.access.writingBoundary.end<plainChapter(ch).length)continue
      checkAbort(access.signal)
      const text = await getChapterSummary(ch,null)
      if (text) summaries.set(ch.id,text)
    }
    session.summaries=summaries
  }
  return session
}
export function readBookManifest(session) {
  const counts = {}
  for (const d of session.docs) counts[d.sourceType] = (counts[d.sourceType] || 0) + 1
  return { workId:session.access.workId, sourceRevision:session.manifest.hash, counts, totalDocs:session.docs.length,
    dataSource:session.dataSource,
    totalChunks:session.chunks.length, projectionCoverage:'complete-readable-text', extractionCoverage:'see-knowledge-status',
    unparsed: session.issues.filter((i) => i.type==='unparsed-asset'), issues: session.issues.filter((i) => i.type!=='ambiguous-mention' || session.docs.some((d) => d.sourceId===i.sourceId)),
    documents: session.docs.map((d) => { const v=documentView(d,session); return { ...v, text:undefined, sourceVersions:undefined, chars:v.text.length, withheld:!!v.withheld } }) }
}
export function readDocument(session, { docId, cursor = 0, limitTokens = 1000 } = {}) {
  checkAbort(session.access.signal)
  const doc = session.docs.find((d) => d.id === docId)
  if (!doc) return { error:'文档不存在或超出读取范围' }
  const view = documentView(doc,session), start = Math.max(0, Math.floor(Number(cursor) || 0)), budget = Math.max(4,Math.min(1400,Number(limitTokens)||1000))
  if(!Number.isFinite(start)||(/[\uDC00-\uDFFF]/.test(view.text[start]||'')&&/[\uD800-\uDBFF]/.test(view.text[start-1]||'')))return {error:'游标必须指向有效的 Unicode 字符边界'}
  let text = '', end=start
  for (const ch of view.text.slice(start)) { if (tokens(text+ch)>budget) break; text+=ch; end+=ch.length }
  const citation = { docId, textHash:doc.textHash, start, end, paragraphId:doc.paragraphs.find((p) => p.start<=start && p.end>start)?.id }
  return { ...view, text, content:text, citation, truncated:end<view.text.length, nextCursor:end<view.text.length?end:null }
}
export function queryTerms(query) {
  const text=String(query||'').toLowerCase(), out=new Set(text.match(/[a-z\d_]+/g)||[])
  for (const match of text.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars=[...match[0]]
    if (chars.length===1) out.add(chars[0])
    for(let i=0;i<chars.length-1;i++) out.add(chars[i]+chars[i+1])
  }
  return [...out]
}
export function queryBook(session, { query='', sourceTypes, semanticClasses, entityIds=[], limitTokens=2400, limit=30 } = {}) {
  checkAbort(session.access.signal)
  const terms=queryTerms(query), related=new Set(session.edges.filter((e) => entityIds.includes(e.toId)||entityIds.includes(e.fromId)).map((e)=>e.docId)), ranked=[]
  for(const doc of session.docs) {
    if (sourceTypes?.length && !sourceTypes.includes(doc.sourceType)) continue
    if (semanticClasses?.length && !semanticClasses.includes(doc.semanticClass)) continue
    const view=documentView(doc,session), hay=(doc.title+' '+doc.headingPath.join('/')+' '+view.text).toLowerCase()
    const hits=terms.filter((t)=>hay.includes(t)).length
    if(terms.length&&!hits&&!related.has(doc.id)) continue
    const pieces = view.withheld || view.summaryOnly ? [{ text:view.text, coreStart:0, coreEnd:0 }] : session.chunksByDoc.get(doc.id)||[]
    for(const chunk of pieces) {
      const local=terms.filter((t)=>chunk.text.toLowerCase().includes(t)).length
      if(terms.length&&!local&&!terms.some((t)=>doc.title.toLowerCase().includes(t))&&!related.has(doc.id)) continue
      ranked.push({ ...view, text:chunk.text, chunkId:chunk.id, score:local*3+hits+Number(related.has(doc.id))*5,
        citation:{docId:doc.id,chunkId:chunk.id,textHash:doc.textHash,start:chunk.contextStart??chunk.coreStart,end:chunk.coreEnd,paragraphId:chunk.paragraphIds?.[0]} })
    }
  }
  ranked.sort((a,b)=>b.score-a.score||String(a.chunkId).localeCompare(String(b.chunkId)))
  const items=[]; let remaining=Math.max(0,limitTokens)
  for(const item of ranked) {
    const cost=tokens(JSON.stringify(item))
    if(cost>remaining)continue
    items.push(item);remaining-=cost
    if(items.length>=limit)break
  }
  return { items, total:ranked.length, tokens:limitTokens-remaining, report:items.length?[]:['没有足够匹配证据；请换关键词或顺序读取文档'], sourceRevision:session.manifest.hash }
}
export function relatedEntities(session, {entityId,depth=1,limit=30}={}) {
  const visited=new Set([entityId]), frontier=[entityId], edges=[]
  for(let i=0;i<Math.min(2,Math.max(1,depth));i++) {
    const next=[]
    for(const id of frontier.splice(0)) for(const e of session.edges.filter((e)=>e.fromId===id||e.toId===id)) {
      if(session.access.asOfChapterId&&!session.access.authorProfiles&&e.temporalStatus==='unknown')continue
      if(!edges.some((x)=>x.id===e.id))edges.push(e)
      const other=e.fromId===id?e.toId:e.fromId
      if(!visited.has(other)&&visited.size<limit){visited.add(other);next.push(other)}
    }
    frontier.push(...next)
  }
  return { entities:session.entities.filter((e)=>visited.has(e.id)).map((e)=>({...e,sourceHash:undefined})),
    edges:edges.slice(0,limit).map((e)=>session.access.privacy?{id:e.id,fromId:e.fromId,toId:e.toId,kind:e.kind,semanticClass:e.semanticClass}:e),
    note:'提及只表示出场／共现，不证明正式关系或因果' }
}
/* P2 规划接口（docs/恍然梦数据架构方案-书库读模型.md）：尚未接线，保留契约供后续任务装配。 */
export function contextPack(session,{query='',budget=3000}={}) {
  const result=queryBook(session,{query,limitTokens:budget})
  return { json:result.items, markdown:result.items.map((r)=>`【${r.semanticClass} · ${r.headingPath.join(' / ')} · ${r.docId}】\n${r.text}`).join('\n\n'),
    tokens:result.tokens,sources:result.items.map((r)=>r.citation),report:result.report,coverage:readBookManifest(session).counts }
}
