/* compare:settings —— 设置工作区的几何/样式对稿（1440×900 为主档，误差 >1px 记 FAIL）。
 *
 * 与 verify:app 的分工：verify 判「行为与形态」（点得动、搜得到、真下载真恢复），
 * 这里判「数值」——把设计总稿与真机产物摆在一张表里逐项量，两边同时测量取差。
 *
 * 两份页面：
 *   ① 总稿 docs/前端美化/设置-总设计稿-20261105/index.html?static
 *      （?static 关掉流动底画布，量的是版式不是背景；自带静态服务会把 assets/ 子目录一起端出去）
 *   ② 产物 assets/app/index.html?embed=1，挂在 verify-app 的 HARNESS 里，等 window.__NS_INSPECT_READY
 *      （?inspect=1 只把页面带到设置视图、不跑断言探针，量的是默认偏好下的干净版面）
 *
 * 同名 class 映射：总稿 .workspace 就是产物的 .settings-shell（前者挂在 body 上、后者 fixed 到视口，
 * inset 数值相同），所以两边都以各自的根选择器为准，底下逐项取同名 class。
 *
 * 期望值出处：docs/前端美化/设置-总设计稿-20261105/studio.css 与
 *            app/plugin/dsh/settings-fusion.css（1:1 移植，逐条数值相同）。
 *
 * 产物：.tmp-verify-app/settings-compare-report.json（逐项 期望/原型/产物/差值/通过）
 *       .tmp-verify-app/settings-compare/*.png（1280/1000/760/380 四档：三页 + 抽屉 + 手机预览，两侧各一套）
 *
 * 用法：node scripts/compare-settings.mjs   （先 npm run build:app）
 */
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, cdpClient, serve } from './verify-app.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = resolve(REPO, '.tmp-verify-app')
const SHOTS = join(OUT, 'settings-compare')
const PROTOTYPE = resolve(REPO, 'docs/前端美化/设置-总设计稿-20261105')
const VH = 900
const CHROME = process.env.NS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TOL = 1
const PAGES = ['appearance', 'data', 'about']
const WIDTHS = [1280, 1000, 760, 380]

/* 设计常量：studio.css（总稿）/ settings-fusion.css（产物）逐条相同，故只有一张表。
   两个 grid 列宽不是写死的常量（minmax + fr），单列成「两列合计 + 间距 = 内容宽」来判。 */
