(() => {
  const fmt=n=>n.toLocaleString('zh-CN'), signed=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n)), md=d=>d.slice(5).replace('-','/'), iso=d=>d.replaceAll('-','.')
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const dayText=d=>!d.logs.length?'无保存记录':signed(d.net)+' 字'+(!d.net&&d.active?' · 有写入':'')
  const bounds=(days,scale)=> {
    const max=scale?.max??Math.max(0,...days.map(d=>d.net)),min=scale?.min??Math.min(0,...days.map(d=>d.net))
    const step=max-min>2200?1000:max-min>800?500:max-min>150?100:10
    return [min?Math.floor(min/step)*step:0,max?Math.ceil(max/step)*step:step]
  }
  function plot(days,{selected='',work='',mode='full',scale,range=false}={}) {
    if(!days.some(d=>d.logs.length))return '<div class="plot-empty"><span>◌</span><strong>暂无写作记录</strong><small>此范围还没有正式章节的保存字数日志。</small></div>'
    const full=mode==='full',mini=mode==='mini', H=full?238:mini?94:105,W=720,T=full?120:6,B=H-15,n=days.length, slot=W/n
    const [min,max]=bounds(days,scale), y=v=>B-(v-min)/(max-min)*(B-T), z=y(0)
    const cap=Math.max(1,...days.map(d=>d.cumulative)),floor=Math.min(0,...days.map(d=>d.cumulative)),cy=v=>96-(v-floor)/(cap-floor)*83
    const path=days.map((d,i)=>(i?'L':'M')+' '+((i+.5)*slot)+' '+cy(d.cumulative)).join(' ')
    const aria=days.map(d=>d.date+'，'+dayText(d))
    const idx=days.findIndex(d=>d.date===selected), last=days.at(-1), ticks=[0,Math.round((n-1)/3),Math.round((n-1)*2/3),n-1].filter((v,i,a)=>a.indexOf(v)===i)
    const size=Math.max(1,Math.min(slot*.62,34)), selectedDay=days[idx]
    return '<div class="plot-wrap '+mode+'">'+(full?'<div class="plot-label"><i></i>区间累计净增 <b>'+signed(last.cumulative)+' 字</b></div>':'')+
      '<div class="plot-frame"><div class="plot-axis" aria-hidden="true">'+(full?'<span style="top:6%">'+signed(cap)+'</span><span style="top:39%">'+signed(floor)+'</span>':'')+
      '<span style="top:'+T/H*100+'%">'+signed(max)+'</span>'+(min<0?'<span style="top:'+z/H*100+'%">0</span>':'')+'<span style="top:'+B/H*100+'%">'+signed(min)+'</span></div>'+
      '<div class="plot-core" data-plot="'+(range?'brush':'point')+'" data-work="'+work+'" style="--days:'+n+'"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+
      (full?'<path d="'+path+' L '+((n-.5)*slot)+' '+cy(0)+' L '+(.5*slot)+' '+cy(0)+' Z" fill="var(--area)"/><path d="'+path+'" fill="none" stroke="var(--mint)" stroke-width="1.8" vector-effect="non-scaling-stroke"/><line class="grid-line" x1="0" x2="'+W+'" y1="105" y2="105"/>':'')+
      [T,(T+B)/2,B].map(t=>'<line class="grid-line" x1="0" x2="'+W+'" y1="'+t+'" y2="'+t+'"/>').join('')+
      '<line class="zero-line" x1="0" x2="'+W+'" y1="'+z+'" y2="'+z+'"/>'+
      (idx<0?'':'<rect class="plot-selected" x="'+idx*slot+'" y="0" width="'+slot+'" height="'+H+'"/><line class="plot-cross" x1="'+(idx+.5)*slot+'" x2="'+(idx+.5)*slot+'" y1="0" y2="'+H+'"/>'+(full?'<circle cx="'+(idx+.5)*slot+'" cy="'+cy(selectedDay.cumulative)+'" r="3.5" fill="var(--mint)"/>':''))+
      days.map((d,i)=>d.logs.length?'<rect rx="2" class="'+(d.net<0?'neg':d.net?'pos':'flat')+'" x="'+((i+.5)*slot-size/2)+'" y="'+(d.net?Math.min(y(d.net),z):z-1.8)+'" width="'+size+'" height="'+Math.max(2,Math.abs(y(d.net)-z))+'"/>':'').join('')+
      '</svg><div class="plot-hits" role="group" aria-label="按方向键选择日期">'+days.map((d,i)=>'<button type="button" data-act="date" data-value="'+d.date+'" data-work="'+work+'" tabindex="'+(i===(idx>=0?idx:n-1)?'0':'-1')+'" aria-label="'+aria[i]+'" aria-pressed="'+(i===idx)+'" title="'+aria[i]+'"></button>').join('')+
      '</div><div class="brush-mark" hidden></div></div></div><div class="plot-ticks">'+ticks.map(i=>'<span style="left:'+(n===1?50:i/(n-1)*100)+'%">'+md(days[i].date)+'</span>').join('')+'</div></div>'
  }
  function heat(days,selected,work) {
    const pad=(new Date(days[0].date+'T00:00:00Z').getUTCDay()+6)%7
    const cells=[...Array(pad).fill(null),...days], weeks=Math.ceil(cells.length/7)
    return '<div class="heat-scroll"><div class="heat" style="--weeks:'+weeks+'">'+Array.from({length:weeks},(_,i)=>{
      const week=cells.slice(i*7,i*7+7)
      return '<div class="heat-week"><span>'+md(week.find(Boolean).date)+' 起</span><div>'+week.map(d=>d?
        '<button type="button" data-origin="calendar" class="heat-cell '+(!d.logs.length?'missing':!d.net?'zero':d.net<0?'down':d.net>850?'strong':'up')+'" data-act="date" data-value="'+d.date+'" data-work="'+work+'" title="'+md(d.date)+' · '+dayText(d)+'" aria-label="'+d.date+'，'+dayText(d)+'" aria-pressed="'+(selected===d.date)+'">'+Number(d.date.slice(8))+'</button>':'<span></span>').join('')+'</div></div>'
    }).join('')+'</div></div>'
  }
  function exact(days) {
    return '<details class="exact"><summary>查看逐日数值</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>保存条数</th><th>正文净增</th><th>区间累计净增</th></tr></thead><tbody>'+days.slice().reverse().map(d=>'<tr><td>'+iso(d.date)+'</td><td>'+fmt(d.logs.length)+'</td><td>'+(!d.logs.length?'—':signed(d.net))+'</td><td>'+signed(d.cumulative)+'</td></tr>').join('')+'</tbody></table></div></details>'
  }
  globalThis.StudioCharts={fmt,signed,md,iso,esc,plot,heat,exact,dayText}
})()

