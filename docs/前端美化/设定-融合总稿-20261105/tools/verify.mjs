import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join,extname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
process.env.NS_VERIFY_OUT='.tmp-lore-fusion'
const {launchChrome,cdpClient}=await import('../../../../scripts/verify-app.mjs')
const ROOT=fileURLToPath(new URL('../',import.meta.url)),mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'}
const server=createServer(async(req,res)=>{try{const path=resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(resolve(ROOT)+sep))throw Error('outside');res.setHeader('content-type',mime[extname(path)]||'text/plain');res.end(await readFile(path))}catch{res.writeHead(404);res.end('missing')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,{proc,wsUrl}=await launchChrome(),cdp=await cdpClient(wsUrl),wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[]
try{
const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}),send=(m,p)=>cdp.send(m,p,sessionId)
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
const check=(name,pass,evidence)=>{results.push({name,pass:!!pass,evidence});console.log((pass?'PASS ':'FAIL ')+name+(pass?'':' '+JSON.stringify(evidence)))}
const click=async selector=>{const point=await ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.closest('[inert]'));if(!el)throw Error('Missing visible '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait(70)}
const key=async(key,modifiers=0)=>{const code=({Escape:27,Tab:9,Enter:13,Backspace:8,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Home:36,z:90,y:89,b:66})[key]||0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code,modifiers});await wait(50)}
const ready=async()=>{await wait(200);for(let i=0;i<100;i++){if(await ev('!!window.__fusionReady'))return;await wait(60)}throw Error('not ready')}
const shot=async name=>{await ev('document.fonts.ready.then(()=>true)');await wait(160);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(ROOT,'screenshots',name+'.png'),Buffer.from(data,'base64'))}
const resize=async width=>{await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await wait(150)}
await send('Page.enable');await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await resize(1440);await send('Page.navigate',{url:origin+'/index.html'});await ready()
check('默认幕布编辑',await ev("__fusion.view==='write'&&document.querySelectorAll('[data-edit-node]').length>8&&__fusion.store.node('lighthouse').text==='雾港灯塔'"))

