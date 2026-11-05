const intersects=(a,b)=>a.x<=b.x+b.w&&a.x+a.w>=b.x&&a.y<=b.y+b.h&&a.y+a.h>=b.y
const bounds=g=>{
  const pts=g.samples||[g.a,g.b],xs=pts.map(p=>p.x),ys=pts.map(p=>p.y)
  const x=Math.min(...xs)-20,y=Math.min(...ys)-20
  return {x,y,w:Math.max(...xs)-x+20,h:Math.max(...ys)-y+20}
}
export class CanvasRouteCache {
  constructor(){this.entries=new Map();this.hits=0;this.misses=0}
  clear(){this.entries.clear();this.hits=0;this.misses=0}
  get(key,signature,obstacles,build) {
    const old=this.entries.get(key),obs=new Map(obstacles.map((r,i)=>[r.id||String(i),r]))
    let changed=!old||old.signature!==signature
    if(!changed) {
      const ids=new Set([...obs.keys(),...old.obstacles.keys()])
      for(const id of ids) {
        const a=old.obstacles.get(id),b=obs.get(id)
        if(a&&b&&a.x===b.x&&a.y===b.y&&a.w===b.w&&a.h===b.h&&a.shape===b.shape) continue
        if(old.g.status==='blocked'||(a&&intersects(a,old.bounds))||(b&&intersects(b,old.bounds))) {changed=true;break}
      }
    }
    if(!changed) {this.hits++;return old.g}
    this.misses++
    const g=build(old?.g)
    if(g) this.entries.set(key,{signature,obstacles:obs,g,bounds:bounds(g)})
    return g
  }
  prune(keys){for(const key of this.entries.keys()) if(!keys.has(key)) this.entries.delete(key)}
}
