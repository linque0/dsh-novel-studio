export function createWritingAnalysisModel(D) {
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
    return scoped(D.chapters,work).filter(c=>(!volume||volume==='all'||(c.volume||'unassigned')===volume)&&(!status||status==='all'||c.status===status))
  }
  const inventory=work=>{const rows=chapters(work);return {chapters:rows,words:total(rows,c=>c.words),done:rows.filter(c=>c.status==='done').length,revise:rows.filter(c=>c.status==='revise').length}}
  function volumes(work) {
    const groups=scoped(D.volumes,work)
    if(chapters(work,'unassigned').length)groups.push({id:'unassigned',work,title:'未分卷'})
    return groups.map(v=>{const rows=chapters(work,v.id);return {...v,words:total(rows,c=>c.words),done:rows.filter(c=>c.status==='done').length,count:rows.length}})
  }
  function chapterStructure(work,volume,status){
    const base=chapters(work,volume), selected=chapters(work,volume,status), ordered=base.map(c=>c.words).sort((a,b)=>a-b)
    const i=Math.floor(ordered.length/2)
    const median=ordered.length?(ordered[i]+ordered[Math.floor((ordered.length-1)/2)])/2:null
    const groups=volumes(work).filter(v=>volume==='all'||v.id===volume).map(v=>({...v,rows:selected.filter(c=>(c.volume||'unassigned')===v.id)})).filter(v=>v.rows.length)
    return {base,groups,median,max:Math.max(1000,Math.ceil(Math.max(0,...ordered)/1000)*1000)}
  }
  function chapterCalendar(work,volume,status,period,range,selection){
    const selected=chapters(work,volume,status).filter(c=>!selection||selection.has(c.id)), dates=timeline(work,D.end,period,range).map(d=>d.date), dateSet=new Set(dates)
    const index=new Map(selected.map(c=>[c.id,new Map()]))
    function add(rows,field){
      for(const row of rows){
        const bucket=index.get(row.chapter)
        if(!bucket||!dateSet.has(row.date))continue
        if(!bucket.has(row.date))bucket.set(row.date,{logs:[],versions:[]})
        bucket.get(row.date)[field].push(row)
      }
    }
    add(D.logs,'logs');add(D.versions,'versions')
    return {dates,rows:selected.map(chapter=>{
      let cumulative=0
      const days=dates.map(date=>{
        const {logs,versions}=index.get(chapter.id).get(date)||{logs:[],versions:[]},net=total(logs,r=>r.delta)
        cumulative+=net
        return {date,logs,versions,net,cumulative,active:logs.some(r=>r.delta!==0)}
      })
      return {chapter,days}
    })}
  }
  const records=(work,from,to)=>[
    ...scoped(D.logs,work).map(r=>({...r,kind:'保存',title:D.chapters.find(c=>c.id===r.chapter)?.title||'来源章节不可用'})),
    ...scoped(D.versions,work).map(r=>({...r,kind:'版本'})),
    ...scoped(D.snippets,work).map(r=>({...r,kind:'灵感'}))
  ].filter(r=>r.date>=from&&r.date<=to).sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind,'zh-CN'))
  function portfolio(pair,end,period,range) {
    const rows=pair.map(work=>({work,days:timeline(work,end,period,range)}))
    return {rows,min:Math.min(0,...rows.flatMap(r=>r.days.map(d=>d.net))),max:Math.max(0,...rows.flatMap(r=>r.days.map(d=>d.net)))}
  }
  const modeFor=work=>work==='all'?'compare':'journey'
  const entry=work=>({work,tab:'overview',mode:modeFor(work),chart:'structure',chapterPick:null,chapterDay:null,period:30,range:null,volume:'all',status:'all',pair:['fog','night'],detail:null,back:null,date:D.end})
  function transition(s,action) {
    switch(action.type){
      case 'drill': return {...s,work:action.work,mode:'journey',volume:'all',status:'all',detail:null,tab:'overview',back:s}
      case 'back': return s.back||s
      case 'work': return {...s,work:action.work,mode:modeFor(action.work),range:null,volume:'all',status:'all',chapterPick:null,chapterDay:null,detail:null,back:null,date:D.end}
      case 'mode': return {...s,mode:action.mode,work:action.mode==='compare'?'all':s.work,detail:null,back:null}
      case 'compare-link': return {...s,tab:'overview',mode:'compare',work:'all',detail:null,back:null}
      case 'day-link': {
        const date=action.date, keep=!s.range||date>=s.range[0]&&date<=s.range[1]
        return {...s,tab:'overview',mode:'journey',range:keep?s.range:null,date,detail:{kind:'date',date,work:s.work}}
      }
      case 'revise-link': return {...s,tab:'manuscript',chart:'structure',volume:'all',status:'revise',chapterPick:null,chapterDay:null,detail:null}
      case 'chapter-link': {
        const c=D.chapters.find(c=>c.id===action.id)
        if(!c)return s
        const date=action.date||null, period=date&&date<D.day(D.end,1-s.period)?90:s.period
        const range=!date||!s.range||(date>=s.range[0]&&date<=s.range[1])?s.range:null
        return {...s,tab:'manuscript',chart:date?'revision':'structure',work:c.work,mode:'journey',volume:c.volume||'unassigned',status:'all',period,range,chapterPick:c.id,chapterDay:date,detail:{kind:'chapter',id:c.id,date}}
      }
      case 'period': {
        const chapterDay=s.chapterDay>=D.day(D.end,1-action.period)?s.chapterDay:null
        return {...s,period:action.period,range:null,date:D.end,chapterDay,detail:s.tab==='manuscript'&&s.detail?.kind==='chapter'?{...s.detail,date:chapterDay}:null}
      }
      case 'range': return {...s,range:action.range,date:action.range?.[1]||D.end,detail:null}
      case 'tab': return {...s,tab:action.tab,detail:null}
      default:return s
    }
  }
  return {scoped,total,timeline,chapters,inventory,volumes,chapterStructure,chapterCalendar,records,portfolio,entry,transition}
}
