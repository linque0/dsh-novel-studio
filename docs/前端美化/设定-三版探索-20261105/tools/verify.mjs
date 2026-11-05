import {createServer} from 'node:http'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join,extname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
process.env.NS_VERIFY_OUT='.tmp-lore-prototypes'
const {launchChrome,cdpClient}=await import('../../../../scripts/verify-app.mjs')
const ROOT=fileURLToPath(new URL('../',import.meta.url)),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.woff2':'font/woff2','.png':'image/png'}
const server=createServer(async(req,res)=>{try{const path=resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(resolve(ROOT)+sep))throw Error('outside');res.setHeader('Content-Type',mime[extname(path)]||'text/plain');res.end(await readFile(path))}catch{res.writeHead(404);res.end('not found')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,{proc,wsUrl}=await launchChrome(),cdp=await cdpClient(wsUrl),wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[]
const variants=[['A','a-study.html'],['B','b-archive.html'],['C','c-observatory.html']]
try{
 for(const [variant,file]of variants.filter(([v])=>!process.env.NS_LORE_VARIANT||process.env.NS_LORE_VARIANT===v)){
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}),send=(m,p)=>cdp.send(m,p,sessionId)
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
 const check=(name,pass,evidence)=>{results.push({variant,name,pass:!!pass,evidence});console.log((pass?'PASS ':'FAIL ')+variant+' '+name+(pass?'':' '+JSON.stringify(evidence)))}
 const shot=async name=>{await ev('document.fonts.ready.then(()=>true)');await wait(180);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(ROOT,'screenshots',name+'.png'),Buffer.from(data,'base64'))}
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+'/'+file})
 for(let i=0;i<100;i++){await wait(60);if(await ev('!!window.__loreReady'))break}
 check('初始选中与导航',await ev("window.__lorePrototype?.model.selected==='lighthouse'&&document.querySelectorAll('.global-nav button').length===6"))

 const click=async selector=>{const pos=await ev(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(selector)})],el=els.find(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');if(!el)throw Error('Missing visible '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});await send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});await wait(55)}
 const fill=async(selector,value)=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))})()`)
 const key=async key=>{const vk=({Escape:27,Tab:9,Enter:13})[key]||0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});await wait(60)}
 const ready=async()=>{await wait(180);for(let i=0;i<100;i++){if(await ev('!!window.__loreReady'))return;await wait(60)}throw Error('not ready')}
 await shot(variant.toLowerCase()+'-1440')

 if(variant==='B'){
 await click('[data-action="edit"][data-id="lighthouse"]');await fill('[data-edit="body"]','搜索前的修改。');await click('[data-action="search"]');await key('Escape')
 check('打开弹窗后编辑DOM与草稿状态一致',await ev("!document.querySelector('#edit-form')||!!__lorePrototype.editing"))
 if(!await ev("!!document.querySelector('#edit-form')"))await click('[data-action="edit-body"]')
 await fill('[data-edit="body"]','关闭搜索后继续编写。');await click('[data-action="save-edit"]')
 check('弹窗之后继续编辑不会静默丢失',await ev("__lorePrototype.model.node('lighthouse').body==='关闭搜索后继续编写。'"))
 await click('[data-action="settings"]');await click('#dialog [data-action="reset-confirm"]');await click('#dialog [data-action="reset"]');await ready()
 }
 const geometry=await ev(`(()=>{const sels=${JSON.stringify(variant==='A'?['.nav-pane','.study-pane']:variant==='B'?['.nav-pane','.list-pane','.archive-pane']:['.nav-pane','.observatory-pane','.detail-pane'])};return sels.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})})()`)
 const expected=variant==='A'?[236,1132]:variant==='B'?[220,300,832]:[180,824,348]
 check('1440首屏列宽与定位',geometry.every((r,i)=>r.y===108&&r.height===762&&r.width===expected[i]),geometry)
 await click('[data-action="edit"][data-id="lighthouse"]');await fill('[data-edit="title"]','雾港灯塔 · 修订');check('编辑时显示待保存',await ev("document.querySelector('#save-status').textContent==='待保存'"));await shot(variant.toLowerCase()+'-edit')
 const sep=await ev("(()=>{const r=document.querySelector('.divider[data-size=nav]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...sep,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:sep.x+26,y:sep.y,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:sep.x+26,y:sep.y,button:'left',clickCount:1});await wait(50)
 check('调宽保留编辑焦点与未提交草稿',await ev("document.activeElement===document.querySelector('[data-edit=title]')&&__lorePrototype.editing?.title==='雾港灯塔 · 修订'&&__lorePrototype.model.node('lighthouse').title==='雾港灯塔'"))
 if(variant==='C')await click('[data-graph-node="harbor"]');else await click('.nav-entry[data-id="harbor"]')
 check('原生选择另一条目保存原稿且不串写',await ev("__lorePrototype.model.node('lighthouse').title==='雾港灯塔 · 修订'&&__lorePrototype.model.node('harbor').title==='旧港与栈桥'&&__lorePrototype.model.selected==='harbor'"))
 await click('[data-action="settings"]');await click('#dialog [data-action="undo"]')
 check('撤销编辑',await ev("__lorePrototype.model.node('lighthouse').title==='雾港灯塔'"))
 if(variant==='C')await click('[data-graph-node="lighthouse"]');else await click('.nav-entry[data-id="lighthouse"]')
 await click('[data-action="edit"][data-id="lighthouse"]');await fill('[data-edit="title"]','取消这次修改');await key('Escape')
 check('Escape取消编辑',await ev("!__lorePrototype.editing&&__lorePrototype.model.node('lighthouse').title==='雾港灯塔'"))
 await click('[data-action="edit-body"]');await fill('[data-edit="body"]','在三点前，把灯交给下一个人。');await click('[data-action="save-edit"]')
 await send('Page.reload');await ready()
 check('刷新恢复内容及独立尺寸',await ev(`__lorePrototype.model.node('lighthouse').body==='在三点前，把灯交给下一个人。'&&__lorePrototype.prefs.widths.nav===${variant==='A'?262:variant==='B'?246:206}`))
 await click('[data-action="search"]');await fill('#global-search','熄灯之约');check('搜索正文与名称',await ev("document.querySelectorAll('.search-result').length===1"));await click('.search-result[data-id="pact"]')
 check('搜索结果跳转真实条目',await ev("__lorePrototype.model.selected==='pact'"))
 await click('[data-action="open-nav"]');await fill('#nav-search','不存在的内容');check('空结果可清除',await ev("__lorePrototype.model.search(__lorePrototype.query).length===0&&!!document.querySelector('[aria-label=清除检索]')"));await shot(variant.toLowerCase()+'-filter');await click('[data-action="clear"]')
 await click('[data-action="category"][data-id="geography"]')
 if(variant==='A')await click('#main-head [data-action="related"]')
 await click('[data-action="new-relation"]');await fill('#relation-search','潮汐集市');await fill('#dialog [name="label"]','连通');await shot(variant.toLowerCase()+'-relationship');await click('#dialog button[type="submit"]')
 check('新增关系接入同一数据',await ev("__lorePrototype.model.links('lighthouse').some(r=>r.otherId==='market'&&r.label==='连通')"))
 const relationId=await ev("__lorePrototype.model.links('lighthouse').find(r=>r.label==='连通').id")
 await click(`[data-action="remove-relation"][data-id="${relationId}"]`)
 check('移除关系并可撤销',await ev("!__lorePrototype.model.links('lighthouse').some(r=>r.label==='连通')"));await click('#toast [data-action="undo"]')
 check('撤销恢复关系',await ev("__lorePrototype.model.links('lighthouse').some(r=>r.label==='连通')"))
 if(variant==='C'){const pos=await ev("(()=>{const r=document.querySelector('[data-graph-node=keepers]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x+25,y:pos.y+15,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x+25,y:pos.y+15,button:'left',clickCount:1});check('原生拖动图谱节点',await ev("Object.keys(__lorePrototype.prefs.positions).some(k=>k.endsWith(':keepers'))"));await click('[data-action="zoom-in"]');check('缩放图谱',await ev('__lorePrototype.prefs.pan.zoom>1'));await click('[data-action="graph-home"]');check('回到当前条目',await ev("__lorePrototype.graphFocus===__lorePrototype.model.selected&&__lorePrototype.prefs.pan.zoom===1"))}
 if(variant==='A'){
 await ev("__lorePrototype.select('lighthouse')")
 const parentBefore=await ev("__lorePrototype.model.node('watch').parentId")
 await ev("(()=>{const el=document.querySelector('[data-inline=watch]');el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))})()")
 check('Tab调整层级',await ev("__lorePrototype.model.node('watch').parentId==='architecture'"))
 await ev("(()=>{const m=__lorePrototype.model;m.undo();__lorePrototype.render();const h=document.querySelector('[data-drag=architecture]'),target=document.querySelector('[data-row=watch]'),dt=new DataTransfer();h.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));const r=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.bottom-1}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.bottom-1}))})()")
 check('拖动手柄移动条目',await ev("__lorePrototype.model.node('architecture').parentId==='watch'"))
 await click('[data-action="undo"]')
 }

 if(variant==='C'){
 await click('[data-action="entry-menu"]');await click('#dialog [data-action="delete-confirm"]');await click('#dialog [data-action="delete"]')
 check('删除中心后仍有有效图谱',await ev("!!__lorePrototype.model.node(__lorePrototype.graphFocus)&&document.querySelectorAll('.graph-node').length>0"))
 await click('#toast [data-action="undo"]');check('撤销中心删除恢复选中与图谱',await ev("__lorePrototype.model.selected==='lighthouse'&&!!document.querySelector('[data-graph-node=lighthouse]')"))
 }
 const before=await ev('__lorePrototype.model.data.nodes.length');await click('[data-action="new-entry"]');await fill('#dialog [name=title]','雾港北侧的旧仓库——一处在退潮后才能靠近、被所有航海日志刻意略去的地方');await fill('#dialog [name=body]','每扇窗都朝向相同的海面。');await fill('#dialog [name=tags]','地点，待补充');await click('#dialog button[type=submit]')
 check('新建条目与标签',await ev(`__lorePrototype.model.data.nodes.length===${before+1}&&__lorePrototype.model.node(__lorePrototype.model.selected).tags.includes('待补充')`))
 check('长标题保持页面边界',await ev('document.documentElement.scrollWidth<=innerWidth'));await shot(variant.toLowerCase()+'-long-title');
 const created=await ev('__lorePrototype.model.selected');await click('[data-action="entry-menu"]');await click('#dialog [data-action="delete-confirm"]');await click('#dialog [data-action="delete"]')
 check('删除条目',await ev(`!__lorePrototype.model.node(${JSON.stringify(created)})`));await click('#toast [data-action="undo"]');check('撤销删除恢复内容',await ev(`__lorePrototype.model.node(${JSON.stringify(created)}).body==='每扇窗都朝向相同的海面。'`))

 if(variant==='B'){
 await click('[data-action="category"][data-id="geography"]');await fill('#nav-search','雾');await ev("document.querySelector('.list-entries').scrollTop=90;document.querySelector('#reader').scrollTop=80")
 const positions=await ev("({list:document.querySelector('.list-entries').scrollTop,reader:document.querySelector('#reader').scrollTop})")
 await click('.list-entry[data-id="harbor"]');check('切换条目保留筛选与列表滚动',await ev(`__lorePrototype.query==='雾'&&document.querySelector('.list-entries').scrollTop===${positions.list}`))
 await click('[data-action="back-entry"]');check('返回条目恢复正文滚动',await ev(`__lorePrototype.model.selected==='lighthouse'&&document.querySelector('#reader').scrollTop===${positions.reader}`))
 await click('[data-action="clear"]')
 }
 // Restore through the actual UI before recording the comparable viewport scenes.
 await click('[data-action="settings"]');await click('#dialog [data-action="reset-confirm"]');await click('#dialog [data-action="reset"]');await ready()
 check('恢复初始内容',await ev("__lorePrototype.model.selected==='lighthouse'&&__lorePrototype.model.node('lighthouse').body.startsWith('雾港最北端')"))
 for(const width of [1440,1280,760,380]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await wait(120);check(width+'无页面横向溢出',await ev('document.documentElement.scrollWidth<=innerWidth'));await shot(variant.toLowerCase()+'-'+width)
 if(width<1100){
 await click('#mobile-bar [data-action="open-nav"]')
 check(width+'目录按需打开',await ev("document.body.dataset.drawer==='nav'&&document.querySelector('#nav-pane').getAttribute('aria-modal')==='true'"))
 await key('Tab');check(width+'抽屉焦点约束',await ev("!!document.activeElement.closest('#nav-pane')"));await key('Escape');check(width+'关闭返回主区',await ev("!document.body.dataset.drawer"))
 if(variant==='B'){await click('.list-entry[data-id="lighthouse"]');check(width+'单区域条目详情',await ev("document.body.dataset.screen==='detail'&&getComputedStyle(document.querySelector('#list-pane')).display==='none'"));await click('#mobile-bar [data-action="back-list"]');check(width+'返回列表保留选中',await ev("document.body.dataset.screen==='list'&&__lorePrototype.model.selected==='lighthouse'"))}
 if(variant==='C'){await click('#mobile-bar [data-action="back-graph"]');await click('[data-graph-node="lighthouse"]');check(width+'图谱选择进入单区域详情',await ev("document.body.dataset.screen==='detail'&&__lorePrototype.model.selected==='lighthouse'"))}
 if(variant==='A'){await click('#mobile-bar [data-action="related"]');check(width+'关联资料占用独立区域',await ev("getComputedStyle(document.querySelector('.study-scroll')).display==='none'&&getComputedStyle(document.querySelector('.study-related')).display!=='none'"));await click('.study-related [data-action="related"]')}
 }
 }
 await cdp.send('Target.closeTarget',{targetId})
 }
 const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);results.push({name:'浏览器异常',pass:errors.length===0,evidence:errors})
 await writeFile(join(ROOT,'report.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));if(results.some(r=>!r.pass))process.exitCode=1
}finally{cdp.close();proc.kill();server.close()}
