// Approved draft vs actual application: same viewport, selected story and frozen background.
import { createServer } from 'node:http'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve,join,extname } from 'node:path'
import { execFileSync } from 'node:child_process'
process.env.NS_VERIFY_OUT='.tmp-outline-comparison'
const {HARNESS,launchChrome,cdpClient}=await import('./verify-app.mjs')
const REF=resolve('docs/前端美化/大纲-三版探索-20261104'),APP=resolve('assets/app'),OUT=resolve('docs/前端美化/大纲-B融合落地-20261104')
await mkdir(join(OUT,'screenshots'),{recursive:true})
const DATA=JSON.parse(await readFile(join(REF,'content.json'),'utf8'))
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'}
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local');if(u.pathname==='/harness.html'){res.setHeader('content-type','text/html');res.end(HARNESS.replace('var VH = 860;','var VH = 900;'));return}
 const base=u.pathname.startsWith('/reference/')?REF:APP,rel=decodeURIComponent(u.pathname.replace(/^\/(reference\/|api\/novelstudio\/app\/)/,'')),file=resolve(base,rel)
 if(!file.startsWith(base+'/')&&!file.startsWith(base+'\\')){res.writeHead(403);res.end();return}
 res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file))
}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin='http://127.0.0.1:'+server.address().port,{proc,wsUrl}=await launchChrome(),cdp=await cdpClient(wsUrl),wait=ms=>new Promise(r=>setTimeout(r,ms))
const results={reference:'B · 编排工作台',viewport:[1440,900],geometry:{},differences:['画布按真实容器层级显示，采用 C 的容器与嵌套；参考 B 为平铺情节。','主区统计、关系标签及人物顺序来自实际数据和当前层级。','创建栏向左移 17.5px，以消除参考稿与缩放控件的交叠。','跨层提示独立占行；画布底部保留 78px / 122px 工具安全区。'],checks:[]}
try{
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}),send=(m,p)=>cdp.send(m,p,sessionId)
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
 const page=fn=>ev(`(async()=>{const f=document.querySelector('iframe'),w=f.contentWindow,d=f.contentDocument,s=w.__ns.getWork(),ui=d.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui'),wait=ms=>new Promise(r=>setTimeout(r,ms));return (${fn.toString()})({f,w,d,s,ui,wait})})()`)
 const shot=async name=>{const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(OUT,'screenshots',name+'.png'),Buffer.from(data,'base64'))}
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await send('Page.navigate',{url:origin+'/reference/b-workbench.html'});await wait(350);await ev('document.fonts.ready.then(()=>true)');await shot('01-reference-b')
 results.referenceTypography=await ev(`Object.fromEntries(['.brand','.brand small','.b-heading h1','.tree-heading','.tree-search','.tree-group strong','.tree-item','.b-detail h2','.detail-content p','.relation-row','.relation-row>div','.relation-text','.relation-text>span'].map(sel=>{const e=document.querySelector(sel),c=getComputedStyle(e),r=e.getBoundingClientRect();return [sel,{font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,lineHeight:c.lineHeight,x:r.x,y:r.y,height:r.height}]}))`)
 results.referenceGeometry=await ev(`Object.fromEntries(['.b-tree','.b-main','.b-detail','.topbar','.creation','.zoom'].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return [sel,{x:r.x,y:r.y,width:r.width,height:r.height}]}))`)
 results.referenceCard=await ev(`(()=>{const r=document.querySelector('.node.selected').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`)
 await send('Page.navigate',{url:origin+'/harness.html?module=outline&vw=1440'})
 let ready=false;for(let i=0;i<200;i++){await wait(100);if(await ev('!!window.__NS_VERIFY_RESULT')){ready=true;break}}if(!ready)throw Error('Harness timeout')
 await ev(`window.__outlineFixture=${JSON.stringify(DATA)}`)
 await page(async({f,w,d,s,ui,wait})=>{
  const fixture=f.ownerDocument.defaultView.__outlineFixture;s.olnodes=[];s.work.title=fixture.title
  for(const [key,value]of Object.entries({outlineLeftWidth:220,outlineRightWidth:318,outlineSideOpen:true,outlineDetailOpen:true}))await ui.setPref(key,value)
  for(const [i,g]of fixture.groups.entries())s.olnodes.push({id:g.id,kind:'container',title:g.name,text:g.summary,chapter:g.range,workId:s.work.id,parentId:null,canvasX:i*540,canvasY:0,w:460,sortOrder:i*1000,rels:[]})
  const positions={e1:[30,20],e2:[280,20],e3:[30,20],e4:[280,20],e5:[30,20],e6:[280,20],n1:[30,220],q1:[280,220],a1:[30,400]}
  for(const n of fixture.nodes){const [x,y]=positions[n.id];s.olnodes.push({...n,status:({'已完成':'done','进行中':'writing','待展开':'planned'})[n.status]||'',parentId:n.group||(n.id==='n1'?'g1':n.id==='q1'?'g2':'g2'),workId:s.work.id,canvasX:x,canvasY:y,mtype:n.number||'',sortOrder:s.olnodes.length*1000,rels:[],...(n.id==='q1'?{refId:'character:lin'}:{}),...(n.id==='a1'?{refId:'chapter17'}:{})})}
  s.characters.push({id:'lin',workId:s.work.id,name:'林照'},{id:'shen',workId:s.work.id,name:'沈砚'});s.chapters.push({id:'chapter17',workId:s.work.id,title:'第 17 章 · 无灯之海',content:'凌晨三点，海面上所有的光都熄灭了。',wordCount:23})
  s.olnodes.find(n=>n.id==='e3').text+='\n\n沈砚第一次意识到，父亲的失踪并不是一场意外。'
  for(const e of fixture.edges)s.olnodeRelAdd(e.from,e.to,{label:e.label,kind:e.type==='dashed'?'伏笔':'因果',...(e.type==='dashed'?{style:'dashed'}:{})})
  s.olnodes.find(n=>n.id==='e3').w=216;s.olnodes.find(n=>n.id==='e3').h=149
  s.outlineView='text';await wait(100);s.canvasPrefs.scopeId='g2';s.canvasPrefs.expanded=['g1','g2','g3'];s.canvasPrefs.cameras.g2={zoom:1,tx:15,ty:25};s.selOlnodeId='e3';s.outlineView='canvas';await wait(200)
  const background=d.querySelector('.st-backdrop-wrap');background.style.backgroundImage='url('+f.ownerDocument.defaultView.location.origin+'/reference/assets/backdrop.webp)';background.style.backgroundSize='cover';background.querySelectorAll('canvas,.st-layer').forEach(el=>el.style.visibility='hidden');await d.fonts.ready;await wait(1300)
 })
 results.actualTypography=await page(({d,w})=>Object.fromEntries(['.brand','.brand small','.draft-canvas-head h1','.tree-heading','.tree-search','.tree-container','.tree-item:not(.tree-container)','.tree-name','.draft-detail h2','.detail-content p','.relation-row','.relation-row>div','.relation-text','.relation-text>span'].map(sel=>{const e=d.querySelector(sel),c=w.getComputedStyle(e),r=e.getBoundingClientRect();return [sel,{font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,lineHeight:c.lineHeight,x:r.x,y:r.y,height:r.height}]})))
 results.geometry=await page(({d})=>Object.fromEntries(['.ow-left','.ow-main','.ow-right','.outline-topbar','.draft-create','.draft-zoom'].map(sel=>{const r=d.querySelector(sel).getBoundingClientRect();return [sel,{x:r.x,y:r.y,width:r.width,height:r.height}]})))
 results.actualCard=await page(({d})=>{const r=d.querySelector('.oc-node.node.selected').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 for(const [sel,x,y,width,height]of [['.ow-left',28,108,220,762],['.ow-main',264,108,814,762],['.ow-right',1094,108,318,762],['.outline-topbar',0,0,1440,84]]){const actual=results.geometry[sel],expected={x,y,width,height};results.checks.push({name:sel,pass:Object.keys(expected).every(k=>Math.abs(actual[k]-expected[k])<=1),actual,expected})}
 await shot('02-actual-b-chrome')
 // Containers are a separate C-reference scene; the main B chrome remains unchanged.
 await page(async({s,wait})=>{s.outlineView='text';await wait(80);s.canvasPrefs.scopeId=null;s.canvasPrefs.cameras.root={zoom:.48,tx:20,ty:45};s.selOlnodeId='e3';s.outlineView='canvas';await wait(200)})
 await shot('03-container-overview')
 await page(async({s,wait})=>{s.outlineView='text';await wait(80);s.canvasPrefs.cameras.root={zoom:.95,tx:20,ty:45};s.selOlnodeId='g1';s.outlineView='canvas';await wait(200)})
 await shot('08-container-readable')
 await page(async({s,wait})=>{s.outlineView='text';await wait(80);s.canvasPrefs.cameras.root={zoom:.48,tx:20,ty:45};s.selOlnodeId='e3';s.outlineView='canvas';await wait(200)})
 await page(async({d,wait})=>{d.querySelector('.ol-side-toggle').click();await wait(120)});await shot('04-a-collapse')
 results.consoleErrors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)
 await writeFile(join(OUT,'comparison-report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
 if(results.checks.some(c=>!c.pass)||results.consoleErrors.length)process.exitCode=1
}finally{cdp.close();proc.kill();server.close()}
execFileSync('python',['scripts/outline-diff.py',OUT],{stdio:'inherit'})
