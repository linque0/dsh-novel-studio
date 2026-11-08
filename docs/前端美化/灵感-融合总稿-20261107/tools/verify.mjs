import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as pause} from 'node:timers/promises'
import {cdpClient} from '../../../../scripts/verify-app.mjs'
const home=fileURLToPath(new URL('../',import.meta.url)),out=join(home,'screenshots')
await mkdir(out,{recursive:true})
const temp=await realpath(tmpdir()),profile=await mkdtemp(join(temp,'latent-idea-fusion-'))
const proc=spawn(process.env.STUDIO_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-extensions','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true})
let c,passed=[]
try{
 const url=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('Chrome start timeout')),15000);proc.on('error',rej);proc.stderr.on('data',b=>{const m=b.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);res(m[1])}})})
 c=await cdpClient(url)
 const {targetId}=await c.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await c.send('Target.attachToTarget',{targetId,flatten:true})
 const send=(m,p)=>c.send(m,p,sessionId)
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
 const until=async code=>{for(let i=0;i<120;i++){if(await ev(code))return;await pause(35)}throw Error('Wait timeout: '+code)}
 const check=async(label,code)=>{const ok=await ev(code);if(!ok)console.log('diagnostic',await ev('({view:IdeaApp.state.ui.view,filter:IdeaApp.state.ui.filter,width:innerWidth,doc:document.documentElement.scrollWidth,workspace:document.querySelector("#workspace").scrollWidth})'));assert.ok(ok,label);passed.push(label)}
 const select=q=>'document.querySelector('+JSON.stringify(q)+')',click=q=>ev(select(q)+'.click()')
 const fill=(q,value)=>ev('(()=>{const e='+select(q)+';e.focus();e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
 const submit=q=>ev(select(q)+'.requestSubmit()')
 const key=async(key,code,n,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n,modifiers})}
 const point=async q=>ev('(()=>{const e='+select(q)+';e.scrollIntoView({block:"nearest",inline:"nearest"});const r=e.getBoundingClientRect();return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2}})()')
 const touch=async q=>{const p=await point(q);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
 const snap=async name=>{await ev('(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))})()');const r=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(out,name+'.png'),Buffer.from(r.data,'base64'))}
 const navigate=async()=>{const previous=await ev('performance.timeOrigin');await send('Page.navigate',{url:pathToFileURL(join(home,'index.html')).href});await until('performance.timeOrigin!=='+previous+'&&!!window.IdeaApp&&document.readyState==="complete"')}
 const reload=async()=>{const previous=await ev('performance.timeOrigin');await send('Page.reload');await until('performance.timeOrigin!=='+previous+'&&!!window.IdeaApp&&document.readyState==="complete"')}
 const go=async width=>{
  await send('Emulation.setDeviceMetricsOverride',{width,height:width===380?844:900,deviceScaleFactor:1,mobile:false});await send('Emulation.setTouchEmulationEnabled',{enabled:width===380,maxTouchPoints:1})
  await navigate();await ev('IdeaApp.reset()');await ev('document.fonts.ready.then(()=>true)')
 }
 const overflow='document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#workspace").scrollWidth<=innerWidth'
 await send('Page.enable');await send('Runtime.enable')
 for(const width of [1440,864,380]){
  await go(width)
  await check('handbook/B sidebar '+width,'IdeaApp.state.ui.view==="journal"&&document.querySelector("#sidebar h2").textContent==="雾港纪年"&&'+overflow)
  await snap('journal-'+width)
  await ev('document.querySelector("#view-host").scrollTop=236');await until('IdeaApp.state.ui.positions.journal[0]>200')
  const top=await ev('document.querySelector("#view-host").scrollTop')
  await click('#board-tab');await check('board, no lost untagged notes '+width,'!!document.querySelector(".board")&&!!document.querySelector(".board-column[data-group=未标记] .note")&&'+overflow)
  await snap('board-'+width)
  await ev('document.querySelector("#board-tab").focus()');await key('ArrowLeft','ArrowLeft',37)
  await check('native tab keyboard and journal scroll restore '+width,'IdeaApp.state.ui.view==="journal"&&Math.abs(document.querySelector("#view-host").scrollTop-'+top+')<2&&document.activeElement.id==="journal-tab"')
  await click('#board-tab')
  if(width===380)await touch('.note[data-id=i01] h3');else await click('.note[data-id=i01] h3')
  await check('details selection '+width,'IdeaApp.state.ui.selected==="i01"&&'+(width<1200?'document.querySelector("#detail").matches(":modal")':'!!document.querySelector("#inspector .inspect-body")'))
  await snap('detail-'+width)
  const prefix=width<1200?'#detail ':'#inspector '
  await click(prefix+'[data-act=edit]');await fill('#edit-body','改稿中的海潮。\n保持这一段输入。')
  if(width===1440){await click('#journal-tab');await click('#board-tab');await check('view switching retains the active unsaved edit','IdeaApp.state.ui.editing==="i01"&&document.querySelector("#edit-body").value.includes("保持这一段输入")')}
  if(width===380){
   await ev('window.__beforeEdit=document.querySelector("#edit-body");__beforeEdit.setSelectionRange(4,7)')
   await send('Emulation.setDeviceMetricsOverride',{width:380,height:600,deviceScaleFactor:1,mobile:false});await until('innerHeight===600')
   await check('mobile keyboard height preserves live editor and caret','document.querySelector("#edit-body")===__beforeEdit&&__beforeEdit.selectionStart===4&&__beforeEdit.selectionEnd===7')
   await send('Emulation.setDeviceMetricsOverride',{width:380,height:844,deviceScaleFactor:1,mobile:false});await until('innerHeight===844')
  }
  if(width<1200){await key('Escape','Escape',27);await check('detail Escape restores card focus '+width,'!document.querySelector("#detail").open&&document.activeElement.dataset.id==="i01"');await click('.note[data-id=i01] h3');await click('#detail [data-act=edit]')}
  await check('editing draft survives detail reopening '+width,'document.querySelector("#edit-body").value.includes("保持这一段输入")')
  await submit('[data-form=edit]');await check('saved body and original ID links '+width,'IdeaApp.state.notes.find(n=>n.id==="i01").body.includes("保持这一段输入")&&IdeaApp.state.notes.find(n=>n.id==="i01").links.length===2')
  if(width<1200)await key('Escape','Escape',27)
  if(width<950){await click('#directory-entry');await check('directory overlay '+width,'document.querySelector("#directory").matches(":modal")');await click('#directory [data-act=filter][data-value=untagged]')}
  else await click('#sidebar [data-act=filter][data-value=untagged]')
  await check('shared untagged filter '+width,'document.querySelector("#result-count").textContent==="2 条"&&IdeaApp.state.ui.group==="未标记"&&'+overflow)
 }
 await go(1440)
 await fill('#search','旧港钟楼');await check('search finds existing linked target by name','document.querySelector("#result-count").textContent==="1 条"')
 await click('[data-act=clear]');await click('#compose-entry');await fill('#compose-text','海上的门\n\n正文 <img src=x onerror=alert(1)>')
 await ev('document.querySelector("#compose-text").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))');await key('Enter','Enter',13,2)
 await check('Chinese composition prevents structural capture','IdeaApp.state.notes.length===12')
 await ev('document.querySelector("#compose-text").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))');await key('Enter','Enter',13,2)
 await until('IdeaApp.state.notes.length===13&&!document.querySelector("#action-dialog").open')
 await check('capture creates one record and safe literal text','IdeaApp.state.notes[0].title==="海上的门"&&!document.querySelector("#view-host img")&&document.querySelector("#view-host").textContent.includes("<img")')
 const created=await ev('IdeaApp.state.ui.selected')
 await click('.note[data-id="'+created+'"] [data-act=edit]');await submit('[data-form=edit]')
 await fill('#tag-input','潮汐');await submit('[data-form=tag]');await check('add tag updates sidebar counts','IdeaApp.state.notes[0].tags.includes("潮汐")&&document.querySelector("#sidebar").textContent.includes("潮汐")&&document.querySelectorAll("#sidebar [data-act=tag-filter]").length===7')
 await click('#sidebar [data-act=more-tags]');await check('full tag index expands','document.querySelectorAll("#sidebar [data-act=tag-filter]").length===11')
 await click('#inspector [data-act=convert][data-kind=正文]');await submit('[data-form=convert]')
 await check('conversion is inspectable and keeps original','IdeaApp.state.notes.length===13&&IdeaApp.state.targets.at(-1).name==="海上的门"&&document.querySelector(".preview-body").textContent.includes("正文 <img")&&!document.querySelector(".preview-body img")')
 await key('Escape','Escape',27);await click('#inspector [data-act=link]');await submit('[data-form=link]');await check('ID links add without replacing converted target','IdeaApp.state.notes[0].links.length===2')
 await ev('window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error("quota test")}')
 await click('#compose-entry');await fill('#compose-text','暂存的雾\n保存失败也不丢这段话。');await submit('[data-form=compose]')
 await check('write failure retains pending record','IdeaApp.pending&&IdeaApp.state.notes.length===14&&IdeaApp.state.notes[0].body.includes("不丢这段话")&&!document.querySelector("#save-error").hidden')
 await snap('save-retry-1440')
 await ev('Storage.prototype.setItem=window.__setItem');await click('[data-act=retry]');await check('retry saves once, no duplicated capture','!IdeaApp.pending&&JSON.parse(localStorage.getItem(IdeaApp.key)).notes.length===14')
 await reload();await check('reload reads saved data and scope','IdeaApp.state.notes.length===14&&document.querySelector("#view-host").textContent.includes("暂存的雾")')
 await click('#compose-entry');await fill('#compose-text','没有写完的信\n刷新后继续');await key('Escape','Escape',27);await ev('IdeaApp.save()');await reload();await click('#compose-entry')
 await check('unfinished capture survives close and refresh','document.querySelector("#compose-text").value.includes("刷新后继续")&&IdeaApp.state.notes.length===14');await key('Escape','Escape',27)
 await click('#board-tab');await click('.note[data-id=i04] [data-act=menu]');await click('[data-act=move-prev]')
 await check('keyboard-accessible order changes without altering creation date','IdeaApp.state.ui.sort==="manual"&&IdeaApp.state.order.indexOf("i04")<IdeaApp.state.order.indexOf("i01")&&IdeaApp.state.notes.find(n=>n.id==="i04").date==="2026-11-06"')
 await ev('(()=>{const h=document.querySelector(".note[data-id=i01] .drag-handle"),dt=new DataTransfer();h.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));const target=document.querySelector(".board-column[data-group=人物]");target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));})()')
 await check('cross-group drag asks before changing tags','document.querySelector("#dialog-title").textContent==="添加到 #人物"&&!IdeaApp.state.notes.find(n=>n.id==="i01").tags.includes("人物")')
 await click('[data-act=confirm-drop]');await check('cross-group adds tag and preserves source tag','IdeaApp.state.notes.find(n=>n.id==="i01").tags.includes("人物")&&IdeaApp.state.notes.find(n=>n.id==="i01").tags.includes("场景")')
 await click('.note[data-id=i10] [data-act=menu]');await click('#action-dialog [data-act=delete]');await check('delete preserves entity in trash','!!IdeaApp.state.notes.find(n=>n.id==="i10").deletedAt')
 await click('#toast [data-act=undo]');await check('undo restores the same ID','!IdeaApp.state.notes.find(n=>n.id==="i10").deletedAt')
 await click('.note[data-id=i10] [data-act=menu]');await click('#action-dialog [data-act=delete]');await click('#sidebar [data-act=filter][data-value=trash]');await click('.note[data-id=i10] h3');await click('#inspector [data-act=restore]')
 await check('trash restore returns to live collection','!IdeaApp.state.notes.find(n=>n.id==="i10").deletedAt&&document.querySelector(".empty-state").textContent.includes("空的")')
 await go(380);await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('#board-tab');await touch('.note[data-id=i01] h3')
 await check('reduced motion renders final mobile drawer','document.querySelector("#detail").open&&getComputedStyle(document.querySelector("#detail")).animationName==="none"&&'+overflow)
 const errors=c.events.filter(e=>e.sessionId===sessionId&&e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)
 assert.deepEqual(errors,[])
 await writeFile(join(out,'checks.json'),JSON.stringify({assertions:passed.length,passed,errors,isolated:true},null,2))
 console.log('PASS '+passed.length+' browser checks; desktop, tablet and phone screenshots saved.')
}finally{
 c?.close();proc.kill()
 const safe=profile.toLowerCase().startsWith(join(temp,'latent-idea-fusion-').toLowerCase())&&profile.length>temp.length+10
 if(safe)await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:300}).catch(()=>{})
}
