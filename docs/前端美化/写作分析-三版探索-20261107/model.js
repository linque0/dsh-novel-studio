(() => {
  const D=globalThis.StudioDemo
  const scoped=(rows,work)=>rows.filter(row=>work==='all'||row.work===work)
  const total=(rows,fn)=>rows.reduce((sum,row)=>sum+fn(row),0)
  function timeline(work,end,period,range) {
    const start=D.day(end,1-period), map=new Map()
    for(const log of scoped(D.logs,work)) {
      if(log.date<start||log.date>end)continue
      if(!map.has(log.date))map.set(log.date,[])
      map.get(log.date).push(log)
    }
    let cumulative=0
    return Array.from({length:period},(_,i)=>D.day(start,i)).filter(date=>!range||date>=range[0]&&date<=range[1]).map(date=>{
      const logs=map.get(date)||[], net=total(logs,row=>row.delta)
      cumulative+=net
      return {date,logs,active:logs.some(r=>r.delta!==0),net,cumulative}
    })
  }
  function chapters(work,volume,status) {
    return scoped(D.chapters,work).filter(c=>(!volume||volume==='all'||c.volume===volume)&&(!status||status==='all'||c.status===status))
  }
  const inventory=work=>{const rows=chapters(work);return {chapters:rows,words:total(rows,c=>c.words),done:rows.filter(c=>c.status==='done').length,revise:rows.filter(c=>c.status==='revise').length}}
  const volumes=work=>scoped(D.volumes,work).map(v=>{const rows=chapters(work,v.id);return {...v,words:total(rows,c=>c.words),done:rows.filter(c=>c.status==='done').length,count:rows.length}})
  const records=(work,from,to)=>[
    ...scoped(D.logs,work).map(r=>({...r,kind:'保存',title:D.chapters.find(c=>c.id===r.chapter)?.title||'章节保存'})),
    ...scoped(D.versions,work).map(r=>({...r,kind:'版本'})),
    ...scoped(D.snippets,work).map(r=>({...r,kind:'灵感'}))
  ].filter(r=>r.date>=from&&r.date<=to).sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind,'zh-CN'))
  function portfolio(pair,end,period,range) {
    const rows=pair.map(work=>({work,days:timeline(work,end,period,range)}))
    return {rows,min:Math.min(0,...rows.flatMap(r=>r.days.map(d=>d.net))),max:Math.max(0,...rows.flatMap(r=>r.days.map(d=>d.net)))}
  }
  const initial=variant=>({variant,work:variant==='c'?'all':'fog',tab:'overview',period:30,range:null,volume:'all',status:'all',pair:['fog','night'],detail:null,drilled:false,date:D.end})
  function transition(s,action) {
    switch(action.type){
      case 'drill': return {...s,work:action.work,volume:'all',status:'all',detail:null,tab:'overview',drilled:true}
      case 'back': return {...s,work:'all',tab:'overview',detail:null,drilled:false}
      case 'work': return {...s,work:action.work,volume:'all',status:'all',detail:null,drilled:false}
      case 'period': return {...s,period:action.period,range:null,date:D.end,detail:null}
      case 'range': return {...s,range:action.range,date:action.range?.[1]||D.end,detail:null}
      case 'tab': return {...s,tab:action.tab,detail:null}
      default:return s
    }
  }
  globalThis.StudioModel={scoped,total,timeline,chapters,inventory,volumes,records,portfolio,initial,transition}
})()
