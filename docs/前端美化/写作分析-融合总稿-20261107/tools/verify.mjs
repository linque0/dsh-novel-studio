import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
import { cdpClient } from '../../../../scripts/verify-app.mjs'

const home=fileURLToPath(new URL('../',import.meta.url))
const outputs=join(home,'screenshots')
await mkdir(outputs,{recursive:true})
const temp=await realpath(tmpdir()), profile=await realpath(await mkdtemp(join(temp,'latent-writing-prototype-')))
const exe=process.env.STUDIO_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'
const proc=spawn(exe,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-extensions','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true})
let cdp, assertions=0
const tabs=['overview','manuscript','outline','lore','people','ideas']
const entity={manuscript:'chapter',outline:'entity',lore:'entity',people:'entity',ideas:'record'}
const checked=[]
try{
  const endpoint=await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('DevTools did not start')),15000)
    proc.on('error',reject)
    proc.stderr.on('data',chunk=>{
      const url=chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/)?.[1]
      if(url){clearTimeout(t);resolve(url)}
    })
  })
  cdp=await cdpClient(endpoint)
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true})
  const send=(m,p)=>cdp.send(m,p,sessionId)
  const ev=async expression=>{
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text)
    return r.result.value
  }
  const check=async (label,js)=>{assert.ok(await ev(js),label);assertions++}
  const sel=q=>'document.querySelector('+JSON.stringify(q)+')'
  const click=q=>ev(sel(q)+'.click()')
  const change=(q,value)=>ev('(()=>{const x='+sel(q)+';x.value='+JSON.stringify(value)+';x.dispatchEvent(new Event("change",{bubbles:true}));})()')
  const key=async (k,v)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:v,nativeVirtualKeyCode:v,text:k==="Enter"&&type==="keyDown"?"\r":undefined})}
  const snap=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});await writeFile(join(outputs,name+'.png'),Buffer.from(data,'base64'))}
  const go=async (page,w=1440,query='')=>{
    const h=w===380?844:900
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false})
    await send('Emulation.setTouchEmulationEnabled',{enabled:w===380,maxTouchPoints:1})
    await send('Emulation.setScrollbarsHidden',{hidden:w===380})
    const url=pathToFileURL(join(home,page+'.html')).href+'?static=1'+query
    await send('Page.navigate',{url})
    for(let i=0;i<100;i++){
      if(await ev('location.href==='+JSON.stringify(url)+' && document.readyState==="complete" && !!document.querySelector("main")'))break
      if(i===99)throw new Error('Load timeout: '+url)
      await pause(50)
    }
    await ev('document.fonts.ready.then(()=>true)')
  }

  const noOverflow='document.documentElement.scrollWidth<=innerWidth && document.querySelector("#studio").scrollWidth<=innerWidth && document.querySelector("#quick").scrollWidth<=innerWidth'
  const el=q=>sel(q)
  const quickOpen='#stats-entry'
  const checkTitle=(title)=>check(title,el('#page-title')+'.textContent==='+JSON.stringify(title))
  const center=async q=>ev('(()=>{const x='+el(q)+';x.scrollIntoView({block:"nearest"});const r=x.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
  const mouse=async q=>{const p=await center(q);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})}
  const touch=async q=>{const p=await center(q);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(80)}
  const quickSelect='#quick [data-act=quick-work]'
  const workSelect='#studio [data-act=work]'
  await send('Page.enable');await send('Runtime.enable')
  for(const w of [1440,864,380]){
    await go('index',w)
    const editorState=await ev('(()=>{const x=document.querySelector("#mock-editor");x.focus();x.setSelectionRange(33,44);x.scrollTop=116;x.value+="\\n测试保留";x.setSelectionRange(33,44);x.scrollTop=116;window.editorBefore=x;return [x.selectionStart,x.selectionEnd,x.scrollTop,x.value]})()')
    if(w===380)await touch(quickOpen);else await mouse(quickOpen)
    await check('editor scope '+w,el(quickSelect)+'.value==="fog"')
    await check('quick modality '+w,el('#quick')+'.matches(":modal")==='+String(w===380))
    await check('quick no overflow '+w,noOverflow)
    await check('quick action is unobscured '+w,'(()=>{const b=document.querySelector("#quick [data-act=full]"),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()')
    await snap('editor-quick-'+w)
    await click('#quick [data-act=full]')
    await checkTitle('创作历程')
    await check('analysis modal '+w,el('#analysis')+'.matches(":modal")')
    await check('journey width '+w,noOverflow)
    await snap('journey-'+w)

    for(const tab of tabs.slice(1)){
      await click('.analysis-bar [data-value="'+tab+'"]')
      await check('module '+tab+' width '+w,noOverflow)
      await click('#studio .main-stack .chapter-row, #studio .module-grid [data-act='+entity[tab]+']')
      await check('module detail '+tab+' '+w,w<=1050?el('#inspector')+'.open':'!!'+el('.inspector-inline .close'))
      await key('Escape',27)
      await check('close module detail '+tab+' '+w,el('#analysis')+'.open && !'+el('#inspector')+'.open && !'+el('.inspector-inline .close'))
    }
    await click('.analysis-bar [data-value=manuscript]')
    if(w===380)await change('.mobile-volume select','f2');else await click('.volume-rail [data-value=f2]')
    await click('[data-act=status][data-value=revise]')
    await check('intersected chapter filters '+w,'document.querySelectorAll(".chapter-row").length===1 && '+el('.chapter-row')+'.dataset.value==="f2-2"')
    const scroll=await ev('(()=>{const x=document.querySelector("#studio");x.scrollTop=65;return x.scrollTop})()')
    await click('[data-act=collapse]')
    await check('collapse returns to quick '+w,el('#quick')+'.open && !'+el('#analysis')+'.open')
    await click('#quick [data-act=full]')
    await checkTitle('稿件案卷')
    await check('resume filters and scroll '+w,el('#studio')+'.scrollTop==='+scroll+' && document.querySelectorAll(".chapter-row").length===1')
    await click('.chapter-row')
    await click(w<=1050?'#inspector .snapshot summary':'.inspector-inline .snapshot summary')
    if(w===1440){await ev('document.querySelector("#studio").scrollTop=0');await snap('manuscript-1440')}
    if(w===380)await snap('chapter-detail-380')
    await key('Escape',27)
    await click('[data-act=close-analysis]')
    await check('editor, selection and scroll survived '+w,'(()=>{const x=document.querySelector("#mock-editor");return x===window.editorBefore&&JSON.stringify([x.selectionStart,x.selectionEnd,x.scrollTop,x.value])==='+JSON.stringify(JSON.stringify(editorState))+' && document.activeElement.id==="stats-entry"})()')

    await go('index',w,'&from=library')
    await click(quickOpen)
    await check('library scope '+w,el(quickSelect)+'.value==="all"')
    if(w!==864)await snap('library-quick-'+w)
    await click('#quick [data-act=full]')
    await checkTitle('作品对照')
    await check('comparison width '+w,noOverflow)
    await snap('compare-'+w)
    await click('[data-act=period][data-value="90"]');await change('[data-act=pair2]','north')
    await check('comparison scales match '+w,'(()=>{const a=document.querySelectorAll(".compare-plots .plot-axis");return a.length===2&&a[0].textContent===a[1].textContent})()')
    await click('.compare-plots [data-work=north][data-value="2026-11-07"]')
    await check('compare inspects correct work '+w,el(w<=1050?'#inspector .detail-head p':'.inspector-inline .detail-head p')+'.textContent==="北纬档案"')
    await key('Escape',27)
    const compareScroll=await ev('(()=>{const x=document.querySelector("#studio");x.scrollTop=73;return x.scrollTop})()')
    await click('.book-tile[data-value=north]');await checkTitle('创作历程')
    await check('drill scope '+w,el(workSelect)+'.value==="north"')
    await click('[data-act=period][data-value="7"]')
    await click('[data-act=back]')
    await checkTitle('作品对照')
    await check('pair, period and scroll restored '+w,el('[data-act=pair2]')+'.value==="north" && '+el('.scope [aria-pressed=true]')+'.dataset.value==="90" && '+el('#studio')+'.scrollTop==='+compareScroll)
    await change(workSelect,'empty')
    await checkTitle('创作历程')
    await check('no history '+w,el('.plot-empty')+'.textContent.includes("暂无写作记录")')
    if(w===380)await snap('empty-380')
    checked.push({width:w,views:tabs.length,entryContexts:2})
  }

  await go('index')
  await mouse(quickOpen)
  await mouse('#mock-editor')
  await check('outside click acts on editor without stealing focus', '!'+el('#quick')+'.open && document.activeElement.id==="mock-editor"')
  await mouse(quickOpen);await key('Escape',27)
  await check('quick Escape restores focus','document.activeElement.id==="stats-entry" && !'+el('#quick')+'.open')
  await mouse(quickOpen)
  await ev(el('#quick .plot-hits [data-value="2026-11-05"]')+'.focus()')
  await key('ArrowLeft',37);await key('ArrowLeft',37);await key('Enter',13)
  await check('keyboard quick selects zero with two saves',el('.quick-day')+'.textContent.includes("有写入") && '+el('.quick-day')+'.textContent.includes("2 条保存")')
  await click('#quick [data-act=date][data-value="2026-11-05"]')
  await check('quick differentiates missing',el('.quick-day')+'.textContent.includes("无保存记录")')
  await click('#quick [data-act=date][data-value="2026-11-03"]')
  await snap('quick-date-1440')
  await click('#quick [data-act=day-link]')
  await checkTitle('创作历程')
  await check('quick opens matching date',el('.inspector-inline h2')+'.textContent==="2026.11.03"')
  await snap('day-detail-1440')
  await click('.inspector-inline [data-act=chapter-link]')
  await checkTitle('稿件案卷')
  await check('linked chapter active',el('.inspector-inline h2')+'.textContent==="逆风而行" && '+el('.volume-rail [aria-pressed=true]')+'.dataset.value==="f2"')
  await click('[data-act=back-chapter]')
  await check('return to selected date',el('.inspector-inline h2')+'.textContent==="2026.11.03"')
  const bounds=await ev('(()=>{const r=document.querySelector("[data-plot=brush]").getBoundingClientRect();return {x:r.left,y:r.top+r.height*.7,w:r.width}})()')
  const x=bounds.x+bounds.w*.61,y=bounds.y
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x+bounds.w*.93,y,button:'left',buttons:1})
  await check('drag brush drawn','!'+el('.brush-mark')+'.hidden')
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x+bounds.w*.93,y,button:'left',buttons:0,clickCount:1})
  await check('drag updates both charts','document.querySelectorAll("#studio .heat-cell").length===10 && document.querySelectorAll("#studio .plot-hits button").length===10')
  await click('[data-act=clear-range]')
  await ev('(()=>{const f=document.querySelector(".range-form");f.elements.from.value="2026-11-03";f.elements.to.value="2026-11-07";f.requestSubmit()})()')
  await check('keyboard date form alternative','document.querySelectorAll(".heat-cell").length===5')
  await click('[data-act=close-analysis]')
  await mouse(quickOpen);await click('[data-act=revise-link]')
  await check('quick revise shortcut',el('[data-act=status][aria-pressed=true]')+'.dataset.value==="revise"')
  await click('[data-act=status][data-value=all]');await click('.volume-rail [data-value=unassigned]')
  await check('unassigned chapters independently visible',el('.chapter-list')+'.textContent.includes("归港") && document.querySelectorAll(".chapter-row").length===1')

  await go('index',380)
  await touch(quickOpen)
  await touch('#quick [data-act=date][data-value="2026-11-03"]')
  await touch('#quick [data-act=day-link]')
  await check('touch opens selected day in bottom drawer',el('#inspector-title')+'.textContent==="2026.11.03"')
  await snap('day-detail-380')
  await key('Escape',27)
  await check('Escape closes only top drawer',el('#analysis')+'.open && !'+el('#inspector')+'.open')
  await touch('[data-act=collapse]')
  await change(quickSelect,'all')
  await click('[data-act=compare-link]')
  await checkTitle('作品对照')
  await check('scope change clears old day',el(workSelect)+'.value==="all" && !'+el('#inspector')+'.open')
  await ev('delete document.body.dataset.static')
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await check('reduced motion disables ambient and full movement','getComputedStyle(document.body,"::after").animationName==="none" && getComputedStyle(document.querySelector("#analysis")).animationName==="none"')
  await click('[data-act=collapse]');await change(quickSelect,'empty')
  await check('empty work quick view has no fabricated activity',el('#quick .plot-empty')+'.textContent.includes("暂无写作记录")')
  await check('text contrast against tinted surface', '(()=>{const cs=getComputedStyle(document.documentElement); const L=hex=>hex.match(/\\w{2}/g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);return ["--text","--muted","--quiet","--mint","--rose","--lav"].every(t=>(L(cs.getPropertyValue(t).trim())+.05)/(L("#46384f")+.05)>=4.5)})()')
  await send('Emulation.setEmulatedMedia',{features:[]})
  const chart=k=>'[data-act=chapter-chart][data-value='+k+']'
  const cell=date=>'.revision-cell[data-value="f2-2"][data-origin="'+date+'"]'
  for(const w of [1440,864,380]){
    await go('index',w,'&view=manuscript')
    await check('chapter structure opens directly '+w,el(chart('structure'))+'.getAttribute("aria-pressed")==="true"')
    await check('structure grouped and unassigned visible '+w,'document.querySelectorAll(".score-group").length===4 && '+el('.chapter-list')+'.textContent.includes("未分卷")')
    await snap('chapter-structure-'+w)
    if(w===380)await change('.mobile-volume select','f2');else await click('.volume-rail [data-value=f2]')
    await click('[data-act=status][data-value=revise]')
    await check('filter keeps common median '+w,el('.median-key b')+'.textContent==="5,060" && document.querySelectorAll(".score-row").length===1')
    await click(chart('revision'))
    await click('.scope [data-value="90"]')
    await check('revision dates do not overflow page '+w,noOverflow+' && document.querySelector(".revision-grid tr").cells.length===91')
    await check('recent dates are the starting horizontal position '+w,'(()=>{const x=document.querySelector(".matrix-window");return x.scrollLeft>0&&x.scrollWidth-x.scrollLeft-x.clientWidth<2})()')
    await ev(el('.matrix-window')+'.scrollLeft-=78')
    const x=await ev(el('.matrix-window')+'.scrollLeft')
    await click(chart('structure'));await click(chart('revision'))
    await check('revision scroll restored '+w,el('.matrix-window')+'.scrollLeft==='+x)
    await click('.scope [data-value="7"]')
    await check('actual zero, negative, and missing marker '+w,el(cell('2026-11-03'))+'.dataset.kind==="zero" && '+el(cell('2026-11-03'))+'.dataset.versions==="1" && '+el(cell('2026-11-04'))+'.dataset.kind==="loss" && '+el(cell('2026-11-05'))+'.dataset.kind==="missing"')
    if(w===380)await touch(cell('2026-11-03'));else await click(cell('2026-11-03'))
    const panel=w===1440?'.inspector-inline':'#inspector'
    await check('chapter detail reads saved facts '+w,el(panel+' .chapter-day-stat')+'.textContent.includes("0 字 · 有写入") && '+el(panel+' .chapter-day-stat')+'.textContent.includes("2 条保存 · 1 个版本") && !!'+el(panel+' .chapter-trend .plot-core'))
    if(w!==864)await snap('chapter-revision-detail-'+w)
    await key('Escape',27)
    await check('close returns to picked cell '+w,'document.activeElement.matches('+JSON.stringify(cell('2026-11-03'))+')')
    await key('ArrowRight',39);await key('Enter',13)
    await check('keyboard opens negative save '+w,el(panel+' .chapter-day-stat')+'.textContent.includes("−273 字")')
    await key('Escape',27)
    await key('ArrowRight',39);await key('Enter',13)
    await check('keyboard opens missing save '+w,el(panel+' .chapter-day-stat')+'.textContent.includes("无保存记录")')
    await key('Escape',27)
    await click('[data-act=collapse]');await click('#quick [data-act=full]')
    await check('resume the revision chart and picked date '+w,el(chart('revision'))+'.getAttribute("aria-pressed")==="true" && '+el(cell('2026-11-05'))+'.getAttribute("aria-pressed")==="true"')
    await click('[data-act=status][data-value=all]')
    await ev(el('#studio')+'.scrollTop=0')
    if(w===380)await check('four demo chapters fit on the phone first screen',el('.matrix-window')+'.getBoundingClientRect().bottom<=innerHeight')
    await snap('chapter-revision-'+w)
  }
  await go('index',1440)
  await ev('delete document.body.dataset.static')
  await click(quickOpen)
  await check('quick SVG bars enter from zero','document.querySelector("#quick").getAnimations({subtree:true}).some(a=>a.effect.target.hasAttribute("data-date-bar"))')
  await click('#quick [data-act=full]')
  await check('journey line draws','document.querySelector("#studio .plot-curve").getAnimations().length>0')
  await pause(500)
  await click('#studio .heat-cell[data-value="2026-11-04"]')
  await check('selecting date animates cursor and not bars','document.querySelector("#studio .plot-cursor").getAnimations().length>0 && ![...document.querySelectorAll("#studio [data-date-bar]")].some(e=>e.getAnimations().length)')
  await click('.analysis-bar [data-value=manuscript]')
  await check('chapter bars animate on first entry','[...document.querySelectorAll(".score-bar")].some(e=>e.getAnimations().length)')
  await click(chart('revision'));await click(chart('structure'));await click(chart('revision'))
  await check('rapid view switches land on current chart',el(chart('revision'))+'.getAttribute("aria-pressed")==="true" && !'+el('.score'))
  await click('.analysis-bar [data-value=outline]')
  await check('outline state segments animate','[...document.querySelectorAll(".module-grid .status-band i")].some(e=>e.getAnimations().length)')
  await click('.analysis-bar [data-value=lore]')
  await check('lore branch lengths animate','[...document.querySelectorAll(".rank .meter i")].some(e=>e.getAnimations().length)')
  await click('.analysis-bar [data-value=ideas]')
  await check('idea tag lengths animate','[...document.querySelectorAll(".rank .meter i")].some(e=>e.getAnimations().length)')
  await click('.analysis-bar [data-value=people]')
  const places=await ev('[...document.querySelectorAll(".network-node")].map(e=>e.style.left+"|"+e.style.top)')
  await click('.network-node')
  await check('relationships highlight actual linked edges without moving nodes','JSON.stringify([...document.querySelectorAll(".network-node")].map(e=>e.style.left+"|"+e.style.top))==='+JSON.stringify(JSON.stringify(places))+' && document.querySelector(".network-map [data-edge-state=active]").getAnimations().length>0')
  await click('.analysis-bar [data-value=overview]');await click('[data-act=mode][data-value=compare]')
  await check('both comparison series animate on the same axis','[...document.querySelectorAll(".compare-plots .plot-core")].every(e=>e.getAnimations({subtree:true}).some(a=>a.effect.target.hasAttribute("data-date-bar"))) && document.querySelectorAll(".compare-plots .plot-axis")[0].textContent===document.querySelectorAll(".compare-plots .plot-axis")[1].textContent')
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await click('.analysis-bar [data-value=manuscript]')
  await click(chart('structure'))
  await check('no chart movement under reduced motion','!document.querySelector("#studio").getAnimations({subtree:true}).length')
  await send('Emulation.setEmulatedMedia',{features:[]})
  if(process.argv.includes('--record')){
    await go('index',1440)
    await ev('delete document.body.dataset.static')
    const clip=join(profile,'chapter-clip')
    await mkdir(clip)
    const frames=[], writes=[], acks=[]
    let cursor=cdp.events.length
    function collect(){
      while(cursor<cdp.events.length){
        const event=cdp.events[cursor++]
        if(event.method!=='Page.screencastFrame'||event.sessionId!==sessionId)continue
        const {data,metadata,sessionId:frameId}=event.params
        const file='frame-'+String(frames.length).padStart(5,'0')+'.jpg'
        frames.push({file,time:metadata.timestamp})
        writes.push(writeFile(join(clip,file),Buffer.from(data,'base64')))
        acks.push(send('Page.screencastFrameAck',{sessionId:frameId}))
      }
    }
    const pump=setInterval(collect,14)
    await send('Page.startScreencast',{format:'jpeg',quality:83,maxWidth:1440,maxHeight:900,everyNthFrame:1})
    try{
      await pause(450)
      await mouse(quickOpen);await pause(1000)
      await mouse('#quick [data-act=full]');await pause(1250)
      await mouse('.heat-cell[data-value="2026-11-03"]');await pause(850)
      await mouse('.inspector-inline [data-act=chapter-link][data-value="f2-2"]');await pause(1050)
      await mouse(chart('structure'));await pause(1250)
      assert.equal(await ev(el(chart('structure'))+'.getAttribute("aria-pressed")'),'true','recorded chapter structure')
      await mouse(chart('revision'));await pause(700)
      await mouse('.scope [data-value="7"]');await pause(600)
      await mouse(cell('2026-11-04'));await pause(1000)
      await mouse('.inspector-inline .snapshot summary');await pause(1250)
      assert.ok(await ev(el('.inspector-inline .snapshot')+'.open'),'recorded expanded version')
    }finally{
      await send('Page.stopScreencast');clearInterval(pump);collect()
      await Promise.all([...writes,...acks])
    }
    assert.ok(frames.length>24,'recorded moving Chrome frames')
    const list=frames.map((frame,i)=>"file '"+frame.file+"'\nduration "+(Math.max(.015,(frames[i+1]?.time||frame.time+.65)-frame.time)).toFixed(5)).join('\n')+"\nfile '"+frames.at(-1).file+"'\n"
    await writeFile(join(clip,'frames.txt'),list)
    await new Promise((resolve,reject)=>{
      const ff=spawn('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i','frames.txt','-vf','fps=30,format=yuv420p','-c:v','libx264','-crf','22','-movflags','+faststart',join(outputs,'chapter-motion.mp4')],{cwd:clip,stdio:['ignore','ignore','inherit'],windowsHide:true})
      ff.on('error',reject);ff.on('exit',code=>code===0?resolve():reject(new Error('ffmpeg failed: '+code)))
    })
    console.log('Recorded '+frames.length+' rendered Chrome frames.')
  }
  const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)
  assert.deepEqual(errors,[])
  await writeFile(join(outputs,'checks.json'),JSON.stringify({assertions,coverage:checked,browserExceptions:errors},null,2)+'\n')
  console.log(assertions+' browser assertions passed; screenshots and report in '+outputs)
}finally{
  cdp?.close()
  if(!proc.killed)proc.kill()
  await pause(1200)
  if(dirname(profile)===temp&&basename(profile).startsWith('latent-writing-prototype-')){
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(e=>console.warn('Temporary browser profile:',e.code))
  }
}


