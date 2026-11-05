import { knowledgeSnapshot } from './knowledge.js'
import { withoutQuotes } from './contracts.js'

export async function stateAt(work,{entityIds=[],asOfChapterId=null,privacy=false,writingBoundary=null}={}) {
  const snapshot=await knowledgeSnapshot(work,asOfChapterId,writingBoundary)
  const characters=work.characters.filter((c)=>!c.deletedAt&&(!entityIds.length||entityIds.includes(c.id)||entityIds.includes('character:'+c.id)))
  return characters.map((c)=>{
    const history=snapshot.cards.filter((r)=>r.kind==='charstate'&&r.refType==='character'&&r.refId===c.id).sort((a,b)=>a.orderIdx-b.orderIdx)
    const states={}
    for(const change of history)states[change.body.dimension]={value:change.body.change,chapterId:change.chapterId,evidence:privacy?undefined:change.evidence}
    return {entityId:'character:'+c.id,name:c.name,states,history:privacy?history.map(withoutQuotes):history,
      sourceVersions:history.map((r)=>({table:'chapters',id:r.chapterId,hash:r.sourceHash})),
      authorProfile:asOfChapterId?undefined:{fields:c.fields,temporalStatus:'unknown'},
      unresolved:history.length?[]:['没有完整正文状态记录；不能把当前人物卡当过去状态'],knowledgeStatus:'only-explicit-evidence'}
  })
}
