import { projectBook, orderedChapters } from '../project/normalize.js'
import { chapterHash, rowHash, hashContent } from '../project/text.js'
import { taskProfile, normalizeTaskRequest } from './task-profiles.js'

export const TASK_OUTPUT_TOOLS = ['submit_chapter_plan','submit_review','submit_recheck','submit_plot_directions','submit_chapter','submit_outline_plan','submit_written_outline','submit_lore','submit_characters','submit_inspiration','submit_memory','submit_draft','submit_proposal']
const str = (v, max = 20000) => { if (typeof v !== 'string' || v.length > max) throw new Error('文本字段格式或长度无效'); return v.trim() }
const list = (v, max = 30) => { if (!Array.isArray(v) || v.length > max) throw new Error('列表格式或数量无效'); return v }
const object = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('提案应为对象'); return v }
const aliasesOf = c => [c.name, ...String(c.aliases || '').split(/[、，,/\s]+/)].filter(Boolean)
export function taskEvidence(refs, work, frozen, required = false) {
  const docs = projectBook(work).docs
  const result = list(refs || [], 100).map(ref => {
    const type = ref.sourceType === 'lore' ? 'mubu' : ref.sourceType === 'outline' ? 'olnode' : ref.sourceType
    const doc = docs.find(d => d.sourceType === type && d.sourceId === ref.sourceId && (!ref.docId || d.id === ref.docId))
    if (!doc || (doc.sourceType === 'chapter' && !frozen.allowedIds.includes(doc.sourceId))) throw new Error('证据不存在或越过任务范围')
    if ((ref.sourceHash && ref.sourceHash !== doc.sourceHash) || (ref.textHash && ref.textHash !== doc.textHash)) throw new Error('证据版本已变化')
    const quote = str(ref.quote || '', 1000)
    const first = quote ? doc.plainText.indexOf(quote) : -1
    const start = Number.isInteger(ref.start) ? ref.start : first
    if (!quote || start < 0 || doc.plainText.slice(start,start + quote.length) !== quote || (!Number.isInteger(ref.start) && doc.plainText.indexOf(quote,first + 1) >= 0)) throw new Error('证据必须在来源唯一定位；重复摘引须指定 start')
    if(frozen.writingBoundary?.chapterId===doc.sourceId&&doc.sourceType==='chapter'&&start+quote.length>frozen.writingBoundary.end)throw new Error('证据越过当前正文位置；选段或后文仅作修改/衔接材料')
    return { sourceType: doc.sourceType, sourceId: doc.sourceId, docId: doc.id, quote, start, sourceHash: doc.sourceHash, textHash: doc.textHash, label: doc.title }
  })
  if (required && !result.some(r => r.sourceType === 'chapter')) throw new Error('正文提取项缺少原文证据')
  return result
}
export function workflowProposal(data, work, frozen, runId, messageId) {
  object(data)
  if (JSON.stringify(data).length>200000) throw new Error('提案超过大小上限')
  const task = frozen.taskRequest, p = taskProfile(task.type)
  const evidence = taskEvidence(data.evidence, work, frozen, p.extraction)
  const warnings = list(data.warnings || [], 20).map(v => str(v, 2000))
  const review = str(data.review || '未提供语义核查，请作者检查。', 6000)
  let payload
  if (p.module === 'outline') {
    let total = 0
    const node = (n,depth = 0) => {
      object(n)
      if (++total > 100 || depth > 5) throw new Error('大纲层级或数量超限')
      const title = str(n.title, 300); if (!title) throw new Error('大纲标题为空')
      const chapterId = n.chapterId || null
      if (chapterId && !frozen.allowedIds.includes(chapterId)) throw new Error('大纲关联章节越界')
      if (p.extraction && !chapterId && !(n.children?.length)) throw new Error('已写内容纲叶节点须关联来源章节')
      const refs = taskEvidence(n.evidence,work,frozen,p.extraction)
      if (p.extraction && chapterId && !refs.some(r => r.sourceType === 'chapter' && r.sourceId === chapterId)) throw new Error('纲点证据未对应关联章节')
      return { title, points: str(n.points || ''), chapterId, evidence: refs, children: list(n.children || []).map(c => node(c,depth + 1)) }
    }
    const nodes = list(data.nodes); if (!nodes.length) throw new Error('大纲节点为空')
    payload = { nodes: nodes.map(n => node(n)), nature: p.extraction ? 'written' : 'plan' }
  } else if (p.module === 'lore') {
    const entries = list(data.entries)
    if (!entries.length) throw new Error('设定提案为空')
    const targets = new Set()
    payload = { entries: entries.map(e => {
      const id = e.id || null, text = str(e.text)
      if (!text) throw new Error('设定文本为空')
      if (id && (task.type !== 'lore.revise' || id !== task.targetId)) throw new Error('只能修订任务选定的设定')
      if (task.type === 'lore.revise' && id !== task.targetId) throw new Error('修订结果未对应选定设定')
      if (id && targets.has(id)) throw new Error('同一设定不能重复修订')
      if (id) targets.add(id)
      return { id, text, evidence: taskEvidence(e.evidence,work,frozen,p.extraction) }
    }) }
  } else if (p.module === 'characters') {
    const seen = new Set(), names = new Set(), targetIds = new Set()
    const characters = list(data.characters || [],20).map(c => {
      object(c)
      const id = c.id || null, key = str(c.key || id || '',100), name = str(c.name,100)
      if (!key || !name || seen.has(key) || names.has(name)) throw new Error('人物临时ID或名称为空/重复')
      seen.add(key); names.add(name)
      if (id && !work.characters.some(r => r.id === id && !r.deletedAt)) throw new Error('人物不存在')
      if (id && targetIds.has(id)) throw new Error('同一人物不能重复修订')
      if (id) targetIds.add(id)
      if (task.type==='character.design' && id) throw new Error('设计人物任务只能创建新人；修改现有人物请使用更新资料任务')
      if (work.characters.some(r=>!r.deletedAt&&r.id===key&&r.id!==id)) throw new Error('临时人物ID与登记人物ID冲突')
      if (task.type === 'character.revise' && id !== task.targetId) throw new Error('只能修订任务选定人物')
      const aliases = [...new Set(list(c.aliases || [],10).map(v => str(v,100)).filter(Boolean))]
      for (const alias of aliases) {
        if (alias !== name && names.has(alias)) throw new Error('人物名称或别名在提案中冲突')
        names.add(alias)
      }
      if (work.characters.some(r => !r.deletedAt && r.id!==id && aliasesOf(r).some(v => [name,...aliases].includes(v)))) throw new Error('人物同名或别名已登记，请明确归并身份')
      const fields = object(c.fields || {})
      if (Object.entries(fields).length > 30) throw new Error('人物字段过多')
      return { id, key, name, aliases, fields:Object.fromEntries(Object.entries(fields).map(([k,v]) => [str(k,100),str(v,2000)])), bio:str(c.bio || ''), evidence:taskEvidence(c.evidence,work,frozen,p.extraction) }
    })
    const refs = new Set([...seen,...work.characters.filter(c => !c.deletedAt).map(c => c.id)])
    const relationIds = new Set()
    const relations = list(data.relations || [],40).map(r => {
      if (!refs.has(r.from) || !refs.has(r.to) || r.from === r.to) throw new Error('关系引用不明确、未登记或指向自身')
      if (task.type === 'character.revise' && r.from !== task.targetId && r.to !== task.targetId) throw new Error('关系须涉及选定人物')
      if (r.id && !work.relations.some(x => x.id === r.id && x.fromId === r.from && x.toId === r.to)) throw new Error('更新关系的端点或ID无效')
      if (r.id && relationIds.has(r.id)) throw new Error('同一关系不能重复修订')
      if (r.id) relationIds.add(r.id)
      if (task.type==='character.design' && r.id) throw new Error('设计人物任务不能修改已有关系')
      const chapterId = r.chapterId || null
      if (chapterId && !frozen.allowedIds.includes(chapterId)) throw new Error('关系生效章节越界')
      return { id:r.id || null, from:r.from, to:r.to, label:str(r.label,200), chapterId, knownBy:str(r.knownBy || '',1000), evidence:taskEvidence(r.evidence,work,frozen,p.extraction) }
    })
    const states = list(data.states || [],50).map(s => {
      if (!refs.has(s.character) || !frozen.allowedIds.includes(s.chapterId) || !['伤势','能力','情感','立场','关系'].includes(s.dimension)) throw new Error('人物状态的身份、章节或维度无效')
      if (task.type === 'character.design') throw new Error('人物设计不能登记尚未发生的阶段状态')
      if (task.type === 'character.revise' && s.character !== task.targetId) throw new Error('状态须属于选定人物')
      const change=str(s.change,2000),evidence=taskEvidence(s.evidence,work,frozen,true)
      if (!change || evidence.some(r=>r.sourceType!=='chapter'||r.sourceId!==s.chapterId)) throw new Error('状态变化须提供发生章节的正文证据')
      return {character:s.character,chapterId:s.chapterId,dimension:s.dimension,change,evidence}
    })
    if (task.type === 'character.states' && (characters.length || relations.length)) throw new Error('阶段状态任务不能修改人物卡或关系图')
    if (!characters.length && !relations.length && !states.length) throw new Error('人物、关系与状态提案为空')
    if (relations.some(r => !r.label)) throw new Error('关系类型为空')
    payload = { characters, relations, states }
  } else if (p.module === 'snippets') {
    const items = list(data.items,10)
    if (!items.length) throw new Error('灵感提案为空')
    payload = { items:items.map(i => {
      const content = str(i.content); if (!content) throw new Error('灵感正文为空')
      const links = list(i.links || [],20).map(r => {
        const table = { character:'characters',lore:'mubu',outline:'olnodes' }[r.type]
        if (!table || !work[table].some(x => x.id === r.id && !x.deletedAt)) throw new Error('灵感关联目标不存在')
        return {type:r.type,id:r.id}
      })
      return {title:str(i.title || '灵感',200),content,knownFacts:str(i.knownFacts || ''),newIdea:str(i.newIdea || content),links,evidence:taskEvidence(i.evidence,work,frozen)}
    }) }
  } else if (task.type === 'memory.extract') {
    const summary = str(data.summary,6000)
    if (!summary) throw new Error('章节摘要为空')
    const facts = list(data.facts || [],50).map(f => {
      if (!['event','charstate','foreshadow'].includes(f.kind)) throw new Error('记忆事实类型无效')
      const refs = taskEvidence(f.evidence,work,frozen,true)
      if (refs.some(r => r.sourceType !== 'chapter' || r.sourceId !== task.chapterId)) throw new Error('记忆证据须来自目标章')
      const body = object(f.body)
      if (f.kind === 'charstate' && (!work.characters.some(c => c.id === f.characterId && !c.deletedAt) || !['伤势','能力','情感','立场','关系'].includes(body.dimension) || typeof body.change !== 'string')) throw new Error('人物状态须引用登记人物、状态维度和变化')
      if (f.kind === 'foreshadow' && body.action !== 'set') throw new Error('记忆提案中的伏笔仅支持新登记；推进/回收请在知识库核对')
      return { kind:f.kind,title:str(f.title,300),body:JSON.parse(JSON.stringify(body)),characterId:f.characterId || null,evidence:refs }
    })
    payload = { summary,facts }
  } else throw new Error('该任务须使用正文提交工具')
  const table={outline:'olnodes',lore:'mubu',characters:'characters',snippets:'snippets',chapters:'chapters'}[p.module]
  const target=work[table]?.find(r=>r.id===task.targetId)
  return {id:crypto.randomUUID(),kind:'workflow',task:p.module,taskType:task.type,title:p.label,workId:frozen.workId,anchorId:task.targetId,anchorLabel:target?.name||target?.title||(target?.text||'').slice(0,40)||'作品根目录',source:JSON.parse(JSON.stringify(frozen)),runId,messageId,payload,evidence,warnings,review,status:'pending',complete:true,createdAt:Date.now()}
}

