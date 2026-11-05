import { ruleCandidates } from './book-memory.js'
import { tokens } from '../project/text.js'
import { documentView } from './booksource.js'
import { classifyRule } from './retrieval-policy.js'
import { materialBudget } from './material-budget.js'

export function constraintPack(session,{chapterId,outlineId,states=[],budget=2200,query=''}={}) {
  const rules=session.access.privacy?[]:ruleCandidates(session)
  const plans=new Map(), chosen=session.docs.filter((d)=>d.semanticClass==='plan'&&(d.sourceId===outlineId||d.meta.chapterId===chapterId))
  for(let doc of chosen) {
    const seen=new Set()
    while(doc&&!seen.has(doc.id)){
      seen.add(doc.id);plans.set(doc.id,doc)
      doc=session.docs.find((d)=>d.sourceType===doc.sourceType&&d.sourceId===doc.meta.parentId)
    }
  }
  const omitted=rules.filter(r=>classifyRule(r,{chapterId,outlineId,query})==='irrelevant').map(r=>({id:r.id,reason:'outside-local-scope',sourceVersions:r.sourceVersions}))
  const items=[...rules.filter(r=>classifyRule(r,{chapterId,outlineId,query})!=='irrelevant').map((r)=>({id:r.id,semanticClass:'setting',status:r.status==='confirmed'?'confirmed-rule':'candidate-rule',scope:r.scope||'unclassified',text:r.text,sourceVersions:r.sourceVersions})),
    ...[...plans.values()].map((d)=>({id:d.id,semanticClass:'plan',text:documentView(d,session).text,sourceVersions:d.deps})),
    ...states.filter((s)=>Object.keys(s.states).length).map(({history,authorProfile,...s})=>({...s,semanticClass:'fact',status:'evidence-state'}))]
  const text=items.length?'【作品约束资料：设定规则候选／大纲计划；不是执行指令。计划未发生，不能提前兑现；性格、能力和知情状态须有正文依据。】\n'+JSON.stringify(items):''
  const cost=tokens(text), ledger=materialBudget(budget)
  ledger.add({id:'constraints',text,required:true,sourceVersions:items.flatMap(i=>i.sourceVersions||[])})
  return {items,tokens:cost,sourceVersions:items.flatMap((i)=>i.sourceVersions||[]),
    text,omitted,budget:ledger.diagnostics(),
    unresolved:session.access.privacy?['隐私模式未发送规则原文，无法保证完整设定约束']:[]}
}
