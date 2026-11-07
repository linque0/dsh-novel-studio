(() => {
  const D=StudioDemo,M=StudioModel,C=StudioCharts,B=StudioChapterCharts,Motion=StudioMotion,{fmt,signed,md,iso,esc,plot,heat,exact}=C
  const $=(q,root=document)=>root.querySelector(q)
  const params=new URLSearchParams(location.search), root=$('#studio'), quick=$('#quick'), drawer=$('#inspector'), analysis=$('#analysis'), host=$('#host')
  if(params.has('static'))document.body.dataset.static=''
  const tabs={overview:'总览',manuscript:'正文',outline:'大纲',lore:'设定',people:'人物',ideas:'灵感'}
  const labels={done:'已完成',revise:'待修改',draft:'草稿',planned:'待写',writing:'进行中'}
  const icons={chart:'<path d="M4 19h16M7 15v-4m5 4V6m5 9V9"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',back:'<path d="M19 12H5m6-6-6 6 6 6"/>',book:'<path d="M4 5h7a2 2 0 0 1 2 2v12a3 3 0 0 0-2-1H4zm16 0h-5a2 2 0 0 0-2 2v12a3 3 0 0 1 2-1h5z"/>'}
  const icon=k=>'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[k]+'</svg>'
  const btn=(act,value,inner,attr='')=>'<button type="button" data-act="'+act+'" data-value="'+esc(value)+'" '+attr+'>'+inner+'</button>'
  const work=id=>D.works.find(w=>w.id===id), name=id=>work(id)?.title||'全部作品', chapter=id=>D.chapters.find(c=>c.id===id)
  const scope=rows=>M.scoped(rows,s.work), dayRows=()=>M.timeline(s.work,D.end,s.period,s.range), allDays=()=>M.timeline(s.work,D.end,s.period)
  const workSelect=(act,val,allowAll=true)=>'<select aria-label="'+(act.startsWith('pair')?'对照作品 '+act.slice(-1):'作品范围')+'" data-act="'+act+'">'+(allowAll?'<option value="all"'+(val==='all'?' selected':'')+'>全部作品</option>':'')+D.works.map(w=>'<option value="'+w.id+'"'+(w.id===val?' selected':'')+'>'+w.title+'</option>').join('')+'</select>'
  const attr=selected=>'aria-pressed="'+selected+'"'
  const heading=(eyebrow,title,hint='',end='')=>'<div class="section-head"><div><div class="micro">'+eyebrow+'</div><h2>'+title+'</h2>'+(hint?'<p>'+hint+'</p>':'')+'</div>'+end+'</div>'
  const pill=(status)=>'<span class="status '+status+'"><i></i>'+labels[status]+'</span>'
  const metric=(label,value,unit='',extra='')=>'<div class="metric"><span>'+label+'</span><b class="'+extra+'">'+value+'</b>'+(unit?'<small>'+unit+'</small>':'')+'</div>'
  const empty=(title,note)=>'<div class="empty"><b>'+title+'</b><p>'+note+'</p></div>'
  const words=n=>fmt(n)+' 字'
  const dates=ds=>iso(ds[0].date)+' — '+iso(ds.at(-1).date)
  const closeBtn=(act='dismiss')=>btn(act,'',icon('close'),'class="icon close" aria-label="关闭明细"')
  let hostView=params.get('from')==='library'?'library':'editor', hostWork='fog'
  const hostDrafts=new Map()
  let s=M.entry(hostView==='library'?'all':hostWork), opened=false, returnFocus, compareReturn, chapterReturn, brush, muteClick=0, snippetTag='all'
  let entryButton, quickDate=null, fullY=0, fullKey=null
  const chartScroll=new Map(), matrixPositions=new Map()
  let showChapterDate=false
  const chartKey=(view=s.chart)=>s.work+'|'+view

  function header(){
    return '<header class="topbar analysis-bar"><span class="brand"><strong>小说工坊</strong><span>LATENT</span></span>'+
      '<nav aria-label="分析视图" class="tabs">'+Object.entries(tabs).map(([id,label])=>btn('tab',id,label,attr(id===s.tab))).join('')+'</nav>'+
      '<div class="tools">'+btn('collapse','','<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14"/></svg>','class="icon" aria-label="收起为速览" title="收起为速览"')+btn('close-analysis','',icon('close'),'class="icon" aria-label="关闭写作分析" title="关闭写作分析"')+'</div></header>'
  }
  function mast(){
    const title=s.tab==='overview'?(s.mode==='compare'?'作品对照':'创作历程'):s.tab==='manuscript'?'稿件案卷':tabs[s.tab]+'分析'
    const description=s.tab==='overview'?(s.mode==='compare'?'在同一时间范围内，比较不同作品的写作记录。':'沿着时间回看正文保存、版本与灵感。'):s.tab==='manuscript'?'读章节结构，或沿日期查看每一章的改稿记录。':'按作品查看当前存量和明细。'
    return '<div class="mast'+(s.tab==='overview'?' overview-mast':'')+'"><div><div class="micro edition">写作分析 <span aria-hidden="true">/</span> '+esc(name(s.work))+'<span class="demo">演示数据</span></div><h1 id="page-title" tabindex="-1">'+title+'</h1>'+(s.tab==='overview'?'':'<p>'+description+'</p>')+'</div><div class="scope">'+
      (chapterReturn&&s.tab==='manuscript'?btn('back-chapter','',icon('back')+(chapterReturn.s.detail?.kind==='record'?'返回记录':'返回日期明细'),'class="soft"'):s.back?btn('back','',icon('back')+'返回对照','class="soft"'):'')+
      '<label class="scope-work"><span>作品</span>'+workSelect('work',s.work)+'</label>'+(['overview','manuscript','ideas'].includes(s.tab)?'<div class="period" role="group" aria-label="日期范围">'+[7,30,90].map(p=>btn('period',p,p+' 日',attr(p===s.period))).join('')+'</div>':'')+'</div></div>'+
      (s.tab==='overview'?'<div class="mode-rail"><div class="period" role="group" aria-label="总览视图">'+btn('mode','journey','创作历程',attr(s.mode==='journey'))+btn('mode','compare','作品对照',attr(s.mode==='compare'))+'</div><span>'+description+'</span></div>':'')
  }
  function ledger(items){
    if(!items.length)return empty('暂无相关记录','此范围没有可用的保存、版本或灵感记录。')
    return '<div class="ledger">'+items.map(r=>btn('record',r.id,'<time>'+md(r.date)+'</time><span class="record-kind">'+r.kind+'</span><strong>'+esc(r.title)+'</strong><span class="record-amount '+(r.delta<0?'loss':'')+'">'+(r.kind==='保存'?signed(r.delta)+' 字':r.kind==='版本'?words(r.words):r.tags.join(' / '))+'</span>', 'class="ledger-row"')).join('')+'</div>'
  }
  function journey(){
    const ds=dayRows(), entries=M.records(s.work,ds[0].date,ds.at(-1).date), notable=entries.filter(r=>r.kind!=='保存'), all=allDays()
    const controls='<form class="range-form" aria-label="自选日期区间"><label>起始<input aria-label="起始日期" type="date" name="from" required min="'+all[0].date+'" max="'+D.end+'" value="'+ds[0].date+'"></label><label>结束<input aria-label="结束日期" type="date" name="to" required min="'+all[0].date+'" max="'+D.end+'" value="'+ds.at(-1).date+'"></label><button class="soft" type="submit">应用</button>'+(s.range?btn('clear-range','','清除区间','class="soft"'):'')+'<span class="range-error" role="status"></span></form>'
    return '<div class="journey-grid"><div class="main-stack"><section class="panel canvas">'+heading('01 / WRITING TRACE','写作轨迹','每日保存字数差 · '+dates(ds),'<span class="badge current">'+(s.range?'自选区间':'近 '+s.period+' 日')+'</span>')+
      '<div class="metric-band">'+metric('区间累计净增',ds.some(d=>d.logs.length)?signed(ds.at(-1).cumulative):'—','字',ds.at(-1).cumulative<0?'loss':'accent')+metric('活跃日期',ds.filter(d=>d.active).length,'天')+metric('当前正文存量',fmt(M.inventory(s.work).words),'字')+'</div>'+
      plot(ds,{selected:s.detail?.date||s.date,work:s.work,range:true})+
      '<div class="plot-foot"><div class="legend"><span><i class="up"></i>净增</span><span><i class="down"></i>净减</span><span><i class="zero"></i>净零</span></div><span>拖选区间，或选择起止日期</span></div>'+
      '<section class="calendar-strip" aria-label="活跃日历"><div class="calendar-title"><h3>活跃日历</h3><span>选中 '+md(s.detail?.date||s.date)+'</span><div class="legend"><span><i class="zero"></i>有写入、净零</span><span><i class="missing"></i>无记录</span></div></div>'+heat(ds,s.detail?.date||s.date,s.work)+'</section>'+controls+exact(ds)+'</section>'+
      '<section class="panel">'+heading('02 / DOCUMENTED MOMENTS','版本与灵感','仅展示此区间内有日期的记录')+ledger(notable)+'</section></div>'+inlineDetail()+'</div>'
  }
  function volumeMenu(){
    const list=M.volumes(s.work)
    return '<aside class="panel volume-rail" aria-label="分卷导航"><div class="micro">MANUSCRIPT INDEX</div><h2>分卷目录</h2>'+btn('volume','all','<span>全部章节</span><small>'+M.inventory(s.work).chapters.length+' 章</small>',attr(s.volume==='all'))+
      list.map((v,i)=>btn('volume',v.id,'<small>'+String(i+1).padStart(2,'0')+(s.work==='all'?' · '+name(v.work):'')+'</small><span>'+v.title+'</span><div class="rail-progress"><i style="width:'+(v.count?v.done/v.count*100:0)+'%"></i></div><small>已完成 '+v.done+' / '+v.count+'</small>',attr(s.volume===v.id))).join('')+'</aside>'
  }
  function manuscript(){
    const vs=M.volumes(s.work), score=M.chapterStructure(s.work,s.volume,s.status), {base}=score, filtered=score.groups.flatMap(g=>g.rows), revision=s.chart==='revision'
    const counts=Object.fromEntries(['done','revise','draft'].map(t=>[t,base.filter(c=>c.status===t).length]))
    const selected=s.chapterPick
    const volName=vs.find(v=>v.id===s.volume)?.title||'全部章节', metricScope=s.volume==='all'?'当前':s.volume==='unassigned'?'未分卷':'本卷'
    const chart=revision?B.matrix(M.chapterCalendar(s.work,s.volume,s.status,s.period,s.range),selected,s.chapterDay,s.work==='all',name):B.structure(score,selected,s.work==='all',name,s.volume)
    const viewSwitch='<div class="chapter-switch period" role="group" aria-label="章节分析图表">'+btn('chapter-chart','structure','章节结构',attr(!revision))+btn('chapter-chart','revision','改稿轨迹',attr(revision))+'</div>'
    return '<div class="manuscript-grid">'+volumeMenu()+'<div class="main-stack"><section class="panel manuscript-panel">'+heading('01 / MANUSCRIPT',revision?'章节改稿轨迹':'章节字数分布',volName+' · '+(revision?'保存字数差与留存版本':'字数与完成度按分卷统计'),'<div class="chapter-head-tools">'+viewSwitch+'<span class="badge">'+(s.status==='all'?'共 ':'筛出 ')+filtered.length+' 章</span></div>')+
      '<div class="metric-band">'+metric(metricScope+'正文',fmt(M.total(base,c=>c.words)),'字','accent')+metric(metricScope+'已完成',counts.done+' / '+base.length,'章')+'</div>'+
      '<label class="mobile-volume"><span>分卷</span><select aria-label="分卷" data-act="volume"><option value="all">全部分卷</option>'+vs.map(v=>'<option value="'+v.id+'"'+(s.volume===v.id?' selected':'')+'>'+v.title+'</option>').join('')+'</select></label>'+
      '<div class="status-band" aria-hidden="true">'+['done','revise','draft'].map(t=>'<i class="'+t+'" style="flex:'+counts[t]+'"></i>').join('')+'</div>'+
      '<div class="status-filter" role="group" aria-label="章节状态">'+[['all','全部',base.length],...Object.entries(counts).map(([k,v])=>[k,labels[k],v])].map(([k,t,n])=>btn('status',k,'<i class="'+k+'"></i>'+t+' <span>'+n+'</span>',attr(s.status===k))).join('')+'</div>'+
      (chart||empty('没有符合条件的章节','可切换分卷、状态或作品范围。'))+
      '</section><section class="panel">'+heading('02 / VOLUME PROGRESS','分卷完成度','已完成章节 / 正式章节')+(vs.length?vs.map(v=>btn('volume',v.id,'<span>'+v.title+'</span><span class="meter"><i style="width:'+(v.count?v.done/v.count*100:0)+'%"></i></span><b>'+v.done+' / '+v.count+'</b>','class="bar-row"')).join(''):empty('尚未分卷','此作品没有正式章节。'))+'</section></div>'+inlineDetail()+'</div>'
  }
  function atlas(){
    const port=M.portfolio(s.pair,D.end,s.period,s.range), vs=M.volumes('all')
    const library='<section class="panel library">'+heading('02 / LIBRARY','作品索引','当前存量 · 点击作品深入','<span class="badge">'+D.works.length+' 部</span>')+'<div class="atlas-books">'+D.works.map((w,i)=>{
      const inv=M.inventory(w.id)
      return btn('drill',w.id,'<div class="book-top"><span class="cover" style="--cover:'+w.color+'">'+w.mark+'</span><div><small>0'+(i+1)+' / '+w.genre+'</small><strong>'+w.title+'</strong></div>'+icon('arrow')+'</div><div class="book-total"><b>'+fmt(inv.words)+'</b> 字 <span>'+inv.chapters.length+' 章</span></div><div class="book-completion" aria-label="已完成 '+inv.done+' 章、待修改 '+inv.revise+' 章">'+[inv.done,inv.revise,inv.chapters.length-inv.done-inv.revise].map((n,j)=>'<i class="'+['done','revise','draft'][j]+'" style="flex:'+n+'"></i>').join('')+'</div><small>已完成 '+inv.done+' / '+inv.chapters.length+'</small>','class="book-tile" data-origin="tile"')
    }).join('')+'</div></section>'
    const comparison='<section class="panel compare-panel">'+heading('01 / SIDE BY SIDE','两部作品的写作走势','每日正文净增 · 两图共用日期与刻度','<div class="comparison-range"><span class="badge">'+dates(port.rows[0].days)+'</span>'+(s.range?btn('clear-range','','清除区间','class="soft"'):'')+'</div>')+
      '<div class="compare-plots">'+port.rows.map(({work:id,days},i)=>'<article><div class="compare-plot-head"><label><span>对照 '+(i+1)+'</span>'+workSelect('pair'+(i+1),id,false)+'</label>'+btn('drill',id,'深入 '+icon('arrow'),'class="soft"')+'</div><div class="compare-net"><b class="'+(days.at(-1).cumulative<0?'loss':'accent')+'">'+(days.some(d=>d.logs.length)?signed(days.at(-1).cumulative):'—')+'</b><small>字 · 区间净增 · '+days.filter(d=>d.active).length+' 活跃日</small></div>'+plot(days,{mode:'mini',work:id,scale:port,selected:s.detail?.work===id?s.detail.date:''})+exact(days)+'</article>').join('')+'</div></section>'
    return '<div class="atlas-layout'+(s.detail?' has-inspector':'')+'"><div class="main-stack">'+comparison+library+
      '<section class="panel">'+heading('03 / VOLUME SCALE','分卷规模','按当前正式章节字数比较')+rank(vs.map(v=>[v.id,name(v.work)+' · '+v.title,v.words]),'volume-tab','字')+'</section></div>'+inlineDetail()+'</div>'
  }
  function network(people,edges){
    const groups=[...new Set(people.map(p=>p.work))], selected=s.detail?.kind==='entity'?s.detail.id:null
    return '<div class="network">'+groups.map(id=>{
      const list=people.filter(p=>p.work===id), points=[[22,25],[71,25],[22,76],[71,76]], links=edges.filter(e=>e.work===id)
      const nodes=new Map(list.map((p,i)=>[p.id,points[i]]))
      const lines=links.map(e=>{const [x1,y1]=nodes.get(e.from),[x2,y2]=nodes.get(e.to)
        const state=!selected?'rest':e.from===selected||e.to===selected?'active':'muted'
        return '<line data-edge-motion="'+esc(e.from+'|'+e.to)+'" data-edge-state="'+state+'" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"/>'}).join('')
      return '<section><span class="micro">'+name(id)+'</span><div class="network-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+lines+'</svg>'+
        list.map(p=>{const [x,y]=nodes.get(p.id);return btn('entity',p.id,'<b>'+p.title+'</b><small>'+p.role+'</small>','class="network-node" style="left:'+x+'%;top:'+y+'%" '+attr(s.detail?.id===p.id))}).join('')+'</div></section>'
    }).join('')+'</div>'
  }
  function rank(rows,act,unit){
    const max=Math.max(1,...rows.map(r=>r[2]))
    if(!rows.length)return empty('暂无数据','当前作品还没有这一类记录。')
    return '<div class="rank">'+rows.map(([id,label,n])=>btn(act,id,'<span>'+esc(label)+'</span><span class="meter"><i style="width:'+n/max*100+'%"></i></span><b>'+fmt(n)+' '+unit+'</b>','class="bar-row" data-row-motion="'+esc(act+'|'+id)+'"')).join('')+'</div>'
  }
  function moduleContent(){
    const ds=dayRows(); let content=''
    if(s.tab==='outline'){
      const rows=scope(D.outline), events=rows.flatMap(r=>r.events)
      content=heading('STORY STRUCTURE','大纲事件','按故事容器查看各状态的事件数')+'<div class="metric-band">'+metric('事件总数',events.length,'件','accent')+metric('已完成',events.filter(e=>e.status==='done').length,'件')+'</div>'+
      '<div class="legend">'+['done','writing','revise','planned'].map(t=>'<span><i class="'+t+'"></i>'+labels[t]+'</span>').join('')+'</div>'+
      (rows.length?rows.map(g=>btn('entity',g.id,'<span>'+g.title+'</span><span class="status-band">'+['done','writing','revise','planned'].map(t=>'<i class="'+t+'" style="flex:'+g.events.filter(e=>e.status===t).length+'"></i>').join('')+'</span><b>'+g.events.filter(e=>e.status==='done').length+' / '+g.events.length+'</b>','class="bar-row"')).join(''):empty('暂无大纲事件','此作品还没有故事容器。'))
    }else if(s.tab==='lore'){
      const rows=scope(D.lore)
      content=heading('WORLD INDEX','设定分支','点击根分支，查看其节点目录')+'<div class="metric-band">'+metric('根分支',rows.length,'个','accent')+metric('设定节点',M.total(rows,r=>r.nodes.length+1),'个')+'</div>'+rank(rows.map(r=>[r.id,r.title,r.nodes.length+1]),'entity','节点')
    }else if(s.tab==='people'){
      const rows=scope(D.people), edges=scope(D.relations), roles=[...new Set(rows.map(p=>p.role))]
      content=heading('CAST & CONNECTIONS','人物与关系','仅列出已建立的关系')+'<div class="metric-band">'+metric('人物',rows.length,'位','accent')+metric('关系',edges.length,'条')+metric('未建立关系',rows.filter(p=>!edges.some(e=>e.from===p.id||e.to===p.id)).length,'位')+'</div>'+
      (rows.length?'<div class="role-grid">'+roles.map(r=>'<div><div class="micro">'+r+' · '+rows.filter(p=>p.role===r).length+'</div>'+rows.filter(p=>p.role===r).map(p=>btn('entity',p.id,p.title,'class="person-chip"')).join('')+'</div>').join('')+'</div><h3>人物关系图</h3>'+network(rows,edges)+'<details class="exact"><summary>查看关系名称与两端人物</summary><div class="edges">'+edges.map(e=>'<div>'+btn('entity',e.from,D.people.find(p=>p.id===e.from).title)+'<span>'+e.label+'</span>'+btn('entity',e.to,D.people.find(p=>p.id===e.to).title)+'</div>').join('')+'</div></details>':empty('暂无人物','此作品还没有人物或关系。'))
    }else{
      const rows=scope(D.snippets), tags=[...new Set(rows.flatMap(r=>r.tags))], recent=rows.filter(r=>r.date>=ds[0].date&&r.date<=ds.at(-1).date&&(snippetTag==='all'||r.tags.includes(snippetTag))).sort((a,b)=>b.date.localeCompare(a.date))
      content=heading('IDEA ARCHIVE','灵感档案','标签分布为当前存量，最近新增随所选日期变化')+'<div class="metric-band">'+metric('当前灵感',rows.length,'条','accent')+metric('已标记',rows.filter(r=>r.tags.length).length+' / '+rows.length,'条')+'</div>'+rank(tags.map(t=>[t,t,rows.filter(r=>r.tags.includes(t)).length]),'tag','条')+
      '<div class="split-title"><h3>最近新增</h3>'+(snippetTag==='all'?'':btn('tag','all',esc(snippetTag)+' ×','class="soft" aria-label="清除标签筛选"'))+'</div>'+ledger(recent.map(r=>({...r,kind:'灵感'})))
    }
    return '<div class="module-grid"><section class="panel">'+content+'</section>'+inlineDetail()+'</div>'
  }
  function contextDetail(){
    if(s.detail)return s.detail
    if(s.tab==='overview'&&s.mode==='journey')return {kind:'date',date:s.date,work:s.work}
    return null
  }
  function inlineDetail(){
    const d=contextDetail()
    if(!d&&s.tab==='overview'&&s.mode==='compare')return ''
    return '<aside class="panel inspector-inline" aria-label="明细"'+(d?' data-detail-motion="'+esc([d.kind,d.id,d.work,d.date].join('|'))+'"':'')+'>'+detailContent(d,false)+'</aside>'
  }
  function detailTop(label,title,sub='',mobile=false){
    return '<div class="detail-head"><div class="micro"><i></i>'+label+'</div>'+(mobile||s.detail?closeBtn():'')+'<h2'+(mobile?' id="inspector-title"':'')+'>'+title+'</h2>'+(sub?'<p>'+sub+'</p>':'')+'</div>'
  }
  function snapshot(v){
    return '<details class="snapshot"><summary><span><b>'+esc(v.title)+'</b><small>'+iso(v.date)+' · '+words(v.words)+'</small></span></summary><blockquote>'+esc(v.text)+'</blockquote></details>'
  }
  function dateDetail(d,mobile){
    const rows=M.records(d.work,d.date,d.date), logs=rows.filter(r=>r.kind==='保存'), net=M.total(logs,r=>r.delta), snapshots=rows.filter(r=>r.kind==='版本'), ideas=rows.filter(r=>r.kind==='灵感')
    const message=!logs.length?'暂无写作记录':!net&&logs.some(r=>r.delta!==0)?'有写入 · 当日净增为零':'当日正文净增'
    return detailTop('DAY INSPECTOR',iso(d.date),name(d.work),mobile)+'<div class="detail-body"><div class="detail-stat"><span>'+message+'</span><b class="'+(net<0?'loss':'accent')+'">'+(logs.length?signed(net):'—')+(logs.length?'<small class="unit"> 字</small>':'')+'</b><small>'+logs.length+' 条保存记录</small></div>'+
      '<h3>涉及章节 <small>点击查看章节案卷</small></h3>'+(logs.length?logs.map(r=>btn('chapter-link',r.chapter,'<span>'+esc(r.title)+'</span><b class="'+(r.delta<0?'loss':'accent')+'">'+signed(r.delta)+'</b>','class="detail-row" data-origin="'+d.date+'" data-work="'+esc(r.id)+'"')).join(''):'<p class="muted">这一天没有章节保存字数日志。</p>')+
      '<h3>可用版本 <small>'+snapshots.length+'</small></h3>'+(snapshots.length?snapshots.map(snapshot).join(''):'<p class="muted">当日没有保留的版本。</p>')+
      (ideas.length?'<h3>新增灵感</h3>'+ideas.map(r=>btn('record',r.id,r.title,'class="detail-row"')).join(''):'')+'</div>'
  }
  function chapterDetail(d,mobile){
    const c=chapter(d.id)
    if(!c)return detailTop('CHAPTER FILE','章节档案','没有可用章节',mobile)
    const ds=M.chapterCalendar(c.work,c.volume||'unassigned','all',s.period,s.range).rows.find(r=>r.chapter.id===c.id).days
    const selected=ds.find(row=>row.date===d.date), logs=selected?.logs||ds.flatMap(day=>day.logs).reverse(), snaps=selected?.versions||ds.flatMap(day=>day.versions).reverse()
    const top=detailTop('CHAPTER FILE',c.title,name(c.work)+' / '+(D.volumes.find(v=>v.id===c.volume)?.title||'未分卷'),mobile)
    return top+'<div class="detail-body chapter-inspector"><div class="detail-stat"><span>当前正文字数</span><b>'+fmt(c.words)+'<small class="unit"> 字</small></b>'+pill(c.status)+'</div>'+
      (selected?'<div class="chapter-day-stat" data-chapter-day-detail="'+selected.date+'"><time>'+iso(selected.date)+'</time><b class="'+(selected.net<0?'loss':'accent')+'">'+B.netText(selected)+'</b><small>'+logs.length+' 条保存 · '+snaps.length+' 个版本</small></div>':'')+
      (s.chart==='revision'?'<div class="chapter-trend"><h3>区间每日净增</h3>'+plot(ds,{mode:'mini',work:c.work,selected:d.date||'',chapterId:c.id})+'</div>':'')+
      '<h3>'+(selected?'当日':'区间')+'保留版本 <small>'+snaps.length+'</small></h3>'+(snaps.length?snaps.map(snapshot).join(''):'<p class="muted">没有留存版本。</p>')+
      '<h3>'+(selected?'当日':'区间')+'保存记录 <small>'+logs.length+'</small></h3>'+(logs.length?'<div class="save-list">'+logs.map((r,i)=>'<div class="detail-row"><span>'+iso(r.date)+(selected?' · 第 '+(i+1)+' 条':'')+'</span><b class="'+(r.delta<0?'loss':'accent')+'">'+signed(r.delta)+' 字</b></div>').join('')+'</div>':'<p class="muted">无保存记录</p>')+'</div>'
  }
  function detailContent(d,mobile){
    if(!d)return detailTop('DETAIL INSPECTOR','查看明细','从图表或清单中选择一项。',mobile)
    if(d.kind==='date')return dateDetail(d,mobile)
    if(d.kind==='chapter')return chapterDetail(d,mobile)
    if(d.kind==='record'){
      const r=M.records('all','2000-01-01',D.end).find(x=>x.id===d.id)
      if(!r)return ''
      return detailTop('RECORD DETAIL',esc(r.title),name(r.work)+' · '+iso(r.date)+' · '+r.kind,mobile)+'<div class="detail-body">'+(r.text?'<blockquote>'+esc(r.text)+'</blockquote>':'')+(r.chapter?btn('chapter-link',r.chapter,'查看章节 '+icon('arrow'),'class="soft" data-origin="'+r.date+'"'):'')+(r.tags?'<p class="muted">'+r.tags.join(' · ')+'</p>':'')+'</div>'
    }
    const g=D.outline.find(x=>x.id===d.id), l=D.lore.find(x=>x.id===d.id), p=D.people.find(x=>x.id===d.id)
    if(g)return detailTop('STORY CONTAINER',g.title,name(g.work),mobile)+'<div class="detail-body">'+g.events.map(e=>'<div class="detail-row"><span>'+e.title+'</span>'+pill(e.status)+'</div>').join('')+'</div>'
    if(l)return detailTop('WORLD BRANCH',l.title,name(l.work)+' · '+(l.nodes.length+1)+' 节点，含根节点',mobile)+'<div class="detail-body"><ul class="tree">'+l.nodes.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'
    if(p)return detailTop('CAST FILE',p.title,name(p.work)+' · '+p.role,mobile)+'<div class="detail-body"><blockquote>'+p.text+'</blockquote><h3>已有关系</h3>'+D.relations.filter(r=>r.from===p.id||r.to===p.id).map(r=>{
      const other=D.people.find(x=>x.id===(r.from===p.id?r.to:r.from))
      return btn('entity',other.id,'<span>'+other.title+'</span><small>'+r.label+'</small>','class="detail-row"')
    }).join('')+'</div>'
    return ''
  }
  const phone=()=>matchMedia('(max-width: 680px)').matches
  const narrow=()=>matchMedia('(max-width: 1050px)').matches
  const brand='<span class="brand"><strong>小说工坊</strong><span>LATENT</span></span>'
  function mountHost(){
    const paras=['汽笛在涨潮前响了一次。叶回把灯举到窗前，等雾里那个人回答。海面空空荡荡，只有北岸的钟声隔着潮水传来。','纪白从栈桥尽头回来时，靴面上沾着一层盐。他把一封折过三次的信递给她，信纸没有落款，只在边缘画了一个极细的圆。','她认得这笔迹。五年前，航图还没有从档案室消失时，有人也曾在北岸以同样的方式标记过低潮航线。','风从窗缝挤进来。桌上的灯火向右偏了一下，栈桥那头，一艘不该出现在此时的船轻轻碰响了木桩。']
    host.innerHTML='<header class="topbar host-bar">'+brand+'<nav class="tabs" aria-label="演示入口">'+btn('host-view','library','书架')+btn('host-view','editor','正文')+'</nav><div class="tools">'+btn('quick','',''+icon('chart'),'id="stats-entry" class="icon quick-open" aria-label="写作数据" aria-haspopup="dialog" aria-controls="quick" aria-expanded="false" title="写作数据"')+'</div></header>'+
      '<main class="host-main"><section id="host-library" aria-labelledby="library-title"><div class="host-mast"><div class="micro">LIBRARY <span class="demo">演示数据</span></div><h1 id="library-title">我的书架</h1><p>从顶栏打开写作数据，查看整个书库。</p></div><div class="shelf-grid">'+D.works.map(w=>btn('host-work',w.id,'<div class="shelf-cover" style="--cover:'+w.color+'"><span>'+w.mark+'</span><small>'+w.genre+'</small></div><div class="shelf-meta"><strong>'+w.title+'</strong><span>'+words(M.inventory(w.id).words)+'　'+icon('arrow')+'</span></div>','class="shelf-book"')).join('')+'</div></section>'+
      '<section id="host-editor" aria-labelledby="editor-title"><div class="host-mast"><div class="micro"><span id="host-work-name"></span> / 正文 <span class="demo">演示数据</span></div><h1 id="editor-title">潮汐的背面</h1><p>从顶栏打开写作数据，默认查看当前作品。</p></div><div class="host-writing panel"><div class="editor-strip"><span>'+icon('book')+' 正文试读</span><small>此处输入仅用于体验 · 不保存</small></div><textarea id="mock-editor" spellcheck="false" aria-label="演示正文编辑器">'+esc([...paras,...paras,...paras].join('\n\n'))+'</textarea></div></section><footer><span>小说工坊 · LATENT</span><a href="../写作分析-三版探索-20261107/index.html">查看原三版探索 '+icon('arrow')+'</a></footer></main>'
    entryButton=$('#stats-entry')
    entryButton.addEventListener('mousedown',e=>e.preventDefault())
    updateHost()
  }
  function updateHost(){
    $('#host-library').hidden=hostView!=='library';$('#host-editor').hidden=hostView!=='editor'
    $('#host-work-name').textContent=name(hostWork)
    $('#editor-title').textContent=(D.chapters.find(c=>c.work===hostWork&&c.id==='f2-3')||D.chapters.find(c=>c.work===hostWork))?.title||'未命名章节'
    host.querySelectorAll('[data-act="host-view"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===hostView)))
  }
  function anchorQuick(){
    if(!quick.open||phone())return
    const r=entryButton.getBoundingClientRect(), bar=$('.host-bar').getBoundingClientRect(), edge=12
    quick.style.setProperty('--quick-right',Math.max(edge,document.documentElement.clientWidth-r.right)+'px')
    quick.style.setProperty('--quick-top',Math.max(edge,bar.bottom+8)+'px')
  }
  function renderQuick(){
    const motion=Motion.prepare(quick,'quick')
    const ds=M.timeline(s.work,D.end,7), inv=M.inventory(s.work), today=ds.at(-1), current=ds.find(d=>d.date===quickDate)
    const hint=current?'<span>'+iso(current.date)+'</span><b class="'+(current.net<0?'loss':'accent')+'">'+C.dayText(current)+'</b><small>'+current.logs.length+' 条保存</small>':'<span>点选日期查看净增与保存条数</span>'
    quick.innerHTML='<div class="quick-head"><div class="micro"><i></i>写作数据 <span class="demo">演示数据</span></div>'+btn('close-quick','',icon('close'),'class="icon close" aria-label="关闭速览"')+'<h2 id="quick-title" tabindex="-1">写作速览</h2><label class="quick-scope"><span>统计范围</span>'+workSelect('quick-work',s.work)+'</label></div>'+
      '<div class="quick-content"><div class="metric-band">'+metric('当前正文字数',fmt(inv.words),'字','accent')+metric('正式章节数',inv.chapters.length,'章')+metric('今日净增',today.logs.length?signed(today.net):'—',today.logs.length?'字':'',today.net<0?'loss':'')+'</div>'+
      '<div class="quick-chart-head"><h3>近 7 日正文净增</h3><div class="legend"><span><i class="up"></i>净增</span><span><i class="down"></i>净减</span></div></div>'+plot(ds,{mode:'quick',work:s.work,selected:quickDate||''})+
      '<div class="quick-day" role="status">'+hint+'</div>'+(current?btn('day-link',current.date,'查看当日明细 '+icon('arrow'),'class="quick-link"'):'')+'</div>'+
      '<div class="quick-actions">'+(s.work==='all'?btn('compare-link','','对照作品','class="soft"'):btn('revise-link','','待修改 '+inv.revise+' 章','class="soft"'))+btn('full','','查看完整分析 '+icon('arrow'),'class="primary"')+'</div>'
    Motion.finish(quick,motion)
  }
  function openQuick(fresh){
    if(fresh){
      s=M.entry(hostView==='library'?'all':hostWork)
      quickDate=null;fullY=0;fullKey=null;opened=false;compareReturn=null;chapterReturn=null;snippetTag='all'
    }
    renderQuick()
    if(phone())quick.showModal()
    else quick.show()
    entryButton.setAttribute('aria-expanded','true')
    anchorQuick()
    $('#quick-title',quick).focus({preventScroll:true})
  }
  function closeQuick(restore=true){
    if(quick.open)quick.close()
    entryButton.setAttribute('aria-expanded','false')
    if(restore)entryButton.focus({preventScroll:true})
  }
  function focusKey(el){return el?.dataset.act?[el.dataset.act,el.dataset.value??el.value,el.dataset.work??'',el.dataset.origin??'']:null}
  function focusOn(key,within=root){
    if(!key)return false
    const target=[...within.querySelectorAll('[data-act]')].find(el=>{const k=focusKey(el);return k&&k.every((v,i)=>v===key[i])&&el.getClientRects().length})
    target?.focus({preventScroll:true})
    return !!target
  }
  function revealMatrixCell(cell){
    const pane=cell?.closest('.matrix-window')
    if(!pane)return
    const frame=pane.getBoundingClientRect(), box=cell.getBoundingClientRect(), sticky=pane.querySelector('th').offsetWidth
    if(box.left<frame.left+sticky+2)pane.scrollLeft+=box.left-frame.left-sticky-3
    if(box.right>frame.right-3)pane.scrollLeft+=box.right-frame.right+4
    if(box.top<frame.top+34)pane.scrollTop+=box.top-frame.top-34
    if(box.bottom>frame.bottom-15)pane.scrollTop+=box.bottom-frame.bottom+15
  }
  function render(preserveFocus=true){
    const motion=Motion.prepare(root,s.tab==='overview'?s.tab+'|'+s.mode:s.tab==='manuscript'?s.tab+'|'+s.chart:s.tab)
    const key=preserveFocus?focusKey(document.activeElement):null
    const y=root.scrollTop, previousOpen=drawer.open
    const oldMatrix=$('.matrix-window',root)
    if(oldMatrix?.dataset.matrixKey)matrixPositions.set(oldMatrix.dataset.matrixKey,[oldMatrix.scrollLeft,oldMatrix.scrollTop])
    root.innerHTML=header()+'<main class="analysis-main">'+mast()+(s.tab==='overview'?(s.mode==='journey'?journey():atlas()):s.tab==='manuscript'?manuscript():moduleContent())+
      '<footer><span>小说工坊 · LATENT</span><span>交互设计稿 / 所有数据为演示</span></footer></main>'
    root.scrollTop=y
    const matrix=$('.matrix-window',root)
    if(matrix){
      matrix.dataset.matrixKey=s.work+'|'+matrix.dataset.matrixWindow
      const position=matrixPositions.get(matrix.dataset.matrixKey)
      matrix.scrollLeft=position?.[0]??matrix.scrollWidth
      matrix.scrollTop=position?.[1]??0
      if(showChapterDate)revealMatrixCell($('.revision-cell[aria-pressed=true]',matrix))
    }
    showChapterDate=false
    if(opened&&narrow()&&contextDetail()&&analysis.open){
      const drawerMotion=Motion.prepare(drawer,'inspector')
      drawer.innerHTML=detailContent(contextDetail(),true)
      if(!drawer.open)drawer.showModal()
      Motion.finish(drawer,drawerMotion)
      if(!previousOpen||!focusOn(key,drawer))$('.close',drawer)?.focus({preventScroll:true})
    }else{
      if(drawer.open)drawer.close()
      focusOn(key)
    }
    Motion.finish(root,motion)
  }
  function expand(type,value){
    if(type){
      s=M.transition(s,{type,date:value})
      opened=type==='day-link';fullY=0;fullKey=null;returnFocus=null;chapterReturn=null
    }
    const restoreKey=fullKey
    closeQuick(false)
    analysis.showModal()
    render(false);root.scrollTop=fullY
    if(!drawer.open&&!focusOn(restoreKey))$('#page-title',root).focus({preventScroll:true})
  }
  function closeAnalysis(collapse=false){
    fullY=root.scrollTop
    if(!collapse)fullKey=null
    if(drawer.open)drawer.close()
    analysis.close()
    if(collapse)openQuick(false)
    else entryButton.focus({preventScroll:true})
  }
  function detail(kind,args,el){
    if(!drawer.open&&!el.closest('.inspector-inline'))returnFocus=focusKey(el)
    s={...s,date:kind==='date'&&s.mode==='journey'?args.date:s.date,detail:{kind,...args}}
    opened=true;render()
  }
  function chapterDetailAt(id,date,el){
    s={...s,chapterPick:id,chapterDay:date}
    detail('chapter',{id,date},el)
  }
  function chapterFilter(key,value){
    if(s[key]===value)return
    s={...s,[key]:value}
    if(!M.chapters(s.work,s.volume,s.status).some(c=>c.id===s.chapterPick)){
      s={...s,chapterPick:null,chapterDay:null,detail:null};opened=false
    }
    render()
  }
  function dismiss(){
    opened=false;s={...s,detail:null};if(drawer.open)drawer.close()
    render(false)
    if(!focusOn(returnFocus))$('#page-title',root)?.focus({preventScroll:true})
  }
  function apply(type,args){
    opened=false;s=M.transition(s,{type,...args});render()
  }
  function range(from,to){apply('range',{range:[from,to]})}
  document.addEventListener('submit',e=>{
    if(!e.target.matches('.range-form'))return
    e.preventDefault()
    const {from,to}=e.target.elements
    if(from.value>to.value){$('.range-error',e.target).textContent='起始日期不能晚于结束日期。';return}
    range(from.value,to.value);$('.range-form button')?.focus({preventScroll:true})
  })
  document.addEventListener('change',e=>{
    const {act}=e.target.dataset, value=e.target.value
    if(act==='quick-work'){
      s={...M.entry(value),pair:s.pair};quickDate=null;fullY=0;fullKey=null;opened=false;chapterReturn=null;snippetTag='all'
      renderQuick();$('[data-act="quick-work"]',quick)?.focus({preventScroll:true})
    }
    if(act==='work'){snippetTag='all';chapterReturn=null;apply('work',{work:value})}
    if(act==='volume')chapterFilter('volume',value)
    if(act?.startsWith('pair')){
      const i=Number(act.at(-1))-1,pair=s.pair.slice(),other=1-i
      if(pair[other]===value)pair[other]=pair[i]
      pair[i]=value;s={...s,pair,detail:null};opened=false;render()
    }
  })
  document.addEventListener('pointerdown',e=>{
    if(quick.open&&!phone()&&!quick.contains(e.target)&&!entryButton.contains(e.target))closeQuick(false)
  })
  document.addEventListener('click',e=>{
    if(e.target===quick&&phone()){closeQuick();return}
    if(e.target===drawer){dismiss();return}
    const el=e.target.closest('button[data-act]')
    if(!el)return
    const {act,value,work:id}=el.dataset
    switch(act){
      case 'host-view': hostView=value;updateHost();break
      case 'host-work': {
        const editor=$('#mock-editor')
        if(value!==hostWork){
          hostDrafts.set(hostWork,editor.value)
          hostWork=value;editor.value=hostDrafts.get(value)??D.versions.find(v=>v.work===value)?.text??''
        }
        hostView='editor';updateHost();editor.focus({preventScroll:true});break
      }
      case 'quick': if(quick.open)closeQuick();else openQuick(true);break
      case 'close-quick': closeQuick();break
      case 'full': expand();break
      case 'day-link':case 'compare-link':case 'revise-link': expand(act,value);break
      case 'collapse': closeAnalysis(true);break
      case 'close-analysis': closeAnalysis();break
      case 'tab': snippetTag='all';apply('tab',{tab:value});root.scrollTop=0;break
      case 'mode': chapterReturn=null;apply('mode',{mode:value});root.scrollTop=0;break
      case 'period': showChapterDate=s.tab==='manuscript'&&!!s.chapterDay;apply('period',{period:Number(value)});break
      case 'drill':
        compareReturn={key:focusKey(el),y:root.scrollTop}
        apply('drill',{work:value});root.scrollTop=0;$('#page-title',root).focus({preventScroll:true});break
      case 'back':
        opened=!!s.back?.detail; s=M.transition(s,{type:'back'}); render(false);root.scrollTop=compareReturn?.y||0
        if(!drawer.open&&!focusOn(compareReturn?.key))$('#page-title',root).focus({preventScroll:true})
        break
      case 'clear-range': apply('range',{range:null});($('.range-form button')||$('.scope [aria-pressed=true]'))?.focus({preventScroll:true});break
      case 'volume': chapterFilter('volume',value);break
      case 'volume-tab':
        s={...M.transition(s,{type:'tab',tab:'manuscript'}),volume:value,status:'all',chart:'structure',chapterPick:null,chapterDay:null};opened=false;render(false);root.scrollTop=0;$('#page-title',root).focus({preventScroll:true});break
      case 'status': chapterFilter('status',value);break
      case 'chapter-chart':
        if(value===s.chart)break
        chartScroll.set(chartKey(),root.scrollTop)
        s={...s,chart:value};render();root.scrollTop=chartScroll.get(chartKey())??0
        break
      case 'tag': snippetTag=value;render();break
      case 'date':
        if(e.detail>0&&el.closest('.plot-hits')&&performance.now()<muteClick)return
        if(quick.contains(el)){
          quickDate=value;const y=quick.scrollTop;renderQuick();quick.scrollTop=y
          focusOn(['date',value,id??'',''],quick)
        }else if(el.dataset.chapter){
          showChapterDate=true;chapterDetailAt(el.dataset.chapter,value,el)
        }else detail('date',{date:value,work:id||s.work},el)
        break
      case 'chapter-link':
        chapterReturn={s,opened,returnFocus,key:focusKey(el),y:root.scrollTop}
        if(drawer.open)drawer.close()
        returnFocus=el.dataset.origin?['chapter-day',value,'',el.dataset.origin]:['chapter',value,'','']
        s=M.transition(s,{type:'chapter-link',id:value,date:el.dataset.origin});opened=true;showChapterDate=true;render(false);root.scrollTop=0
        if(!drawer.open)focusOn(returnFocus)
        break
      case 'back-chapter': {
        const from=chapterReturn
        if(!from)break
        chapterReturn=null;({s,opened,returnFocus}=from);render(false);root.scrollTop=from.y
        focusOn(from.key,drawer.open?drawer:root);break
      }
      case 'chapter-day': chapterDetailAt(value,el.dataset.origin,el);break
      case 'chapter': chapterDetailAt(value,s.chapterPick===value?s.chapterDay:null,el);break
      case 'record':case 'entity':detail(act,{id:value},el);break
      case 'dismiss': dismiss();break
    }
  })
  root.addEventListener('focusin',e=>{
    const key=focusKey(e.target)
    if(key&&!['collapse','close-analysis'].includes(key[0]))fullKey=key
  })
  quick.addEventListener('cancel',e=>{e.preventDefault();closeQuick()})
  drawer.addEventListener('cancel',e=>{e.preventDefault();dismiss()})
  analysis.addEventListener('cancel',e=>{e.preventDefault();if(s.detail)dismiss();else closeAnalysis()})
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&(quick.open||analysis.open)){
      e.preventDefault()
      if(quick.open)closeQuick()
      else if(drawer.open||s.detail)dismiss()
      else closeAnalysis()
      return
    }
    const cell=e.target.closest('.revision-cell')
    if(cell&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){
      e.preventDefault()
      const grid=cell.closest('.revision-grid'), r=Number(cell.dataset.row), c=Number(cell.dataset.col)
      const row=Math.max(0,Math.min(grid.tBodies[0].rows.length-1,r+(e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0)))
      const last=grid.tHead.rows[0].cells.length-2, col=e.key==='Home'?0:e.key==='End'?last:Math.max(0,Math.min(last,c+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)))
      const next=grid.tBodies[0].rows[row].cells[col+1].firstElementChild
      cell.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});revealMatrixCell(next)
      return
    }
    const el=e.target.closest('.plot-hits button')
    if(!el||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
    e.preventDefault()
    const list=[...el.parentNode.children],i=list.indexOf(el),j=e.key==='Home'?0:e.key==='End'?list.length-1:Math.max(0,Math.min(list.length-1,i+(e.key==='ArrowLeft'?-1:1)))
    list.forEach((b,k)=>b.tabIndex=k===j?0:-1);list[j].focus()
  })
  const brushIndex=(el,x)=>{const box=el.getBoundingClientRect(),n=el.querySelectorAll('button').length;return Math.max(0,Math.min(n-1,Math.floor((x-box.left)/box.width*n)))}
  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest('[data-plot="brush"]')
    if(!el||e.button!==0)return
    brush={el,id:e.pointerId,x:e.clientX,i:brushIndex(el,e.clientX),moving:false}
  })
  document.addEventListener('pointermove',e=>{
    if(!brush||brush.id!==e.pointerId)return
    const {el,i,x}=brush
    if(!brush.moving&&Math.abs(e.clientX-x)<7)return
    if(!brush.moving){el.setPointerCapture(e.pointerId);brush.moving=true}
    const j=brushIndex(el,e.clientX),n=el.querySelectorAll('button').length,mark=$('.brush-mark',el)
    mark.hidden=false;mark.style.left=Math.min(i,j)/n*100+'%';mark.style.width=(Math.abs(i-j)+1)/n*100+'%'
  })
  document.addEventListener('pointerup',e=>{
    if(!brush||brush.id!==e.pointerId)return
    const {el,i,moving}=brush;brush=null
    if(!moving)return
    const j=brushIndex(el,e.clientX),list=el.querySelectorAll('button')
    muteClick=performance.now()+220;range(list[Math.min(i,j)].dataset.value,list[Math.max(i,j)].dataset.value)
  })
  document.addEventListener('pointercancel',()=>{if(brush){$('.brush-mark',brush.el).hidden=true;brush=null}})
  matchMedia('(max-width: 1050px)').addEventListener('change',()=>{if(analysis.open)render()})
  matchMedia('(max-width: 680px)').addEventListener('change',()=>{
    if(analysis.open)render()
    if(quick.open){closeQuick(false);openQuick(false)}
  })
  window.addEventListener('resize',anchorQuick)
  mountHost()
  if(params.get('view')==='manuscript'){
    s={...M.entry(hostWork),tab:'manuscript',chart:params.get('chart')==='revision'?'revision':'structure'}
    expand()
  }
})()



