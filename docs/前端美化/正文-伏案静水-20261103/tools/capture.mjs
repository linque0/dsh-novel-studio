// tools/capture.mjs — 「正文」界面设计稿的取证：CDP 驱动本机 Chrome 无头，出状态图、动效帧带与 report.json。
// 用法：node tools/capture.mjs [index.html 路径]
// 基准 1440×900；状态图进 screenshots/，动效帧进 frames/，report.json 落在 index.html 同目录。

import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pagePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DIR, 'index.html')
const OUT = path.dirname(pagePath)
const SHOTS = path.join(OUT, 'screenshots')
const FRAMES = path.join(OUT, 'frames')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.NS_CDP_PORT) || 9448
const BASE_W = 1440
const BASE_H = 900
const PNG_LIMIT = Math.round(1.6 * 1024 * 1024)

if (!existsSync(pagePath)) {
  console.error('找不到设计稿：' + pagePath)
  console.error('取证脚本只截已存在的页面，不生成页面。先把 index.html 放进 ' + OUT + '（内联：node tools/build-page.mjs），再运行本脚本。')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error('找不到 Chrome：' + CHROME + '（可用环境变量 CHROME 覆盖路径）')
  process.exit(1)
}

const toUrl = p => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20').replace(/[\u4e00-\u9fa5]/g, ch => encodeURIComponent(ch))
const PAGE = toUrl(pagePath)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/* 量具：元素几何 + lightBlocks（逐字搬 scripts/verify-app.mjs 的 lightScan）+ WCAG 对比度。 */
const MEASURE_EXPR = `(function () {
  var vw = window.innerWidth || 1, vh = window.innerHeight || 1, varea = vw * vh;
  function rgbOf(s) {
    var str = String(s || '');
    var open = str.indexOf('('), close = str.indexOf(')');
    if (open < 0 || close < open) return null;
    if (str.slice(0, open).indexOf('rgb') !== 0) return null;
    var parts = str.slice(open + 1, close).split(',');
    if (parts.length < 3) return null;
    var p = parts.map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  /* 可见面积 >8% 视口、计算背景亮度 >0.8 的元素个数：白胶囊不该撑起一整块浅底。 */
  function lightBlocks() {
    var count = 0;
    Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) {
      var r = el.getBoundingClientRect();
      var aw = Math.min(r.right, vw) - Math.max(r.left, 0);
      var ah = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (!(aw > 0 && ah > 0)) return;
      var area = aw * ah;
      if (area <= varea * 0.08) return;
      var c = rgbOf(window.getComputedStyle(el).backgroundColor);
      if (!c || c.a <= 0.5) return;
      if ((c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255 > 0.8) count++;
    });
    return count;
  }
  function over(fg, bg) {
    var a = fg.a === undefined ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function srgb(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function relLum(c) { return 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b); }
  function ratio(fg, bg) {
    var x = relLum(fg), y = relLum(bg), hi = Math.max(x, y), lo = Math.min(x, y);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  /* 设计令牌 → 实际颜色：先取 var 的原始值（未定义就是空串），再挂个探针让它被解析成 rgb()。 */
  function varColor(name) {
    var raw = String(window.getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
    if (!raw) return null;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;color:' + raw;
    document.body.appendChild(probe);
    var c = rgbOf(window.getComputedStyle(probe).color);
    document.body.removeChild(probe);
    return c;
  }
  function colorOf(sel) { var el = document.querySelector(sel); return el ? rgbOf(window.getComputedStyle(el).color) : null; }
  function box(sel) { var el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; }
  function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }

  var baseBg = varColor('--st-bg') || rgbOf(window.getComputedStyle(document.body).backgroundColor) || { r: 21, g: 21, b: 23, a: 1 };
  var paperEl = document.querySelector('.st-paper');
  var paperBg = paperEl ? rgbOf(window.getComputedStyle(paperEl).backgroundColor) : null;
  if (!paperBg || paperBg.a <= 0) paperBg = baseBg;
  if ((paperBg.a === undefined ? 1 : paperBg.a) < 1) paperBg = over(paperBg, baseBg);
  var paper = document.querySelector('.rich-host .rich-inner .tiptap');
  var bodyFg = (paper ? rgbOf(window.getComputedStyle(paper).color) : null) || colorOf('body') || { r: 230, g: 232, b: 235, a: 1 };
  if ((bodyFg.a === undefined ? 1 : bodyFg.a) < 1) bodyFg = over(bodyFg, paperBg);
  var labelFg = varColor('--ns-label-2') || colorOf('.app-topnav-item') || bodyFg;
  var captionFg = varColor('--ns-caption') || varColor('--ns-label-3') || colorOf('.app-topbar-save') || bodyFg;

  var em = paper ? parseFloat(window.getComputedStyle(paper).fontSize) : 0;
  var paperRect = paper ? paper.getBoundingClientRect() : null;
  var topbar = box('.app-topbar'), side = box('.side-panel'), toolbar = box('.editor-toolbar');
  var paperW = paperRect ? round1(paperRect.width) : 0;

  return {
    w: vw,
    topbarH: topbar ? round1(topbar.height) : 0,
    sideW: side ? round1(side.width) : 0,
    paperW: paperW,
    paperEm: em > 0 ? Math.round((paperW / em) * 100) / 100 : 0,
    toolbarH: toolbar ? round1(toolbar.height) : 0,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    lightBlocks: lightBlocks(),
    contrast: {
      body: ratio(bodyFg, paperBg),
      label: ratio(labelFg, paperBg),
      caption: ratio(captionFg, paperBg)
    }
  };
})()`

