import {writeFile} from 'node:fs/promises'
process.env.NS_VERIFY_OUT='.tmp-lore-explorer'
const {launchChrome,cdpClient}=await import('../../../../scripts/verify-app.mjs')
const {proc,wsUrl}=await launchChrome(),cdp=await cdpClient(wsUrl)
try{
const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}),send=(m,p)=>cdp.send(m,p,sessionId)
await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:process.argv[2]||'http://127.0.0.1:57890/style-explorer.html'});await new Promise(r=>setTimeout(r,1700))
const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL('../screenshots/comparison.png',import.meta.url),Buffer.from(data,'base64'))
const {targetInfos}=await cdp.send('Target.getTargets'),results=[]
for(const target of targetInfos.filter(t=>t.type==='iframe')){
 const {sessionId:child}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});await cdp.send('Runtime.enable',{},child)
 const r=await cdp.send('Runtime.evaluate',{expression:`(()=>{if(!window.__loreReady)return null;document.querySelector('[data-action=edit]').click();const input=document.querySelector('[data-edit=title]');input.value='预览内交互检查';input.dispatchEvent(new InputEvent('input',{bubbles:true}));const pending=document.querySelector('#save-status').textContent;document.querySelector('[data-action=save-edit]').click();return{variant:document.body.dataset.variant,title:__lorePrototype.model.node('lighthouse').title,pending,save:document.querySelector('#save-status').textContent}})()`,returnByValue:true},child)
 if(r.result?.value)results.push(r.result.value)
}
console.log(JSON.stringify(results,null,2));const variants=new Set(results.filter(r=>r.title==='预览内交互检查'&&r.pending==='待保存'&&r.save==='已更新').map(r=>r.variant));if(variants.size!==3)throw Error('Interactive comparison incomplete')
await writeFile(new URL('../explorer-report.json',import.meta.url),JSON.stringify({sandbox:'allow-scripts allow-forms; session state within embedded previews',results},null,2))
}finally{cdp.close();proc.kill()}
