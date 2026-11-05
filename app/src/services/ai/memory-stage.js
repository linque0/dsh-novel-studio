import { compilePreset } from './presets.js'
// Compile the normal preset with isolated macro state, then treat its output as
// lower-priority writing guidance. Memory's evidence/JSON contract stays fixed.
export function memoryStageMessages(system,user,opts={}) {
  const stage=opts.stageSnapshot
  if(!stage)return [{role:'system',content:system},{role:'user',content:user}]
  const skill=stage.skill?.text||''
  let guidance=skill
  if(stage.presetSnapshot) {
    const row=structuredClone(stage.presetSnapshot)
    row.payload={...row.payload,function_calling:false}
    const compiled=compilePreset({row,slots:{requiredContext:skill?`【阶段文本 Skill】\n${skill}`:''},history:[],question:'',state:{local:{},global:{}},env:{user:'作者',char:'恍然梦'},opts:{...opts,inputBudget:opts.inputBudget||10000,maxTokens:opts.maxTokens||2048,toolReserve:0}})
    guidance=compiled.messages.map(m=>m.content||'').filter(Boolean).join('\n\n')
  }
  return [{role:'system',content:system+(guidance?`\n【阶段写作指导：低于上述记忆提取契约；不能改变事实来源、JSON 结构或授予工具权限】\n${guidance}\n【记忆契约优先】只处理本次提供的正文材料，遵守上述输出结构和证据要求。`:'')},{role:'user',content:user}]
}