const SPEC = {
  'side-pane 宽': 236,
  'main-pane 宽': 1132,
  'page-head padding-top': 25,
  'page-head min-height': 119,
  'page-head h1 字号': 28,
  'page-foot min-height': 53,
  'nav-head padding-top': 26,
  'nav-head padding-right': 23,
  'nav-head padding-bottom': 21,
  'search-box padding-top': 9,
  'search-box padding-left': 10,
  'category min-height': 74,
  'appearance-layout gap': 36,
  'setting-row min-height': 90,
  'setting-row padding-top': 21,
  'select 宽': 186,
  'size-stepper 高': 38,
  'preview-column padding-left': 29,
  'preview-column 左边框': 1,
  'preview-chrome 高': 35,
  'preview-paper max-height': 390,
  'preview-paper padding-top': 30,
  'preview-paper padding-right': 29,
  'preview-paper padding-bottom': 25,
  'preview-copy 字号': 17,
  'preview-copy 行高': 33.15,
  'data-layout gap': 42,
  'data-layout 右列宽': 290,
  'data-aside padding-left': 26,
  'action-row min-height': 74,
  'about-layout gap': 55,
  'about-layout max-width': 1040,
  'about-mark 宽': 60,
  'about-mark 高': 77,
  'keyboard-panel padding-left': 26
  /* 侧栏页脚 .nav-foot 不写进这张表：它判三件事（display:block / white-space:normal /
     strong 与 p 不同行）加高度 ±1，单独在下面按硬判据入表。高度两侧现在都是 87px：
     T3 第 3 轮给 .nav-foot 补了 font-size:14px;line-height:1.65，把 themes.css 裸规则泄漏的
     10px strut 抵消掉了；明细仍留在报告的 setup 段，供以后 3px 级别的偏差直接定位。 */
}
/* 字族行：字符串精确相等（两边都取第一个字族名，比较的是「用哪套字形」，不含兜底家族差异） */
const FAM_ROWS = ['page-head h1 字族', 'preview-copy 字族']
const FAM_SPEC = { 'page-head h1 字族': 'Noto Serif SC', 'preview-copy 字族': 'Noto Serif SC' }
const PAGE_OF = {
  'side-pane 宽': 'appearance',
  'main-pane 宽': 'appearance',
  'page-head padding-top': 'appearance',
  'page-head min-height': 'appearance',
  'page-head h1 字号': 'appearance',
  'page-head h1 字族': 'appearance',
  'page-foot min-height': 'appearance',
  'nav-head padding-top': 'appearance',
  'nav-head padding-right': 'appearance',
  'nav-head padding-bottom': 'appearance',
  'search-box padding-top': 'appearance',
  'search-box padding-left': 'appearance',
  'category min-height': 'appearance',
  'appearance-layout gap': 'appearance',
  'setting-row min-height': 'appearance',
  'setting-row padding-top': 'appearance',
  'select 宽': 'appearance',
  'size-stepper 高': 'appearance',
  'preview-column padding-left': 'appearance',
  'preview-column 左边框': 'appearance',
  'preview-chrome 高': 'appearance',
  'preview-paper max-height': 'appearance',
  'preview-paper padding-top': 'appearance',
  'preview-paper padding-right': 'appearance',
  'preview-paper padding-bottom': 'appearance',
  'preview-copy 字号': 'appearance',
  'preview-copy 行高': 'appearance',
  'preview-copy 字族': 'appearance',
  'data-layout gap': 'data',
  'data-layout 右列宽': 'data',
  'data-aside padding-left': 'data',
  'action-row min-height': 'data',
  'about-layout gap': 'about',
  'about-layout max-width': 'about',
  'about-mark 宽': 'about',
  'about-mark 高': 'about',
  'keyboard-panel padding-left': 'about'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---- 页内量具与导航：整段 toString() 注进目标页面求值，所以只能用参数与字面量。 ---- */
function NS_NAV(doc, page) {
  var btn = doc.querySelector('.category[data-page="' + page + '"]')
  if (!btn) return false
  btn.click()
  return true
}

function NS_MEASURE(doc, win, ROOT) {
  function q(sel) { return doc.querySelector(ROOT + ' ' + sel) }
  function cs(sel) { var n = q(sel); return n ? win.getComputedStyle(n) : null }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : null }
  function box(sel) { var n = q(sel); if (!n) return null; var r = n.getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 } }
  function prop(sel, name) { var c = cs(sel); return c ? num(c[name]) : null }
  function fam(sel) {
    var c = cs(sel)
    if (!c) return null
    var f = String(c.fontFamily || '').split(',')[0].trim()
    return f.replace(/^["']/, '').replace(/["']$/, '')
  }
  function gridCols(sel) {
    var c = cs(sel)
    if (!c) return null
    var parts = String(c.gridTemplateColumns || '').trim().split(/\s+/)
    var out = []
    for (var i = 0; i < parts.length; i++) { var v = num(parts[i]); if (v !== null) out.push(v) }
    return out
  }
  function contentWidth(sel) {
    var n = q(sel)
    if (!n) return null
    var c = win.getComputedStyle(n)
    var w = n.clientWidth - num(c.paddingLeft) - num(c.paddingRight)
    return Math.round(w * 100) / 100
  }
  var out = {}
  var hasAppearance = !!q('.appearance-layout')
  var hasData = !!q('.data-layout')
  var hasAbout = !!q('.about-layout')
  var sp = box('.side-pane'), mp = box('.main-pane')
  out['side-pane 宽'] = sp ? sp.w : null
  out['main-pane 宽'] = mp ? mp.w : null
  out['page-head padding-top'] = prop('.page-head', 'paddingTop')
  out['page-head min-height'] = prop('.page-head', 'minHeight')
  out['page-head h1 字号'] = prop('.page-head h1', 'fontSize')
  out['page-head h1 字族'] = fam('.page-head h1')
  out['page-foot min-height'] = prop('.page-foot', 'minHeight')
  out['nav-head padding-top'] = prop('.nav-head', 'paddingTop')
  out['nav-head padding-right'] = prop('.nav-head', 'paddingRight')
  out['nav-head padding-bottom'] = prop('.nav-head', 'paddingBottom')
  out['search-box padding-top'] = prop('.search-box', 'paddingTop')
  out['search-box padding-left'] = prop('.search-box', 'paddingLeft')
  out['category min-height'] = prop('.category', 'minHeight')
  var apCols = hasAppearance ? gridCols('.appearance-layout') : null
  var apGap = hasAppearance ? prop('.appearance-layout', 'columnGap') : null
  out['appearance-layout gap'] = apGap
  out['appearance 两列+间距'] = apCols && apCols.length >= 2 && apGap !== null
    ? Math.round((apCols[0] + apCols[1] + apGap) * 100) / 100 : null
  out['appearance 内容宽'] = hasAppearance ? contentWidth('.appearance-layout') : null
  out['setting-row min-height'] = hasAppearance ? prop('.setting-row', 'minHeight') : null
  out['setting-row padding-top'] = hasAppearance ? prop('.setting-row', 'paddingTop') : null
  var sel = hasAppearance ? box('.select') : null
  out['select 宽'] = sel ? sel.w : null
  var stepper = hasAppearance ? box('.size-stepper') : null
  out['size-stepper 高'] = stepper ? stepper.h : null
  out['preview-column padding-left'] = hasAppearance ? prop('.preview-column', 'paddingLeft') : null
  out['preview-column 左边框'] = hasAppearance ? prop('.preview-column', 'borderLeftWidth') : null
  var chrome = hasAppearance ? box('.preview-chrome') : null
  out['preview-chrome 高'] = chrome ? chrome.h : null
  out['preview-paper max-height'] = hasAppearance ? prop('.preview-paper', 'maxHeight') : null
  out['preview-paper padding-top'] = hasAppearance ? prop('.preview-paper', 'paddingTop') : null
  out['preview-paper padding-right'] = hasAppearance ? prop('.preview-paper', 'paddingRight') : null
  out['preview-paper padding-bottom'] = hasAppearance ? prop('.preview-paper', 'paddingBottom') : null
  out['preview-copy 字号'] = hasAppearance ? prop('.preview-copy', 'fontSize') : null
  out['preview-copy 行高'] = hasAppearance ? prop('.preview-copy', 'lineHeight') : null
  out['preview-copy 字族'] = hasAppearance ? fam('.preview-copy') : null
  var dlCols = hasData ? gridCols('.data-layout') : null
  out['data-layout gap'] = hasData ? prop('.data-layout', 'columnGap') : null
  out['data-layout 右列宽'] = dlCols && dlCols.length >= 2 ? dlCols[dlCols.length - 1] : null
  out['data-aside padding-left'] = hasData ? prop('.data-aside', 'paddingLeft') : null
  out['action-row min-height'] = hasData ? prop('.action-row', 'minHeight') : null
  out['about-layout gap'] = hasAbout ? prop('.about-layout', 'columnGap') : null
  out['about-layout max-width'] = hasAbout ? prop('.about-layout', 'maxWidth') : null
  var mark = hasAbout ? box('.about-mark') : null
  out['about-mark 宽'] = mark ? mark.w : null
  out['about-mark 高'] = mark ? mark.h : null
  out['keyboard-panel padding-left'] = hasAbout ? prop('.keyboard-panel', 'paddingLeft') : null
  /* 侧栏页脚：块级 + 两行（.nav-foot 曾被 themes.css 里未加 .lore-shell 前缀的
     display:flex;white-space:nowrap 顶成一行并被面板裁掉；settings-fusion.css:62 已补复位）。
     三条版式判据 + 高度都进几何表；下面这份 detail 是行高/边距的原始数据（高度对不上时直接看这里）。 */
  var nf = q('.nav-foot')
  var nfc = nf ? win.getComputedStyle(nf) : null
  var nfStrong = nf ? nf.querySelector('strong') : null
  var nfP = nf ? nf.querySelector('p') : null
  out['nav-foot display'] = nfc ? String(nfc.display) : null
  out['nav-foot white-space'] = nfc ? String(nfc.whiteSpace) : null
  out['nav-foot 同一行'] = nfStrong && nfP
    ? Math.abs(nfStrong.getBoundingClientRect().top - nfP.getBoundingClientRect().top) < 4
    : null
  out['nav-foot 高'] = nf ? Math.round(nf.offsetHeight * 100) / 100 : null
  function detail(sel) {
    var n = q(sel)
    if (!n) return null
    var c = win.getComputedStyle(n)
    var r = n.getBoundingClientRect()
    return {
      rect: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, top: Math.round(r.top * 100) / 100, bottom: Math.round(r.bottom * 100) / 100 },
      offsetHeight: n.offsetHeight,
      fontSize: String(c.fontSize),
      lineHeight: String(c.lineHeight),
      fontWeight: String(c.fontWeight),
      marginTop: String(c.marginTop),
      marginBottom: String(c.marginBottom),
      paddingTop: String(c.paddingTop),
      paddingBottom: String(c.paddingBottom),
      borderTopWidth: String(c.borderTopWidth)
    }
  }
  out['setup nav-foot'] = nf ? { box: detail('.nav-foot'), strong: detail('.nav-foot strong'), p: detail('.nav-foot p') } : null
  /* 量到 null 的键（当页没有这个元素）由 Node 侧丢弃，不参与比较 */
  return out
}