// Pure, revalidated mutation plan. The caller commits the entire plan in one DB transaction.
export function workflowChanges(card, work, {includeLinks = false} = {}) {
  const checked = workflowProposal({...card.payload,evidence:card.evidence,warnings:card.warnings,review:card.review},work,card.source,card.runId,card.messageId)
  const task = normalizeTaskRequest(card.source.taskRequest,work), p = taskProfile(task.type), changes = [], time = Date.now()
  const add = (table, row, prior = null) => {
    if (changes.some(c => c.table === table && c.id === row.id)) throw new Error('提案重复修改同一条目')
    changes.push({table,id:row.id,before:prior?JSON.parse(JSON.stringify(prior)):null,after:{...row,updatedAt:time},afterHash:rowHash(row)})
  }
  const create = extra => ({id:crypto.randomUUID(),workId:card.workId,createdAt:time,updatedAt:time,deletedAt:null,...extra})
  const sort = (table,parentId) => Math.max(-1000,...work[table].filter(r => !r.deletedAt && (r.parentId || null) === parentId).map(r => r.sortOrder || 0)) + 1000
  const data = checked.payload
  if (p.module === 'outline') {
    const walk = (nodes,parentId) => nodes.forEach((n,i) => {
      const row = create({parentId,refId:n.chapterId,kind:'event',title:n.title,text:n.points,html:null,fold:false,sortOrder:sort('olnodes',parentId)+i*1000,canvasX:null,canvasY:null,w:null,h:null,shape:'process',pin:false,rels:[],outlineNature:data.nature,evidence:n.evidence,sourceChapterVersions:n.evidence.filter(e=>e.sourceType==='chapter').map(e=>({id:e.sourceId,hash:e.sourceHash})),progress:data.nature==='written'?'completed':'planned'})
      add('olnodes',row);walk(n.children,row.id)
    })
    walk(data.nodes,task.targetId)
  } else if (p.module === 'lore') data.entries.forEach((e,i) => {
    const prior = e.id ? work.mubu.find(r => r.id === e.id) : null
    add('mubu',prior?{...prior,text:e.text,html:null,evidence:e.evidence}:create({parentId:task.targetId,text:e.text,html:null,fold:false,sortOrder:sort('mubu',task.targetId)+i*1000,evidence:e.evidence}),prior)
  })
  else if (p.module === 'characters') {
    const ids = new Map(work.characters.filter(r => !r.deletedAt).map(r => [r.id,r.id]))
    data.characters.forEach(c => {
      const prior = c.id ? work.characters.find(r => r.id === c.id) : null
      const row = prior?{...prior,name:c.name,fields:{...(prior.fields||{}),...c.fields},aliases:[...new Set([...aliasesOf(prior).slice(1),...c.aliases])].join('、'),content:c.bio || prior.content,evidence:c.evidence}:create({name:c.name,aliases:c.aliases.join('、'),role:'配角',tags:[],fields:c.fields,avatarAssetId:null,content:c.bio,evidence:c.evidence})
      ids.set(c.key,row.id);add('characters',row,prior)
    })
    const relationKeys = new Set()
    data.relations.forEach(r => {
      const fromId=ids.get(r.from),toId=ids.get(r.to)
      if(fromId===toId)throw new Error('关系端点归并后指向自身')
      const relationKey=JSON.stringify([fromId,toId,r.label])
      if(relationKeys.has(relationKey))throw new Error('提案包含重复关系')
      relationKeys.add(relationKey)
      if(!r.id&&work.relations.some(x=>!x.deletedAt&&x.fromId===fromId&&x.toId===toId&&x.label===r.label))return
      const prior=r.id?work.relations.find(x=>x.id===r.id):null
      add('relations',{...(prior||create({color:'',style:''})),fromId,toId,label:r.label,effectiveChapterId:r.chapterId,knownBy:r.knownBy,evidence:r.evidence},prior)
    })
    data.states.forEach(s => {
      const chapter=work.chapters.find(c=>c.id===s.chapterId),characterId=ids.get(s.character),hash=chapterHash(chapter)
      add('aikb',create({kind:'charstate',title:s.dimension+'变化',body:{dimension:s.dimension,change:s.change},chapterId:chapter.id,orderIdx:orderedChapters(work).findIndex(c=>c.id===chapter.id),sourceHash:hash,refType:'character',refId:characterId,verified:true,semanticClass:'fact',assertionStatus:'confirmed',evidence:s.evidence[0],sourceVersions:[{table:'chapters',id:chapter.id,hash}],taskMemory:true}))
    })
  } else if (p.module === 'snippets') data.items.forEach(i => add('snippets',create({title:i.title,content:i.content,tags:['AI灵感'],knownFacts:i.knownFacts,newIdea:i.newIdea,evidence:i.evidence,aiLinks:includeLinks?i.links:[]})))
  else {
    const chapter=work.chapters.find(c=>c.id===task.chapterId),hash=chapterHash(chapter)
    const previous=(work.aisum || []).find(s=>s.entityType==='chapter'&&s.entityId===chapter.id)
    add('aisum',{...(previous || create({})),entityType:'chapter',entityId:chapter.id,sourceHash:hash,contentHash:hashContent(chapter.content||''),coverageVersion:1,schemaVersion:1,summary:data.summary,assertionStatus:'confirmed',evidence:card.evidence},previous)
    data.facts.forEach(f=>add('aikb',create({kind:f.kind,title:f.title,body:{...f.body,...(f.kind==='foreshadow'?{foreshadowId:'fs:'+crypto.randomUUID()}: {})},chapterId:chapter.id,orderIdx:orderedChapters(work).findIndex(c=>c.id===chapter.id),sourceHash:hash,refType:f.characterId?'character':'chapter',refId:f.characterId||chapter.id,verified:true,semanticClass:'fact',assertionStatus:'confirmed',evidence:f.evidence[0],sourceVersions:card.source.sourceVersions,taskMemory:true})))
  }
  if (!changes.length) throw new Error('没有可应用的新变更')
  return changes
}
