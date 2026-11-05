/* 同源临时作品库中的真实插件与原设计稿：相同章节、目标、宽度，保留未修改的设计稿。 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { HARNESS, launchChrome, cdpClient } from './verify-app.mjs'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'docs/diagnostics/writing-design-20261104')
const design = join(root, 'docs/前端美化/正文-伏案静水-20261103')
const ctx = { window: {} }
runInNewContext(await readFile(join(design, 'parts/content.js'), 'utf8'), ctx)
const chapter = ctx.window.NS_CONTENT.chapters.find(c => c.id === 'c3')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
await mkdir(out, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (path === '/harness.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HARNESS); return }
    const file = path.startsWith('/api/novelstudio/app/') ? resolve(root, 'assets/app', path.slice(21))
      : path.startsWith('/reference/') ? resolve(design, path.slice(11)) : null
    if (!file || (!file.startsWith(root + '\\') && !file.startsWith(root + '/'))) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': (types[extname(file)] || 'application/octet-stream') + (['.html', '.css', '.js'].includes(extname(file)) ? '; charset=utf-8' : '') })
    res.end(await readFile(file))
  } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port
const { proc, wsUrl } = await launchChrome()
const cdp = await cdpClient(wsUrl)
const results = []
async function waitFor(send, expression) {
  for (let i = 0; i < 200; i++) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.result?.value) return r.result.value
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('页面未就绪: ' + expression)
}
try {
  for (const width of [695, 1280]) {
    for (const kind of ['reference', 'plugin']) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      const send = (method, params) => cdp.send(method, params, sessionId)
      await send('Page.enable')
      await send('DOM.enable')
      await send('CSS.enable')
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Page.navigate', { url: origin + (kind === 'reference' ? '/reference/index.html?scene=writing&bg=ink' : '/harness.html?module=chapters&vw=' + width) })
      if (kind === 'plugin') {
        await waitFor(send, 'window.__NS_VERIFY_RESULT')
        const expression = `(async () => {
          const f=document.querySelector('iframe'), w=f.contentWindow, store=w.__ns.getWork();
          const ui=w.document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui');
          ui.sidePanelOpen=false; ui.rightPanelOpen=false;
          for(const p of w.document.querySelectorAll('.n-popover')) p.style.display='none';
          const c=${JSON.stringify(chapter)};
          const target=store.chapters[2];
          Object.assign(target,{title:c.title,content:c.text,fmt:'text',wordCount:c.words,status:'writing'});
          store.wordGoal=3000;store.selChapterId=target.id;
          await w.document.fonts.ready;
          return true;
        })()`
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      }
      await waitFor(send, kind === 'plugin' ? `document.querySelector('iframe').contentDocument.querySelector('.tiptap')?.textContent.includes('四点二十')` : `document.querySelector('.tiptap')?.textContent.includes('四点二十')`)
      const metric = await send('Runtime.evaluate', { expression: `(async()=>{
        const d=${kind === 'plugin' ? "document.querySelector('iframe').contentDocument" : 'document'}, w=d.defaultView;
        await d.fonts.ready;
        const selectors=${JSON.stringify(kind === 'plugin' ? ['.editor-head','.editor-toolbar','.rich-host','.tiptap'] : ['.ed-head','.editor-toolbar','.paper','.tiptap'])};
        const data=selectors.map(s=>{const e=d.querySelector(s),r=e.getBoundingClientRect(),c=w.getComputedStyle(e);return {selector:s,x:r.x,y:r.y,width:r.width,height:r.height,padding:c.padding,font:c.fontFamily,fontSize:c.fontSize,lineHeight:c.lineHeight,background:c.backgroundImage}});
        const h=d.querySelector(selectors[0]).getBoundingClientRect(), p=d.querySelector(selectors[2]).getBoundingClientRect();
        return {data,clip:{x:Math.max(0,p.x-2),y:Math.max(0,h.y-6),width:p.width+4,height:Math.min(870,900-h.y+6),scale:1}};
      })()`, awaitPromise: true, returnByValue: true })
      const value = metric.result.value
      // Capture a stable frame after fonts/layout; the background remains the production shader.
      await new Promise(r => setTimeout(r, 400))
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: value.clip })
      const file = kind + '-' + width + '.png'
      await writeFile(join(out, file), Buffer.from(shot.data, 'base64'))
      results.push({ kind, width, file, ...value })
      await cdp.send('Target.closeTarget', { targetId })
    }
  }
  await writeFile(join(out, 'metrics.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results.map(r=>({kind:r.kind,width:r.width,file:r.file,metrics:r.data})), null, 2))
} finally {
  cdp.close(); proc.kill(); server.close()
}
process.exit(0)
