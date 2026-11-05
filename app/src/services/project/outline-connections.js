// Preserve connection endpoints: a junction belongs to a connection, not its owner node.
export function outlineConnections(rows) {
  const nodes=new Map(rows.map(r=>[r.id,r])), entries=[], issues=[]
  const walk=(owner,rels,path=[])=>{
    for(const [i,rel] of (rels||[]).entries()) {
      const key=rel.id||'legacy-'+[...path,i].join('-')
      entries.push({owner,rel,key,from:rel.fromJunction?{...rel.fromJunction}:{nodeId:owner.id},to:rel.toJunction?{...rel.toJunction}:{nodeId:rel.toId||rel.to}})
      walk(owner,rel._out,[...path,i])
    }
  }
  for(const owner of rows)walk(owner,owner.rels)
  const byKey=new Map(entries.map(e=>[e.owner.id+':'+e.key,e])), valid=new Map(), visiting=new Set()
  const check=e=>{
    const key=e.owner.id+':'+e.key
    if(valid.has(key))return valid.get(key)
    if(visiting.has(key))return false
    visiting.add(key)
    const ok=[e.from,e.to].every(p=>{
      if(p.nodeId)return nodes.has(p.nodeId)
      const host=byKey.get(p.ownerId+':'+p.relId)
      return !!host&&!!host.rel.junctions?.some(j=>j.id===p.junctionId)&&check(host)
    })
    visiting.delete(key);valid.set(key,ok);return ok
  }
  const result=entries.filter(e=>{const ok=check(e);if(!ok)issues.push({type:'orphan-outline-connection',sourceId:e.owner.id,relId:e.key});return ok})
  const endpointTitle=p=>p.nodeId?(nodes.get(p.nodeId)?.title||p.nodeId):`连线「${byKey.get(p.ownerId+':'+p.relId)?.rel.label||byKey.get(p.ownerId+':'+p.relId)?.rel.kind||p.relId}」的连接点`
  return {entries:result.map(e=>({...e,text:`${e.rel.kind||'关联'}：${endpointTitle(e.from)} ${e.rel.arrows||'->'} ${endpointTitle(e.to)}${e.rel.label?'；标签：'+e.rel.label:''}`,
    dependencyIds:[...new Set([e.owner.id,...[e.from,e.to].map(p=>p.nodeId||p.ownerId)])]})),issues}
}
