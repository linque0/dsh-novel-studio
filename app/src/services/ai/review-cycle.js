// Same JSON/FNV fingerprint as presets, kept dependency-free for protocol consumers.
export function protocolHash(value) {
  let h=2166136261
  for(const c of JSON.stringify(value)) h=Math.imul(h ^ c.charCodeAt(0),16777619)
  return (h>>>0).toString(16)
}
const object=value=>value && typeof value==='object' && !Array.isArray(value)
const str=value=>typeof value==='string'?value:''
function capped(row,keys,limit=20000) {
  for(const key of keys) if(row[key]!=null&&(typeof row[key]!=='string'||row[key].length>limit)) throw new Error(`无效或过长的 ${key}`)
}
function immutable(value) {
  if(value && typeof value==='object') { for(const child of Object.values(value)) immutable(child);Object.freeze(value) }
  return value
}
export function freezeDraft(card) {
  if(!object(card)||!str(card.id)||!Number.isInteger(card.revision??0)||(card.revision??0)<0) throw new Error('无效草稿身份或版本')
  const text=card.editText??card.text
  if(typeof text!=='string'||text.length>2000000||card.id.length>200) throw new Error('草稿正文必须是有界文本')
  const contentHash=protocolHash(text)
  if(card.contentHash!=null&&card.contentHash!==contentHash) throw new Error('草稿正文哈希不匹配')
  return immutable({id:card.id,revision:card.revision??0,contentHash,text})
}
export function assertReviewCurrent(review,draft) {
  const current=freezeDraft(draft), source=review?.sourceDraft
  if(source?.text!=null) freezeDraft(source)
  if(!source||source.id!==current.id||source.revision!==current.revision||source.contentHash!==current.contentHash) throw new Error('审稿来源已变化，请重新审稿')
  return true
}
function locate(text,quote,start,end) {
  if(!quote) return null
  if(start!==undefined && start!==null) {
    if(!Number.isInteger(start)||start<0||text.slice(start,start+quote.length)!==quote||(end!=null&&end!==start+quote.length)) return null
    return {start,end:start+quote.length}
  }
  const at=text.indexOf(quote)
  return at>=0 && text.indexOf(quote,at+1)<0?{start:at,end:at+quote.length}:null
}
export function normalizeReview(data,draft,resolveEvidence) {
  const sourceDraft=freezeDraft(draft)
  if(!object(data)||!Array.isArray(data.items)||data.items.length>200) throw new Error('审稿必须包含问题清单（至多 200 项）')
  if(data.sourceDraft) assertReviewCurrent(data,sourceDraft)
  const ids=new Set()
  const items=data.items.map((row,index)=>{
    if(!object(row)||!['error','warning','suggestion','pass'].includes(row.severity??'suggestion')||!str(row.problem).trim()) throw new Error('无效审稿条目')
    capped(row,['category','problem','expected','quote']);capped(row,['id'],200)
    const quote=str(row.quote), position=locate(sourceDraft.text,quote,row.start,row.end)
    if(row.evidence!=null&&(!Array.isArray(row.evidence)||row.evidence.length>100)) throw new Error('无效证据清单')
    const evidence=(row.evidence??[]).map(e=>{
      if(!object(e)) throw new Error('无效来源证据')
      capped(e,['quote']);capped(e,['sourceType','sourceId'],200)
      const clean={sourceType:str(e.sourceType),sourceId:str(e.sourceId),quote:str(e.quote),...(e.start!=null?{start:e.start}:{}),...(e.end!=null?{end:e.end}:{})}
      let found=null
      try {const source=resolveEvidence?.(clean);if(source && source.verified!==false) found=locate(typeof source==='string'?source:str(source.text),clean.quote,clean.start,clean.end)} catch { /* Missing or stale source is unverified. */ }
      return {...clean,...(found??{}),evidenceStatus:found?'verified':'unverified'}
    })
    const id=str(row.id)||`finding-${index+1}-${protocolHash([row.category,row.problem,quote])}`
    if(ids.has(id)) throw new Error('审稿问题 ID 重复')
    ids.add(id)
    return {id,severity:row.severity??'suggestion',category:str(row.category),problem:row.problem.trim(),expected:str(row.expected),quote,start:position?.start??null,end:position?.end??null,evidence,evidenceStatus:position&&evidence.every(e=>e.evidenceStatus==='verified')?'verified':'unverified'}
  })
  return immutable({sourceDraft,items})
}
export function confirmReview(review,draft,decisions={},authorGuidance='') {
  assertReviewCurrent(review,draft)
  if(!object(decisions)||typeof authorGuidance!=='string'||authorGuidance.length>20000) throw new Error('无效作者确认')
  const ids=new Set(review.items.map(item=>item.id))
  for(const [id,decision] of Object.entries(decisions)) if(!ids.has(id)||!['apply','ignore','defer'].includes(decision)) throw new Error('无效作者选择')
  return immutable({sourceDraft:freezeDraft(draft),items:JSON.parse(JSON.stringify(review.items.filter(item=>decisions[item.id]==='apply'))),authorGuidance:authorGuidance.trim(),confirmed:true})
}
export function normalizeRecheck(data,review,revisedDraft) {
  const draft=freezeDraft(revisedDraft)
  const source=review?.sourceDraft
  if(source?.text!=null) freezeDraft(source)
  if(!source||(draft.id!==source.id&&revisedDraft.parentDraftId!==source.id)||draft.revision<=source.revision) throw new Error('复核草稿身份或版本不匹配')
  if(!object(data)||!Array.isArray(data.items)) throw new Error('无效复核清单')
  const expected=new Set(review.items.map(item=>item.id)),seen=new Set()
  if(data.items.length!==expected.size) throw new Error('复核必须覆盖全部原问题')
  const items=data.items.map(row=>{
    if(!object(row)||!expected.has(row.id)||seen.has(row.id)) throw new Error('复核包含未知或重复问题')
    if(!['resolved','unresolved'].includes(row.status)) throw new Error('无效复核状态')
    capped(row,['quote','explanation'])
    seen.add(row.id)
    const quote=str(row.quote),position=locate(draft.text,quote,row.start,row.end)
    return {id:row.id,status:row.status==='resolved'&&position?'resolved':'unresolved',quote,start:position?.start??null,end:position?.end??null,explanation:str(row.explanation)}
  })
  return immutable({sourceDraft:review.sourceDraft,revisedDraft:draft,items})
}
