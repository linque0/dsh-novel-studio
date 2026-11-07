/* Real built plugin, temporary browser/profile and origin only. No running host is contacted. */
import assert from 'node:assert/strict'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as pause } from 'node:timers/promises'
import vm from 'node:vm'
process.env.NS_VERIFY_OUT='.tmp-writing-fusion-release/record-browser'
const {serve,launchChrome,cdpClient}=await import('./verify-app.mjs')
const output=resolve('docs/验收/写作分析-插件融合-20261107')
await mkdir(join(output,'screenshots'),{recursive:true})
await mkdir(process.env.NS_VERIFY_OUT,{recursive:true})
const sandbox={}
vm.runInNewContext(await readFile('docs/前端美化/写作分析-融合总稿-20261107/fixtures.js','utf8'),sandbox)
const demo=JSON.parse(JSON.stringify(sandbox.StudioDemo))
const server=await serve(),origin='http://127.0.0.1:'+server.address().port
const {proc,wsUrl}=await launchChrome(),c=await cdpClient(wsUrl)
const {targetId}=await c.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await c.send('Target.attachToTarget',{targetId,flatten:true})
const send=(m,p)=>c.send(m,p,sessionId),screens=[]
let assertions=0
const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const app=code=>evaluate('(async()=>{const f=document.querySelector("iframe"),win=f.contentWindow,doc=f.contentDocument,p=doc.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia;'+code+'})()')
const check=async(label,code)=>{assert.ok(await app(code),label);assertions++}
const until=async code=>{for(let i=0;i<200;i++){if(await app(code))return;await pause(40)}throw new Error('Wait: '+code)}
const click=selector=>app('doc.querySelector('+JSON.stringify(selector)+').click()')
const change=(selector,value)=>app('const e=doc.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new win.Event("change",{bubbles:true}));')
const shot=async name=>{await pause(380);const r=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(output,'screenshots',name+'.png'),Buffer.from(r.data,'base64'));screens.push(name)}
const mouse=async selector=>{const pt=await app('const e=doc.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {x:(Math.max(0,r.left)+Math.min(win.innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(win.innerHeight,r.bottom))/2}');for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...pt,button:'left',clickCount:1})}
const tap=async selector=>{const pt=await app('const e=doc.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center",inline:"center"});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,id:1}');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
async function size(width){
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
 await send('Emulation.setTouchEmulationEnabled',{enabled:width===380,maxTouchPoints:1})
 await send('Emulation.setScrollbarsHidden',{hidden:width===380})
 await app('f.style.width='+width+'+"px";f.style.height="900px";win.dispatchEvent(new win.Event("resize"));')
 await pause(100)
}
try{
 await send('Page.enable');await send('Runtime.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:origin+'/harness.html?module=shelf&vw=1440'})
 for(let i=0;i<300;i++){if(await evaluate('!!window.__NS_VERIFY_RESULT'))break;await pause(50)}
 await app('f.dataset.verifyReload="1";f.style.height="900px";')
 const rows={}
 const t=Date.now()
 rows.works=demo.works.map(w=>({id:w.id,title:w.title,genre:w.genre,createdAt:t,updatedAt:t,deletedAt:null}))
 rows.volumes=demo.volumes.map((v,i)=>({id:v.id,workId:v.work,title:v.title,sortOrder:i*1000,createdAt:t,updatedAt:t}))
 rows.chapters=demo.chapters.map((ch,i)=>({id:ch.id,workId:ch.work,volumeId:ch.volume,title:ch.title,fmt:'text',content:('正文里的潮声与来信。'.repeat(Math.ceil(ch.words/10))).slice(0,ch.words),wordCount:ch.words,status:ch.status,sortOrder:i*1000,createdAt:t,updatedAt:t,deletedAt:null}))
 rows.wordlog=demo.logs.map(r=>({id:r.id,workId:r.work,chapterId:r.chapter,date:r.date,delta:r.delta,createdAt:t}))
 rows.revisions=demo.versions.map(r=>({id:r.id,entityType:'chapter',entityId:r.chapter,fmt:'text',content:r.text,createdAt:new Date(r.date+'T12:00:00').getTime()}))
 rows.olnodes=demo.outline.flatMap(g=>[{id:g.id,workId:g.work,title:g.title,kind:'container',parentId:null},...g.events.map(e=>({id:e.id,workId:g.work,title:e.title,status:e.status,kind:'event',parentId:g.id}))])
 rows.mubu=demo.lore.flatMap(g=>[{id:g.id,workId:g.work,text:g.title,parentId:null},...g.nodes.map((title,i)=>({id:g.id+'-n'+i,workId:g.work,text:title,parentId:g.id,tags:['档案']}))])
 rows.characters=demo.people.map(p=>({id:p.id,workId:p.work,name:p.title,role:p.role,bio:p.text}))
 rows.relations=demo.relations.map((e,i)=>({id:'relation'+i,workId:e.work,fromId:e.from,toId:e.to,label:e.label}))
 rows.snippets=demo.snippets.map(r=>({id:r.id,workId:r.work,content:r.text,title:r.title,tags:r.tags,createdAt:new Date(r.date+'T12:00:00').getTime()}))
 await app('const rows='+JSON.stringify(rows)+';await new Promise((res,rej)=>{const request=win.indexedDB.open(win.__NS_AGENT__==="dsh"?"novel-studio@dsh":"novel-studio");request.onerror=()=>rej(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(Object.keys(rows),"readwrite");tx.oncomplete=()=>{db.close();res()};tx.onabort=()=>rej(tx.error);for(const [table,items] of Object.entries(rows)){const store=tx.objectStore(table);store.clear();for(const row of items)store.put(row)}}});')
 await app('await new Promise(resolve=>{f.addEventListener("load",resolve,{once:true});f.contentWindow.location.reload()});')
 await until('return !!doc.querySelector(".app-topbar")&&!!p._s.get("shelf")')
 await app('await p._s.get("work").open("fog",{chapterId:"f2-2"});p._s.get("ui").topbarAutoHide=false;')
 await until('return !![...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width)')
 for(const width of [1440,1280,864,760,380]){
  await size(width)
  await app('const e=[...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width&&!e.closest("[inert]"));e.click();')
  await until('return !!doc.querySelector(".writing-stats-quick[open] [data-stat=words]")')
  await check('quick modality '+width,'return doc.querySelector(".writing-stats-quick").matches(":modal")==='+String(width===380))
  await shot('quick-'+width)
  if(width===1440){
   await mouse('.rich-host .tiptap')
   await check('outside click reaches original editor and keeps its focus','return !doc.querySelector(".writing-stats-quick[open]")&&!!doc.activeElement.closest(".rich-host")')
   await app('[...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width&&!e.closest("[inert]")).click()')
   await until('return !!doc.querySelector(".writing-stats-quick[open] [data-stat=words]")')
  }
  await click('.writing-stats-quick .primary')
  await until('return !!doc.querySelector(".journey-grid")&&!doc.querySelector(".writing-stats-full .stats-state")')
  await shot('journey-'+width)
  await check('full width '+width,'const e=doc.querySelector(".writing-stats-full");return e.scrollWidth<=e.clientWidth+1')
  await click('#stats-tab-chapters');await until('return !!doc.querySelector(".score")')
  await shot('structure-'+width)
  await click('[data-chart=revision]');await click('.writing-stats-full [data-period="7"]')
  await until('return doc.querySelectorAll(".revision-grid thead th").length===8')
  await shot('revision-'+width)
  const selected=await app('return [...doc.querySelectorAll(".revision-cell")].find(e=>e.dataset.chapter===JSON.stringify(["fog","f2-2"])&&e.dataset.date==="2026-11-03")?.dataset.chapter')
  assert.ok(selected)
  await app('const e=[...doc.querySelectorAll(".revision-cell")].find(e=>e.dataset.chapter===JSON.stringify(["fog","f2-2"])&&e.dataset.date==="2026-11-03");e.id="release-selected-cell";')
  if(width===1440){
   await app('doc.querySelector("#release-selected-cell").focus()')
   for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
   await check('native keyboard moves in revision matrix','return doc.activeElement.dataset.date==="2026-11-04"&&doc.activeElement.classList.contains("revision-cell")')
  }
  if(width===380){
   await app('doc.addEventListener("pointerdown",e=>{if(e.target.closest(".revision-cell"))win.__revisionPointer=e.pointerType},{capture:true})')
   await tap('#release-selected-cell')
   await check('native touch selects revision cell','return win.__revisionPointer==="touch"')
  }else await click('#release-selected-cell')
  await until('return !!doc.querySelector(".writing-stats-inspector[open]")||!!doc.querySelector(".inspector-inline .chapter-day-stat")')
  await shot('revision-detail-'+width)
  await check('zero save details '+width,'const e=doc.querySelector(".writing-stats-inspector[open]")||doc.querySelector(".inspector-inline");return e.textContent.includes("有写入")&&e.textContent.includes("2 条保存")')
  await app('(doc.querySelector(".writing-stats-inspector[open]")||doc.querySelector(".inspector-inline")).querySelector(".close").click()')
  await click('.writing-stats-full .stats-close')
  await until('return !doc.querySelector(".writing-stats-dialog[open]")')
 }
 await size(1440)
 await app('await p._s.get("work").closeWork()')
 await app('[...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width&&!e.closest("[inert]")).click()')
 await until('return !!doc.querySelector(".writing-stats-quick[open] [data-stat=words]")')
 await shot('library-quick-1440');await click('.writing-stats-quick .primary')
 await until('return !!doc.querySelector(".compare-plots")')
 await shot('compare-1440')
 await check('common scale','const a=doc.querySelectorAll(".compare-plots .plot-axis");return a.length===2&&a[0].textContent===a[1].textContent')
 for(const [tab,name] of [['outline','outline'],['lore','lore'],['characters','characters'],['snippets','snippets']]){
  await click('#stats-tab-'+tab);await shot(name+'-1440')
 }
 await click('.writing-stats-full .stats-close')
 await app('await p._s.get("work").open("fog",{chapterId:"f2-2"})')
 const record=process.argv.includes('--record')
 if(record){
  await app('const original=win.Element.prototype.animate;win.__statsMotionCalls=[];win.Element.prototype.animate=function(...args){if(this.closest(".writing-stats-fusion"))win.__statsMotionCalls.push({classes:this.getAttribute("class")||"",bar:this.hasAttribute("data-date-bar")});return original.apply(this,args)}')
  const frameDir=resolve(process.env.NS_VERIFY_OUT,'frames');await mkdir(frameDir,{recursive:true})
  let at=c.events.length
  const frames=[],writes=[],acks=[]
  function collect(){while(at<c.events.length){const e=c.events[at++];if(e.method!=='Page.screencastFrame'||e.sessionId!==sessionId)continue;const f='frame-'+String(frames.length).padStart(5,'0')+'.jpg';frames.push({file:f,time:e.params.metadata.timestamp});writes.push(writeFile(join(frameDir,f),Buffer.from(e.params.data,'base64')));acks.push(send('Page.screencastFrameAck',{sessionId:e.params.sessionId}))}}
  const pump=setInterval(collect,14)
  await send('Page.startScreencast',{format:'jpeg',quality:83,everyNthFrame:1,maxWidth:1440,maxHeight:900})
  try{
   await pause(500)
   const entry=await app('const e=[...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width&&!e.closest("[inert]"));e.id="release-stats-entry";return e.id')
   await mouse('#'+entry);await pause(800)
   await mouse('.writing-stats-quick .primary');await pause(1000)
   await mouse('.heat-cell[data-date="2026-11-03"]');await pause(550)
   await mouse('.inspector-inline button.detail-row');await pause(1000)
   await mouse('[data-chart=structure]');await pause(850)
   await mouse('[data-chart=revision]');await pause(800)
   await mouse('.writing-stats-full [data-period="7"]');await pause(700)
   await app('const e=[...doc.querySelectorAll(".revision-cell")].find(e=>e.dataset.chapter===JSON.stringify(["fog","f2-2"])&&e.dataset.date==="2026-11-03");e.id="release-cell";')
   await mouse('#release-cell');await pause(1000)
   await mouse('.inspector-inline .snapshot summary');await pause(1200)
   await mouse('[data-chart=structure]');await pause(1100)
  }finally{await send('Page.stopScreencast');clearInterval(pump);collect();await Promise.all([...writes,...acks])}
  assert.ok(frames.length>20)
  await check('real rendered charts invoke bars, curve, selection pulse and moving view indicator','const a=win.__statsMotionCalls;return a.some(e=>e.bar)&&a.some(e=>e.classes.includes("plot-curve"))&&a.some(e=>e.classes.includes("revision-cell"))&&a.some(e=>e.classes.includes("motion-tab-indicator"))')
  await writeFile(join(frameDir,'frames.txt'),frames.map((f,i)=>"file '"+f.file+"'\nduration "+Math.max(.016,(frames[i+1]?.time||f.time+.7)-f.time).toFixed(5)).join('\n')+"\nfile '"+frames.at(-1).file+"'\n")
  await new Promise((res,rej)=>{const ff=spawn('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i','frames.txt','-vf','fps=30,format=yuv420p','-c:v','libx264','-crf','22','-movflags','+faststart',join(output,'writing-analysis-plugin.mp4')],{cwd:frameDir,windowsHide:true,stdio:['ignore','ignore','inherit']});ff.on('error',rej);ff.on('exit',code=>code?rej(new Error('ffmpeg '+code)):res())})
 }
 await click('.writing-stats-full .stats-close')
 await app('p._s.get("ui").topbarAutoHide=true')
 await until('return !!doc.querySelector(".wb-topbar-edge")')
 await app('doc.querySelector(".wb-topbar-edge").focus()')
 await until('return !!doc.querySelector(".wb-topbar-host.is-expanded .writing-stats-entry")')
 await app('[...doc.querySelectorAll(".writing-stats-entry")].find(e=>e.getBoundingClientRect().width&&!e.closest("[inert]")).id="release-auto-entry"')
 await mouse('#release-auto-entry')
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:700,y:500})
 await until('return !doc.querySelector(".wb-topbar-host.is-expanded")')
 await check('quick remains accessible when toolbar auto hides','const e=doc.querySelector(".writing-stats-quick[open]"),r=e?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=win.innerHeight')
 for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await until('return !doc.querySelector(".writing-stats-quick[open]")')
 await check('escape returns focus to toolbar reveal control','return doc.activeElement.classList.contains("wb-topbar-edge")||doc.activeElement.id==="release-auto-entry"')
 const errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown'&&e.sessionId===sessionId).map(e=>e.params.exceptionDetails.text)
 assert.deepEqual(errors,[])
 await writeFile(join(output,'release-checks.json'),JSON.stringify({assertions,screenshots:screens,errors,isolated:true},null,2))
 console.log('PASS release screenshots '+screens.length+', checks '+assertions)
}finally{c.close();proc.kill();server.close()}

