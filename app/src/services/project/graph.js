import { hashContent, rowHash, stableStringify, normalizeText } from './text.js'
import { outlineConnections } from './outline-connections.js'
import { doublelinkTitle } from '../doublelink-titles.js'

export function projectGraph(bundle, docs, decisions = []) {
  const workId = bundle.work.id, entities = [], edges = [], issues = []
  const live = (t) => (bundle[t] || []).filter((r) => !r.deletedAt && (!r.workId || r.workId === workId))
  const docMap=new Map(docs.filter(d=>d.sourceType!=='outlineconnection').map((d)=>[d.sourceTable+':'+d.sourceId,d]))
  const docFor = (t, id) => docMap.get(t+':'+id)
  const addEntity = (kind, row, type, title) => {
    const id = `${type}:${row.id}`, doc = docFor(type === 'character' ? 'characters' : 'mubu', row.id)
    entities.push({ id, workId, kind, name: title, aliases: String(row.aliases || '').split(/[、，,\s/]+/).filter(Boolean), refType: type, refId: row.id,
      semanticClass: 'setting', temporalStatus: 'unknown', sourceHash: rowHash(row), docId: doc?.id })
  }
  for (const c of live('characters')) addEntity('character', c, 'character', c.name)
  for (const n of live('mubu')) addEntity(/势力|组织|门派/.test(docFor('mubu',n.id)?.headingPath.join('/') || '') ? 'faction' : 'lore', n, 'lore', (n.text || '').split('\n')[0])
  const edge = (fromId, toId, kind, doc, label = '', semanticClass = doc?.semanticClass || 'setting', details = {}) => {
    const id = 'edge:' + hashContent(stableStringify([fromId, toId, kind, doc?.id, label,details.connectionId,details.fromEndpoint,details.toEndpoint]))
    edges.push({ id, workId, fromId, toId, kind, label, semanticClass, docId: doc?.id, chapterId: doc?.meta.chapterId || null,
      dependencies: doc?.deps || [], temporalStatus: semanticClass === 'fact' ? 'chapter' : 'unknown', ...details })
  }
  for(const entity of entities)if(entity.docId)edge(entity.id,entity.docId,'profile',docs.find((d)=>d.id===entity.docId))
  for (const r of live('relations')) {
    const d = docFor('relations',r.id)
    if (d) edge('character:' + r.fromId, 'character:' + r.toId, 'relationship', d, r.label)
  }
  for(const r of live('lorelinks')) {
    const d=docFor('lorelinks',r.id),entity=(kind,id)=>(kind==='mubu'?'lore':'character')+':'+id
    if(d)edge(entity(r.fromKind,r.fromId),entity(r.toKind,r.toId),'entry-relationship',d,r.label,'setting',{reverseLabel:r.reverseLabel||'',description:r.description||''})
  }
  const connections=outlineConnections(live('olnodes'))
  issues.push(...connections.issues)
  const connectionId=(ownerId,relId)=>`outline-connection:${ownerId}:${relId}`
  for(const e of connections.entries) {
    const d=docs.find(d=>d.sourceType==='outlineconnection'&&d.sourceId===e.owner.id&&d.meta.connectionId===e.key)
    if(!d)continue
    const id=connectionId(e.owner.id,e.key)
    entities.push({id,workId,kind:'outline-connection',name:e.rel.label||e.rel.kind||'关联',refType:'olnode',refId:e.owner.id,docId:d.id,semanticClass:d.semanticClass,temporalStatus:'unknown'})
    edge(id,docFor('olnodes',e.owner.id)?.id,'connection-source',d)
    const endpoint=p=>p.nodeId?docFor('olnodes',p.nodeId)?.id:connectionId(p.ownerId,p.relId)
    edge(endpoint(e.from),endpoint(e.to),'outline-'+(e.rel.kind||'关联'),d,e.rel.label||e.rel.kind||'关联',d.semanticClass,{connectionId:id,fromEndpoint:e.from,toEndpoint:e.to,arrows:e.rel.arrows||'->'})
  }
  const names = new Map()
  for (const e of entities.filter(e=>e.kind!=='outline-connection')) for (const name of [e.name, ...e.aliases].filter(Boolean)) {
    if (!names.has(name)) names.set(name, [])
    names.get(name).push(e)
  }
  const targetDocs=(kind,id)=>kind==='outline'?docs.filter((d)=>['outline','olnode'].includes(d.sourceType)&&(d.sourceId===id||d.meta.refId===id)):docs.filter((d)=>d.sourceType===(kind==='lore'?'mubu':kind)&&d.sourceId===id)
  const titleTargets=new Map()
  for(const d of docs) {
    if(d.sourceType==='outlineconnection')continue
    const row=(bundle[d.sourceTable]||[]).find(r=>r.id===d.sourceId)
    const alias=['outline','olnode'].includes(d.sourceType)?doublelinkTitle('outline',{id:d.meta.refId||d.sourceId},bundle):row?doublelinkTitle(d.sourceType,row,bundle):''
    for(const title of new Set([d.title,alias].filter(Boolean).map(t=>normalizeText(t,'text').toLowerCase()))) {
      if(!titleTargets.has(title))titleTargets.set(title,[])
      titleTargets.get(title).push(d)
    }
  }
  for(const link of live('links')) {
    const source=targetDocs(link.entityType,link.entityId)[0],target=docFor('assets',link.assetId)
    if(source&&target)edge(source.id,target.id,'attachment',source)
    else issues.push({type:'missing-attachment-link',sourceId:link.entityId,assetId:link.assetId})
  }
  for (const doc of docs) {
    if(doc.sourceType==='outlineconnection')continue
    const source=(bundle[doc.sourceTable]||[]).find((r)=>r.id===doc.sourceId)
    const raw=[source?.content,source?.html,source?.text,...(source?.textboxes||[]).map((b)=>b.text)].filter(Boolean).join('\n')
    if(doc.sourceType==='snippet')for(const link of source?.aiLinks||[]) {
      const targets=targetDocs(link.type,link.id)
      if(targets.length)for(const target of targets)edge(doc.id,target.id,'inspiration-link',doc)
      else issues.push({type:'missing-inspiration-link',sourceId:doc.sourceId,ref:link.type+':'+link.id})
    }
    for(const match of raw.matchAll(/data-dl-target\s*=\s*["']([^"']+)["']/g)) {
      const sep=match[1].indexOf(':'),kind=match[1].slice(0,sep),id=match[1].slice(sep+1),targets=sep>0?targetDocs(kind,id):[]
      if(targets.length)for(const target of targets)edge(doc.id,target.id,'doublelink',doc)
      else issues.push({type:'missing-doublelink',sourceId:doc.sourceId,ref:match[1]})
    }
    for(const match of raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      const title=normalizeText(match[1],'text').toLowerCase(),targets=titleTargets.get(title)||[]
      if(targets.length===1)edge(doc.id,targets[0].id,'doublelink',doc)
      else issues.push({type:targets.length?'ambiguous-doublelink':'missing-doublelink',sourceId:doc.sourceId,title:match[1]})
    }
    if (doc.meta.parentId) {
      const parent = docs.find((d) => d.sourceType === doc.sourceType && d.sourceId === doc.meta.parentId)
      if (parent) edge(doc.id, parent.id, 'parent', doc)
    }
    if (doc.meta.refId) {
      const [type, id] = doc.meta.refId.includes(':') ? doc.meta.refId.split(':') : [null, doc.meta.refId]
      const target = docs.find((d) => d.sourceId === id && (!type || d.sourceType === type || (type === 'lore' && d.sourceType === 'mubu')))
      if (target) edge(doc.id, target.id, doc.semanticClass === 'plan' ? 'plans' : 'reference', doc)
      else issues.push({ type: 'missing-reference', sourceId: doc.sourceId, ref: doc.meta.refId })
    }
    if (doc.sourceType !== 'chapter') continue
    for (const [name, matched] of names) {
      if (!doc.plainText.includes(name)) continue
      const merge = decisions.find((d) => d.key === 'entity:' + name && d.action === 'merge')
      const matches = merge ? matched.filter((e) => e.refId === merge.refId && e.refType === merge.refType) : matched
      if (matches.length !== 1) { issues.push({ type: 'ambiguous-mention', sourceId: doc.sourceId, name }); continue }
      edge(doc.id, matches[0].id, 'mention', doc, name, 'fact')
    }
  }
  return { entities, edges: [...new Map(edges.map((e) => [e.id,e])).values()], issues }
}
