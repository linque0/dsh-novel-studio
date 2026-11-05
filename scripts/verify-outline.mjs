// 使用 verify:app 的宿主令牌与隔离 IndexedDB；真实组件、真实输入事件，不读用户作品库。
import { createServer } from 'node:http'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve,join,extname } from 'node:path'
process.env.NS_VERIFY_OUT='.tmp-verify-outline'
const {HARNESS,launchChrome,cdpClient}=await import('./verify-app.mjs')
const OUT=resolve('.tmp-verify-outline'),APP=resolve('assets/app')
await mkdir(join(OUT,'screenshots'),{recursive:true})
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'}
const server=createServer(async(req,res)=>{
  try{const u=new URL(req.url,'http://local');if(u.pathname==='/harness.html'){res.setHeader('content-type','text/html');res.end(HARNESS.replace('var VH = 860;', 'var VH = 900;'));return}
    const file=resolve(APP,decodeURIComponent(u.pathname.replace('/api/novelstudio/app/','')))
    if(!file.startsWith(APP+'/')&&!file.startsWith(APP+'\\')){res.writeHead(403);res.end();return}
    res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file))
  }catch{res.writeHead(404);res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin='http://127.0.0.1:'+server.address().port
const {proc,wsUrl}=await launchChrome(),cdp=await cdpClient(wsUrl)
const results=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms))
function check(name,pass,evidence){results.push({name,pass:!!pass,evidence});console.log(`${pass?'PASS':'FAIL'} ${name}${pass?'':' '+JSON.stringify(evidence)}`)}
try{
 for(const [module,width] of [['outline',1440],['outline',1280],['outline',760],['outline',380],['panel-outline',760],['panel-outline',1440]].filter(([module,width])=>!process.env.NS_OUTLINE_SCENE||process.env.NS_OUTLINE_SCENE===module+'-'+width)){
  const label=module+'-'+width
  console.log('START '+label)
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true})
  const send=(method,params)=>cdp.send(method,params,sessionId)
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
  const page=(fn,...args)=>evaluate(`(async()=>{const f=document.querySelector('iframe'),w=f.contentWindow,d=f.contentDocument,s=w.__ns.getWork(),ui=d.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui'),wait=ms=>new Promise(r=>setTimeout(r,ms));return (${fn.toString()})({w,d,s,ui,wait},...${JSON.stringify(args)})})()`)
  const click=selector=>page(({d},sel)=>{const e=d.querySelector(sel);if(!e)throw Error('Missing '+sel);e.click()},selector)
  await send('Page.enable');await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Page.navigate',{url:origin+`/harness.html?module=${module}&vw=${width}`})
  let ready=false
  for(let i=0;i<180;i++){await wait(100);if(await evaluate('!!window.__NS_VERIFY_RESULT')){ready=true;break}}
  if(!ready)throw Error('Harness timeout '+label)
  console.log('READY '+label)
  await page(async({w,d,s,ui,wait})=>{
    s.outlineView='canvas';s.olnodes=[];s.work.title='长夜将明'
    for(const [k,v] of Object.entries({outlineLeftWidth:220,outlineRightWidth:318,outlineSideOpen:true,outlineDetailOpen:true}))await ui.setPref(k,v)
  })
  await page(({w,d,s,ui,wait})=>{
    const add=(id,parentId,kind,title,text,x,y)=>{const row={id,parentId,kind,title,text,canvasX:x,canvasY:y,w:kind==='container'?460:null,rels:[],sortOrder:s.olnodes.length*1000,createdAt:Date.now(),updatedAt:Date.now(),workId:s.work.id};s.olnodes.push(row);return row}
    add('g1',null,'container','雾港来信','从一封没有署名的来信，到一座无法离开的城。',0,0)
    add('g2',null,'container','灯塔之下','追查失踪者的足迹，逼近守望者的秘密。',540,0)
    add('g3',null,'container','长夜将明','当最后一盏灯熄灭，决定留下的人重新点亮它。',1080,0)
    add('g12','g2','container','守灯人的秘密','失踪航海日志与三年前的风暴。',30,205)
    add('g123','g12','container','航海日志','三层容器中的旧记录。',10,150)
    add('e1','g1','event','一封迟到的信','沈砚收到父亲三年前寄出的信，里面只有一张船票。',20,150)
    add('e2','g1','event','雾中抵港','码头上有人叫出一个不属于他的名字。',20,330)
    add('e3','g2','event','灯塔熄灭的那一夜','停摆的钟在凌晨三点响起。林照认出守灯人的笔迹，却选择隐瞒。',30,20)
    add('e4','g12','event','守灯人的旧档案','被涂改的记录指向同一场风暴。',20,150)
    add('e5','g3','event','潮汐带回的名字','所有失踪者的名字浮出水面。',20,150)
    add('e6','g3','event','天亮之前','灯塔重新亮起，第一班渡轮驶向无雾的海面。',20,330)
    add('n1','g123','note','钟声与潮汐','三点的钟声不是报时，而是一次求救。',20,150)
  })
  await page(({w,d,s,ui,wait})=>{
    s.olnodeRelAdd('e1','e2',{label:'启程'});s.olnodeRelAdd('e2','e3',{label:'追查'});s.olnodeRelAdd('e3','e4',{label:'发现线索'});s.olnodeRelAdd('e4','e5',{label:'真相浮现'});s.olnodeRelAdd('e5','e6',{label:'抉择'})
  })
  await page(async({w,d,s,ui,wait})=>{
    await w.__ns.db.appconfig.delete('olcanvas:'+s.work.id);await s.loadCanvasPrefs()
    s.canvasPrefs.cameras={root:{zoom:.49,tx:20,ty:18},g2:{zoom:.95,tx:35,ty:30}}
    s.selOlnodeId='e3';await s.saveCanvasPrefs()
    // 重新挂载以验证加载的相机和 Teleport 目标。
    s.outlineView='text';await wait(70);s.outlineView='canvas';await wait(250);await d.fonts.ready
  })
  const initial=await page(({d,s,ui})=>({mode:d.querySelector('.ow-workspace')?.dataset.layout,canvas:d.querySelector('.ow-main').getBoundingClientRect().width,expanded:[...s.canvasPrefs.expanded],left:d.querySelector('.ow-left').getBoundingClientRect().width,right:d.querySelector('.ow-right').getBoundingClientRect().width,drawer:d.querySelector('.ow-right .oc-drawer')?.textContent.includes('灯塔熄灭'),overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth}))
  check(label+' 模式与画布空间',initial.mode===(width<1100?'drawer':'docked')&&(width<1100||initial.canvas>=480)&&!initial.overflow,initial)
  check(label+' 只默认展开根容器',JSON.stringify(initial.expanded)===JSON.stringify(['g1','g2','g3']),initial.expanded)
  check(label+' 真实选中详情',initial.drawer,initial)
  if(width>=1100){
    const camera=await page(({d})=>d.querySelector('.om-inner').style.transform)
    const pref=await page(({ui})=>ui.sideWidth)
    const drag=async(selector,dx)=>{
      const pos=await page(({d},sel)=>{const r=d.querySelector(sel).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}},selector)
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos})
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1})
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x+dx,y:pos.y,button:'left',buttons:1})
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x+dx,y:pos.y,button:'left',clickCount:1});await wait(100)
    }
    await drag('.ow-left-resizer',75);await drag('.ow-right-resizer',-40)
    const resized=await page(async({w,d,ui})=>({left:ui.outlineLeftWidth,right:ui.outlineRightWidth,other:ui.sideWidth,canvas:d.querySelector('.ow-main').getBoundingClientRect().width,camera:d.querySelector('.om-inner').style.transform,savedLeft:(await w.__ns.db.appconfig.get('outlineLeftWidth'))?.value,savedRight:(await w.__ns.db.appconfig.get('outlineRightWidth'))?.value}))
    check(label+' 两侧真实拖宽并保存',resized.left>220&&resized.right>318&&resized.left===resized.savedLeft&&resized.right===resized.savedRight&&resized.other===pref&&resized.canvas>=480,resized)
    check(label+' 调宽不动相机',camera===resized.camera,{camera,after:resized.camera})
    await page(async({w,d,ui})=>{const e=d.querySelector('.ow-left-resizer');e.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await new Promise(r=>setTimeout(r,60));d.querySelector('.ow-right-resizer').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));await new Promise(r=>setTimeout(r,60))})
    const keyboard=await page(({ui})=>({left:ui.outlineLeftWidth,right:ui.outlineRightWidth}))
    check(label+' 键盘调宽与双击复位',keyboard.left===resized.left-10&&keyboard.right===318,keyboard)
    await click('.ol-side-toggle');await wait(80)
    const closed=await page(({d})=>({rail:!!d.querySelector('.ow-left-rail'),width:d.querySelector('.ow-left').getBoundingClientRect().width,camera:d.querySelector('.om-inner').style.transform}))
    check(label+' 左栏收放不动相机',closed.rail&&closed.width===0&&closed.camera===camera,closed)
    await click('.ow-left-rail');await click('.oc-drawer-x');await wait(80)
    const hidden=await page(({s,d})=>({selected:s.selOlnodeId,rail:!!d.querySelector('.ow-right-rail')}))
    check(label+' 右栏关闭保留选择',hidden.selected==='e3'&&hidden.rail,hidden)
    await page(({s})=>{s.selOlnodeId='e1'});await wait(50)
    check(label+' 普通选择不强开详情',await page(({d})=>!!d.querySelector('.ow-right-rail')))
    await click('.ow-right-rail');await wait(50)
    check(label+' 恢复详情跟随最新节点',await page(({d})=>d.querySelector('.oc-drawer h2').textContent.includes('一封迟到')))
    await page(async({w,ui})=>{const before=[ui.outlineLeftWidth,ui.outlineRightWidth];ui.outlineLeftWidth=180;ui.outlineRightWidth=260;await ui.loadPrefs();w.__widthRestore={before,after:[ui.outlineLeftWidth,ui.outlineRightWidth]}})
    check(label+' 重载持久化偏好',await page(({w})=>JSON.stringify(w.__widthRestore.before)===JSON.stringify(w.__widthRestore.after)))
    const remembered=await page(({ui})=>[ui.outlineLeftWidth,ui.outlineRightWidth])
    await evaluate("document.querySelector('iframe').style.width='1000px'");await wait(130)
    check(label+' 按实际容器宽度切抽屉',await page(({d})=>d.querySelector('.ow-workspace').dataset.layout==='drawer'))
    await evaluate(`document.querySelector('iframe').style.width='${width}px'`);await wait(130)
    const restored=await page(({d,ui})=>({mode:d.querySelector('.ow-workspace').dataset.layout,prefs:[ui.outlineLeftWidth,ui.outlineRightWidth]}))
    check(label+' 回到宽屏恢复记忆尺寸',restored.mode==='docked'&&JSON.stringify(remembered)===JSON.stringify(restored.prefs),restored)
  }else{
    await click('.ow-mobile-controls button:first-child');await wait(80)
    const left=await page(({d})=>({left:d.querySelector('.ow-left').getBoundingClientRect().width,right:d.querySelector('.ow-right').getBoundingClientRect().width,dialog:d.querySelector('.ow-left').getAttribute('role')}))
    check(label+' 窄屏结构抽屉',left.left>0&&left.right===0&&left.dialog==='dialog',left)
    await click('.ow-scrim');await click('.ow-mobile-controls button:last-child');await wait(70)
    const right=await page(({d})=>({left:d.querySelector('.ow-left').getBoundingClientRect().width,right:d.querySelector('.ow-right').getBoundingClientRect().width,overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth}))
    check(label+' 窄屏单侧详情',right.left===0&&right.right>0&&!right.overflow,right)
    const trapped=await page(({w,d})=>{const controls=[...d.querySelectorAll('.ow-right button,.ow-right input,.ow-right textarea,.ow-right select')].filter(e=>!e.disabled&&e.getClientRects().length);controls.at(-1).focus();controls.at(-1).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return d.activeElement===controls[0]})
    check(label+' 抽屉键盘焦点留在当前面板',trapped)
    await page(({w})=>w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
    check(label+' Escape 关闭不改桌面偏好',await page(({d,ui})=>!d.querySelector('.ow-scrim')&&ui.outlineSideOpen&&ui.outlineDetailOpen))
  }
  const nested=await page(async({s,wait})=>{
    const relations=()=>s.liveOlnodes().reduce((sum,n)=>sum+(n.rels||[]).length,0),before=relations()
    const rejectSelf=s.olnodeMoveTo('g2','g2'),rejectDesc=s.olnodeMoveTo('g2','g123')
    const moved=s.olnodeMoveTo('e1','g12');const parent=s.olnodes.find(n=>n.id==='e1').parentId
    s.olnodeUndo();const undone=s.olnodes.find(n=>n.id==='e1').parentId;s.olnodeRedo();const redone=s.olnodes.find(n=>n.id==='e1').parentId
    s.olnodeMoveTo('e1','g1');s.canvasPrefs.expanded=['g1','g2','g3','g12','g123'];await s.saveCanvasPrefs();await wait(80)
    return{rejectSelf,rejectDesc,moved,parent,undone,redone,before,after:relations()}
  })
  check(label+' 三层嵌套移动、撤销、循环防护与关系保留',!nested.rejectSelf&&!nested.rejectDesc&&nested.moved&&nested.parent==='g12'&&nested.undone==='g1'&&nested.redone==='g12'&&nested.before===nested.after,nested)
  await page(async({s,wait})=>{s.selOlnodeId='e3';s.outlineView='text';await wait(120)})
  const textRoundtrip=await page(async({w,d,s,wait})=>{
    const editor=d.querySelector('.ol-editor'),before=editor.textContent;editor.textContent=before+'\n她把那页纸留了下来。';editor.dispatchEvent(new w.InputEvent('input',{bubbles:true}));
    s.outlineView='canvas';await wait(160);s.outlineView='text';await wait(120);return{kept:d.querySelector('.ol-editor').textContent.endsWith('她把那页纸留了下来。'),html:s.olnodes.find(n=>n.id==='e3').html}
  })
  check(label+' 文本与画布切换不丢内容',textRoundtrip.kept,textRoundtrip)
  await page(async({s,wait})=>{s.outlineView='canvas';await wait(200);s.canvasPrefs.expanded=['g1','g2','g3'];await s.saveCanvasPrefs();await wait(70)})
  // 实际工作层截图：进入第二卷，子容器仍可就地展开。
  await page(async({s,ui,wait},width)=>{s.outlineView='text';await wait(70);ui.outlineLeftWidth=220;ui.outlineRightWidth=318;s.canvasPrefs.scopeId='g2';s.canvasPrefs.expanded=['g1','g2','g3','g12'];s.canvasPrefs.cameras.g2={zoom:width<1100?.82:.95,tx:35,ty:width<1100?10:25};s.selOlnodeId='e3';s.outlineView='canvas';await wait(250)},width)
  check(label+' 创建工具与缩放无交叠',await page(({d})=>{const a=d.querySelector('.draft-create').getBoundingClientRect(),b=d.querySelector('.draft-zoom').getBoundingClientRect();return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top}))
  check(label+' 跨层提示位于画布之外',await page(({d})=>{const a=d.querySelector('.draft-cross-lanes'),b=d.querySelector('.oc-canvas');return !a||a.getBoundingClientRect().bottom<=b.getBoundingClientRect().top}))
  check(label+' 画布预留底部工具安全区',await page(({d})=>d.querySelector('.oc-canvas').getBoundingClientRect().bottom<=d.querySelector('.draft-create').getBoundingClientRect().top))
  if(module==='outline'&&width===1440){
    // 真实拖动顶层事件进入当前可见的子容器，不经 store 模拟落点。
    const points=await page(({d})=>{
      const a=d.querySelector('.oc-node[data-node-id="e3"]').getBoundingClientRect(),b=d.querySelector('.oc-node[data-node-id="g12"]').getBoundingClientRect();
      return{from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:b.x+b.width/2,y:b.y+100}}
    })
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...points.from,button:'left',clickCount:1})
    for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.from.x+(points.to.x-points.from.x)*i/8,y:points.from.y+(points.to.y-points.from.y)*i/8,button:'left',buttons:1})
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.to,button:'left',clickCount:1});await wait(150)
    check('真实节点拖入子容器',await page(({s})=>s.olnodes.find(n=>n.id==='e3').parentId==='g12'))
    await page(async({s,wait})=>{s.olnodeUndo();await wait(100)})
    check('真实拖动一次撤销恢复层级',await page(({s})=>s.olnodes.find(n=>n.id==='e3').parentId==='g2'))
    const mini=await page(({d})=>{const a=d.querySelector('[data-mini-id="e4"]').getBoundingClientRect(),c=d.querySelector('.oc-canvas').getBoundingClientRect();return{from:{x:a.x+a.width/2,y:a.y+35},to:{x:c.right-80,y:c.y+160}}})
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...mini.from,button:'left',clickCount:1})
    for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:mini.from.x+(mini.to.x-mini.from.x)*i/8,y:mini.from.y+(mini.to.y-mini.from.y)*i/8,button:'left',buttons:1})
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...mini.to,button:'left',clickCount:1});await wait(100)
    check('真实迷你卡拖出容器',await page(({s})=>s.olnodes.find(n=>n.id==='e4').parentId==='g2'))
    await page(({s})=>s.olnodeUndo())
    check('拖出后撤销恢复嵌套',await page(({s})=>s.olnodes.find(n=>n.id==='e4').parentId==='g12'))
    // 新增入口和右栏输入、删除均走真实组件事件。
    await click('.draft-head-tools .btn.light');await wait(100)
    const temp=await page(({s})=>s.liveOlnodes().find(n=>!['g1','g2','g3','g12','g123','e1','e2','e3','e4','e5','e6','n1'].includes(n.id))?.id)
    check('工具栏可真实新增模块',!!temp,temp)
    if(temp){
      await page(async({s,wait},id)=>{s.selOlnodeId=id;await wait(80)},temp)
      await click('.oc-drawer [aria-label="编辑标题"]');await page(({w,d})=>{const input=d.querySelector('.oc-drawer [data-edit="title"]');input.value='临时验收便签';input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})
      check('右侧详情编辑接入节点',await page(({s},id)=>s.olnodes.find(n=>n.id===id).title==='临时验收便签',temp))
      await click('.oc-drawer [aria-label="编辑情节梗概"]')
      await page(({w,d})=>{const input=d.querySelector('[data-edit="body"]');input.value='她在黎明前读完了信。';input.dispatchEvent(new w.Event('input',{bubbles:true}))})
      const split=await page(({d})=>{const r=d.querySelector('.ow-right-resizer').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...split,button:'left',clickCount:1})
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:split.x-12,y:split.y,button:'left',buttons:1})
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:split.x-12,y:split.y,button:'left',clickCount:1});await wait(70)
      check('调宽保留原位编辑焦点且不提前提交',await page(({d,s},id)=>d.activeElement===d.querySelector('[data-edit="body"]')&&s.olnodes.find(n=>n.id===id).text!=='她在黎明前读完了信。',temp))
      await page(({w,d})=>d.querySelector('[data-edit="body"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true})))
      await click('.detail-status');await wait(80)
      await page(({d})=>[...d.querySelectorAll('.draft-status-options button')].find(e=>e.textContent==='已完成').click())
      await wait(1500)
      const persisted=await page(async({w,s},id)=>{const row=await w.__ns.db.olnodes.get(id);return{title:row?.title,text:row?.text,status:row?.status,inMemory:s.olnodes.find(n=>n.id===id).text}},temp)
      check('详情原位摘要与状态实际落盘',persisted.title==='临时验收便签'&&persisted.text==='她在黎明前读完了信。'&&persisted.status==='done'&&persisted.inMemory===persisted.text,persisted)
      const beforeOther=await page(({s})=>s.olnodes.find(n=>n.id==='e3').title)
      const chooseOther=async()=>{
        const p=await page(({d})=>{const r=d.querySelector('.oc-node[data-node-id="e3"] h3').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
        await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await wait(100)
      }
      await click('.oc-drawer [aria-label="编辑标题"]');await page(({w,d})=>{const input=d.querySelector('[data-edit="title"]');input.value='切换前编辑的标题';input.dispatchEvent(new w.Event('input',{bubbles:true}))})
      await chooseOther()
      check('实际点击另一卡片提交原节点标题且不串写',await page(({s},id,title)=>s.selOlnodeId==='e3'&&s.olnodes.find(n=>n.id===id).title==='切换前编辑的标题'&&s.olnodes.find(n=>n.id==='e3').title===title,temp,beforeOther))
      await page(async({s,wait},id)=>{s.selOlnodeId=id;await wait(80)},temp)
      await click('.oc-drawer [aria-label="编辑情节梗概"]');await page(({w,d})=>{const input=d.querySelector('[data-edit="body"]');input.value='切换前尚未失焦的摘要。';input.dispatchEvent(new w.Event('input',{bubbles:true}))})
      await chooseOther()
      check('实际点击另一卡片提交原节点摘要',await page(({s},id)=>s.olnodes.find(n=>n.id===id).text==='切换前尚未失焦的摘要。',temp))
      await page(async({s,wait},id)=>{s.selOlnodeId=id;await wait(80)},temp)
      await click('[aria-label="更多节点操作"]');await wait(80);await click('.draft-node-more .oc-drawer-foot button');await click('.draft-node-more .oc-drawer-foot button');await wait(100)
      check('删除选中模块后显示空态',await page(({d,s},id)=>!s.liveOlnodes().some(n=>n.id===id)&&!!d.querySelector('.ow-detail-empty'),temp))
      await page(({s})=>{s.selOlnodeId='e3'})
    }
    const beforeAdd=await page(async({s,wait})=>{s.outlineView='text';await wait(100);return s.liveOlnodes().length})
    await click('[aria-label="添加模块"]');await wait(80)
    await page(({d})=>{const option=[...d.querySelectorAll('.n-dropdown-option-body')].find(el=>el.textContent==='添加便签');if(!option)throw Error('Missing add note menu');option.click()});await wait(200)
    check('文本视图侧栏添加菜单有效',await page(({s},count)=>s.outlineView==='canvas'&&s.liveOlnodes().length===count+1&&s.olnodes.find(n=>n.id===s.selOlnodeId)?.kind==='note',beforeAdd))
    await page(async({s,wait})=>{if(s.olnodes.find(n=>n.id===s.selOlnodeId)?.title==='新便签')s.olnodeRemove(s.selOlnodeId);s.selOlnodeId='e3';s.outlineView='canvas';await wait(100)})
  }
  if(width<1100){
    const canvasShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    await writeFile(join(OUT,'screenshots',label+'-canvas.png'),Buffer.from(canvasShot.data,'base64'))
    await click('.ow-mobile-controls button:last-child')
  }
  await wait(3200)
  const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  await writeFile(join(OUT,'screenshots',label+'.png'),Buffer.from(data,'base64'))
  if(module==='outline'&&width===1440){
    await click('.ol-side-toggle');await wait(120)
    const collapsed=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    await writeFile(join(OUT,'screenshots',label+'-collapsed.png'),Buffer.from(collapsed.data,'base64'))
  }
  if(module==='outline'&&width===1440){
    await page(async({ui})=>{await ui.setPref('outlineLeftWidth',285);await ui.setPref('outlineRightWidth',361);await ui.setPref('outlineSideOpen',false);await ui.setPref('outlineDetailOpen',false)})
    await evaluate("document.querySelector('iframe').contentWindow.location.reload()")
    let restored=false
    for(let i=0;i<160;i++){await wait(100);if(await evaluate("!!document.querySelector('iframe')?.contentDocument?.querySelector('.ow-left-rail')")){restored=true;break}}
    const reload=restored?await page(({ui,d})=>({left:ui.outlineLeftWidth,right:ui.outlineRightWidth,leftOpen:ui.outlineSideOpen,rightOpen:ui.outlineDetailOpen,rails:!!d.querySelector('.ow-left-rail')&&!!d.querySelector('.ow-right-rail')})):null
    check('实际刷新恢复独立尺寸及两侧收放偏好',reload?.left===285&&reload?.right===361&&!reload?.leftOpen&&!reload?.rightOpen&&reload?.rails,reload)
  }
  await cdp.send('Target.closeTarget',{targetId})
 }
 await writeFile(join(OUT,'report.json'),JSON.stringify({at:new Date().toISOString(),results},null,2))
 check('全部场景',results.every(r=>r.pass))
 if(results.some(r=>!r.pass))process.exitCode=1
}finally{cdp.close();proc.kill();server.close()}
