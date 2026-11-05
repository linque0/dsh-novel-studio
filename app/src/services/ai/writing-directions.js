const text=(value,max)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('剧情方向标题或演变为空或过长')
  return value.trim()
}
export function normalizeDirectionRows(rows,expectedCount=null) {
  if(!Array.isArray(rows)||!rows.length||rows.length>6||(expectedCount!==null&&rows.length!==expectedCount))throw new Error('剧情方向数量不符合本次要求')
  const ids=new Set(),contents=new Set()
  return rows.map(r=>{
    const id=text(r?.id,100),title=text(r.title,120),development=text(r.development,5000)
    if(ids.has(id)||contents.has(development))throw new Error('剧情方向 ID 或演变重复')
    ids.add(id);contents.add(development)
    return {id,title,development}
  })
}

// Only parse balanced objects in the directions array. Never evaluate model output.
export function completedDirectionRows(raw='') {
  const match=/"directions"\s*:\s*\[/.exec(raw)
  if(!match)return []
  const rows=[];let depth=0,start=-1,quoted=false,escaped=false
  for(let i=match.index+match[0].length;i<raw.length;i++) {
    const c=raw[i]
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
    if(c==='"'){quoted=true;continue}
    if(c==='{'){if(depth++===0)start=i}
    else if(c==='}'&&depth>0){if(--depth===0){try{rows.push(JSON.parse(raw.slice(start,i+1)))}catch{return rows}}}
    else if(c===']'&&depth===0)break
  }
  return rows
}

export function mergeDirectionRows(session,rows,token) {
  if(session.generation?.token!==token)return false
  const checked=normalizeDirectionRows(rows),g=session.generation
  checked.forEach((row,i)=>{
    const id=g.slots[i]||=(crypto.randomUUID()),existing=session.directions.find(d=>d.id===id)
    if(g.removed?.includes(id))return
    if(existing) {
      if(existing.lastIncoming===JSON.stringify(row))return
      existing.lastIncoming=JSON.stringify(row)
      if(existing.edited||existing.kept||existing.revision>(g.revisions[id]??0)) {
        existing.alternatives||=[];existing.alternatives.push({...row});return
      }
      existing.original={title:row.title,development:row.development};existing.draft={...existing.original};existing.complete=true
    } else session.directions.push({id,original:{title:row.title,development:row.development},draft:{title:row.title,development:row.development},revision:0,edited:false,kept:false,complete:true,lastIncoming:JSON.stringify(row)})
  })
  return true
}
export function editDirection(session,id,patch) {
  const d=session.directions.find(d=>d.id===id)
  if(!d)throw new Error('剧情方向已移除')
  for(const key of ['title','development'])if(key in patch){if(typeof patch[key]!=='string'||patch[key].length>(key==='title'?120:5000))throw new Error('剧情方向内容过长');d.draft[key]=patch[key]}
  d.revision++;d.edited=true;d.kept=true
}
export function selectedDirectionSnapshot(session) {
  const d=session.directions.find(d=>d.id===session.selectedId)
  if(!d?.complete)throw new Error('请先选择一个完整剧情方向')
  return {id:d.id,revision:d.revision,title:text(d.draft.title,120),development:text(d.draft.development,5000)}
}

export function directionProposal(data,frozen,{runId,messageId}={}) {
  if(frozen.taskRequest?.type!=='chapter.directions')throw new Error('不是剧情方向任务')
  const directions=normalizeDirectionRows(data?.directions,frozen.taskRequest.directionCount)
  return {id:crypto.randomUUID(),kind:'directions',taskType:'chapter.directions',title:'剧情方向（可编辑草案）',workId:frozen.workId,source:JSON.parse(JSON.stringify(frozen)),directions,runId,messageId,complete:true,status:'draft'}
}
