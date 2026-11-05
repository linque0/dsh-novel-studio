import { plainChapter } from '../project/text.js'

export function retrievalTask(type='chat') {
  return type.startsWith('character.')?'character':type.startsWith('lore.')?'lore':type.startsWith('outline.')?'outline':/review|recheck|memory\.extract/.test(type)?'consistency':type.startsWith('chapter.')||type.startsWith('snippet.')?'plot':'chat'
}
export function buildRetrievalRequest(work, frozen, question = '', {privacy=false}={}) {
  const request=frozen.taskRequest || {}, task=retrievalTask(request.type)
  const anchorId=request.targetId || frozen.refs?.characterId || frozen.refs?.loreId || frozen.refs?.outlineId || frozen.chapterId || null
  const chapter=(work.chapters || []).find(c=>c.id===frozen.chapterId)
  // Only left-of-anchor text may seed factual retrieval. Right is a writing constraint.
  const currentDraft=request.story?.text ?? (request.storyDocumentId?(request.revisedDraft?.text??request.draftSource?.text??''):null)
  const context=privacy?'':currentDraft!==null?currentDraft.slice(-1800):request.writingAnchor ? request.writingAnchor.left : frozen.writingBoundary ? plainChapter(chapter).slice(0,frozen.writingBoundary.end).slice(-1800) : (frozen.selection || plainChapter(chapter).slice(-1800))
  const names=(work.characters || []).filter(c=>!c.deletedAt&&[c.name,...String(c.aliases||'').split(/[、，,/\s]+/)].filter(Boolean).some(n=>(question+' '+context).includes(n))).map(c=>c.name)
  const plans=privacy?[]:(work.olnodes || []).filter(n=>!n.deletedAt&&n.outlineNature!=='written'&&(n.refId===frozen.chapterId||n.id===request.targetId||n.id===frozen.refs?.outlineId)).map(n=>[n.title,n.text].filter(Boolean).join(' '))
  return {task,anchorId,query:[question,frozen.chapterTitle,...names,...plans,request.selectedDirection?.title,request.selectedDirection?.development,context].filter(Boolean).join('\n'),asOfChapterId:frozen.asOfChapterId,writingBoundary:frozen.writingBoundary}
}

export function vectorPolicy({ privacy=false, embeddings, opts, query }={}) {
  const reason=privacy?'privacy':!embeddings?.enabled?'disabled':!opts?'missing-provider':!query?'empty-query':null
  return {enabled:!reason,reason}
}

export function classifyRule(rule, {chapterId,outlineId,query=''}={}) {
  if(rule.scope==='local')return rule.chapterId===chapterId&&!!chapterId || rule.outlineId===outlineId&&!!outlineId || (rule.targetIds||[]).some(id=>id===chapterId||id===outlineId) || (rule.keywords||[]).some(k=>k&&query.includes(k)) ? 'relevant' : 'irrelevant'
  // Unclassified legacy rules stay mandatory until the author explicitly scopes them.
  return 'required'
}
