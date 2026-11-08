/* Built plugin only. Random origin + disposable Chrome; never accesses a running host. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createServer} from 'node:http'
import {resolve,join,extname} from 'node:path'
import {setTimeout as pause} from 'node:timers/promises'
import {spawn} from 'node:child_process'
import vm from 'node:vm'
process.env.NS_VERIFY_OUT='.tmp-snippets-alignment-20261108/browser'
const {HARNESS,launchChrome,cdpClient}=await import('./verify-app.mjs')
const output=resolve('docs/验收/灵感-插件完善-20261108'),tmp=resolve(process.env.NS_VERIFY_OUT)
await mkdir(join(output,'screenshots'),{recursive:true});await mkdir(tmp,{recursive:true})
const sandbox={};vm.runInNewContext(await readFile('docs/前端美化/灵感-融合总稿-20261107/fixtures.js','utf8'),sandbox)
const demo=JSON.parse(JSON.stringify(sandbox.IdeaSeed)),checks=[],metrics=[],screens=[]
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'}
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local'),path=decodeURIComponent(u.pathname)
 if(path==='/harness.html'){res.setHeader('content-type','text/html;charset=utf-8');res.end(HARNESS);return}
 let root,rel
 if(path.startsWith('/api/novelstudio/app/')){root=resolve(req.headers.cookie?.includes('baseline=1')?'.tmp-snippets-alignment-20261108/before-app':'assets/app');rel=path.slice('/api/novelstudio/app/'.length)}
 else {root=resolve('docs/前端美化/灵感-融合总稿-20261107');rel=path.replace(/^\/prototype\//,'')}
 const file=resolve(root,rel);if(!file.startsWith(root+'\\')&&!file.startsWith(root+'/'))throw Error('path')
 res.setHeader('content-type',(MIME[extname(file)]||'application/octet-stream')+';charset=utf-8');res.end(await readFile(file))
 }catch{res.statusCode=404;res.end('Not found')}})
await new Promise(res=>server.listen(0,'127.0.0.1',res));const origin='http://127.0.0.1:'+server.address().port
const {proc,wsUrl}=await launchChrome(),c=await cdpClient(wsUrl)
const {targetId}=await c.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await c.send('Target.attachToTarget',{targetId,flatten:true})
const send=(m,p)=>c.send(m,p,sessionId)
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const app=code=>evaluate('(async()=>{const f=document.querySelector("iframe"),win=f.contentWindow,doc=f.contentDocument,p=doc.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia,w=p?._s.get("work"),ui=p?._s.get("ui");'+code+'})()')
async function until(code){for(let i=0;i<200;i++){if(await app(code))return;await pause(40)}throw Error('Wait: '+code+'\n'+await app('return doc.querySelector(".snip-toast")?.textContent'))}
async function check(name,code){const value=await app(code);assert.ok(value,name+' :: '+JSON.stringify(value));checks.push(name);console.log('✓ '+name)}
const click=selector=>app('doc.querySelector('+JSON.stringify(selector)+').click()')
const button=text=>app('const e=[...doc.querySelectorAll(".snip-inspector button,[data-dialog=action] button,.snip-save-error button")].find(e=>e.textContent.trim()==='+JSON.stringify(text)+');if(!e)throw Error("Missing button: '+text+'");e.click()')
const input=(selector,value)=>app('const e=doc.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new win.Event("input",{bubbles:true}));')
const key=async(key,code,vk,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,modifiers})}
const close=async()=>{while(await app('return !!doc.querySelector("dialog.snip-native[open]")')){await key('Escape','Escape',27);await pause(80)}}
const shot=async name=>{await pause(260);const r=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(output,'screenshots',name+'.png'),Buffer.from(r.data,'base64'));screens.push(name)}
const point=selector=>app('const e=doc.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}')
const mouse=async selector=>{const pt=await point(selector);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...pt,button:'left',clickCount:1})}
const tap=async selector=>{const pt=await point(selector);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pt,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
async function drag(source,target){
 // Start at the source before scrolling the target into view. Otherwise the second
 // scroll can invalidate the source coordinates and turn the test into an empty drag.
 const a=await point(source)
 await app('win.__snipDragStarted=false;doc.addEventListener("dragstart",()=>win.__snipDragStarted=true,{once:true,capture:true})')
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...a})
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1})
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x-10,y:a.y-10,button:'left',buttons:1});await until('return win.__snipDragStarted')
 const b=await point(target)
 for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,button:'left',buttons:1});await pause(30)}
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1})
}
async function size(width,height=900){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await send('Emulation.setTouchEmulationEnabled',{enabled:width===380,maxTouchPoints:1});await app('f.style.width='+width+'+"px";f.style.height='+height+'+"px";win.dispatchEvent(new win.Event("resize"));');await pause(80)}
const dbRead=table=>app('return await new Promise((res,rej)=>{const r=win.indexedDB.open(win.__ns.db.name);r.onsuccess=()=>{const db=r.result,tx=db.transaction('+JSON.stringify(table)+',"readonly"),q=tx.objectStore('+JSON.stringify(table)+').getAll();q.onsuccess=()=>{res(q.result);db.close()};tx.onerror=()=>rej(tx.error)}})')
const dbPut=(table,row)=>app('return await new Promise((res,rej)=>{const r=win.indexedDB.open(win.__ns.db.name);r.onsuccess=()=>{const db=r.result,tx=db.transaction('+JSON.stringify(table)+',"readwrite");tx.objectStore('+JSON.stringify(table)+').put('+JSON.stringify(row)+');tx.oncomplete=()=>{res(true);db.close()};tx.onabort=()=>rej(tx.error)}})')
async function seed(){
 const t=Date.now(),kind={正文:'chapter',设定:'mubu',人物:'character'}
 const rows={works:[{id:'w1',title:demo.work,createdAt:t,updatedAt:t,deletedAt:null},{id:'w2',title:'第二部作品',createdAt:t,updatedAt:t,deletedAt:null}],snippets:demo.notes.map(n=>({id:n.id,workId:'w1',content:n.title+'\n\n'+n.body,tags:n.tags,links:n.links.map(l=>({kind:kind[l.kind],id:l.id})),createdAt:new Date(n.date+'T'+n.time).getTime(),updatedAt:new Date(n.date+'T'+n.time).getTime(),deletedAt:null})),chapters:demo.targets.filter(n=>n.kind==='正文').map(n=>({id:n.id,workId:'w1',title:n.name,content:n.body,wordCount:n.body.length,sortOrder:0,deletedAt:null,createdAt:t,updatedAt:t})),mubu:demo.targets.filter(n=>n.kind==='设定').map(n=>({id:n.id,workId:'w1',parentId:null,text:n.name,sortOrder:0,createdAt:t,updatedAt:t,deletedAt:null})),characters:demo.targets.filter(n=>n.kind==='人物').map(n=>({id:n.id,workId:'w1',name:n.name,bio:n.body,createdAt:t,updatedAt:t})),appconfig:[],outlines:[],wordlog:[]}
 await app('f.dataset.verifyReload="1";')
 await app('const rows='+JSON.stringify(rows)+';await new Promise((res,rej)=>{const r=win.indexedDB.open(win.__ns.db.name);r.onsuccess=()=>{const db=r.result,tx=db.transaction(Object.keys(rows),"readwrite");for(const [table,list] of Object.entries(rows)){const s=tx.objectStore(table);s.clear();for(const row of list)s.put(row)}tx.oncomplete=()=>{db.close();res()};tx.onabort=()=>rej(tx.error)}});await new Promise(res=>{f.addEventListener("load",res,{once:true});win.location.reload()});')
 await until('return !!p?._s.get("work")&&!!p?._s.get("ui")')
 await app('await w.open("w1");w.tab="snippets";w.selSnippetId="i01";ui.topbarAutoHide=false;')
 await until('return !!doc.querySelector(".snip-note[data-id=i01]")&&ui.snipStateWorkId==="w1"')
}
async function boot(baseline=false){
 await send('Network.setCookie',{name:'baseline',value:baseline?'1':'0',url:origin,path:'/'})
 await send('Page.navigate',{url:origin+'/harness.html?module=shelf&vw=1440'})
 for(let i=0;i<300;i++){if(await evaluate('!!window.__NS_VERIFY_RESULT'))break;await pause(50)}
 console.log("Harness ready",baseline);await seed();console.log("Seed ready",baseline)
}
async function sidebarMetrics(label,width){
 await app('await Promise.allSettled(doc.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished))')
 const value=await app('const q=s=>doc.querySelector(".snip-directory-dialog")?.querySelector(s)||doc.querySelector(s),r=e=>{const x=e.getBoundingClientRect();return {x:x.x,y:x.y,w:x.width,h:x.height,bottom:x.bottom}},nav=q(".snip-nav"),title=q(".snip-nav h2"),rows=[...nav.querySelectorAll(".snip-nav-row")],a=rows[0],b=rows[1],cs=win.getComputedStyle(a),count=a.querySelector("b"),tags=q(".snip-tag-list");return {width:win.innerWidth,nav:r(nav),title:r(title),titleSize:win.getComputedStyle(title).fontSize,row:r(a),gap:r(b).y-r(a).bottom,padding:cs.padding,groupSize:win.getComputedStyle(q(".snip-nav-title-line > span")).fontSize,selected:[win.getComputedStyle(a).color,win.getComputedStyle(count).color],trash:r(q(".snip-nav-row[data-value=trash]")),tags:tags?{client:tags.clientHeight,scroll:tags.scrollHeight}:null,order:rows.filter(e=>e.dataset.tag).map(e=>e.dataset.tag)}')
 metrics.push({label,...value});if(label!=='after')return
 const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.01,actual+' ≈ '+expected)
 near(value.row.h,37);near(value.gap,3);assert.equal(value.padding,'8px 10px');assert.equal(value.groupSize,'11px');near(value.title.h,32);assert.equal(value.selected[0],value.selected[1]);assert.ok(value.trash.bottom<=900);assert.ok(!value.tags||value.tags.scroll<=value.tags.client+1)
 if(width>=950)near(value.nav.w,width<1200?170:174)
 else near(await app('return doc.querySelector(".snip-directory-dialog").getBoundingClientRect().width'),255)
 checks.push('sidebar exact metrics '+width)
}
try{
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 if(existsSync('.tmp-snippets-alignment-20261108/before-app/index.html')){
  await boot(true)
  for(const width of [1440,1280,864,760,380]){await size(width);if(width<950)await click('.snip-mobile-menu');await sidebarMetrics('before',width);await shot('before-sidebar-'+width);if(width<950)await click('.snip-drawer-head .snip-round')}
  await size(1440)
 }
 await boot(false)
 for(const width of [1440,1280,864,760,380]){
  await size(width);await shot('journal-'+width)
  await check('no page overflow '+width,'return doc.documentElement.scrollWidth<=win.innerWidth')
  await check('directory breakpoint '+width,'const e=doc.querySelector(".snip-mobile-menu");return (!!e&&!!e.getClientRects().length)==='+String(width<950))
  if(width<950){await mouse('.snip-mobile-menu');await until('return !!doc.querySelector(".snip-directory-dialog")')}
  await sidebarMetrics('after',width);await shot('after-sidebar-'+width)
  if(width<950){
   await key('Tab','Tab',9,1)
   await check('native directory focus trap '+width,'return !!doc.activeElement.closest("dialog.snip-native")')
   await key('Escape','Escape',27);await until('return !doc.querySelector(".snip-directory-dialog")')
   await check('directory Escape returns focus '+width,'return doc.activeElement.classList.contains("snip-mobile-menu")')
  }
  await click('.snip-view-switch button:last-child');await until('return !!doc.querySelector(".snip-board")');await shot('board-'+width)
  await check('all tags get independent lanes '+width,'return doc.querySelectorAll(".snip-lane").length===11')
  await app('doc.querySelector(".snip-note[data-id=i01]").id="release-card"')
  if(width===380){await tap('#release-card')}else await mouse('#release-card')
  await until('return !!doc.querySelector(".snip-inspector .snip-detail-copy")');await shot('detail-'+width)
  if(width<1200){
   await check('native details modal '+width,'return doc.querySelector("dialog.snip-native").matches(":modal")')
   if(width===380){
    await check('read-only details do not open the keyboard','return !/^(INPUT|TEXTAREA)$/.test(doc.activeElement.tagName)')
    await check('phone bottom sheet','const r=doc.querySelector(".snip-detail-dialog").getBoundingClientRect();return Math.abs(r.bottom-win.innerHeight)<2')
    await button('编辑片段');await input('.snip-edit-form [name=body]','软键盘高度变化时保留输入')
    await app('const e=doc.querySelector(".snip-edit-form [name=body]");e.focus();e.setSelectionRange(3,6)');await size(380,560)
    await check('keyboard height change preserves draft, focus and caret','return doc.activeElement.name==="body"&&doc.activeElement.value==="软键盘高度变化时保留输入"&&doc.activeElement.selectionStart===3&&doc.activeElement.selectionEnd===6')
    await size(380);await app('ui.setSnipDraft("i01",null)')
   }
   await key('Escape','Escape',27);await until('return !doc.querySelector(".snip-detail-dialog")')
   await check('detail Escape returns focus '+width,'return doc.activeElement.dataset.id==="i01"')
  }
  await click('.snip-view-switch button:first-of-type');await until('return !!doc.querySelector(".snippet-surface")')
 }
 await size(1440)
 // Stress the independent tag scroller, long names, stable first appearance, and >100 tags.
 await app('w.work.title="雾港纪年与漫长来信之后仍未写完的最后一个夜晚";w.snippets.push({id:"stress",workId:"w1",content:"长标签与计数检查",tags:Array.from({length:110},(_,i)=>"长标签"+i+"·潮声与来信"),links:[],createdAt:1});ui.saveSnipState({moreTags:true});')
 await until('return doc.querySelectorAll(".snip-nav [data-tag]").length===120')
 await check('all tags accessible, only tags scroll','const nav=doc.querySelector(".snip-nav"),t=nav.querySelector(".snip-tag-list"),h=nav.querySelector("h2");return t.scrollHeight>t.clientHeight&&nav.scrollWidth<=nav.clientWidth&&h.title===w.work.title&&h.getBoundingClientRect().height===32&&nav.querySelector("[data-value=trash]").getBoundingClientRect().bottom<=win.innerHeight')
 await shot('long-tags-1440')
 await app('w.work.title="雾港纪年";w.snippets=w.snippets.filter(n=>n.id!=="stress");ui.saveSnipState({moreTags:false});')
 // Edit/draft restore and native save shortcut including IME protection.
 await mouse('.snip-note[data-id=i01]');await button('编辑片段')
 await input('.snip-edit-form [name=body]','未提交的潮声。\n\n[[chapter:正文-迟到的钟声]]')
 await app('doc.querySelector(".snip-edit-form [name=body]").focus();doc.activeElement.dispatchEvent(new win.CompositionEvent("compositionstart",{bubbles:true}));')
 await key('s','KeyS',83,2)
 await check('IME does not save structure or draft','return !!ui.snipDrafts.edit.i01&&w.snippets.find(n=>n.id==="i01").content.includes("港口的人")')
 await app('doc.activeElement.dispatchEvent(new win.CompositionEvent("compositionend",{bubbles:true}));')
 await click('.snip-view-switch button:last-child');await until('return !!doc.querySelector(".snip-board .snip-lanes")')
 await check('view switch keeps selected draft','return w.selSnippetId==="i01"&&doc.querySelector(".snip-edit-form [name=body]").value.includes("未提交的潮声")')
 await app('const e=doc.querySelector(".snip-lanes");e.scrollLeft=300;e.dispatchEvent(new win.Event("scroll"));await ui.flushSnipPersistence();')
 await click('.snip-view-switch button:first-of-type');await click('.snip-view-switch button:last-child')
 await check('board horizontal scroll restored','return doc.querySelector(".snip-lanes").scrollLeft>=299')
 await app('await ui.flushSnipPersistence();f.dataset.verifyReload="1";await new Promise(res=>{f.addEventListener("load",res,{once:true});win.location.reload()});')
 await until('return !!p?._s.get("work")')
 await app('await w.open("w1");w.tab="snippets";w.selSnippetId="i01";ui.topbarAutoHide=false;')
 await until('return !!doc.querySelector(".snip-edit-form [name=body]")')
 await check('draft survives reload','return doc.querySelector(".snip-edit-form [name=body]").value.includes("未提交的潮声")')
 await app('doc.querySelector(".snip-edit-form [name=body]").focus()');await key('s','KeyS',83,2)
 await until('return !ui.snipDrafts.edit.i01');assert.ok((await dbRead('snippets')).find(n=>n.id==='i01').content.includes('未提交的潮声'));checks.push('native Ctrl S saves input to DB')
 // One transaction for target, outline, source link and wordlog; forced failure on the last write.
 await button('转为章节');await until('return !!doc.querySelector("[data-dialog=action] select")');const before=Object.fromEntries(await Promise.all(['chapters','outlines','snippets','wordlog'].map(async t=>[t,await dbRead(t)])))
 await app('win.__snipFail=()=>{throw new win.DOMException("验收注入：保存失败","QuotaExceededError")};win.__ns.db.snippets.hook("updating",win.__snipFail)')
 await app('doc.querySelector("[data-dialog=action] form").requestSubmit()')
 await until('return !!doc.querySelector(".snip-save-error")')
 for(const t of ['chapters','outlines','snippets','wordlog'])assert.deepEqual(await dbRead(t),before[t],t+' rollback')
 checks.push('conversion rollback includes chapter/outline/source/wordlog')
 await check('failed conversion retains dialog and source','return !!doc.querySelector("[data-dialog=action] form")&&w.snippets.find(n=>n.id==="i01").content.includes("未提交的潮声")')
 await app('win.__ns.db.snippets.hook("updating").unsubscribe(win.__snipFail)')
 await mouse('dialog[open] .snip-save-error button');await until('return !!doc.querySelector(".snip-preview-body")')
 const after=await dbRead('chapters'),target=after.find(n=>!before.chapters.some(b=>b.id===n.id))
 assert.ok(target);assert.equal(after.length,before.chapters.length+1);assert.equal(target.title,demo.notes[0].title);assert.equal(target.content,'未提交的潮声。\n\n[[chapter:正文-迟到的钟声]]');assert.ok((await dbRead('snippets')).find(n=>n.id==='i01').links.some(l=>l.id===target.id));assert.ok((await dbRead('wordlog')).some(l=>l.chapterId===target.id&&l.delta===target.wordCount));checks.push('retry creates one target and traceable wordlog')
 await close();await click('[aria-label=撤销]');await until('return w.chapters.find(n=>n.id==='+JSON.stringify(target.id)+')?.deletedAt')
 await click('[aria-label=重做]');await until('return w.chapters.find(n=>n.id==='+JSON.stringify(target.id)+')?.deletedAt===null')
 checks.push('conversion undo/redo preserves IDs and body')
 // Persist an external change then refuse to overwrite the preserved draft.
 await button('编辑片段');await input('.snip-edit-form [name=body]','发生冲突时保留的草稿')
 // Legacy drafts contain title/body only. Their first save must still compare the displayed source.
 await app('const d=ui.snipDrafts.edit.i01;ui.setSnipDraft("i01",{title:d.title,body:d.body})')
 const source=(await dbRead('snippets')).find(n=>n.id==='i01');await dbPut('snippets',{...source,content:'外部修改\n\n必须保留'})
 await app('doc.querySelector(".snip-edit-form").requestSubmit()');await until('return doc.querySelector(".snip-toast")?.textContent.includes("原片段已变化")')
 await check('conflict preserves draft and refreshes source','return ui.snipDrafts.edit.i01.body==="发生冲突时保留的草稿"&&w.snippets.find(n=>n.id==="i01").content.includes("外部修改")')
 assert.ok((await dbRead('snippets')).find(n=>n.id==='i01').content.includes('外部修改'));checks.push('conflict does not overwrite DB')
 await until('return !!doc.querySelector(".snip-conflict")');await button('已核对，继续编辑');await app('doc.querySelector(".snip-edit-form").requestSubmit()');await until('return !ui.snipDrafts.edit.i01');assert.ok((await dbRead('snippets')).find(n=>n.id==='i01').content.includes('发生冲突时保留的草稿'));checks.push('conflict can be reconciled explicitly without losing draft')
 // Work-scoped quick drafts and history survive switching modules/works.
 await app('ui.saveSnipDrafts({quick:"作品一草稿"});await w.open("w2");w.tab="snippets";')
 await until('return ui.snipStateWorkId==="w2"');await app('ui.saveSnipDrafts({quick:"作品二草稿"});await w.open("w1");w.tab="snippets";')
 await until('return ui.snipStateWorkId==="w1"');await check('rapid switch isolates drafts','return ui.snipDrafts.quick==="作品一草稿"')
 await app('await ui.flushSnipPersistence()');const configs=await dbRead('appconfig');assert.equal(configs.find(c=>c.key==='snipdraft:w2').value.quick,'作品二草稿');checks.push('debounced writes retain work identity')
 // Reset only this isolated origin for final visual and interaction recording.
 await seed();await size(1440)
 await click('.snip-view-switch button:last-child');await until('return !!doc.querySelector(".snip-lanes")')
 await drag('.snip-lane[data-group="tag:场景"] [data-id=i04] .snip-drag-handle','.snip-lane[data-group="tag:场景"] [data-id=i01] h3')
 await until('return ui.snipSort==="manual"&&ui.snipOrder.indexOf("i04")<ui.snipOrder.indexOf("i01")');checks.push('native drag honors actual target')
 await drag('.snip-lane[data-group="tag:场景"] [data-id=i04] .snip-drag-handle','.snip-lane[data-group="tag:雾港"] [data-id=i01] h3')
 await until('return doc.querySelector("[data-dialog=action]")?.textContent.includes("添加到 #雾港")')
 await mouse('[data-dialog=action] .snip-primary');await until('return w.snippets.find(n=>n.id==="i04").tags.includes("雾港")');checks.push('cross lane drag confirms tag and order atomically')
 await click('[aria-label=撤销]');await until('return !w.snippets.find(n=>n.id==="i04").tags.includes("雾港")');checks.push('cross lane undo preserves original tags')
 await click('.snip-view-switch button:first-of-type');await mouse('.snip-note[data-id=i04]');await button('编辑片段');await input('.snip-edit-form [name=body]','入回收站也保留的草稿');await click('.snip-note[data-id=i04] [aria-label=片段操作]');await button('移入回收站')
 await until('return !!w.snippets.find(n=>n.id==="i04").deletedAt');await click('.snip-nav [data-value=trash]');await click('.snip-view-switch button:last-child')
 await check('recycle bin remains browsable in board','return !!doc.querySelector(".snip-board .snip-note[data-id=i04]")')
 await mouse('.snip-note[data-id=i04]');await check('deleted note suspends editing and retains draft','return !doc.querySelector(".snip-edit-form")&&ui.snipDrafts.edit.i04.body==="入回收站也保留的草稿"');await button('恢复这条灵感');await until('return !w.snippets.find(n=>n.id==="i04").deletedAt');await click('.snip-nav [data-value=all]')
 await app('ui.saveSnipDrafts({quick:"保存失败时仍保留的输入"});await ui.flushSnipPersistence();win.__failDraft=(mods,key)=>{if(key==="snipdraft:w1")throw Error("草稿保存失败")};win.__ns.db.appconfig.hook("updating",win.__failDraft);ui.saveSnipDrafts({quick:"更新后的未完成输入"});await ui.flushSnipPersistence()')
 await check('draft write failure keeps input and pending state','return ui.snipDrafts.quick==="更新后的未完成输入"&&ui.snipPersistence.pending&&ui.snipPersistence.writeError')
 await app('win.__ns.db.appconfig.hook("updating").unsubscribe(win.__failDraft)');await mouse('.snip-save-error button');await until('return !ui.snipPersistence.pending&&!ui.snipPersistence.writeError');checks.push('draft retry persists retained input')
 await app('w.selSnippetId="i09";await ui.flushSnipPersistence();await w.open("w2");w.tab="snippets";')
 await until('return ui.snipStateWorkId==="w2"');await app('ui.saveSnipState({view:"board"})');await until('return !!doc.querySelector(".snip-board .snip-empty")');await shot('empty-board-1440');await app('await w.open("w1");w.tab="snippets";')
 await until('return ui.snipStateWorkId==="w1"&&w.selSnippetId==="i09"');checks.push('work switch restores selection and view')
 await app('w.tab="chapters"');await until('return !doc.querySelector(".snip-shell")');await app('w.tab="snippets"');await until('return !!doc.querySelector(".snip-shell")');await check('undo history retained across modules','return !doc.querySelector("[aria-label=撤销]").disabled')
 await seed();await size(1440)
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await click('.snip-view-switch button:last-child');await check('reduced motion reaches final state','return !!doc.querySelector(".snip-board")&&doc.querySelectorAll(".snip-lane").length===11');await send('Emulation.setEmulatedMedia',{features:[]})
 await app('ui.topbarAutoHide=true');await until('return !!doc.querySelector(".wb-topbar-edge")');await shot('autohide-1440');await app('ui.topbarAutoHide=false')
 if(process.argv.includes('--record')){
  const frameDir=join(tmp,'frames');await mkdir(frameDir,{recursive:true});const frames=[],writes=[],acks=[];let at=c.events.length
  function collect(){while(at<c.events.length){const e=c.events[at++];if(e.method!=='Page.screencastFrame'||e.sessionId!==sessionId)continue;const file='frame-'+String(frames.length).padStart(5,'0')+'.jpg';frames.push({file,time:e.params.metadata.timestamp});writes.push(writeFile(join(frameDir,file),Buffer.from(e.params.data,'base64')));acks.push(send('Page.screencastFrameAck',{sessionId:e.params.sessionId}))}}
  const pump=setInterval(collect,14);await send('Page.startScreencast',{format:'jpeg',quality:84,everyNthFrame:1,maxWidth:1440,maxHeight:900})
  try{await pause(500);await mouse('.snip-view-switch button:first-of-type');await pause(650);await mouse('.snip-note[data-id=i01]');await button('编辑片段');await pause(600);await input('.snip-edit-form [name=body]','潮声依旧，来信已经抵达。');await pause(550);await mouse('.snip-view-switch button:last-child');await pause(700);await mouse('.snip-edit-form [type=submit]');await pause(800);await mouse('[aria-label=撤销]');await pause(700);await mouse('[aria-label=重做]');await pause(650);await mouse('.snip-nav-title-line button');await pause(500);await mouse('.snip-nav-row[data-tag=来信]');await pause(650)}finally{await send('Page.stopScreencast');clearInterval(pump);collect();await Promise.all([...writes,...acks])}
  assert.ok(frames.length>20);await writeFile(join(frameDir,'frames.txt'),frames.map((f,i)=>"file '"+f.file+"'\nduration "+Math.max(.016,(frames[i+1]?.time||f.time+.7)-f.time).toFixed(5)).join('\n')+"\nfile '"+frames.at(-1).file+"'\n")
  await new Promise((res,rej)=>{const ff=spawn('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i','frames.txt','-vf','fps=30,format=yuv420p','-c:v','libx264','-crf','22','-movflags','+faststart',join(output,'snippets-plugin.mp4')],{cwd:frameDir,windowsHide:true});ff.on('error',rej);ff.on('exit',code=>code?rej(Error('ffmpeg '+code)):res())})
 }
 // Capture the unchanged design at exactly the same dimensions and content for comparison.
 for(const width of [1440,1280,864,760,380]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:origin+'/prototype/index.html'})
  for(let i=0;i<150;i++){if(await evaluate('!!window.IdeaApp'))break;await pause(40)}
  await evaluate('IdeaApp.reset();document.fonts.ready.then(()=>true)')
  if(width<950)await evaluate('document.querySelector(".mobile-menu").click()')
  await shot('design-sidebar-'+width)
 }
 await writeFile(join(output,'release-checks.json'),JSON.stringify({checks,metrics,screens,isolated:true},null,2));console.log('PASS '+checks.length+' checks, '+screens.length+' screenshots')
}finally{c.close();proc.kill();server.close()}