function pad2(s, n) {
  const str = String(s)
  let w = 0
  for (const ch of str) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1
  return w >= n ? str + ' ' : str + ' '.repeat(n - w)
}

async function shoot(send, name, width) {
  /* 两个 target 同时开着时截图偶发超时：先 bringToFront 再拍，仍失败就再试一次。 */
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await send('Page.bringToFront').catch(() => {})
      const st = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: VH, scale: 1 } })
      const file = join(SHOTS, name + '.png')
      await writeFile(file, Buffer.from(st.data, 'base64'))
      return { name: name + '.png', file: file, width, height: VH }
    } catch (e) {
      lastErr = e
      await sleep(600)
    }
  }
  throw lastErr || new Error('截图失败：' + name)
}

/* 总稿静态服务：整目录挂出去（studio.css / prototype.js / fonts.css / assets/ 都在它下面）。 */
function servePrototype() {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
  }
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
      const rel = normalize(pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''))
      const file = join(PROTOTYPE, rel)
      if (!file.startsWith(PROTOTYPE + sep)) { res.writeHead(403); res.end('forbidden'); return }
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('missing')
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function openTarget(cdp, width, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height: VH, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  return { targetId, sessionId, send }
}

async function evalIn(send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) throw new Error('页面内求值异常：' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r && r.result ? r.result.value : null
}

