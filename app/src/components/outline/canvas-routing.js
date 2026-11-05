/* Shared visible geometry for the outline canvas. No DOM/Vue dependencies. */
const EPS = 1e-5
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})
const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v))
const normal = s => ({right:{x:1,y:0},left:{x:-1,y:0},bottom:{x:0,y:1},top:{x:0,y:-1}}[s] || {x:1,y:0})
const code = d => d.x ? (d.x>0?0:1) : (d.y>0?2:3)

export function shapePorts(r, shape='process') {
  const polygon=shape==='para'||shape==='diamond',inset=polygon?.016:0
  return {
    top:{x:r.x+r.w/2,y:r.y+r.h*inset}, bottom:{x:r.x+r.w/2,y:r.y+r.h*(1-inset)},
    left:{x:r.x+r.w*(shape==='para'?.068:inset),y:r.y+r.h/2},
    right:{x:r.x+r.w*(1-(shape==='para'?.068:inset)),y:r.y+r.h/2}
  }
}

export function segmentPoint(s,t) {
  if(s.type==='L') return mix(s.a,s.b,t)
  const u=1-t
  if(s.type==='Q') return {x:u*u*s.a.x+2*u*t*s.c.x+t*t*s.b.x,y:u*u*s.a.y+2*u*t*s.c.y+t*t*s.b.y}
  return {x:u*u*u*s.a.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2.x+t*t*t*s.b.x,y:u*u*u*s.a.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.b.y}
}
function split(s,t) {
  const p=mix(s.a,s.type==='Q'?s.c:s.type==='C'?s.c1:s.b,t)
  if(s.type==='L') return [{...s,b:p},{...s,a:p}]
  if(s.type==='Q') {
    const q=mix(s.c,s.b,t),m=mix(p,q,t)
    return [{type:'Q',a:s.a,c:p,b:m},{type:'Q',a:m,c:q,b:s.b}]
  }
  const q=mix(s.c1,s.c2,t),r=mix(s.c2,s.b,t),u=mix(p,q,t),v=mix(q,r,t),m=mix(u,v,t)
  return [{type:'C',a:s.a,c1:p,c2:u,b:m},{type:'C',a:m,c1:v,c2:r,b:s.b}]
}
export function segmentsD(ss) {
  if(!ss.length) return ''
  let d=`M ${ss[0].a.x} ${ss[0].a.y}`
  for(const s of ss) {
    if(s.type==='L') d+=` L ${s.b.x} ${s.b.y}`
    if(s.type==='Q') d+=` Q ${s.c.x} ${s.c.y} ${s.b.x} ${s.b.y}`
    if(s.type==='C') d+=` C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.b.x} ${s.b.y}`
  }
  return d
}
function flatSegment(s,tolerance=.12) {
  const out=[{...s.a,u:0}]
  const recurse=(part,t0,t1,depth)=>{
    const controls=part.type==='Q'?[part.c]:part.type==='C'?[part.c1,part.c2]:[]
    const chord=dist(part.a,part.b)
    // Control polygon excess also detects collinear loops; a chord-only test misses them.
    const poly=[part.a,...controls,part.b].reduce((v,p,i,a)=>v+(i?dist(a[i-1],p):0),0)
    const error=Math.max(0,...controls.map(p=>pointLine(p,part.a,part.b).dist))
    if(depth>=16 || (error<=tolerance&&poly-chord<=tolerance)) out.push({...part.b,u:t1})
    else { const [l,r]=split(part,.5),m=(t0+t1)/2;recurse(l,t0,m,depth+1);recurse(r,m,t1,depth+1) }
  }
  recurse(s,0,1,0)
  return out
}
function pointLine(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy
  const u=l?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l):0,q=mix(a,b,u)
  return {point:q,u,dist:dist(p,q)}
}
function ensureGeometry(g) {
  if(g.segments) return g
  if(g.c1) return finish([{type:'C',a:g.a,b:g.b,c1:g.c1,c2:g.c2,t0:0,t1:1}],{...g})
  return finish(roundedSegments(g.pts||[g.a,g.b],10,false),{...g})
}
export function flattenRoute(g) {
  if(!g) return []
  return ensureGeometry(g).samples
}
function finish(segments,extra={}) {
  let length=0
  const samples=[]
  for(let i=0;i<segments.length;i++) {
    const s=segments[i],ps=flatSegment(s)
    s.samples=ps;s.length=0
    for(let j=0;j<ps.length;j++) {
      if(j) { const l=dist(ps[j-1],ps[j]);length+=l;s.length+=l }
      if(i&&j===0) continue
      samples.push({...ps[j],t:s.t0+(s.t1-s.t0)*ps[j].u,segment:i,length})
    }
  }
  const a=segments[0]?.a||extra.a,b=segments.at(-1)?.b||extra.b
  const first=segments[0],last=segments.at(-1)
  const sd=first?.c1||first?.c||first?.b||b,ed=last?.c2||last?.c||last?.a||a
  const g={...extra,segments,samples,a,b,length,d:segmentsD(segments),startDir:{x:sd.x-a.x,y:sd.y-a.y},endDir:{x:b.x-ed.x,y:b.y-ed.y}}
  g.mid=routePoint(g,.5)
  return g
}
export function routePoint(g,t) {
  if(!g) return null
  g=ensureGeometry(g);t=clamp(g.parameterReversed?1-t:t)
  const s=g.segments.find(s=>t<=s.t1+EPS)||g.segments.at(-1)
  return s?segmentPoint(s,clamp((t-s.t0)/(s.t1-s.t0||1))):g.a
}
export function projectOnRoute(p,g) {
  if(!g) return {point:p,t:.5,dist:Infinity}
  g=ensureGeometry(g)
  let best={dist:Infinity,t:0,point:g.a}
  for(const s of g.segments) {
    for(let i=1;i<s.samples.length;i++) {
      const a=s.samples[i-1],b=s.samples[i],q=pointLine(p,a,b)
      if(q.dist>best.dist+.3) continue
      // Minimize on the actual curve in the adaptive interval, not on its chord.
      let lo=a.u,hi=b.u
      for(let k=0;k<22;k++) {
        const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3
        if(dist(p,segmentPoint(s,u))<dist(p,segmentPoint(s,v))) hi=v;else lo=u
      }
      for(const u of [a.u,b.u,(lo+hi)/2]) {
        const point=segmentPoint(s,u),d=dist(p,point)
        if(d<best.dist) best={point,dist:d,t:s.t0+(s.t1-s.t0)*u}
      }
    }
  }
  if(g.parameterReversed) best.t=1-best.t
  return best
}
export function trimRoute(g,end=0,start=0) {
  g=ensureGeometry(g)
  const total=g.length,scale=Math.min(1,total/Math.max(EPS,(end+start)*1.01))
  const min=start*scale,max=total-end*scale
  let acc=0
  const out=[]
  for(const s of g.segments) {
    if(acc+s.length>min&&acc<max) {
      const at=arc=>{
        let n=0
        for(let i=1;i<s.samples.length;i++) {
          const l=dist(s.samples[i-1],s.samples[i])
          if(n+l>=arc) return s.samples[i-1].u+(s.samples[i].u-s.samples[i-1].u)*clamp((arc-n)/(l||1))
          n+=l
        }
        return 1
      }
      const lo=at(Math.max(0,min-acc)),hi=at(Math.min(s.length,max-acc))
      let part=hi<1?split(s,hi)[0]:s
      if(lo>0) part=split(part,lo/(hi||1))[1]
      out.push(part)
    }
    acc+=s.length
  }
  return segmentsD(out)
}
function roundedSegments(pts,r,smooth) {
  const lengths=[0]
  for(let i=1;i<pts.length;i++) lengths.push(lengths[i-1]+dist(pts[i-1],pts[i]))
  const total=lengths.at(-1)||1,ss=[]
  let a=pts[0],t0=0
  const line=(b,t1)=>{if(dist(a,b)>EPS) ss.push({type:'L',a,b,t0,t1});a=b;t0=t1}
  for(let i=1;i<pts.length-1;i++) {
    const p=pts[i],prev=pts[i-1],next=pts[i+1],l1=dist(prev,p),l2=dist(p,next)
    const rr=Math.min(r,l1/2,l2/2)
    const entry=mix(p,prev,rr/(l1||1)),exit=mix(p,next,rr/(l2||1))
    line(entry,(lengths[i]-rr)/total)
    const t1=(lengths[i]+rr)/total
    ss.push(smooth?{type:'C',a:entry,c1:mix(entry,p,2/3),c2:mix(exit,p,2/3),b:exit,t0,t1}:{type:'Q',a:entry,c:p,b:exit,t0,t1})
    a=exit;t0=t1
  }
  line(pts.at(-1),1)
  return ss
}
function clean(pts) {
  const out=[]
  for(const p of pts) {
    if(out.length&&dist(out.at(-1),p)<EPS) continue
    while(out.length>=2) {
      const a=out.at(-2),b=out.at(-1)
      if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>EPS) break
      // Never collapse a reversal into an apparently valid segment.
      if((b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0) break
      out.pop()
    }
    out.push({...p})
  }
  return out
}
function inside(p,o) {
  if(!(p.x>o.x+EPS&&p.x<o.x+o.w-EPS&&p.y>o.y+EPS&&p.y<o.y+o.h-EPS)) return false
  if(o.shape==='para') {
    const t=((p.y-o.y)/o.h-.016)/.968
    return t>0&&t<1&&p.x>o.x+o.w*(.12-.104*t)+EPS&&p.x<o.x+o.w*(.984-.104*t)-EPS
  }
  if(o.shape==='diamond') return Math.abs((p.x-o.x-o.w/2)/(o.w*.484))+Math.abs((p.y-o.y-o.h/2)/(o.h*.484))<1-EPS
  return true
}
// Liang–Barsky, valid for diagonal adaptive chords as well as orthogonal segments.
export function lineHitsObstacle(a,b,o) {
  let lo=0,hi=1
  const dx=b.x-a.x,dy=b.y-a.y
  for(const [p,q] of [[-dx,a.x-o.x-EPS],[dx,o.x+o.w-a.x-EPS],[-dy,a.y-o.y-EPS],[dy,o.y+o.h-a.y-EPS]]) {
    if(Math.abs(p)<EPS) {if(q<0) return false}
    else { const t=q/p;if(p<0) lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi) return false }
  }
  if(o.shape==='para'||o.shape==='diamond') {
    // Clip the segment against the actual convex polygon (not just sample its box).
    const vs=o.shape==='diamond'?[[.5,.016],[.984,.5],[.5,.984],[.016,.5]]:[[.12,.016],[.984,.016],[.88,.984],[.016,.984]]
    lo=0;hi=1
    for(let i=0;i<vs.length;i++) {
      const u={x:o.x+vs[i][0]*o.w,y:o.y+vs[i][1]*o.h},v={x:o.x+vs[(i+1)%vs.length][0]*o.w,y:o.y+vs[(i+1)%vs.length][1]*o.h}
      const ex=v.x-u.x,ey=v.y-u.y,num=ex*(a.y-u.y)-ey*(a.x-u.x),den=ex*dy-ey*dx
      if(Math.abs(den)<EPS) {if(num<=EPS) return false}
      else if(den>0) lo=Math.max(lo,(EPS-num)/den);else hi=Math.min(hi,(EPS-num)/den)
      if(lo>=hi) return false
    }
  }
  return lo<=hi
}
const clearPath=(pts,obs)=>pts.slice(1).every((b,i)=>obs.every(o=>!lineHitsObstacle(pts[i],b,o)))
export const routeIsClear=(g,obs)=>clearPath(flattenRoute(g),obs)
function validDirections(pts,ds,de) {
  if(pts.length<2) return false
  if(pts.slice(1).some((p,i)=>Math.abs(p.x-pts[i].x)>EPS&&Math.abs(p.y-pts[i].y)>EPS)) return false
  const a=pts[0],b=pts[1],c=pts.at(-2),d=pts.at(-1)
  if((b.x-a.x)*ds.x+(b.y-a.y)*ds.y<=EPS || (d.x-c.x)*de.x+(d.y-c.y)*de.y>=-EPS) return false
  for(let i=1;i<pts.length-1;i++) {
    const u={x:pts[i].x-pts[i-1].x,y:pts[i].y-pts[i-1].y},v={x:pts[i+1].x-pts[i].x,y:pts[i+1].y-pts[i].y}
    if(u.x*v.x+u.y*v.y<-EPS) return false
  }
  return true
}
const routeCost=(pts,context)=>{
  let cost=(pts.length-2)*32
  for(let i=1;i<pts.length;i++) {
    cost+=dist(pts[i-1],pts[i])
    for(const s of context.occupiedSegments||[]) cost+=channelCost(pts[i-1],pts[i],s.a,s.b)
  }
  return cost
}
export function channelCost(a,b,c,d) {
  if(Math.abs(a.y-b.y)<EPS&&Math.abs(c.y-d.y)<EPS&&Math.abs(a.y-c.y)<6) return Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)))*1.2
  if(Math.abs(a.x-b.x)<EPS&&Math.abs(c.x-d.x)<EPS&&Math.abs(a.x-c.x)<6) return Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)))*1.2
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)
  return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0?24:0
}
function curveChannelCost(g,occupied) {
  if(!occupied.length) return 0
  const points=g.samples
  let cost=0
  for(let i=1;i<points.length;i++) for(const s of occupied) {
    const a=points[i-1],b=points[i],c=s.a,d=s.b
    // Adaptive chords need not be perfectly axis-aligned. Count the actual
    // visible curve running within the host's corridor, rather than its chord.
    if(Math.abs(c.y-d.y)<EPS&&Math.abs(a.y-c.y)<6&&Math.abs(b.y-c.y)<6) cost+=Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)))*1.2
    else if(Math.abs(c.x-d.x)<EPS&&Math.abs(a.x-c.x)<6&&Math.abs(b.x-c.x)<6) cost+=Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)))*1.2
    else cost+=channelCost(a,b,c,d)
  }
  return cost
}
function nearestFree(p,obs,margin) {
  if(!obs.some(o=>inside(p,o))) return {...p}
  const xs=[p.x],ys=[p.y]
  for(const o of obs) {xs.push(o.x-margin,o.x+o.w+margin);ys.push(o.y-margin,o.y+o.h+margin)}
  let best=null
  for(const x of xs) for(const y of ys) {
    const q={x,y};if(obs.some(o=>inside(q,o))) continue
    const d=dist(p,q);if(!best||d<best.d) best={...q,d}
  }
  return best&&{x:best.x,y:best.y}
}
function resolvePreferences(wanted,obs,margin) {
  const points=wanted.map(p=>({...p}))
  // A segment is one preference: keep its aligned endpoints together when an
  // obstacle forces one endpoint into the nearest available channel.
  for(let pass=0;pass<points.length*2;pass++) {
    let changed=false
    for(let i=0;i<points.length;i++) {
      const p=points[i],q=nearestFree(p,obs,margin)
      if(!q) continue
      for(const axis of ['x','y']) if(Math.abs(p[axis]-q[axis])>EPS) {
        const old=p[axis]
        let lo=i,hi=i
        while(lo>0&&Math.abs(points[lo-1][axis]-old)<EPS) lo--
        while(hi+1<points.length&&Math.abs(points[hi+1][axis]-old)<EPS) hi++
        for(let j=lo;j<=hi;j++) points[j][axis]=q[axis]
        changed=true
      }
    }
    if(!changed) break
  }
  return points
}
export function planOrthogonal(a,fromSide,b,toSide,obstacles,stub,margin,context,search) {
  const ds=normal(fromSide),de=normal(toSide),obs=obstacles||[]
  if(obs.some(o=>inside(a,o)||inside(b,o))) return {pts:[a,b],status:'blocked',resolvedWaypoints:[]}
  const wanted=context.waypoints||[],resolvedWaypoints=resolvePreferences(wanted,obs,margin)
  /* 桩段出线检验与 A* 同口径：按包围盒 +2px 皮肤（skinOf），桩端所在的卡豁免（自身端口必然贴着自身包围盒）。
     此前只按多边形/矩形本体检验：平行四边形/菱形的斜边判定会让 18px 桩端落进邻卡包围盒皮肤里，
     A* 起点四向全堵 → 容器迷你网格（12px 间距）所有侧向连线一律 blocked（v1.1.8 容器内外无法连线） */
  const onStubOwner=(pt,o)=>pt.x>=o.x-EPS&&pt.x<=o.x+o.w+EPS&&pt.y>=o.y-EPS&&pt.y<=o.y+o.h+EPS
  const skinOf=o=>({x:o.x-2,y:o.y-2,w:o.w+4,h:o.h+4})
  const stubAt=(p,d,preferred)=>{
    let n=Math.min(Math.max(stub,2),Math.max(2,dist(a,b)/3))
    if(preferred) {
      const along=(preferred.x-p.x)*d.x+(preferred.y-p.y)*d.y
      const across=(preferred.x-p.x)*d.y-(preferred.y-p.y)*d.x
      if(along>EPS&&Math.abs(across)<EPS) n=Math.min(n,along)
    }
    while(n>.3&&!obs.every(o=>onStubOwner(p,o)||!lineHitsObstacle(p,{x:p.x+d.x*n,y:p.y+d.y*n},skinOf(o)))) n/=2
    return n
  }
  const s=stubAt(a,ds,resolvedWaypoints[0]),e=stubAt(b,de,resolvedWaypoints.at(-1))
  const p={x:a.x+ds.x*s,y:a.y+ds.y*s},q={x:b.x+de.x*e,y:b.y+de.y*e}
  if(!clearPath([a,p],obs)||!clearPath([q,b],obs)) return {pts:[a,b],status:'blocked',resolvedWaypoints}
  const candidates=[]
  if(!wanted.length) {
    const mx=(p.x+q.x)/2,my=(p.y+q.y)/2
    for(const middle of [[],[{x:q.x,y:p.y}],[{x:p.x,y:q.y}],[{x:mx,y:p.y},{x:mx,y:q.y}],[{x:p.x,y:my},{x:q.x,y:my}]]) {
      const pts=clean([a,p,...middle,q,b])
      if(pts.slice(1).some((u,i)=>Math.abs(u.x-pts[i].x)>EPS&&Math.abs(u.y-pts[i].y)>EPS)) continue
      if(validDirections(pts,ds,de)&&clearPath(pts,obs)) candidates.push(pts)
    }
  }
  if(candidates.length&&!context.previous&&!(context.occupiedSegments||[]).length) {
    candidates.sort((x,y)=>routeCost(x,context)-routeCost(y,context))
    return {pts:candidates[0],status:'ok',resolvedWaypoints}
  }
  let mid=[p],last=p,d0=code(ds),failed=false
  for(const [i,dest] of [...resolvedWaypoints,q].entries()) {
    const goal=i===resolvedWaypoints.length?code({x:-de.x,y:-de.y}):null
    if(dist(last,dest)<EPS) continue
    const part=search(last,dest,obs,margin,d0,goal,32,context)
    if(!part) {failed=true;break}
    mid.push(...part.slice(1));last=dest
    if(mid.length>1) {const v=mid.at(-2);d0=code({x:last.x-v.x,y:last.y-v.y})}
  }
  const searched=clean([a,...mid,b])
  if(!failed&&validDirections(searched,ds,de)&&clearPath(searched,obs)) candidates.push(searched)
  // Adapt the two endpoint spans, preserving the previous obstacle bypass corridors.
  const prev=context.previous?.pts
  if(!wanted.length&&prev?.length>2) {
    const ps=prev.map(v=>({...v}));ps[0]=a;ps[ps.length-1]=b
    if(ds.x) ps[1].y=a.y;else ps[1].x=a.x
    if(de.x) ps[ps.length-2].y=b.y;else ps[ps.length-2].x=b.x
    if(validDirections(ps,ds,de)&&clearPath(ps,obs)) candidates.push(ps)
  }
  candidates.sort((x,y)=>routeCost(x,context)-routeCost(y,context))
  let pts=candidates[0]
  if(prev&&pts) {
    const stable=candidates.find(c=>c.length===prev.length&&c.slice(1,-1).every((v,i)=>dist(v,prev[i+1])<2))
    if(stable&&routeCost(stable,context)<=routeCost(pts,context)*1.15+24) pts=stable
  }
  return {pts:pts||[a,b],status:pts?'ok':'blocked',resolvedWaypoints}
}
export function createRoute(a,fromSide,b,toSide,obstacles,style,stub,margin,context,search) {
  const ds=normal(fromSide),de=normal(toSide),obs=obstacles||[]
  const waypoints=context.waypoints|| (context.custom?[context.custom]:[])
  if(style!=='ortho'&&!waypoints.length) {
    const h=Math.min(160,Math.max(1,dist(a,b)*.45))
    const c1={x:a.x+ds.x*h,y:a.y+ds.y*h},c2={x:b.x+de.x*h,y:b.y+de.y*h}
    const g=finish([{type:'C',a,c1,c2,b,t0:0,t1:1}],{c1,c2,avoided:false,status:'ok'})
    const occupied=context.occupiedSegments||[]
    const congestion=curveChannelCost(g,occupied)
    if(routeIsClear(g,obs)&&congestion<48) return g
  }
  const result=planOrthogonal(a,fromSide,b,toSide,obs,stub,margin,{...context,waypoints},search)
  if(result.status==='blocked') return finish([{type:'L',a,b,t0:0,t1:1}],{...result,avoided:true})
  let g
  for(const radius of style==='ortho'?[10,5,0]:[36,18,10,4,.5]) {
    g=finish(roundedSegments(result.pts,radius,style!=='ortho'),{...result,avoided:style!=='ortho'||!!waypoints.length})
    if(routeIsClear(g,obs)) break
  }
  g.mid=labelPoint(g,obs)
  return g
}
export function labelPoint(g,obstacles=[],width=76,height=26) {
  let best=null
  for(const s of g.segments) {
    if(s.length<width+12) continue
    for(const t of [.5,.25,.75]) {
    const p=segmentPoint(s,t),box={x:p.x-width/2,y:p.y-height-6,w:width,h:height}
    if(obstacles.some(o=>box.x<o.x+o.w&&box.x+box.w>o.x&&box.y<o.y+o.h&&box.y+box.h>o.y)) continue
    const score=s.length-Math.abs((s.t0+s.t1)/2-.5)*100-Math.abs(t-.5)*50
    if(!best||score>best.score) best={p,score}
    }
  }
  return best?.p||routePoint(g,.5)
}
