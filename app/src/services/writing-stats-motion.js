export function createStatsMotion({controlsOnly=false}={}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'), surfaces=new WeakMap()
  const easing='cubic-bezier(.21,.72,.21,1)'
  const enabled=()=>!reduced.matches&&!document.body.hasAttribute('data-static')&&typeof Element.prototype.animate==='function'
  const number=(el,key)=>Number(el.getAttribute(key))
  const running=new Set()
  function play(el,frames,duration=260,delay=0){
    const effect=el.animate(frames,{duration,delay,easing,fill:'backwards'})
    running.add(effect)
    effect.finished.catch(()=>{}).finally(()=>running.delete(effect))
  }
  const reduce=()=>{if(reduced.matches)for(const effect of running)effect.cancel()}
  reduced.addEventListener('change',reduce)
  function describe(root,live){
    const out={plots:new Map(),bars:new Map(),rows:new Map(),picked:new Map(),edges:new Map(),marks:new Map(),switches:new Map(),detail:null,groups:new Set()}
    for(const [i,group] of [...root.querySelectorAll(controlsOnly?'.analysis-bar .tabs,.mode-rail .period':'.analysis-bar .tabs,.mode-rail .period,.chapter-switch')].entries()){
      const e=group.querySelector('button[aria-pressed=true]')
      if(e){const r=e.getBoundingClientRect();out.switches.set(group.getAttribute('aria-label')||i,{e,x:r.left,width:r.width,value:e.dataset.value||e.dataset.chart||e.dataset.mode||e.id})}
    }
    if(controlsOnly)return out
    for(const box of root.querySelectorAll('[data-plot-motion]')){
      const cursor=box.querySelector('.plot-cursor')
      const curve=box.querySelector('.plot-curve')
      const bars=new Map([...box.querySelectorAll('[data-date-bar]')].map(e=>[e.dataset.dateBar,{e,x:number(e,'x'),y:number(e,'y'),width:number(e,'width'),h:number(e,'height'),zero:Number(e.dataset.zero),kind:e.getAttribute('class')}]))
      out.plots.set(box.dataset.plotMotion,{bars,curve,path:curve?.getAttribute('d'),cursor,x:cursor?Number(cursor.dataset.cursorX):null,area:box.querySelector('.plot-area')})
    }
    const counts=new Map()
    for(const e of root.querySelectorAll('[data-bar-motion],.meter i,.rail-progress i,.status-band i,.book-completion i')){
      const action=e.closest('[data-act]')
      const key=e.dataset.barMotion||[e.parentElement.className,action?.dataset.act,action?.dataset.value,e.className].join('|')
      const n=(counts.get(key)||0)+1;counts.set(key,n)
      const rect=e.getBoundingClientRect(), parent=e.parentElement.getBoundingClientRect()
      out.bars.set(key+'|'+n,{e,width:rect.width,x:rect.left-parent.left})
    }
    for(const e of root.querySelectorAll('[data-row-motion]'))out.rows.set(e.dataset.rowMotion,{e,y:live?e.getBoundingClientRect().top:0})
    for(const e of root.querySelectorAll('.heat-cell[aria-pressed=true],.revision-cell[aria-pressed=true]')){
      out.picked.set(e.classList.contains('heat-cell')?'calendar':'matrix',{e,key:(e.dataset.chapter||e.dataset.value||'')+'|'+(e.dataset.date||e.dataset.origin||'')})
    }
    for(const e of root.querySelectorAll('[data-edge-motion]'))out.edges.set(e.dataset.edgeMotion,{e,state:e.dataset.edgeState})
    for(const e of root.querySelectorAll('[data-matrix-mark]'))out.marks.set(e.dataset.matrixMark,{e,state:e.dataset.kind+'|'+e.dataset.versions+'|'+e.style.getPropertyValue('--strength')})
    out.detail=root.querySelector('[data-detail-motion]')
    for(const group of root.querySelectorAll('[data-motion-group]'))out.groups.add(group.dataset.motionGroup)
    return out
  }
  function prepare(root,key){
    let surface=surfaces.get(root)
    if(!surface)surfaces.set(root,surface={key:null,states:new Map()})
    if(!enabled()){surface.key=null;surface.states.clear();return null}
    const same=surface.key===key
    if(surface.key!==null&&root.getClientRects().length){
      const old=describe(root,true)
      old.detail=old.detail?.dataset.detailMotion
      surface.states.set(surface.key,old)
    }
    const previous=surface.states.get(surface.key)
    surface.key=key
    return {same,previous,old:surface.states.get(key)}
  }
  function finish(root,frame){
    if(!frame)return
    const {same,old,previous}=frame
    const now=describe(root,true)
    const surface=surfaces.get(root)
    surface.states.set(surface.key,{...now,detail:now.detail?.dataset.detailMotion})
    if(!enabled())return
    for(const [key,p] of now.plots){
      const prior=old?.plots.get(key)
      let stagger=0
      for(const [date,b] of p.bars){
        const a=prior?.bars.get(date)
        if(a&&a.h===b.h&&a.y===b.y&&a.width===b.width&&a.x===b.x&&a.kind===b.kind)continue
        const from=a&&a.kind===b.kind?Math.max(0,Math.min(4,a.h/b.h)):.03
        b.e.style.transformOrigin='0px '+b.zero+'px'
        play(b.e,[{transform:'scaleY('+from+')'},{transform:'scaleY(1)'}],270,prior?0:Math.min(80,stagger++*5))
      }
      if(p.curve&&p.path!==prior?.path){
        const length=p.curve.getTotalLength()
        if(length>0)play(p.curve,[{strokeDasharray:length+'px '+length+'px',strokeDashoffset:length+'px'},{strokeDasharray:length+'px '+length+'px',strokeDashoffset:'0px'}],410)
        if(p.area)play(p.area,[{opacity:.1},{opacity:1}],320)
      }
      if(p.cursor&&p.x!==prior?.x){
        const delta=prior?.x!=null?p.x-prior.x:null
        play(p.cursor,delta===null?[{opacity:.25},{opacity:1}]:[{transform:'translateX('+(-delta)+'px)'},{transform:'translateX(0px)'}],165)
      }
    }
    for(const [key,b] of now.bars){
      const a=old?.bars.get(key)
      if(b.width<1||a&&Math.abs(a.width-b.width)<.5&&Math.abs(a.x-b.x)<.5)continue
      b.e.style.transformOrigin='left center'
      const delta=a?a.x-b.x:0
      play(b.e,[{transform:'translateX('+delta+'px) scaleX('+(a?Math.min(5,a.width/b.width):.035)+')'},{transform:'translateX(0px) scaleX(1)'}],285)
    }
    for(const [key,b] of now.rows){
      const a=old?.rows.get(key)
      if(a&&same&&Math.abs(a.y-b.y)>1&&Math.abs(a.y-b.y)<500){
        play(b.e,[{transform:'translateY('+(a.y-b.y)+'px)'},{transform:'translateY(0px)'}],225)
      }else if(!a)play(b.e,[{opacity:.46},{opacity:1}],185)
    }
    for(const [key,b] of now.picked)if(b.key!==old?.picked.get(key)?.key)play(b.e,[{boxShadow:'inset 0 0 0 3px #c6f4dc90'},{boxShadow:'inset 0 0 0 1px #c6f4dc20'}],190)
    for(const [key,b] of now.edges){
      const before=old?.edges.get(key)?.state
      if(before===b.state)continue
      const opacity=state=>state==='muted'?.24:state==='active'?1:.65
      play(b.e,[{opacity:before?opacity(before):.2},{opacity:opacity(b.state)}],220)
    }
    for(const [key,b] of now.switches){
      const a=previous?.switches.get(key)
      if(a&&a.value!==b.value&&Math.abs(a.x-b.x)<240){
        const group=b.e.parentElement, slide=document.createElement('i')
        slide.className='motion-tab-indicator';slide.setAttribute('aria-hidden','true')
        slide.style.left=b.e.offsetLeft+'px';slide.style.top=b.e.offsetTop+'px';slide.style.width=b.width+'px';slide.style.height=b.e.offsetHeight+'px'
        group.append(slide)
        const effect=slide.animate([{transform:'translateX('+(a.x-b.x)+'px) scaleX('+(a.width/b.width)+')',opacity:.85},{transform:'translateX(0px) scaleX(1)',opacity:.55}],{duration:180,easing})
        running.add(effect);effect.finished.catch(()=>{}).finally(()=>{running.delete(effect);slide.remove()})
      }
    }
    if(now.groups.has('revision-matrix')&&!old?.groups.has('revision-matrix')){
      const target=root.querySelector('.matrix-window')
      if(target)play(target,[{opacity:.58,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0px)'}],230)
    }
    if(old?.groups.has('revision-matrix')){
      let count=0
      const pane=root.querySelector('.matrix-window')?.getBoundingClientRect()
      for(const [key,b] of now.marks){
        if(count>=60||b.state===old.marks.get(key)?.state||!pane)continue
        const box=b.e.getBoundingClientRect()
        if(box.right<pane.left||box.left>pane.right||box.bottom<pane.top||box.top>pane.bottom)continue
        play(b.e,[{opacity:.55},{opacity:1}],220,Math.min(60,count++*4))
      }
    }
    if(now.detail&&now.detail.dataset.detailMotion!==old?.detail)play(now.detail,[{opacity:.58,transform:'translateX(5px)'},{opacity:1,transform:'translateX(0px)'}],190,35)
  }
  return {prepare,finish,dispose(){reduced.removeEventListener('change',reduce);for(const effect of running)effect.cancel();running.clear()}}
}