async function waitFor(send, expression, ms, label) {
  const t0 = Date.now()
  const lim = ms || 60000
  for (;;) {
    let ok = false
    try { ok = await evalIn(send, expression) } catch { ok = false }
    if (ok) return true
    if (Date.now() - t0 > lim) throw new Error(lim + 'ms 内没等到：' + label)
    await sleep(250)
  }
}

/* 产物侧：把 iframe 拉到 width×900 并派 resize（HARNESS 默认写死 860 高）。 */
async function fitProductFrame(productSend, width) {
  await evalIn(productSend, `(function(){
    var f = document.getElementById('ns-frame');
    f.style.width = '${width}px';
    f.style.height = '${VH}px';
    try { f.contentWindow.dispatchEvent(new f.contentWindow.Event('resize')); } catch (e) {}
    return true;
  })()`)
  await sleep(420)
}

const PRODUCT_DOC = "document.getElementById('ns-frame').contentDocument"
const PRODUCT_WIN = "document.getElementById('ns-frame').contentWindow"

async function measureSide(kind, send, width) {
  const merged = {}
  for (const page of PAGES) {
    if (kind === 'proto') {
      await evalIn(send, `(${NS_NAV.toString()})(document, ${JSON.stringify(page)})`)
      await sleep(420)
      const got = await evalIn(send, `(${NS_MEASURE.toString()})(document, window, '.workspace')`)
      Object.assign(merged, pickNonNull(got))
    } else {
      await evalIn(send, `(${NS_NAV.toString()})(${PRODUCT_DOC}, ${JSON.stringify(page)})`)
      await sleep(480)
      const got = await evalIn(send, `(${NS_MEASURE.toString()})(${PRODUCT_DOC}, ${PRODUCT_WIN}, '.settings-shell')`)
      Object.assign(merged, pickNonNull(got))
    }
  }
  return merged
}

function pickNonNull(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) if (v !== null && v !== undefined) out[k] = v
  return out
}