const focus=async(id,offset=0)=>ev(`(()=>{const el=document.querySelector('[data-edit-node="'+${JSON.stringify(id)}+'"]');if(!el)throw Error('No editor');el.scrollIntoView({block:'nearest'});el.focus();const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,remaining=${offset};while(n=w.nextNode()){if(remaining<=n.textContent.length){const r=document.createRange();r.setStart(n,remaining);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);break}remaining-=n.textContent.length}})()`)
const fillNode=async(id,text)=>ev(`(()=>{const el=document.querySelector('[data-edit-node="'+${JSON.stringify(id)}+'"]');el.focus();el.innerText=${JSON.stringify(text)};const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))})()`)
const drag=async(selector,dx,dy=0,steps=4)=>{const p=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});for(let i=1;i<=steps;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+dx*i/steps,y:p.y+dy*i/steps,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});await wait(70)}
const reset=async()=>{await click('[data-act=settings]');await click('#dialog [data-act=reset-confirm]');await click('#dialog [data-act=reset]');await ready()}
check('A没有独立标题正文模型',await ev("__fusion.store.data.nodes.every(n=>!('title'in n)&&!('body'in n))"))
const geo=await ev("[...document.querySelectorAll('#workspace>.pane')].map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})")
check('A默认坐标与列宽',geo[0].x===28&&geo[0].width===220&&geo[1].x===264&&geo[1].width===1148&&geo[1].y===108,geo)
await fillNode('watch','守灯规程 · 待提交');check('输入显示待保存',await ev("document.querySelector('#save-state').textContent==='待保存'"));await shot('a-editing')
await drag('.divider[data-size=nav]',35)
check('调宽保持编辑焦点与未提交草稿',await ev("document.activeElement.dataset.editNode==='watch'&&__fusion.drafts.has('watch')&&__fusion.store.node('watch').text==='守灯规程'&&__fusion.prefs.navWidth===255"))
await key('Escape');check('Esc取消当前条目输入',await ev("document.querySelector('[data-edit-node=watch]').innerText==='守灯规程'&&!__fusion.drafts.size"))
await ev("document.querySelector('.divider').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
await focus('watch',2);await ev("document.querySelector('.write-scroll').scrollTop=70")
const scrollA=await ev("document.querySelector('.write-scroll').scrollTop")
await click('[data-row=watch] [data-act=open-detail]');check('A行尾进入B且条目身份一致',await ev("__fusion.view==='detail'&&__fusion.store.selected==='watch'"));await shot('b-from-row')
await click('[data-act=back]')
const backA=await ev("({id:document.activeElement.dataset.editNode,caret:getSelection().anchorOffset,scroll:document.querySelector('.write-scroll').scrollTop})")
check('返回A恢复光标和滚动',backA.id==='watch'&&backA.caret===2&&backA.scroll===scrollA,backA)
await focus('watch',4);const count=await ev('__fusion.store.data.nodes.length');await key('Enter');const sibling=await ev('__fusion.store.selected')
check('Enter紧随当前条目创建同级并聚焦',await ev(`__fusion.store.node(${JSON.stringify(sibling)}).parentId==='lighthouse'&&document.activeElement.dataset.editNode===${JSON.stringify(sibling)}&&__fusion.store.children('lighthouse').map(n=>n.id).indexOf(${JSON.stringify(sibling)})===__fusion.store.children('lighthouse').map(n=>n.id).indexOf('watch')+1`))
await key('z',2);check('CtrlZ一次撤销新建',await ev(`__fusion.store.data.nodes.length===${count}`))
await focus('watch',2);await key('Tab');check('Tab降级保留子树',await ev("__fusion.store.node('watch').parentId==='architecture'&&__fusion.store.node('secret').parentId==='watch'"));await key('Tab',8);check('ShiftTab升级',await ev("__fusion.store.node('watch').parentId==='lighthouse'"));await key('ArrowUp',1);check('Alt方向键同级排序',await ev("__fusion.store.children('lighthouse').findIndex(n=>n.id==='watch')<__fusion.store.children('lighthouse').findIndex(n=>n.id==='architecture')"));await key('z',2)
await focus('watch',4);await key('Enter',8);await send('Input.insertText',{text:'换行内容'});check('ShiftEnter条目内换行而非新节点',await ev(`document.querySelector('[data-edit-node=watch]').innerText.includes(String.fromCharCode(10))&&__fusion.store.data.nodes.length===${count}`));await key('Escape')
await focus('watch',0);await ev("document.querySelector('[data-edit-node=watch]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'守'}))");await send('Input.insertText',{text:'中文'});await ev("document.querySelector('[data-edit-node=watch]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))");check('中文组合输入不误建条目',await ev(`__fusion.store.data.nodes.length===${count}`));await ev("document.querySelector('[data-edit-node=watch]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}))");await key('Escape')
const beforeMerge=await ev("({first:__fusion.store.node('lighthouse-text-0').text,second:__fusion.store.node('lighthouse-text-1').text})")
await focus('lighthouse-text-1',0);await key('Backspace');check('行首退格合并内容且不丢字',await ev(`!__fusion.store.node('lighthouse-text-1')&&__fusion.store.node('lighthouse-text-0').text===${JSON.stringify(beforeMerge.first+beforeMerge.second)}`));await key('z',2);check('撤销恢复被合并条目',await ev("!!__fusion.store.node('lighthouse-text-1')"))
await focus('watch',0);await ev("(()=>{const el=document.querySelector('[data-edit-node=watch]'),r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r)})()");await key('b',2);await click('[data-act=view][data-id=detail]');check('富文本同步到详情',await ev("/<(b|strong)>/.test(__fusion.store.node('watch').html||'')"));await shot('b-rich-text');await click('[data-act=undo]') .catch(async()=>{await click('[data-act=settings]');await click('#dialog [data-act=undo]')})
await reset()
// Reorder via HTML5 drop events drives the same UI handler as dragging the bullet.
await ev("(()=>{const from=document.querySelector('[data-drag=harbor]'),target=document.querySelector('[data-row=watch]'),d=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));target.dataset.drop='inside';target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}))})()")
check('三层拖入归组',await ev("__fusion.store.node('harbor').parentId==='watch'"));await click('[data-act=undo]');check('拖入可撤销',await ev("__fusion.store.node('harbor').parentId==='geography'"))
await ev("(()=>{const from=document.querySelector('[data-drag=lighthouse]'),target=document.querySelector('[data-row=secret]'),d=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));target.dataset.drop='inside';target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}))})()")
check('阻止拖入自身后代',await ev("__fusion.store.node('lighthouse').parentId==='geography'"))
await click('[data-row=lighthouse] [data-act=fold]');const foldedBefore=await ev('JSON.stringify(__fusion.prefs.writeFold)');await click('[data-act=view][data-id=map]')
check('C层级展开不覆盖A折叠偏好',await ev(`JSON.stringify(__fusion.prefs.writeFold)===${JSON.stringify(foldedBefore)}`))
const hierarchyCam=await ev("JSON.stringify(__fusion.prefs.cameras['hierarchy:geography'])")
await drag('#map-stage',18,10);const panned=await ev("JSON.stringify(__fusion.prefs.cameras['hierarchy:geography'])");check('层级图可以平移',panned!==hierarchyCam)
await click('[data-act=map-mode][data-id=relations]');await drag('[data-map-node=keepers]',30,12,4)
const graphDrag=await ev("__fusion.prefs.positions['lighthouse:keepers']")
check('关系节点多步拖动按最终位移计算',Math.abs(graphDrag.x-(165+30/.9))<1&&Math.abs(graphDrag.y-(110+12/.9))<1,graphDrag)
check('关系拖动不改变父子层级',await ev("__fusion.store.node('keepers').parentId==='factions'"))
await click('[data-act=zoom-in]');const relationCam=await ev("JSON.stringify(__fusion.prefs.cameras['relations:lighthouse'])");await click('[data-act=map-mode][data-id=hierarchy]');check('双导图独立相机',await ev(`JSON.stringify(__fusion.prefs.cameras['hierarchy:geography'])===${JSON.stringify(panned)}`));await click('[data-act=map-mode][data-id=relations]');check('关系视图恢复相机',await ev(`JSON.stringify(__fusion.prefs.cameras['relations:lighthouse'])===${JSON.stringify(relationCam)}`))
await click('[data-map-node=keepers]');await click('.inspector [data-act=open-detail]');check('C摘要进入B同一条目',await ev("__fusion.view==='detail'&&__fusion.store.selected==='keepers'"));await click('[data-act=back]');check('B返回C保留原中心',await ev("__fusion.view==='map'&&__fusion.prefs.relationCenter==='lighthouse'"))
await reset();await click('[data-row=lighthouse] [data-act=open-detail]');await click('[data-act=edit][data-id=lighthouse]');await fillNode('lighthouse','雾港灯塔 · 联动修订');await click('[data-act=search]');await key('Escape');check('弹窗后编辑仍可继续',await ev("!!document.querySelector('[data-edit-node=lighthouse]')"));await fillNode('lighthouse','雾港灯塔 · 继续编辑');await click('[data-act=finish-edit]');check('弹窗之后输入正常保存',await ev("__fusion.store.node('lighthouse').text==='雾港灯塔 · 继续编辑'"));await click('[data-act=locate]');check('B编辑同步回A并定位',await ev("__fusion.view==='write'&&document.activeElement.dataset.editNode==='lighthouse'&&document.querySelector('[data-edit-node=lighthouse]').innerText==='雾港灯塔 · 继续编辑'"))
await send('Page.reload');await ready();check('刷新恢复共享内容与视图',await ev("__fusion.store.node('lighthouse').text==='雾港灯塔 · 继续编辑'&&__fusion.view==='write'"));await reset()

for(const width of [1440,1280,760,380]){
 await resize(width);await ev("__fusion.open('write','lighthouse',{push:false})");await shot('a-write-'+width);check('A '+width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'))
 await click('[data-act="view"][data-id="detail"]');await shot('b-detail-'+width);check('B '+width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'))
 await click('[data-act="view"][data-id="map"]');await click('[data-act="map-mode"][data-id="hierarchy"]');await shot('c-hierarchy-'+width);check('C层级 '+width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'))
 await click('[data-act="map-mode"][data-id="relations"]');await shot('c-relations-'+width);check('C关系 '+width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'))
}
// ---- 设定 · 去纸面框 + 层级标题 + 全部设定总览（2026-11-05 迭代） ----
await resize(1440);await send('Page.navigate',{url:origin+'/index.html'});await ready();await reset()
if((await ev("document.querySelector('.fusion-head h1').textContent.trim()"))!=='地理与场所')await click('[data-act=scope-toggle]')
check('编写区无浅色面板',await ev("(()=>{const s=document.querySelector('.write-surface');if(!s)return false;const bg=getComputedStyle(s).backgroundColor;const light=[...document.querySelectorAll('#workspace *')].some(el=>/^rgba?\\(243, 239, 231/.test(getComputedStyle(el).backgroundColor));return (bg==='rgba(0, 0, 0, 0)'||bg==='transparent')&&!light})()"))
check('标题显示当前层级名',await ev("document.querySelector('.fusion-head h1').textContent.trim()==='地理与场所'"),await ev("document.querySelector('.fusion-head h1').textContent.trim()"))
check('视图名只在切换器中出现',await ev("(()=>{const h=document.querySelector('.fusion-head h1').textContent.trim();const on=document.querySelector('.view-switch button.on').textContent.trim();return h!==on&&on==='条目编写'})()"))
await click('[data-act=scope-toggle]')
const allTotal=await ev("(()=>{const s=__fusion.store;return s.data.nodes.filter(n=>n.isSet).reduce((a,r)=>a+s.descendants(r.id).length,0)})()")
check('全部设定：标题与 6 个分组',await ev("(()=>{const h=document.querySelector('.fusion-head h1').textContent.trim();return h==='全部设定'&&document.querySelectorAll('.mubu-set-head').length===6})()"))
check('全部设定：汇总全部条目',await ev("document.querySelectorAll('.mubu-row').length==="+allTotal),allTotal)
check('全部设定：分组头带条目计数',await ev("(()=>{const hs=[...document.querySelectorAll('.mubu-set-head')];return hs.length===6&&hs.every(h=>/[0-9]+ 条目/.test(h.textContent))})()"))
check('全部设定：侧栏只保留一个当前项',await ev("document.querySelectorAll('.nav-tree .category.current').length===1&&!!document.querySelector('.category.all-scope.current')"))
check('全部设定：侧栏范围项为当前',await ev("(()=>{const b=document.querySelector('.category.all-scope');return !!b&&b.classList.contains('current')&&b.getAttribute('aria-pressed')==='true'})()"))
await ev("document.querySelector('.write-scroll').scrollTop=0");await wait(150);await shot('a-all-1440')
const rowsBefore=await ev("[...document.querySelectorAll('.write-group')].map(g=>g.querySelectorAll('.mubu-row').length)")
await ev("(()=>{const g=document.querySelectorAll('.write-group')[1],b=[...g.querySelectorAll('.bullet.has-children')].find(x=>!x.classList.contains('folded'));b.click()})()");await wait(90)
const rowsAfter=await ev("[...document.querySelectorAll('.write-group')].map(g=>g.querySelectorAll('.mubu-row').length)")
check('全部设定：折叠只影响该设定集',rowsAfter[1]<rowsBefore[1]&&rowsBefore.filter((n,i)=>i!==1).every((n,i)=>n===rowsAfter.filter((x,j)=>j!==1)[i]),{rowsBefore,rowsAfter})
await click('[data-act=expand-all]');await wait(90)
await ev("(()=>{const el=document.querySelector('[data-edit-node=keepers]');el.focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r)})()")
await send('Input.insertText',{text:'·总览'});await wait(80)
check('全部设定：编辑进入待保存',await ev("document.querySelector('#save-state').textContent.includes('待保存')"))
await ev("document.querySelector('[data-edit-node=keepers]').blur()");await wait(90)
check('全部设定：编辑写回共享条目',await ev("__fusion.store.node('keepers').text.includes('总览')"))
await click('[data-act=scope-toggle]');await wait(120)
await click('[data-act=category][data-id=factions]');await wait(120)
check('回到当前设定集可见上一步修改',await ev("(document.querySelector('[data-edit-node=keepers]')?.innerText||'').includes('总览')"))
await ev("(()=>{__fusion.prefs.writeScope='all';__fusion.render(false)})()");await wait(120)
await ev("(()=>{const el=document.querySelector('.write-scroll');el.scrollTop=260})()");await wait(120)
await send('Page.navigate',{url:origin+'/index.html'});await ready()
check('全部设定：刷新恢复范围与滚动',await ev("(()=>{const h=document.querySelector('.fusion-head h1').textContent.trim(),el=document.querySelector('.write-scroll');return __fusion.prefs.writeScope==='all'&&h==='全部设定'&&el.scrollTop>120})()"),await ev("document.querySelector('.write-scroll').scrollTop"))
await ev("(()=>{const from=document.querySelector('[data-drag=harbor]'),target=document.querySelector('[data-row=keepers]'),d=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));target.dataset.drop='inside';target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}))})()");await wait(90)
check('全部设定：可跨设定集拖动',await ev("__fusion.store.node('harbor').parentId==='keepers'"))
await click('[data-act=undo]');await wait(90)
check('跨设定集拖动可撤销',await ev("__fusion.store.node('harbor').parentId==='geography'"))
await ev("(()=>{const el=document.querySelector('.write-scroll');el.scrollTop=300})()");await wait(150)
check('全部设定：粘性头与滚动口对齐',await ev("(()=>{const s=document.querySelector('.write-scroll').getBoundingClientRect(),h=document.querySelector('.mubu-set-head').getBoundingClientRect();return Math.abs(h.top-s.top)<1.5})()"),await ev("(()=>{const s=document.querySelector('.write-scroll').getBoundingClientRect(),h=document.querySelector('.mubu-set-head').getBoundingClientRect();return {scrollTop:s.top,headTop:h.top}})()"))
await shot('a-all-scrolled-1440')
check('全部设定：侧栏计数与分组头同口径',await ev("(()=>{const nav=[...document.querySelectorAll('.nav-tree .category:not(.all-scope) small')].map(e=>Number(e.textContent)),heads=[...document.querySelectorAll('.mubu-set-head small')].map(e=>parseInt(e.textContent)),all=Number(document.querySelector('.category.all-scope small').textContent);return nav.length===6&&heads.length===6&&nav.every((n,i)=>n===heads[i])&&nav.reduce((a,b)=>a+b,0)===all})()"),await ev("[...document.querySelectorAll('.nav-tree .category small')].map(e=>e.textContent).join(',')"))
check('正文行宽有上限',await ev("(()=>{const els=[...document.querySelectorAll('.mubu-row .node-text')],caps=els.map(el=>parseFloat(getComputedStyle(el).maxWidth));return els.length>0&&caps.every(c=>c>200&&c<=700)})()"),await ev("(()=>{const el=document.querySelector('.mubu-row .node-text');return {w:Math.round(el.getBoundingClientRect().width),max:getComputedStyle(el).maxWidth}})()"))
check('标签字号不小于 10px',await ev("(()=>{const t=document.querySelector('.write-surface .tag');return !!t&&parseFloat(getComputedStyle(t).fontSize)>=10})()"))

for(const width of [1440,1280,760,380]){await resize(width);await send('Page.navigate',{url:origin+'/index.html'});await ready();if((await ev("document.querySelector('.fusion-head h1').textContent.trim()"))!=='全部设定')await ev("(()=>{__fusion.prefs.writeScope='all';__fusion.render(false)})()");await ev("document.querySelector('.write-scroll').scrollTop=0");await wait(150);await shot('a-all-'+width);check('全部设定 '+width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'))}
const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);check('无运行异常',errors.length===0,errors)
await writeFile(join(ROOT,'report.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));if(results.some(r=>!r.pass))process.exitCode=1
}finally{cdp.close();proc.kill();server.close()}
