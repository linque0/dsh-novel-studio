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
const files=['a-journey','b-manuscript','c-atlas']
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
  const visible=sel=>[...document.querySelectorAll(sel)].filter(x=>x.getClientRects().length)
  const noscroll='document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth'
  await send('Page.enable');await send('Runtime.enable')
  for(const w of [1440,864,380]){
    for(const f of files){
      await go(f,w)
      await check(f+' overview width '+w,noscroll)
      await check('correct heading', 'document.querySelector(".tabs button[aria-pressed=true]").textContent==="总览"')
      await snap(f+'-'+w)
      for(const tab of tabs.slice(1)){
        await click('.tabs [data-value="'+tab+'"]')
        await check(f+' '+tab+' width '+w,noscroll)
        const action=entity[tab]
        await ev('('+visible.toString()+')("main [data-act='+action+']")[0].click()')
        await check('detail for '+tab,w<1050?'document.querySelector("#inspector").open && !!document.querySelector("#inspector-title")':'!!document.querySelector(".inspector-inline .close")')
        if(w<1050)await key('Escape',27)
        else await click('.inspector-inline .close')
        await check('closed detail for '+tab,'!document.querySelector("#inspector").open && !document.querySelector(".inspector-inline .close")')
      }
      await click('.tabs [data-value="overview"]')
      await click('[data-act=quick]')
      await check('quick dialog and chart','document.querySelector("#quick").open && !!document.querySelector("#quick .plot-core")')
      if(w===1440||w===380)await snap(f+'-quick-'+w)
      await change('#quick select','north')
      await check('shared scope', 'document.querySelector(".scope select").value==="north"')
      await click('#quick [data-act=full]')
      await check('full view and focus','!document.querySelector("#quick").open && document.activeElement.id==="page-title"')
      await go(f,w,'&scene=detail')
      await check('deep detail width',noscroll)
      if(w===1440||w===380)await snap(f+'-detail-'+w)
      if(w===380){
        await key('Escape',27)
        await check('mobile Escape','!document.querySelector("#inspector").open')
      }
      await go(f,w,'&scene=empty')
      await check('empty width',noscroll)
      await check('missing history rendered',f.startsWith('b')?'document.body.textContent.includes("没有符合条件的章节")':'document.body.textContent.includes("暂无写作记录")')
      checked.push({variant:f,width:w,views:6})
    }
  }
  await go(files[0])
  await ev('delete document.body.dataset.static')
  await check('ambient animation available','getComputedStyle(document.body,"::after").animationName==="veil"')
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await check('reduced motion disables ambient animation','getComputedStyle(document.body,"::after").animationName==="none"')
  await send('Emulation.setEmulatedMedia',{features:[]})
  await ev('document.body.dataset.static=""')
  await check('text and chart accents on tinted glass clear the contrast check', `(()=>{
    const vars=getComputedStyle(document.documentElement)
    const light=hex=>{const [r,g,b]=hex.match(/\\w{2}/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b}
    return ['--text','--muted','--quiet','--mint','--rose','--lav'].every(t=>(light(vars.getPropertyValue(t).trim())+.05)/(light('#46384f')+.05)>=4.5)
  })()`)
  const {x,y,w}=await ev('(()=>{const r=document.querySelector("[data-plot=brush]").getBoundingClientRect();return {x:r.left,y:r.top+r.height*.7,w:r.width}})()')
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x+w*.61,y,button:'left',buttons:1,clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+w*.93,y,button:'left',buttons:1})
  await check('brush drawn','!document.querySelector(".brush-mark").hidden')
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+w*.93,y,button:'left',buttons:0,clickCount:1})
  await check('brush filters chart and calendar','document.querySelectorAll(".heat-cell").length===10 && document.querySelectorAll(".plot-hits button").length===10')
  await click('[data-act=clear-range]')
  await ev('(()=>{const f=document.querySelector(".range-form");f.elements.from.value="2026-11-03";f.elements.to.value="2026-11-07";f.requestSubmit()})()')
  await check('date form filters','document.querySelectorAll(".heat-cell").length===5')
  await click('.heat-cell[data-value="2026-11-03"]')
  await check('net zero with logs','document.querySelector(".inspector-inline").textContent.includes("有写入 · 当日净增为零")')
  await click('.heat-cell[data-value="2026-11-05"]')
  await check('missing has no invented save','document.querySelector(".inspector-inline").textContent.includes("暂无写作记录")')
  await ev('document.querySelector(".plot-hits [data-value=\\\"2026-11-05\\\"]").focus()')
  await key('ArrowLeft',37);await key('Enter',13)
  await check('chart keyboard negative result','document.querySelector(".inspector-inline .detail-stat b").textContent==="−273"')
  await click('[data-act=quick]');await key('Escape',27)
  await check('quick returns focus','document.activeElement.dataset.act==="quick"')
  await go(files[0],380)
  const dayTouch=await ev('(()=>{const b=document.querySelector(".heat-cell[data-value=\\"2026-11-03\\"]");b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dayTouch]})
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await pause(80)
  await check('calendar day works with touch','document.querySelector("#inspector").open && document.querySelector("#inspector-title").textContent==="2026.11.03"')
  await key('Escape',27)
  await check('calendar returns focus to selected date','document.activeElement.matches(".heat-cell[data-value=\\"2026-11-03\\"]")')

  await go(files[1])
  await click('.volume-rail [data-value=f2]');await click('[data-act=status][data-value=revise]')
  await check('volume and status intersect','document.querySelectorAll(".chapter-row").length===1 && document.querySelector(".chapter-row").dataset.value==="f2-2"')
  await click('.chapter-row');await click('.snapshot summary')
  await check('chapter versions open','document.querySelector(".snapshot").open')
  await click('.inspector-inline .close')
  await check('chapter filter persists','document.querySelectorAll(".chapter-row").length===1 && document.activeElement.dataset.value==="f2-2"')
  await go(files[1],380)
  const touch=await ev('(()=>{const b=document.querySelector(".chapter-row");b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]})
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await pause(80)
  await check('mobile touch opens chapter','document.querySelector("#inspector").open')
  const scroll=await ev('scrollY')
  await key('Escape',27)
  await check('mobile close restores focus and scroll','document.activeElement.matches(".chapter-row") && scrollY==='+scroll)

  await go(files[2])
  await click('[data-act=period][data-value="90"]');await change('[data-act=pair2]','north')
  await check('shared comparison scale','[...document.querySelectorAll(".compare-plots .plot-axis")].length===2 && document.querySelectorAll(".compare-plots .plot-axis")[0].textContent===document.querySelectorAll(".compare-plots .plot-axis")[1].textContent')
  await click('.book-tile[data-value=north]')
  await check('deep work scope','document.querySelector(".work-hero h2").textContent==="北纬档案"')
  await snap('c-atlas-work-1440')
  await click('[data-act=back]')
  await check('return retains both selections','document.querySelector("[data-act=pair2]").value==="north" && document.querySelector("[data-act=period][aria-pressed=true]").dataset.value==="90"')
  await change('[data-act=work]','all')
  await change('[data-act=pair1]','north')
  await check('comparison keeps two unique works','document.querySelector("[data-act=pair2]").value==="fog"')
  await click('.tabs [data-value=people]')
  await check('relationship diagram only draws real relationships','document.querySelectorAll(".network-map line").length===StudioDemo.relations.length')
  await snap('c-atlas-people-1440')

  await go('index')
  await snap('comparison-1440')
  await click('[data-focus=c]');await click('[data-width="380"]')
  await check('comparison single phone mode','document.querySelector(".gallery").dataset.focus==="c" && document.querySelector("[data-id=c] iframe").style.width==="380px"')
  await click('[data-detail=c]')
  await check('comparison link opens detail','document.querySelector("[data-id=c] iframe").src.includes("scene=detail")')
  await go('index',380)
  await check('comparison phone layout',noscroll)
  await snap('comparison-380')
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

