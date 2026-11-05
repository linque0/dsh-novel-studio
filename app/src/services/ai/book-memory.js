import { db } from '../../db/database.js'
import { ensureProjection, readSourceSnapshot } from '../../db/project-repo.js'
import { sourceManifest } from '../project/normalize.js'
import { hashContent, checkAbort, sourceChanged } from '../project/text.js'

// Registered material is indexed as registered material, never invented facts.
// No model is needed to copy author records into the semantic read index.
export async function buildBookMemory(workId,{signal,onProgress}={}) {
  const projection=await ensureProjection(workId,{signal})
  const docs=projection.docs.filter((d)=>!['chapter','work','volume','asset','lorecat'].includes(d.sourceType))
  const done=[]
  for(const doc of docs) {
    checkAbort(signal)
    const chunks=projection.chunks.filter((c)=>c.docId===doc.id)
    const cards=chunks.map((c)=>({id:'source:'+c.id,workId,docId:doc.id,kind:doc.semanticClass==='summary'?'writtenOutline':doc.semanticClass==='plan'?'planBeat':doc.semanticClass==='inspiration'?'inspiration':doc.semanticClass==='comment'?'comment':doc.sourceType==='character'?'characterProfile':['relation','lorelink'].includes(doc.sourceType)?'relation':'authorSetting',
      schemaVersion:1,semanticClass:doc.semanticClass,assertionStatus:'authorRecord',title:doc.title,
      body:{text:c.text,sourceType:doc.sourceType,temporalStatus:doc.meta.temporalStatus||'author-record'},
      refType:doc.sourceType,refId:doc.sourceId,sourceHash:doc.sourceHash,contextHash:doc.contextHash,dependencies:doc.deps,
      evidence:{docId:doc.id,sourceType:doc.sourceType,sourceId:doc.sourceId,textHash:doc.textHash,sourceHash:doc.sourceHash,start:c.contextStart,end:c.coreEnd,chunkId:c.id,paragraphId:c.paragraphIds[0],evidenceStatus:'source-record'},updatedAt:Date.now()}))
    const meta={id:'docmeta:'+doc.id,workId,docId:doc.id,sourceType:doc.sourceType,sourceId:doc.sourceId,sourceHash:doc.sourceHash,contextHash:doc.contextHash,status:'success',mode:'source-records',extracted:false,totalChunks:chunks.length,doneChunks:chunks.length,updatedAt:Date.now()}
    await db.transaction('rw',[db.aikb,db.aikbmeta,db.aiindex],async()=>{
      const current=await db.aiindex.get(workId)
      if(current?.sourceRevision!==projection.index.sourceRevision||current.status!=='ready')throw sourceChanged()
      await db.aikb.where('workId').equals(workId).filter((r)=>r.docId===doc.id&&r.assertionStatus==='authorRecord').delete()
      if(cards.length)await db.aikb.bulkPut(cards)
      await db.aikbmeta.put(meta)
    })
    done.push(doc.id);onProgress?.({stage:'source-index',done:done.length,total:docs.length})
  }
  const source=await readSourceSnapshot(workId)
  if(sourceManifest(source).hash!==projection.index.sourceRevision)throw sourceChanged()
  const keep=new Set(docs.map((d)=>d.id))
  await db.transaction('rw',[db.aikb,db.aikbmeta],async()=>{
    await db.aikb.where('workId').equals(workId).filter((r)=>r.assertionStatus==='authorRecord'&&!keep.has(r.docId)).delete()
    await db.aikbmeta.where('workId').equals(workId).filter((r)=>r.mode==='source-records'&&!keep.has(r.docId)).delete()
  })
  return {projection,readDocuments:done.length,mode:'source-records'}
}

export function ruleCandidates(session) {
  return session.docs.filter((d)=>d.semanticClass==='setting'&&!['character','relation','lorelink'].includes(d.sourceType)).flatMap((doc)=>
    doc.plainText.split('\n').filter((line)=>/必须|不得|不能|禁止|不可|只有|需要|代价|上限/.test(line)).map((text)=>{
      const row=session.work?.[doc.sourceTable]?.find(r=>r.id===doc.sourceId),rule=row?.rulePolicy || doc.meta?.rulePolicy || {}
      return {id:'rule:'+hashContent(doc.id+':'+text),docId:doc.id,sourceId:doc.sourceId,text,semanticClass:'setting',strength:'candidate',status:rule.status==='confirmed'?'confirmed':'needsReview',scope:rule.scope,chapterId:rule.chapterId,outlineId:rule.outlineId,targetIds:rule.targetIds,keywords:rule.keywords,sourceVersions:doc.deps}
    }))
}