/* 四档窄幅：三页截图 + 抽屉 + 手机预览 + 横向溢出断言（两侧各一套）。 */
async function captureNarrow(kind, send, width, shots, states) {
  const overflow = []
  const prefix = kind === 'proto' ? 'proto' : 'prod'
  if (kind === 'product') await fitProductFrame(send, width)
  else await send('Emulation.setDeviceMetricsOverride', { width, height: VH, deviceScaleFactor: 1, mobile: false })
  await sleep(460)

  const nav = async (page) => {
    if (kind === 'proto') await evalIn(send, `(${NS_NAV.toString()})(document, ${JSON.stringify(page)})`)
    else await evalIn(send, `(${NS_NAV.toString()})(${PRODUCT_DOC}, ${JSON.stringify(page)})`)
    await sleep(460)
  }
  const checkOverflow = async (tag) => {
    const got = kind === 'proto'
      ? await evalIn(send, `(function(){var d=document.documentElement;return {sw:d.scrollWidth, iw:window.innerWidth}})()`)
      : await evalIn(send, `(function(){var d=${PRODUCT_DOC}.documentElement;var w=${PRODUCT_WIN};return {sw:d.scrollWidth, iw:w.innerWidth}})()`)
    overflow.push({ side: prefix, width, tag, scrollWidth: got ? got.sw : -1, innerWidth: got ? got.iw : -1, pass: !!got && got.sw <= got.iw })
  }

  for (const page of PAGES) {
    await nav(page)
    shots.push(await shoot(send, prefix + '-' + page + '-' + width, width))
    await checkOverflow(page)
  }

  if (width < 1100) {
    await nav('appearance')
    if (kind === 'proto') await evalIn(send, `(function(){var b=document.querySelector('#mobile-tools [data-act="open-drawer"]');if(b)b.click();return true})()`)
    else await evalIn(send, `(function(){var b=${PRODUCT_DOC}.querySelector('.mobile-tools [data-act="open-drawer"]');if(b)b.click();return true})()`)
    await sleep(520)
    const drawerState = kind === 'proto'
      ? await evalIn(send, 'document.body.classList.contains("drawer-open")')
      : await evalIn(send, `(function(){var el=${PRODUCT_DOC}.querySelector('.settings-shell');return el ? el.getAttribute('data-drawer') : null})()`)
    shots.push(await shoot(send, prefix + '-drawer-' + width, width))
    await checkOverflow('drawer')
    states.push({ side: prefix, width, tag: 'drawer', value: drawerState, pass: drawerState === 'open' || drawerState === true })
    if (kind === 'proto') await evalIn(send, `(function(){var s=document.querySelector('.scrim');if(s)s.click();return true})()`)
    else await evalIn(send, `(function(){var s=${PRODUCT_DOC}.querySelector('.scrim');if(s)s.click();return true})()`)
    await sleep(420)

    if (width <= 559) {
      if (kind === 'proto') await evalIn(send, `(function(){var b=document.querySelector('.head-actions [data-act="toggle-preview"]');if(b)b.click();return true})()`)
      else await evalIn(send, `(function(){var b=${PRODUCT_DOC}.querySelector('.head-actions [data-act="toggle-preview"]');if(b)b.click();return true})()`)
      await sleep(560)
      const previewState = kind === 'proto'
        ? await evalIn(send, 'document.body.classList.contains("preview-open")')
        : await evalIn(send, `(function(){var el=${PRODUCT_DOC}.querySelector('.settings-shell');return el ? el.getAttribute('data-preview') : null})()`)
      shots.push(await shoot(send, prefix + '-preview-' + width, width))
      await checkOverflow('preview')
      states.push({ side: prefix, width, tag: 'preview', value: previewState, pass: previewState === 'open' || previewState === true })
      if (kind === 'proto') await evalIn(send, `(function(){var b=document.querySelector('.head-actions [data-act="toggle-preview"]');if(b)b.click();return true})()`)
      else await evalIn(send, `(function(){var b=${PRODUCT_DOC}.querySelector('.head-actions [data-act="toggle-preview"]');if(b)b.click();return true})()`)
      await sleep(420)
    }
  }
  return { overflow, states }
}

