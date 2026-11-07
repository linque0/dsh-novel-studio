(() => {
  const M=StudioModel,{fmt,md,esc,signed}=StudioCharts
  const status={done:'已完成',revise:'待修改',draft:'草稿'}
  const kinds={gain:['+','净增'],loss:['−','净减'],zero:['=','有写入 · 净零'],flat:['≈','保存净零'],missing:['·','无保存记录']}
  const kind=d=>!d.logs.length?'missing':d.net>0?'gain':d.net<0?'loss':d.active?'zero':'flat'
  const netText=d=>!d.logs.length?'无保存记录':signed(d.net)+' 字'+(!d.net&&d.active?' · 有写入':'')
  function structure({groups,base,median,max},selected,showWork,name,volume){
    if(!groups.length)return ''
    const ticks=[0,max/4,max/2,max*3/4,max]
    const reference=median===null?'':'<span class="median-key"><i></i>'+(volume==='all'?'全部章节':volume==='unassigned'?'未分卷':'本卷')+'中位数 <b>'+fmt(median)+'</b> 字</span>'
    const tickMarks='<span class="score-ticks">'+ticks.map((v,i)=>'<span style="left:'+i*25+'%">'+fmt(v)+'</span>').join('')+'</span>'
    const marker='<i class="median-mark" style="--median:'+median/max*100+'%" aria-hidden="true"></i>'
    return '<div class="score" data-motion-group="chapter-score"><div class="score-key"><span>原稿顺序 · 当前正文</span>'+reference+'</div>'+
      '<div class="chapter-axis score-axis"><span>章节 / 状态</span>'+tickMarks+'<span>字数</span></div><div class="chapter-list">'+groups.map((g,i)=>
        '<div class="score-group"><div class="score-group-label"><b>'+(g.id==='unassigned'?'—':String(i+1).padStart(2,'0'))+'</b><span>'+esc(g.title)+'</span>'+(showWork&&g.work!=='all'?'<small>'+esc(name(g.work))+'</small>':'')+'</div>'+
        g.rows.map(c=>'<button type="button" data-act="chapter" data-value="'+esc(c.id)+'" data-row-motion="chapter-'+esc(c.id)+'" class="chapter-row score-row" aria-pressed="'+(c.id===selected)+'" aria-label="'+esc(c.title)+'，'+fmt(c.words)+' 字，'+status[c.status]+'"><span class="chapter-title"><span class="chapter-no">'+String(base.indexOf(c)+1).padStart(2,'0')+'</span><span><strong>'+esc(c.title)+'</strong><small class="status '+c.status+'"><i></i>'+status[c.status]+'</small></span></span><span class="word-track score-track">'+marker+'<i data-bar-motion="chapter-'+esc(c.id)+'" class="score-bar '+c.status+'" style="width:'+c.words/max*100+'%"></i></span><b>'+fmt(c.words)+'</b></button>').join('')+'</div>'
      ).join('')+'</div><details class="exact"><summary>查看章节精确数值</summary><div class="table-scroll"><table><thead><tr><th>分卷</th><th>章节</th><th>状态</th><th>当前字数</th></tr></thead><tbody>'+groups.flatMap(g=>g.rows.map(c=>'<tr><td>'+esc((showWork?name(c.work)+' · ':'')+g.title)+'</td><td>'+esc(c.title)+'</td><td>'+status[c.status]+'</td><td>'+fmt(c.words)+'</td></tr>')).join('')+'</tbody></table></div></details></div>'
  }
  function matrix({dates,rows},selected,selectedDay,showWork,name){
    if(!rows.length)return ''
    const datesKey=dates[0]+'…'+dates.at(-1)
    const defaultId=rows.find(r=>r.chapter.id===selected)?.chapter.id||rows[0].chapter.id, defaultDay=dates.includes(selectedDay)?selectedDay:dates.at(-1)
    const records=rows.flatMap(r=>r.days.filter(d=>d.logs.length||d.versions.length).map(d=>({c:r.chapter,d})))
    const peak=Math.max(1,...records.map(({d})=>Math.abs(d.net)))
    const key='<div class="matrix-key">'+['gain','loss','zero','missing'].map(k=>'<span><i class="'+k+'">'+(kinds[k][0]||'·')+'</i>'+kinds[k][1]+'</span>').join('')+'<span><i class="version">◆</i>留存版本</span></div>'
    return '<div class="revision-board" data-motion-group="revision-matrix"><div class="matrix-cap"><div>'+key+'<p>选一格查看保存与版本。'+(dates.length>7?'横滑可查看更多日期。':'')+'</p></div><span class="badge">'+md(dates[0])+' — '+md(dates.at(-1))+'</span></div>'+
      '<div class="matrix-window" data-day-count="'+dates.length+'" data-matrix-window="'+datesKey+'" aria-label="按章节和日期浏览改稿记录"><table class="revision-grid" aria-label="章节改稿轨迹"><thead><tr><th scope="col">章节</th>'+dates.map(d=>'<th scope="col" class="'+(d===selectedDay?'column-active':'')+'" title="'+d+'"><span aria-hidden="true">'+(d.endsWith('-01')?md(d):d.slice(8))+'</span><span class="chart-sr">'+d+'</span></th>').join('')+'</tr></thead><tbody>'+
      rows.map(({chapter:c,days},i)=>'<tr class="'+(c.id===selected?'row-active':'')+'"><th scope="row"><button type="button" data-act="chapter" data-value="'+esc(c.id)+'" aria-pressed="'+(c.id===selected)+'"><span>'+String(i+1).padStart(2,'0')+'</span><strong>'+esc(c.title)+'</strong></button>'+(showWork?'<small>'+esc(name(c.work))+'</small>':'')+'</th>'+days.map((d,j)=>{
        const k=kind(d),active=c.id===selected&&d.date===selectedDay
        const label=c.title+'，'+d.date+'，'+netText(d)+'，'+d.logs.length+' 条保存'+(d.versions.length?'，'+d.versions.length+' 个版本':'')
        return '<td class="'+(d.date===selectedDay?'column-active':'')+'"><button type="button" class="revision-cell '+k+'" style="--strength:'+(0.16+Math.sqrt(Math.abs(d.net)/peak)*.56).toFixed(3)+'" data-act="chapter-day" data-value="'+esc(c.id)+'" data-origin="'+d.date+'" data-row="'+i+'" data-col="'+j+'" data-kind="'+k+'" data-versions="'+d.versions.length+'"'+(d.logs.length||d.versions.length?' data-matrix-mark="'+esc(c.id)+'|'+d.date+'"':'')+' tabindex="'+(c.id===defaultId&&d.date===defaultDay?0:-1)+'" aria-pressed="'+active+'" title="'+esc(label)+'" aria-label="'+esc(label)+'"><span aria-hidden="true">'+kinds[k][0]+'</span>'+(d.versions.length?'<i aria-hidden="true"></i>':'')+'</button></td>'
      }).join('')+'</tr>').join('')+'</tbody></table></div><details class="exact"><summary>查看有记录的精确数值</summary>'+(records.length?'<div class="table-scroll"><table><thead><tr><th>章节</th><th>日期</th><th>当日净增</th><th>保存</th><th>版本</th></tr></thead><tbody>'+records.map(({c,d})=>'<tr><td>'+esc(c.title)+'</td><td>'+d.date+'</td><td>'+(!d.logs.length?'—':signed(d.net))+'</td><td>'+d.logs.length+'</td><td>'+d.versions.length+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">区间内没有保存字数日志或版本记录。</p>')+'</details></div>'
  }
  globalThis.StudioChapterCharts={structure,matrix,netText}
})()