const COUNTS_EXPR = `(function () {
  return {
    chapters: document.querySelectorAll('[data-anchor=tree-chapter]').length,
    notes: document.querySelectorAll('[data-anchor=notes-list] > *').length,
    history: document.querySelectorAll('[data-anchor=history-row]').length
  };
})()`

const FOCUS_EXPR = `(function () {
  var ed = document.querySelector('.rich-host .rich-inner .tiptap') || document.querySelector('[contenteditable="true"]');
  if (!ed) return false;
  try { ed.focus(); } catch (e) {}
  try { ed.click(); } catch (e) {}
  return true;
})()`

const STATS_EXPR = 'JSON.stringify(window.__nsStudioStats ? window.__nsStudioStats() : null)'

async function waitForDebugger() {
  for (let i = 0; i < 75; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version')
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch (_error) { /* 还没起来 */ }
    await sleep(200)
  }
  throw new Error('Chrome 调试端口未就绪：' + PORT)
}

function createClient(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const events = []
  let seq = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    } else if (message.method) events.push(message)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', () => reject(new Error('无法连接 Chrome DevTools')))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  return { ready, send, events, close: () => socket.close() }
}

async function main() {
  await mkdir(SHOTS, { recursive: true })
  await rm(FRAMES, { recursive: true, force: true })
  await mkdir(FRAMES, { recursive: true })

  const profile = path.join(os.tmpdir(), 'ns-capture-' + process.pid)
  const chrome = spawn(CHROME, [
    '--headless=new', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--disable-extensions', '--mute-audio',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    '--window-size=' + BASE_W + ',' + BASE_H, 'about:blank'
  ], { stdio: 'ignore' })

  let client = null
  const cleanup = async () => {
    try { if (client) client.close() } catch (_error) { /* 已断开 */ }
    try { chrome.kill() } catch (_error) { /* 已退出 */ }
    await sleep(300)
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  try {
    client = createClient(await waitForDebugger())
    await client.ready

    /* 宽高交给 Emulation.setDeviceMetricsOverride：新版 Chrome 拒绝给非新窗口的 createTarget 传宽高 */
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params) => client.send(method, params, sessionId)

    await call('Page.enable')
    await call('Runtime.enable')
    await call('Log.enable')

    const consoleErrors = []
    const drain = () => {
      for (const event of client.events.splice(0)) {
        if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') consoleErrors.push(event.params.entry.text)
        if (event.method === 'Runtime.exceptionThrown') consoleErrors.push(event.params.exceptionDetails.text || 'exception')
      }
    }

    let viewW = BASE_W
    let viewH = BASE_H
    let lastStats = null

    async function open(query = '', width = BASE_W, height = BASE_H, settle = 1200) {
      viewW = width
      viewH = height
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await call('Page.navigate', { url: PAGE + query })
      await sleep(settle)
      drain()
    }

    async function grab(format, quality) {
      const params = { format, captureBeyondViewport: false }
      if (quality) params.quality = quality
      return Buffer.from((await call('Page.captureScreenshot', params)).data, 'base64')
    }

    /* 单张 PNG 超过 1.6MB 就降 deviceScaleFactor 重截，截完恢复 1 */
    async function shot(file) {
      let bytes = await grab('png')
      let scale = 1
      while (bytes.length > PNG_LIMIT && scale > 0.55) {
        scale = Math.round((scale - 0.2) * 100) / 100
        await call('Emulation.setDeviceMetricsOverride', { width: viewW, height: viewH, deviceScaleFactor: scale, mobile: false })
        bytes = await grab('png')
      }
      if (scale !== 1) await call('Emulation.setDeviceMetricsOverride', { width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false })
      await writeFile(path.join(SHOTS, file), bytes)
      return scale
    }

    async function evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false })
      return result.result ? result.result.value : undefined
    }

    async function readStats() {
      const raw = await evaluate(STATS_EXPR)
      if (!raw) return null
      try { return JSON.parse(raw) } catch (_error) { return null }
    }

    let anchorData = { total: 0, list: [] }
    const anchorsPath = path.join(OUT, 'anchors.json')
    if (existsSync(anchorsPath)) {
      try {
        const parsed = JSON.parse(await readFile(anchorsPath, 'utf8'))
        anchorData = { total: Number(parsed.total) || (parsed.anchors || []).length, list: Array.isArray(parsed.anchors) ? parsed.anchors : [] }
      } catch (error) {
        consoleErrors.push('anchors.json 解析失败：' + error.message)
      }
    } else {
      consoleErrors.push('缺少 anchors.json，锚点断言跳过')
    }

    const byScene = {}
    const missing = []
    async function assertScene(scene) {
      const items = anchorData.list.filter(item => item.scene === scene)
      if (!items.length) return
      const pairs = items.map(item => [item.id, item.selector])
      const found = await evaluate(
        '(function (list) { var miss = []; for (var i = 0; i < list.length; i++) {' +
        ' var ok = false; try { ok = !!document.querySelector(list[i][1]) } catch (e) { ok = false }' +
        ' if (!ok) miss.push(list[i][0]) } return miss })(' + JSON.stringify(pairs) + ')'
      )
      const miss = Array.isArray(found) ? found : pairs.map(pair => pair[0])
      byScene[scene] = { total: pairs.length, found: pairs.length - miss.length, missing: miss }
      for (const id of miss) missing.push(id)
    }

    const states = [
      { file: '01-ink.png', query: '', measure: true, scene: 'writing', count: 'chapters', stats: true },
      { file: '02-lamp.png', query: '?mode=lamp' },
      { file: '03-ridge.png', query: '?mode=ridge' },
      { file: '04-writing-1280.png', query: '', width: 1280, measure: true },
      { file: '05-writing-760.png', query: '', width: 760, measure: true },
      { file: '06-writing-380.png', query: '', width: 380, measure: true },
      { file: '07-notes.png', query: '?scene=notes', scene: 'notes', count: 'notes' },
      { file: '08-focus.png', query: '?mode=focus' },
      { file: '09-read.png', query: '?mode=read' },
      { file: '10-menu.png', query: '?scene=menu', scene: 'menu' },
      { file: '11-formats.png', query: '?scene=formats', scene: 'formats' },
      { file: '12-history.png', query: '?scene=history', scene: 'history', count: 'history' },
      { file: '13-gpu-off.png', query: '?gpu=0' }
    ]

    const measures = []
    const counts = {}
    const stateFiles = []
    const pngScales = {}

    for (const state of states) {
      await open(state.query || '', state.width || BASE_W, BASE_H)
      pngScales[state.file] = await shot(state.file)
      stateFiles.push(state.file)
      if (state.measure) measures.push(await evaluate(MEASURE_EXPR))
      if (state.scene) await assertScene(state.scene)
      if (state.count) {
        const tally = await evaluate(COUNTS_EXPR)
        if (tally && typeof tally[state.count] === 'number') counts[state.count] = tally[state.count]
      }
      if (state.stats) lastStats = await readStats()
    }
    drain()

    /* anchors.json 里还有没被状态图覆盖的场景（ctx / search 等），单独开一轮 */
    const covered = new Set(states.filter(s => s.scene).map(s => s.scene))
    for (const scene of new Set(anchorData.list.map(item => item.scene))) {
      if (covered.has(scene)) continue
      await open('?scene=' + encodeURIComponent(scene), BASE_W, BASE_H, 800)
      await assertScene(scene)
    }
    drain()

    /* 动效帧：先对正文触发一次 input，再按 0/120/240/400/700/1100/1600ms 截 7 帧 */
    await open('', BASE_W, BASE_H)
    await evaluate(FOCUS_EXPR)
    await call('Input.insertText', { text: '水' })
    const marks = [0, 120, 240, 400, 700, 1100, 1600]
    const ripple = { ampAfter120: null, ampAfter1600: null }
    const frameFiles = []
    let previous = 0
    for (let i = 0; i < marks.length; i += 1) {
      await sleep(Math.max(0, marks[i] - previous))
      previous = marks[i]
      if (marks[i] === 120 || marks[i] === 1600) {
        const snapshot = await readStats()
        const amp = snapshot && snapshot.ripple ? Number(snapshot.ripple.amp) : 0
        if (marks[i] === 120) ripple.ampAfter120 = amp
        else ripple.ampAfter1600 = amp
      }
      const name = 'motion-' + String(i + 1).padStart(2, '0') + '.jpg'
      await writeFile(path.join(FRAMES, name), await grab('jpeg', 82))
      frameFiles.push(name)
    }
    drain()

    /* reduced：冻结时间（前后两次采样 stats().time 差为 0） */
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await open('', BASE_W, BASE_H)
    const first = await readStats()
    await sleep(320)
    const second = await readStats()
    await call('Emulation.setEmulatedMedia', { features: [] })
    const timeA = first ? Number(first.time) : 0
    const timeB = second ? Number(second.time) : 0
    const reduceMotion = { timeA, timeB, frozen: timeA === timeB }
    drain()

    /* 同目录有 compare.html 才截语言对照，没有就在报告里明说跳过 */
    let languageCompare = 'skipped: 同目录没有 compare.html'
    const comparePath = path.join(OUT, 'compare.html')
    if (existsSync(comparePath)) {
      await call('Page.navigate', { url: toUrl(comparePath) })
      await sleep(1400)
      pngScales['00-language-compare.png'] = await shot('00-language-compare.png')
      languageCompare = 'screenshots/00-language-compare.png'
    }

    const base = lastStats || {}
    const report = {
      capturedAt: new Date().toISOString(),
      page: PAGE,
      states: stateFiles,
      frames: frameFiles,
      backend: base.backend || 'unknown',
      pixels: base.pixels || [0, 0],
      consoleErrors,
      reduceMotion,
      measures,
      ripple,
      anchors: { total: anchorData.total || anchorData.list.length, missing, byScene },
      counts: { chapters: counts.chapters || 0, notes: counts.notes || 0, history: counts.history || 0 },
      shaderLog: base.shaderLog === undefined ? '' : base.shaderLog,
      languageCompare,
      pngScales
    }
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      report: path.join(OUT, 'report.json'),
      states: report.states.length,
      frames: report.frames.length,
      backend: report.backend,
      anchors: (report.anchors.total - report.anchors.missing.length) + '/' + report.anchors.total,
      consoleErrors: report.consoleErrors.length
    }))
  } finally {
    await cleanup()
  }
}

main().catch(error => {
  console.error('取证失败：' + (error && error.message ? error.message : error))
  process.exit(1)
})