async function main() {
  if (!existsSync(join(REPO, 'assets', 'app', 'index.html'))) {
    console.error('FAIL：assets/app/index.html 不存在 —— 先跑 npm run build:app')
    return 1
  }
  if (!existsSync(join(PROTOTYPE, 'index.html'))) {
    console.error('FAIL：找不到设计总稿 ' + PROTOTYPE)
    return 1
  }
  if (!existsSync(CHROME)) {
    console.error('FAIL：找不到 Chrome：' + CHROME + '（可用 NS_CHROME 指定）')
    return 1
  }
  await mkdir(OUT, { recursive: true })
  await mkdir(SHOTS, { recursive: true })

  const productServer = await serve()
  const productOrigin = 'http://127.0.0.1:' + productServer.address().port
  const protoServer = await servePrototype()
  const protoOrigin = 'http://127.0.0.1:' + protoServer.address().port
  console.log('[1] 产物页 ' + productOrigin + '  总稿页 ' + protoOrigin)

  const { proc, wsUrl } = await launchChrome()
  console.log('[2] Chrome headless 已起')
  const cdp = await cdpClient(wsUrl)

  const shots = []
  const overflow = []
  const states = []
  const errors = []
  let protoMenu = {}
  let productMenu = {}
  let backdrop1440 = null
  try {
    console.log('[3] CDP 已连接')
    /* ---- ① 总稿：清掉本地偏好再进页面，量的是默认外观（字号 17 / 思源宋体 / 跟随中文） ---- */
    const proto = await openTarget(cdp, 1440, protoOrigin + '/index.html?static')
    await waitFor(proto.send, '!!window.__settingsReady', 90000, '总稿 __settingsReady')
    await evalIn(proto.send, `(function(){try{localStorage.removeItem('latent-settings-design-v1')}catch(e){};return true})()`)
    await proto.send('Page.reload')
    await waitFor(proto.send, '!!window.__settingsReady', 90000, '总稿 reload 后就绪')
    await sleep(600)
    console.log('[4] 总稿就绪（1440x900）')

    /* ---- ② 产物：HARNESS 用应用自己的 store 把视图切到 settings，再等外壳挂上 ---- */
    const product = await openTarget(cdp, 1440, productOrigin + '/harness.html?module=settings&vw=1440&inspect=1')
    await waitFor(product.send, '!!window.__NS_INSPECT_READY', 180000, '产物 __NS_INSPECT_READY')
    await fitProductFrame(product.send, 1440)
    await waitFor(product.send, `!!(${PRODUCT_DOC} && ${PRODUCT_DOC}.querySelector('.settings-shell'))`, 60000, '产物 .settings-shell')
    await sleep(900)
    console.log('[5] 产物就绪（1440x900，ui.view=settings）')

    protoMenu = await measureSide('proto', proto.send, 1440)
    productMenu = await measureSide('product', product.send, 1440)
    /* 量完最后一页是「关于」，截图前各自回外观页：1440 的主图要对齐总稿截图（外观与排版） */
    await evalIn(proto.send, `(${NS_NAV.toString()})(document, 'appearance')`)
    await evalIn(product.send, `(${NS_NAV.toString()})(${PRODUCT_DOC}, 'appearance')`)
    await sleep(600)
    shots.push(await shoot(proto.send, 'proto-appearance-1440', 1440))
    shots.push(await shoot(product.send, 'prod-appearance-1440', 1440))
    /* 背板取证图（T3 第 3 轮：设置页也挂 .st-backdrop-wrap > canvas.st-backdrop）：
       把外壳与顶栏淡到 0.18 露出流动底，拍完立即复原；画布盒子/缓冲区与钩子后端一并记进报告。 */
    backdrop1440 = await evalIn(product.send, `(function(){
      var d = document.getElementById('ns-frame').contentDocument;
      var w = document.getElementById('ns-frame').contentWindow;
      var shell = d.querySelector('.settings-shell');
      var bar = d.querySelector('.app-topbar-shell') || d.querySelector('.app-topbar');
      if (shell) shell.style.opacity = '0.18';
      if (bar) bar.style.opacity = '0.18';
      var cv = d.querySelector('.st-backdrop-wrap > canvas.st-backdrop');
      var r = cv ? cv.getBoundingClientRect() : null;
      var stats = typeof w.__nsSettingsBackdrop === 'function' ? w.__nsSettingsBackdrop() : null;
      return {
        wrap: !!d.querySelector('.st-backdrop-wrap'),
        canvas: !!cv,
        layers: d.querySelectorAll('.st-backdrop-wrap .st-layer').length,
        box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        buffer: cv ? { w: cv.width, h: cv.height } : null,
        backend: stats ? String(stats.backend || '') : '(无钩子)',
        renderer: stats ? String(stats.renderer || '').slice(0, 60) : '',
        scale: stats ? stats.scale : null
      };
    })()`)
    await sleep(900)
    shots.push(await shoot(product.send, 'prod-backdrop-1440', 1440))
    await evalIn(product.send, `(function(){
      var d = document.getElementById('ns-frame').contentDocument;
      var shell = d.querySelector('.settings-shell');
      var bar = d.querySelector('.app-topbar-shell') || d.querySelector('.app-topbar');
      if (shell) shell.style.opacity = '';
      if (bar) bar.style.opacity = '';
      return true;
    })()`)
    await sleep(400)

    /* ---- ③ 四档窄幅：三页 + 抽屉 + 手机预览（两侧各一套）+ 横向溢出 ---- */
    for (const w of WIDTHS) {
      console.log('>>> ' + w + '：两侧三页 + 抽屉 + 手机预览')
      const a = await captureNarrow('proto', proto.send, w, shots, states)
      const b = await captureNarrow('product', product.send, w, shots, states)
      overflow.push(...a.overflow, ...b.overflow)
    }
    await cdp.send('Target.closeTarget', { targetId: proto.targetId }).catch(() => {})
    await cdp.send('Target.closeTarget', { targetId: product.targetId }).catch(() => {})
  } catch (e) {
    errors.push(String(e && e.message || e))
    console.error('采集失败：' + String(e && e.stack || e))
  } finally {
    try { cdp.close() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
    productServer.close()
    protoServer.close()
  }

  /* ---- 逐项比对 ---- */
  const rows = []
  const names = Object.keys(SPEC).concat(FAM_ROWS)
  for (const name of names) {
    const expected = FAM_SPEC[name] !== undefined ? FAM_SPEC[name] : SPEC[name]
    const protoVal = protoMenu[name] === undefined ? null : protoMenu[name]
    const prodVal = productMenu[name] === undefined ? null : productMenu[name]
    const isFam = FAM_ROWS.indexOf(name) >= 0
    let pass = false
    let delta = '—'
    if (isFam) {
      pass = protoVal != null && prodVal != null && String(prodVal) === String(protoVal) && String(prodVal) === String(expected)
    } else if (protoVal != null && prodVal != null) {
      delta = Math.round((Number(prodVal) - Number(protoVal)) * 1000) / 1000
      pass = Math.abs(delta) <= TOL && Math.abs(Number(prodVal) - Number(expected)) <= TOL
    }
    rows.push({
      constant: name,
      page: PAGE_OF[name] || 'appearance',
      expected: expected,
      prototype: protoVal === null ? '未量到' : protoVal,
      product: prodVal === null ? '未量到' : prodVal,
      delta: delta,
      pass: pass
    })
  }
  /* grid 铺满内容宽（派生行）：两列宽度是 minmax + fr 的结果，没有可以写死的常量，
     所以判「两列 + 间距 = 内容盒宽」这条恒等式——两侧各判一次，任一侧不成立就算超差。 */
  ;(() => {
    const pSum = protoMenu['appearance 两列+间距']
    const pBox = protoMenu['appearance 内容宽']
    const dSum = productMenu['appearance 两列+间距']
    const dBox = productMenu['appearance 内容宽']
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
    const okProto = num(pSum) !== null && num(pBox) !== null && Math.abs(pSum - pBox) <= TOL
    const okProd = num(dSum) !== null && num(dBox) !== null && Math.abs(dSum - dBox) <= TOL
    const delta = num(pSum) !== null && num(dSum) !== null ? Math.round((dSum - pSum) * 1000) / 1000 : '—'
    rows.push({
      constant: 'appearance 两列+间距=内容宽',
      page: 'appearance',
      expected: num(pBox) === null ? '未量到' : pBox,
      prototype: num(pSum) === null ? '未量到' : (pSum + '（内容宽 ' + pBox + '）'),
      product: num(dSum) === null ? '未量到' : (dSum + '（内容宽 ' + dBox + '）'),
      delta: delta,
      pass: okProto && okProd
    })
  })()

  /* 侧栏页脚：三条版式判据直接进几何表（超差即 FAIL，不再有 advisory 通道） */
  const NF_STR = [
    { constant: 'nav-foot display', key: 'nav-foot display', expected: 'block' },
    { constant: 'nav-foot white-space', key: 'nav-foot white-space', expected: 'normal' },
    { constant: 'nav-foot strong 与 p 不同行', key: 'nav-foot 同一行', expected: false }
  ]
  for (const def of NF_STR) {
    const pv = protoMenu[def.key]
    const dv = productMenu[def.key]
    const known = pv !== undefined && pv !== null && dv !== undefined && dv !== null
    rows.push({
      constant: def.constant,
      page: 'appearance',
      expected: JSON.stringify(def.expected),
      prototype: known ? JSON.stringify(pv) : '未量到',
      product: known ? JSON.stringify(dv) : '未量到',
      delta: known ? (String(pv) === String(dv) ? 0 : '—') : '—',
      pass: known && String(pv) === String(def.expected) && String(dv) === String(def.expected)
    })
  }
  /* 高度单独判：产物 vs 原型 ±1（两侧现在都是 87px；明细见报告 setup 段） */
  const nfProto = Number(protoMenu['nav-foot 高'])
  const nfProd = Number(productMenu['nav-foot 高'])
  const nfKnown = isFinite(nfProto) && isFinite(nfProd) && protoMenu['nav-foot 高'] != null && productMenu['nav-foot 高'] != null
  const nfDelta = nfKnown ? Math.round((nfProd - nfProto) * 100) / 100 : '—'
  rows.push({
    constant: 'nav-foot 高（产物 vs 原型，±1）',
    page: 'appearance',
    expected: nfKnown ? nfProto : '未量到',
    prototype: nfKnown ? nfProto : '未量到',
    product: nfKnown ? nfProd : '未量到',
    delta: nfDelta,
    pass: nfKnown && Math.abs(nfDelta) <= 1
  })
  const setupRows = {
    prototype: protoMenu['setup nav-foot'] || null,
    product: productMenu['setup nav-foot'] || null,
    heightDelta: nfDelta
  }
  /* 判定集合在**所有**行入表之后才算一次：否则后加的行只进表格、不进退出码（曾因此漏红一次）。 */
  const failed = rows.filter((r) => !r.pass)
  const ofFail = overflow.filter((o) => !o.pass)
  const stFail = states.filter((s) => !s.pass)

  console.log('')
  console.log('=== 设置工作区 · 几何/样式对稿（1440x900，误差 >' + TOL + 'px 或字族不一致记 FAIL） ===')
  console.log(pad2('常量', 26) + pad2('页', 12) + pad2('期望', 12) + pad2('原型', 10) + pad2('产物', 10) + pad2('差', 8) + '判定')
  for (const r of rows) {
    console.log(pad2(r.constant, 26) + pad2(r.page, 12) + pad2(r.expected, 12) + pad2(r.prototype, 10) + pad2(r.product, 10) + pad2(r.delta, 8) + (r.pass ? 'PASS' : 'FAIL'))
  }

  console.log('')
  console.log('=== 窄档无横向溢出（scrollWidth <= innerWidth） ===')
  for (const o of overflow) {
    console.log(pad2(o.side + ' ' + o.width, 16) + pad2(o.tag, 16) + o.scrollWidth + ' <= ' + o.innerWidth + '  ' + (o.pass ? 'PASS' : 'FAIL'))
  }
  console.log('')
  console.log('=== 窄档交互态（抽屉 / 手机预览 真的开了） ===')
  for (const s of states) {
    console.log(pad2(s.side + ' ' + s.width, 16) + pad2(s.tag, 16) + JSON.stringify(s.value) + '  ' + (s.pass ? 'PASS' : 'FAIL'))
  }

  console.log('')
  console.log('=== nav-foot 高度明细（两侧行盒/边距并列，高度对不上时直接看这里） ===')
  for (const side of ['prototype', 'product']) {
    const d = setupRows[side]
    if (!d) { console.log('  ' + pad2(side, 10) + '未量到'); continue }
    for (const part of ['box', 'strong', 'p']) {
      const v = d[part]
      if (!v) { console.log('  ' + pad2(side, 10) + pad2(part, 8) + '未量到'); continue }
      console.log('  ' + pad2(side, 10) + pad2(part, 8)
        + 'rect ' + v.rect.w + 'x' + v.rect.h + ' top=' + v.rect.top + ' bottom=' + v.rect.bottom + ' offsetHeight=' + v.offsetHeight
        + ' | font-size=' + v.fontSize + ' line-height=' + v.lineHeight + ' weight=' + v.fontWeight
        + ' | margin ' + v.marginTop + '/' + v.marginBottom + ' padding ' + v.paddingTop + '/' + v.paddingBottom + ' border-top=' + v.borderTopWidth)
    }
  }
  console.log('  高度差（产物 - 原型）=' + setupRows.heightDelta + 'px（判据 ±1px）')
  if (backdrop1440) {
    console.log('')
    console.log('=== 设置页流动背板（1440，prod-backdrop-1440.png） ===')
    console.log('  .st-backdrop-wrap=' + backdrop1440.wrap + ' canvas.st-backdrop=' + backdrop1440.canvas
      + ' .st-layer=' + backdrop1440.layers
      + ' 盒子=' + (backdrop1440.box ? backdrop1440.box.w + 'x' + backdrop1440.box.h : '?')
      + ' 缓冲区=' + (backdrop1440.buffer ? backdrop1440.buffer.w + 'x' + backdrop1440.buffer.h : '?')
      + ' __nsSettingsBackdrop().backend=' + backdrop1440.backend
      + (backdrop1440.scale != null ? (' scale=' + backdrop1440.scale) : ''))
  }

  console.log('')
  console.log('=== 对稿截图 ===')
  for (const s of shots) console.log('  ' + pad2(s.name, 32) + s.file + '  ' + s.width + 'x' + s.height)

  console.log('')
  if (errors.length) console.log('采集异常：' + errors.join(' | '))
  if (failed.length) {
    console.log('FAIL ' + failed.length + '/' + rows.length + ' 项超差：')
    for (const r of failed) console.log('  FAIL ' + r.constant + '：期望 ' + r.expected + '，原型 ' + r.prototype + '，产物 ' + r.product + '，差 ' + r.delta)
  } else if (!errors.length) {
    console.log('几何全对：' + rows.length + '/' + rows.length + ' 项在 ±' + TOL + 'px 内')
  }
  if (ofFail.length) console.log('FAIL 窄档横向溢出 ' + ofFail.length + '/' + overflow.length + ' 项：' + ofFail.map((o) => o.side + '@' + o.width + '/' + o.tag).join(', '))
  else console.log('无横向溢出：' + overflow.length + '/' + overflow.length + ' 项通过')
  if (stFail.length) console.log('FAIL 窄档交互态 ' + stFail.length + '/' + states.length + ' 项：' + stFail.map((s) => s.side + '@' + s.width + '/' + s.tag + '=' + JSON.stringify(s.value)).join(', '))
  else console.log('窄档交互态：' + states.length + '/' + states.length + ' 项生效')

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: { width: 1440, height: VH },
    tolerance: TOL,
    sides: {
      prototype: 'docs/前端美化/设置-总设计稿-20261105/index.html?static（.workspace）',
      product: 'assets/app/index.html?embed=1 挂在 HARNESS 里，ui.view=settings（.settings-shell）'
    },
    rows: rows,
    failCount: failed.length,
    overflow: overflow,
    overflowFail: ofFail.length,
    states: states,
    stateFail: stFail.length,
    advisories: [],
    setup: setupRows,
    backdrop1440: backdrop1440,
    measured: { prototype: protoMenu, product: productMenu },
    screenshots: shots,
    errors: errors
  }
  const reportPath = join(OUT, 'settings-compare-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log('报告：' + reportPath)
  const bad = failed.length + ofFail.length + stFail.length + errors.length
  if (bad) process.exitCode = 1
  return bad ? 1 : 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('FAIL：' + String(e && e.stack || e))
  process.exit(1)
})
