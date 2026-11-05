// 独立无头浏览器；不读取用户浏览器数据，不启动插件 RPC。
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const OUT=fileURLToPath(new URL('../',import.meta.url))
const ROOT=path.resolve(OUT,'../../..')
const PORT=19447
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn(process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--hide-scrollbars','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',
  '--allow-file-access-from-files',`--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(ROOT,'.tmp/outline-design-browser')}`,'--window-size=1440,900','about:blank'
],{stdio:'ignore'})
let socket
try {
  let url
  for(let i=0;i<70;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);url=(await r.json()).webSocketDebuggerUrl;break}catch{await wait(150)}}
  if(!url)throw Error('Headless Chrome did not start')
  socket=new WebSocket(url)
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j})
  let seq=0;const pending=new Map(),errors=[]
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown'||m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params)}
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  await call('Page.enable');await call('Runtime.enable');await call('Log.enable')
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  const open=async(file)=>{await call('Page.navigate',{url:pathToFileURL(file).href});await wait(500);await evaluate('document.fonts.ready.then(()=>true)');await wait(250)}
  const shot=async(file,format='png')=>{const {data}=await call('Page.captureScreenshot',{format,captureBeyondViewport:false,...(format==='webp'?{quality:95}:{})});await writeFile(file,Buffer.from(data,'base64'))}
  await mkdir(path.join(OUT,'assets'),{recursive:true});await mkdir(path.join(OUT,'screenshots'),{recursive:true})
  if(process.argv.includes('--background')){
    await open(path.join(ROOT,'docs/前端美化/书架-流动封面-20261103/index.html'))
    const stats=await evaluate(`(()=>{document.querySelectorAll('#app > :not(.backdrop)').forEach(el=>el.style.display='none');backend.setReducedMotion(true);backend.setPalette(paletteOf(BOOKS.find(b=>b.title==='长夜将明')||BOOKS[0]),{duration:0});return window.__latentStats()})()`)
    await wait(100);await shot(path.join(OUT,'assets/backdrop.webp'),'webp')
    console.log(JSON.stringify({background:'书架原渲染器 · 长夜将明 · 冻结帧',stats,errors},null,2))
  }else{
    const report=[]
    for(const file of ['a-panorama','b-workbench','c-volumes']){
      await open(path.join(OUT,file+'.html'))
      const metrics=await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.node')];const cards=nodes.map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.node,x:r.x,y:r.y,w:r.width,h:r.height}});const chrome=[...document.querySelectorAll('.creation,.zoom,.detail')].map(e=>({name:e.className,r:e.getBoundingClientRect()}));const overlaps=cards.flatMap(c=>chrome.filter(({r})=>Math.min(c.x+c.w,r.right)-Math.max(c.x,r.left)>1&&Math.min(c.y+c.h,r.bottom)-Math.max(c.y,r.top)>1).map(t=>({node:c.id,chrome:t.name})));return {viewport:[innerWidth,innerHeight],nodes:cards.length,events:nodes.filter(n=>n.classList.contains('event')).length,edges:document.querySelectorAll('[data-edge]').length,containers:document.querySelectorAll('[data-container]').length||3,fontLoaded:document.fonts.check('500 24px "Noto Serif SC"','长夜将明'),outside:cards.filter(c=>c.x<0||c.y<0||c.x+c.w>1440||c.y+c.h>900),overlaps,bodyOverflow:document.documentElement.scrollWidth>1440,missingAssets:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src),cards}})()`)
      metrics.edgeOcclusion=await evaluate(`(()=>{
        const cards=[...document.querySelectorAll('.node')].map(el=>({id:el.dataset.node,r:el.getBoundingClientRect()}));
        return [...document.querySelectorAll('[data-edge]')].flatMap(g=>{
          const ends=g.dataset.edge.split(':');const p=g.querySelector('path');const m=p.getScreenCTM();const len=p.getTotalLength();
          const hits=new Set();
          for(let n=1;n<200;n++){const q=p.getPointAtLength(n*len/200);const v=new DOMPoint(q.x,q.y).matrixTransform(m);for(const c of cards)if(!ends.includes(c.id)&&v.x>c.r.left+2&&v.x<c.r.right-2&&v.y>c.r.top+2&&v.y<c.r.bottom-2)hits.add(c.id)}
          const label=g.querySelector('rect').getBoundingClientRect();const labels=cards.filter(c=>Math.min(c.r.right,label.right)-Math.max(c.r.left,label.left)>2&&Math.min(c.r.bottom,label.bottom)-Math.max(c.r.top,label.top)>2).map(c=>c.id);
          return hits.size||labels.length?[{edge:g.dataset.edge,pathHits:[...hits],labelHits:labels}]:[];
        })
      })()`)
      await shot(path.join(OUT,'screenshots',file+'.png'))
      report.push({file,...metrics})
    }
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:560,deviceScaleFactor:1,mobile:false})
    await open(path.join(OUT,'style-explorer.html'))
    const explorer=await evaluate(`({title:document.title,frames:document.querySelectorAll('iframe').length,bodyOverflow:document.documentElement.scrollWidth>innerWidth})`)
    await shot(path.join(OUT,'screenshots/comparison.png'))
    const result={capturedAt:new Date().toISOString(),report,explorer,errors}
    await writeFile(path.join(OUT,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
    if(errors.length||report.some(r=>r.outside.length||r.overlaps.length||r.edgeOcclusion.length||r.bodyOverflow||!r.fontLoaded||r.nodes!==9||r.edges!==9))process.exitCode=1
  }
}finally{socket?.close();chrome.kill()}
