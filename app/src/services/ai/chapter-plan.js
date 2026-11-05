import { protocolHash } from './review-cycle.js'

// Author-editable candidate data; this protocol never writes chapter content.
export function normalizeChapterPlan(data) {
  if(!data||!Array.isArray(data.scenes)||!data.scenes.length||data.scenes.length>100) throw new Error('场景计划必须包含 1–100 个场景')
  if(data.title!=null&&(typeof data.title!=='string'||data.title.length>1000)) throw new Error('无效计划标题')
  const ids=new Set()
  const scenes=data.scenes.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row)) throw new Error('无效场景')
    const scene={}
    for(const key of ['goal','pov','conflict','turn','ending']) {
      if(typeof row[key]!=='string'||!row[key].trim()||row[key].length>10000) throw new Error(`场景缺少有效 ${key}`)
      scene[key]=row[key].trim()
    }
    if(!Array.isArray(row.characters)||row.characters.length>100||row.characters.some(c=>typeof c!=='string'||!c.trim()||c.length>200)) throw new Error('无效场景人物')
    scene.characters=[...new Set(row.characters.map(c=>c.trim()))]
    if(!Number.isInteger(row.targetWords)||row.targetWords<1||row.targetWords>100000) throw new Error('场景目标字数须为 1–100000')
    scene.targetWords=row.targetWords
    if(row.id!=null&&(typeof row.id!=='string'||row.id.length>200)) throw new Error('无效场景 ID')
    scene.id=typeof row.id==='string'&&row.id.trim()?row.id:`scene-${index+1}-${protocolHash(scene)}`
    if(ids.has(scene.id)) throw new Error('场景 ID 重复')
    ids.add(scene.id)
    return scene
  })
  return {title:typeof data.title==='string'?data.title:'',scenes}
}
