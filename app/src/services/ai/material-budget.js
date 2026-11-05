import { tokens } from '../project/text.js'

export function materialBudget(limit) {
  const total=Math.max(0,Number(limit)||0), included=[], omitted=[]
  let used=0
  return {
    add({id,text='',required=false,sourceVersions=[]}) {
      const cost=tokens(text), entry={id,tokens:cost,required,sourceVersions}
      if(used+cost>total){omitted.push({...entry,reason:'budget'});if(required)throw new Error('必要材料超出材料预算，请提高上下文预算或缩小任务范围');return false}
      used+=cost;included.push(entry);return true
    },
    diagnostics:()=>({limit:total,used,remaining:total-used,included:[...included],omitted:[...omitted]})
  }
}
