/* Relationship commands are validated on a draft. The store commits once, after success. */
export function flattenRelations(nodes) {
  const out=[]
  function walk(owner,arr,parent=null) {
    for(const rel of arr||[]) {out.push({owner,rel,arr,parent});walk(owner,rel._out,rel)}
  }
  for(const owner of nodes) if(!owner.deletedAt) walk(owner,owner.rels)
  return out
}
const refKey=r=>`${r.ownerId}:${r.relId}`
const sameRef=(a,b)=>a&&b&&a.ownerId===b.ownerId&&a.relId===b.relId&&a.junctionId===b.junctionId
const sourceOf=e=>e.rel.fromJunction?{...e.rel.fromJunction}:{nodeId:e.owner.id,side:e.rel.fromSide}
const targetOf=e=>e.rel.toJunction?{...e.rel.toJunction}:{nodeId:e.rel.toId,side:e.rel.toSide}
const sameEndpoint=(a,b)=>a.nodeId?!!b.nodeId&&a.nodeId===b.nodeId:sameRef(a,b)

export function relationTransaction(nodes,command,{uid,now=Date.now}={}) {
  const draft=JSON.parse(JSON.stringify(nodes))
  const fail=error=>({ok:false,error})
  const entries=()=>flattenRelations(draft)
  const find=(ownerId,relId)=>entries().find(e=>e.owner.id===ownerId&&e.rel.id===relId)
  if(command.type==='prune') {
    const live=new Set(draft.filter(n=>!n.deletedAt).map(n=>n.id))
    for(let changed=true;changed;) {
      changed=false
      for(const e of entries()) {
        const refs=[e.rel.fromJunction,e.rel.toJunction].filter(Boolean)
        if((!e.rel.toJunction&&!live.has(e.rel.toId))||refs.some(r=>!find(r.ownerId,r.relId)?.rel.junctions?.some(j=>j.id===r.junctionId))) {
          e.arr.splice(e.arr.indexOf(e.rel),1);changed=true
        }
      }
    }
    return {ok:true,nodes:draft}
  }
  let current=command.relId?find(command.ownerId,command.relId):null
  if(command.relId&&!current) return fail('连线不存在')
  if(command.type==='remove'||command.type==='junction-remove') {
    const dead=new Set()
    if(command.type==='remove') dead.add(refKey({ownerId:current.owner.id,relId:current.rel.id}))
    else {
      const ref={ownerId:current.owner.id,relId:current.rel.id,junctionId:command.junctionId}
      if(!current.rel.junctions?.some(j=>j.id===command.junctionId)) return fail('连接点不存在')
      current.rel.junctions=current.rel.junctions.filter(j=>j.id!==command.junctionId)
      for(const e of entries()) if([e.rel.fromJunction,e.rel.toJunction].some(r=>sameRef(r,ref))) dead.add(refKey({ownerId:e.owner.id,relId:e.rel.id}))
    }
    for(let changed=true;changed;) {
      changed=false
      for(const e of entries()) {
        const key=refKey({ownerId:e.owner.id,relId:e.rel.id})
        if(dead.has(key)||[e.rel.fromJunction,e.rel.toJunction].some(r=>r&&dead.has(refKey(r)))) {
          for(const c of flattenRelations([{...e.owner,rels:[e.rel]}])) dead.add(refKey({ownerId:c.owner.id,relId:c.rel.id}))
          e.arr.splice(e.arr.indexOf(e.rel),1);changed=true
        }
      }
    }
    return {ok:true,nodes:draft}
  }
  if(command.type==='patch') {
    Object.assign(current.rel,command.patch)
    return {ok:true,nodes:draft,rel:current.rel,ownerId:current.owner.id}
  }
  if(!['connect','reconnect'].includes(command.type)) return fail('未知关系操作')
  const resolve=endpoint=>{
    if(!endpoint) return null
    if(endpoint.nodeId) return draft.some(n=>n.id===endpoint.nodeId&&!n.deletedAt)?{nodeId:endpoint.nodeId,side:endpoint.side}:null
    const host=find(endpoint.ownerId,endpoint.relId)
    if(!host) return null
    let j=host.rel.junctions?.find(j=>j.id===endpoint.junctionId)
    if(!j&&Number.isFinite(endpoint.t)) {
      j={id:uid(),t:Math.max(0,Math.min(1,endpoint.t)),bornAt:now()}
      host.rel.junctions=[...(host.rel.junctions||[]),j]
    }
    return j?{ownerId:host.owner.id,relId:host.rel.id,junctionId:j.id}:null
  }
  const source=resolve(command.type==='connect'?command.source:command.end==='source'?command.endpoint:sourceOf(current))
  const target=resolve(command.type==='connect'?command.target:command.end==='target'?command.endpoint:targetOf(current))
  if(!source||!target) return fail('落点无效')
  const rel=command.type==='connect'?{id:uid(),label:'',kind:'关联',arrows:'->',style:'',junctions:[],...(command.fields||{})}:current.rel
  if(entries().some(e=>e.rel.id!==rel.id&&sameEndpoint(sourceOf(e),source)&&sameEndpoint(targetOf(e),target)&&(e.rel.kind||'关联')===(rel.kind||'关联'))) return fail('相同关系已存在')
  if(current) current.arr.splice(current.arr.indexOf(rel),1)
  const ownerId=source.nodeId||source.ownerId
  const nestedIds=new Set(flattenRelations([{id:ownerId,rels:[rel]}]).map(e=>e.rel.id))
  if(!source.nodeId&&nestedIds.has(source.relId)) return fail('不能依赖自身的宿主连线')
  if(source.nodeId) {delete rel.fromJunction;rel.fromSide=source.side;const owner=draft.find(n=>n.id===ownerId);(owner.rels||=([])).push(rel)}
  else {rel.fromJunction={...source};delete rel.fromSide;const host=find(source.ownerId,source.relId);if(!host) return fail('起点不存在');(host.rel._out||=([])).push(rel)}
  if(target.nodeId) {rel.toId=target.nodeId;rel.toSide=target.side;delete rel.toJunction}
  else {rel.toId=null;rel.toJunction={...target};delete rel.toSide}
  // Moving a host also moves its full outgoing tree; update every incoming reference.
  for(const e of entries()) for(const field of ['fromJunction','toJunction']) {
    const r=e.rel[field]
    if(r&&nestedIds.has(r.relId)) r.ownerId=ownerId
  }
  const all=entries(),byKey=new Map(all.map(e=>[refKey({ownerId:e.owner.id,relId:e.rel.id}),e.rel]))
  const visiting=new Set(),visited=new Set()
  function visit(key) {
    if(visiting.has(key)) return false
    if(visited.has(key)) return true
    visiting.add(key)
    const edge=byKey.get(key)
    if(!edge) return false
    for(const ref of [edge.fromJunction,edge.toJunction].filter(Boolean)) {
      const host=byKey.get(refKey(ref))
      if(!host?.junctions?.some(j=>j.id===ref.junctionId)||!visit(refKey(ref))) return false
    }
    visiting.delete(key);visited.add(key);return true
  }
  // Validate the changed tree and everything depending on it. An unrelated legacy
  // orphan must not prevent editing healthy parts of an existing work.
  const affected=new Set([...nestedIds].map(id=>refKey({ownerId,relId:id})))
  for(let changed=true;changed;) {
    changed=false
    for(const e of all) {
      const key=refKey({ownerId:e.owner.id,relId:e.rel.id})
      if(!affected.has(key)&&[e.rel.fromJunction,e.rel.toJunction].some(r=>r&&affected.has(refKey(r)))) {affected.add(key);changed=true}
    }
  }
  if(![...affected].every(visit)) return fail('宿主连线不能形成递归依赖')
  return {ok:true,nodes:draft,rel,ownerId}
}
