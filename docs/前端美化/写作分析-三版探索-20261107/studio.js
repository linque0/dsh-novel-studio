(() => {
  const D=StudioDemo,M=StudioModel,C=StudioCharts,{fmt,signed,md,iso,esc,plot,heat,exact}=C
  const $=(q,root=document)=>root.querySelector(q), variant=document.body.dataset.variant
  const params=new URLSearchParams(location.search), scene=params.get('scene'), root=$('#studio'), quick=$('#quick'), drawer=$('#inspector')
  if(params.has('static'))document.body.dataset.static=''
  const tabs={overview:'总览',manuscript:'正文',outline:'大纲',lore:'设定',people:'人物',ideas:'灵感'}
  const labels={done:'已完成',revise:'待修改',draft:'草稿',planned:'待写',writing:'进行中'}
  const styles={a:{name:'创作长卷',en:'WRITING CHRONICLE',tag:'循着时间，看见写作留下的痕迹。'},b:{name:'稿件案卷',en:'MANUSCRIPT DOSSIER',tag:'从分卷到单章，找到下一处落笔的位置。'},c:{name:'作品图志',en:'WORKS ATLAS',tag:'把并行的故事放在同一张图上。'}}
  const conf=styles[variant]
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
  let s=M.initial(variant), opened=false, returnFocus, compareReturn, brush, muteClick=0, snippetTag='all'
  if(scene==='empty')s=M.transition(s,{type:'work',work:'empty'})
  if(tabs[params.get('tab')])s={...s,tab:params.get('tab')}

  function header(){
    return '<header class="topbar"><a class="brand" href="index.html" aria-label="小说工坊，返回三版对比"><strong>小说工坊</strong><span>LATENT</span></a>'+
      '<nav aria-label="分析视图" class="tabs">'+Object.entries(tabs).map(([id,label])=>btn('tab',id,label,attr(id===s.tab))).join('')+'</nav>'+
      '<div class="tools"><a class="icon compare-back" href="index.html" aria-label="返回三版对比" title="返回三版对比">'+icon('back')+'</a>'+btn('quick','',icon('chart'),'class="icon quick-open" aria-haspopup="dialog" aria-label="写作速览" title="写作速览"')+'</div></header>'
  }
  function mast(){
    return '<div class="mast"><div><div class="micro edition"><span class="edition-letter">'+variant.toUpperCase()+'</span>'+conf.en+'<span class="demo">演示数据</span></div><h1 id="page-title" tabindex="-1">'+conf.name+'</h1><p>'+conf.tag+'</p></div><div class="scope">'+
      (s.drilled?btn('back','',icon('back')+'返回对照','class="soft"'):'')+
      '<label class="scope-work"><span>作品</span>'+workSelect('work',s.work)+'</label><div class="period" role="group" aria-label="日期范围">'+[7,30,90].map(p=>btn('period',p,p+' 日',attr(p===s.period))).join('')+'</div></div></div>'
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
      '<section class="calendar-strip" aria-label="活跃日历"><div class="calendar-title"><h3>活跃日历</h3><span>每格一天 · 选择日期查看明细</span><div class="legend"><span><i class="zero"></i>有写入、净零</span><span><i class="missing"></i>无记录</span></div></div>'+heat(ds,s.detail?.date||s.date,s.work)+'</section>'+controls+exact(ds)+'</section>'+
      '<section class="panel">'+heading('02 / DOCUMENTED MOMENTS','版本与灵感','仅展示此区间内有日期的记录')+ledger(notable)+'</section></div>'+inlineDetail()+'</div>'
  }
  function volumeMenu(){
    const list=M.volumes(s.work)
    return '<aside class="panel volume-rail" aria-label="分卷导航"><div class="micro">MANUSCRIPT INDEX</div><h2>分卷目录</h2>'+btn('volume','all','<span>全部章节</span><small>'+M.inventory(s.work).chapters.length+' 章</small>',attr(s.volume==='all'))+
      list.map((v,i)=>btn('volume',v.id,'<small>'+String(i+1).padStart(2,'0')+(s.work==='all'?' · '+name(v.work):'')+'</small><span>'+v.title+'</span><div class="rail-progress"><i style="width:'+(v.count?v.done/v.count*100:0)+'%"></i></div><small>已完成 '+v.done+' / '+v.count+'</small>',attr(s.volume===v.id))).join('')+'</aside>'
  }
  function manuscript(){
    const inv=M.inventory(s.work), vs=M.volumes(s.work), filtered=M.chapters(s.work,s.volume,s.status), base=M.chapters(s.work,s.volume), max=Math.max(1000,Math.ceil(Math.max(0,...base.map(c=>c.words))/1000)*1000)
    const counts=Object.fromEntries(['done','revise','draft'].map(t=>[t,base.filter(c=>c.status===t).length]))
    const selected=s.detail?.kind==='chapter'?s.detail.id:(variant==='b'&&s.work==='fog'&&s.volume==='all'&&s.status==='all'?'f2-2':null)
    const volName=vs.find(v=>v.id===s.volume)?.title||'全部分卷'
    return '<div class="manuscript-grid">'+volumeMenu()+'<div class="main-stack"><section class="panel manuscript-panel">'+heading('01 / CHAPTER DISTRIBUTION','章节字数分布',volName+' · 当前正文存量','<span class="badge">'+filtered.length+' 章</span>')+
      '<div class="metric-band">'+metric('当前正文',fmt(inv.words),'字','accent')+metric('全作已完成',inv.done+' / '+inv.chapters.length,'章')+'</div>'+
      '<label class="mobile-volume"><span>分卷</span><select aria-label="分卷" data-act="volume"><option value="all">全部分卷</option>'+vs.map(v=>'<option value="'+v.id+'"'+(s.volume===v.id?' selected':'')+'>'+v.title+'</option>').join('')+'</select></label>'+
      '<div class="status-band" aria-hidden="true">'+['done','revise','draft'].map(t=>'<i class="'+t+'" style="flex:'+counts[t]+'"></i>').join('')+'</div>'+
      '<div class="status-filter" role="group" aria-label="章节状态">'+[['all','全部',base.length],...Object.entries(counts).map(([k,v])=>[k,labels[k],v])].map(([k,t,n])=>btn('status',k,'<i class="'+k+'"></i>'+t+' <span>'+n+'</span>',attr(s.status===k))).join('')+'</div>'+
      (filtered.length?'<div class="chapter-axis"><span>章节</span><span>0</span><span>'+fmt(max)+' 字</span></div><div class="chapter-list">'+filtered.map((c)=>btn('chapter',c.id,'<span class="chapter-title"><i class="'+c.status+'"></i>'+c.title+'</span><span class="word-track"><i class="'+c.status+'" style="width:'+c.words/max*100+'%"></i></span><b>'+fmt(c.words)+'</b>','class="chapter-row" '+attr(selected===c.id)+' aria-label="'+c.title+'，'+words(c.words)+'，'+labels[c.status]+'"')).join('')+'</div>':empty('没有符合条件的章节','可切换分卷、状态或作品范围。'))+
      '</section><section class="panel">'+heading('02 / VOLUME PROGRESS','分卷完成度','已完成章节 / 正式章节')+(vs.length?vs.map(v=>btn('volume',v.id,'<span>'+v.title+'</span><span class="meter"><i style="width:'+(v.count?v.done/v.count*100:0)+'%"></i></span><b>'+v.done+' / '+v.count+'</b>','class="bar-row"')).join(''):empty('尚未分卷','此作品没有正式章节。'))+'</section></div>'+inlineDetail()+'</div>'
  }
  function atlas(){
    if(s.work!=='all'){
      const inv=M.inventory(s.work), ds=dayRows(), w=work(s.work)
      return '<div class="atlas-layout'+(s.detail?' has-inspector':'')+'"><div class="atlas-drill main-stack"><section class="panel work-hero"><span class="cover" style="--cover:'+w.color+'">'+w.mark+'</span><div><div class="micro">'+w.genre+'</div><h2>'+w.title+'</h2><p>'+w.note+'</p></div><div class="metric-band">'+metric('当前正文',fmt(inv.words),'字','accent')+metric('已完成',inv.done+' / '+inv.chapters.length,'章')+'</div></section><div class="two-col"><section class="panel">'+heading('01 / WRITING TRACE','保存走势','近 '+s.period+' 日 · 每日净增')+plot(ds,{mode:'mini',work:s.work,selected:s.detail?.date})+exact(ds)+'</section><section class="panel">'+heading('02 / VOLUMES','分卷规模','当前正式章节字数')+rank(M.volumes(s.work).map(v=>[v.id,v.title,v.words]),'volume-tab','字')+'</section></div><section class="panel">'+heading('03 / WORK INDEX','作品构成','进入单项查看详情')+'<div class="lanes">'+moduleLanes()+'</div></section></div>'+inlineDetail()+'</div>'
    }
    const port=M.portfolio(s.pair,D.end,s.period,s.range), vs=M.volumes('all'), phone=matchMedia('(max-width: 680px)').matches
    const library='<section class="panel library">'+heading((phone?'02':'01')+' / LIBRARY','作品索引','当前存量 · 点击作品深入','<span class="badge">'+D.works.length+' 部</span>')+'<div class="atlas-books">'+D.works.map((w,i)=>{
      const inv=M.inventory(w.id)
      return btn('drill',w.id,'<div class="book-top"><span class="cover" style="--cover:'+w.color+'">'+w.mark+'</span><div><small>0'+(i+1)+' / '+w.genre+'</small><strong>'+w.title+'</strong></div>'+icon('arrow')+'</div><div class="book-total"><b>'+fmt(inv.words)+'</b> 字 <span>'+inv.chapters.length+' 章</span></div><div class="book-completion" aria-label="已完成 '+inv.done+' 章、待修改 '+inv.revise+' 章">'+[inv.done,inv.revise,inv.chapters.length-inv.done-inv.revise].map((n,j)=>'<i class="'+['done','revise','draft'][j]+'" style="flex:'+n+'"></i>').join('')+'</div><small>已完成 '+inv.done+' / '+inv.chapters.length+'</small>','class="book-tile" data-origin="tile"')
    }).join('')+'</div></section>'
    const comparison='<section class="panel compare-panel">'+heading((phone?'01':'02')+' / SIDE BY SIDE','创作投入对照','每日正文净增 · 两部作品同一日期、同一刻度','<span class="badge">'+dates(port.rows[0].days)+'</span>')+
      '<div class="compare-plots">'+port.rows.map(({work:id,days},i)=>'<article><div class="compare-plot-head"><label><span>对照 '+(i+1)+'</span>'+workSelect('pair'+(i+1),id,false)+'</label>'+btn('drill',id,'深入 '+icon('arrow'),'class="soft"')+'</div><div class="compare-net"><b class="'+(days.at(-1).cumulative<0?'loss':'accent')+'">'+(days.some(d=>d.logs.length)?signed(days.at(-1).cumulative):'—')+'</b><small>区间净增 · '+days.filter(d=>d.active).length+' 活跃日</small></div>'+plot(days,{mode:'mini',work:id,scale:port,selected:s.detail?.work===id?s.detail.date:''})+exact(days)+'</article>').join('')+'</div></section>'
    return '<div class="atlas-layout'+(s.detail?' has-inspector':'')+'"><div class="main-stack">'+(phone?comparison+library:library+comparison)+
      '<section class="panel">'+heading('03 / VOLUME SCALE','分卷规模','按当前正式章节字数比较')+rank(vs.map(v=>[v.id,name(v.work)+' · '+v.title,v.words]),'volume-tab','字')+'</section></div>'+inlineDetail()+'</div>'
  }
  function moduleLanes(){
    const data=[['outline','大纲',M.total(scope(D.outline),g=>g.events.length),'事件'],['lore','设定',M.total(scope(D.lore),r=>r.nodes.length+1),'节点'],['people','人物',scope(D.people).length,'人物'],['ideas','灵感',scope(D.snippets).length,'条灵感']]
    return data.map(([id,title,n,unit])=>btn('tab',id,'<span>'+title+'</span><b>'+n+'</b><small>'+unit+'</small>'+icon('arrow'),'class="lane"')).join('')
  }
  function network(people,edges){
    const groups=[...new Set(people.map(p=>p.work))]
    return '<div class="network">'+groups.map(id=>{
      const list=people.filter(p=>p.work===id), points=[[22,25],[71,25],[22,76],[71,76]], links=edges.filter(e=>e.work===id)
      const nodes=new Map(list.map((p,i)=>[p.id,points[i]]))
      const lines=links.map(e=>{const [x1,y1]=nodes.get(e.from),[x2,y2]=nodes.get(e.to)
        return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"/>'}).join('')
      return '<section><span class="micro">'+name(id)+'</span><div class="network-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+lines+'</svg>'+
        list.map(p=>{const [x,y]=nodes.get(p.id);return btn('entity',p.id,'<b>'+p.title+'</b><small>'+p.role+'</small>','class="network-node" style="left:'+x+'%;top:'+y+'%" '+attr(s.detail?.id===p.id))}).join('')+'</div></section>'
    }).join('')+'</div>'
  }
  function rank(rows,act,unit){
    const max=Math.max(1,...rows.map(r=>r[2]))
    if(!rows.length)return empty('暂无数据','当前作品还没有这一类记录。')
    return '<div class="rank">'+rows.map(([id,label,n])=>btn(act,id,'<span>'+esc(label)+'</span><span class="meter"><i style="width:'+n/max*100+'%"></i></span><b>'+fmt(n)+' '+unit+'</b>','class="bar-row"')).join('')+'</div>'
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
    if(s.tab==='overview'&&variant==='a')return {kind:'date',date:s.date,work:s.work}
    if((s.tab==='overview'&&variant==='b'||s.tab==='manuscript')&&variant==='b'){
      const list=M.chapters(s.work,s.volume,s.status)
      if(list.length)return {kind:'chapter',id:list.find(c=>c.id==='f2-2')?.id||list[0].id}
    }
    return null
  }
  function inlineDetail(){
    const d=contextDetail()
    if(!d&&s.tab==='overview'&&variant==='c')return ''
    return '<aside class="panel inspector-inline" aria-label="明细">'+detailContent(d,false)+'</aside>'
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
    return detailTop('DAY INSPECTOR',iso(d.date),name(d.work),mobile)+'<div class="detail-body"><div class="detail-stat"><span>'+message+'</span><b class="'+(net<0?'loss':'accent')+'">'+(logs.length?signed(net):'—')+'</b><small>'+logs.length+' 条保存记录'+(logs.length?' · 字':'')+'</small></div>'+
      '<h3>涉及章节</h3>'+(logs.length?logs.map(r=>btn('chapter',r.chapter,'<span>'+esc(r.title)+'</span><b class="'+(r.delta<0?'loss':'accent')+'">'+signed(r.delta)+'</b>','class="detail-row"')).join(''):'<p class="muted">这一天没有章节保存字数日志。</p>')+
      '<h3>可用版本 <small>'+snapshots.length+'</small></h3>'+(snapshots.length?snapshots.map(snapshot).join(''):'<p class="muted">当日没有保留的版本。</p>')+
      (ideas.length?'<h3>新增灵感</h3>'+ideas.map(r=>btn('record',r.id,r.title,'class="detail-row"')).join(''):'')+'</div>'
  }
  function chapterDetail(d,mobile){
    const c=chapter(d.id)
    if(!c)return detailTop('CHAPTER FILE','章节档案','没有可用章节',mobile)
    const ds=dayRows(), logs=D.logs.filter(r=>r.chapter===c.id&&r.date>=ds[0].date&&r.date<=ds.at(-1).date).sort((a,b)=>b.date.localeCompare(a.date)), snaps=D.versions.filter(r=>r.chapter===c.id)
    return detailTop('CHAPTER FILE',c.title,name(c.work)+' / '+(D.volumes.find(v=>v.id===c.volume)?.title||'未分卷'),mobile)+'<div class="detail-body"><div class="detail-stat"><span>当前正文字数</span><b>'+fmt(c.words)+'</b>'+pill(c.status)+'</div><h3>保留版本 <small>'+snaps.length+'</small></h3>'+(snaps.length?snaps.map(snapshot).join(''):'<p class="muted">此章没有保留的版本。</p>')+
      '<h3>区间保存记录 <small>'+logs.length+'</small></h3>'+(logs.length?'<div class="save-list">'+logs.map(r=>'<div class="detail-row"><span>'+iso(r.date)+'</span><b class="'+(r.delta<0?'loss':'accent')+'">'+signed(r.delta)+' 字</b></div>').join('')+'</div>':'<p class="muted">暂无写作记录</p>')+'</div>'
  }
  function detailContent(d,mobile){
    if(!d)return detailTop('DETAIL INSPECTOR','查看明细','从图表或清单中选择一项。',mobile)
    if(d.kind==='date')return dateDetail(d,mobile)
    if(d.kind==='chapter')return chapterDetail(d,mobile)
    if(d.kind==='record'){
      const r=M.records('all','2000-01-01',D.end).find(x=>x.id===d.id)
      if(!r)return ''
      return detailTop('RECORD DETAIL',esc(r.title),name(r.work)+' · '+iso(r.date)+' · '+r.kind,mobile)+'<div class="detail-body">'+(r.text?'<blockquote>'+esc(r.text)+'</blockquote>':'')+(r.chapter?btn('chapter',r.chapter,'查看章节 '+icon('arrow'),'class="soft"'):'')+(r.tags?'<p class="muted">'+r.tags.join(' · ')+'</p>':'')+'</div>'
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
  function renderQuick(){
    const ds=M.timeline(s.work,D.end,7), inv=M.inventory(s.work), today=ds.at(-1)
    quick.innerHTML='<div class="detail-head"><div class="micro"><i></i>'+conf.en+' · 演示数据</div>'+btn('close-quick','',icon('close'),'class="icon close" aria-label="关闭速览"')+'<h2 id="quick-title">写作速览</h2><p>当前存量与近七日保存趋势</p></div><div class="detail-body">'+workSelect('quick-work',s.work)+'<div class="metric-band">'+metric('正文存量',fmt(inv.words),'字','accent')+metric('正式章节',inv.chapters.length,'章')+metric('今日净增',today.logs.length?signed(today.net):'—','字')+'</div>'+plot(ds,{mode:'quick',work:s.work})+'<div class="quick-day" role="status">选择日期查看当日净增</div>'+btn('full','', '查看完整分析 '+icon('arrow'),'class="primary"')+'</div>'
  }
  function closeQuick(expand=false){
    quick.close()
    $(expand?'#page-title':'[data-act="quick"]')?.focus({preventScroll:true})
  }
  const narrow=()=>matchMedia('(max-width: 1050px)').matches
  function focusKey(el){return el?.dataset.act?[el.dataset.act,el.dataset.value??el.value,el.dataset.work??'',el.dataset.origin??'']:null}
  function focusOn(key){
    if(!key)return
    const target=[...document.querySelectorAll('[data-act]')].find(el=>{const k=focusKey(el);return k&&k.every((v,i)=>v===key[i])&&el.getClientRects().length})
    target?.focus({preventScroll:true})
  }
  function render(preserveFocus=true){
    const key=preserveFocus?focusKey(document.activeElement):null
    const previousOpen=drawer.open
    root.innerHTML=header()+'<main>'+mast()+(s.tab==='overview'?(variant==='a'?journey():variant==='b'?manuscript():atlas()):s.tab==='manuscript'?manuscript():moduleContent())+
      '<footer><span>小说工坊 · LATENT</span><span>交互设计稿 / 所有数据为演示</span><a href="index.html">返回三版对比 '+icon('arrow')+'</a></footer></main>'
    if(quick.open)renderQuick()
    if(opened&&narrow()&&contextDetail()&&!quick.open){
      drawer.innerHTML=detailContent(contextDetail(),true)
      if(!drawer.open)drawer.showModal()
      if(!previousOpen)$('.close',drawer)?.focus()
    }else if(drawer.open)drawer.close()
    if(!drawer.open&&key)focusOn(key)
    else if(previousOpen&&drawer.open&&key){focusOn(key);if(!drawer.contains(document.activeElement))$('.close',drawer)?.focus()}
  }
  function detail(kind,args,el){
    if(!drawer.open&&!el.closest('.inspector-inline'))returnFocus=focusKey(el)
    s={...s,date:kind==="date"&&variant==="a"?args.date:s.date,detail:{kind,...args}}
    opened=true;render()
    if(!narrow()&&variant==='c'&&s.tab==='overview')$('.inspector-inline')?.scrollIntoView({block:'nearest'})
  }
  function dismiss(){
    opened=false;s={...s,detail:null};if(drawer.open)drawer.close()
    render(false);focusOn(returnFocus)
  }
  function apply(type,args){
    if(drawer.open)drawer.close()
    opened=false;s=M.transition(s,{type,...args});render()
  }
  function range(from,to){
    apply('range',{range:[from,to]})
  }
  document.addEventListener('submit',e=>{
    if(!e.target.matches('.range-form'))return
    e.preventDefault()
    const {from,to}=e.target.elements
    if(from.value>to.value){$('.range-error',e.target).textContent='起始日期不能晚于结束日期。';return}
    range(from.value,to.value);$('.range-form button')?.focus({preventScroll:true})
  })
  document.addEventListener('change',e=>{
    const {act}=e.target.dataset
    const value=e.target.value
    if(act==='work'||act==='quick-work'){snippetTag='all';apply('work',{work:value});if(act==='quick-work')$('[data-act="quick-work"]',quick)?.focus()}
    if(act==='volume'){s={...s,volume:value,detail:null};opened=false;render()}
    if(act?.startsWith('pair')){
      const i=Number(act.at(-1))-1,pair=s.pair.slice(),other=1-i
      if(pair[other]===value)pair[other]=pair[i]
      pair[i]=value;s={...s,pair,detail:null};opened=false;render()
    }
  })
  document.addEventListener('click',e=>{
    if(e.target===quick){closeQuick();return}
    if(e.target===drawer){dismiss();return}
    const el=e.target.closest('button[data-act]')
    if(!el)return
    const {act,value,work:id}=el.dataset
    switch(act){
      case 'quick': renderQuick();quick.showModal();break
      case 'close-quick': closeQuick();break
      case 'full': closeQuick(true);break
      case 'tab': snippetTag='all';apply('tab',{tab:value});break
      case 'period': apply('period',{period:Number(value)});break
      case 'drill': compareReturn={key:focusKey(el),y:scrollY};apply('drill',{work:value});scrollTo(0,0);$('#page-title').focus({preventScroll:true});break
      case 'back': apply('back');scrollTo(0,compareReturn?.y||0);focusOn(compareReturn?.key);break
      case 'clear-range': apply('range',{range:null});$('.range-form button')?.focus({preventScroll:true});break
      case 'volume': s={...s,volume:value,detail:null};opened=false;render();break
      case 'volume-tab': s={...M.transition(s,{type:'tab',tab:'manuscript'}),volume:value,status:'all'};opened=false;render();$('.manuscript-panel h2')?.scrollIntoView({block:'nearest'});break
      case 'status': s={...s,status:value,detail:null};opened=false;render();break
      case 'tag': snippetTag=value;render();break
      case 'date':
        if(e.detail>0&&el.closest(".plot-hits")&&performance.now()<muteClick)return
        if(quick.open){
          const d=M.timeline(s.work,D.end,7).find(r=>r.date===value)
          $('.quick-day',quick).textContent=iso(value)+' · '+C.dayText(d)
          quick.querySelectorAll('[data-act="date"]').forEach(b=>{b.setAttribute('aria-pressed',b===el);b.tabIndex=b===el?0:-1})
        }else detail('date',{date:value,work:id||s.work},el)
        break
      case 'chapter':case 'record':case 'entity':detail(act,{id:value},el);break
      case 'dismiss': dismiss();break
    }
  })
  quick.addEventListener('cancel',e=>{e.preventDefault();closeQuick()})
  drawer.addEventListener('cancel',e=>{e.preventDefault();dismiss()})
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&s.detail&&!narrow()&&!quick.open){dismiss();return}
    const el=e.target.closest('.plot-hits button')
    if(!el||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
    e.preventDefault()
    const list=[...el.parentNode.children],i=list.indexOf(el), j=e.key==='Home'?0:e.key==='End'?list.length-1:Math.max(0,Math.min(list.length-1,i+(e.key==='ArrowLeft'?-1:1)))
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
    const j=brushIndex(el,e.clientX), n=el.querySelectorAll('button').length, mark=$('.brush-mark',el)
    mark.hidden=false;mark.style.left=Math.min(i,j)/n*100+'%';mark.style.width=(Math.abs(i-j)+1)/n*100+'%'
  })
  document.addEventListener('pointerup',e=>{
    if(!brush||brush.id!==e.pointerId)return
    const {el,i,moving}=brush;brush=null
    if(!moving)return
    const j=brushIndex(el,e.clientX), list=el.querySelectorAll('button')
    muteClick=performance.now()+220;range(list[Math.min(i,j)].dataset.value,list[Math.max(i,j)].dataset.value)
  })
  document.addEventListener('pointercancel',()=>{if(brush){$('.brush-mark',brush.el).hidden=true;brush=null}})
  matchMedia('(max-width: 1050px)').addEventListener('change',()=>render())
  matchMedia('(max-width: 680px)').addEventListener('change',()=>render())
  if(scene==='detail'){
    opened=true
    s={...s,detail:variant==='a'?{kind:'date',date:'2026-11-03',work:'fog'}:variant==='b'?{kind:'chapter',id:'f2-2'}:{kind:'date',date:'2026-11-06',work:'night'}}
    if(variant==='b')s={...s,volume:'f2',status:'revise'}
  }
  render(false)
  if(scene==='detail'&&variant==='b')$('.snapshot summary',drawer.open?drawer:$('.inspector-inline'))?.click()
  if(scene==='quick'){renderQuick();quick.showModal()}
})()



