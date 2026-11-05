// tools/folia-design-capture.mjs — 书架网页稿的取证：CDP 驱动 Chrome 无头，出静态图、动效帧带与 report.json。
// 用法：node tools/folia-design-capture.mjs

import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve('docs/前端美化/书架-流动封面-20261103')
const SHOTS = path.join(OUT, 'screenshots')
const FRAMES = path.join(OUT, 'frames')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9444
const PAGE = 'file:///' + path.join(OUT, 'index.html').replace(/\\/g, '/').replace(/ /g, '%20').replace(/[\u4e00-\u9fa5]/g, ch => encodeURIComponent(ch))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForDebugger() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch {}
    await sleep(200)
  }
  throw new Error('Chrome 调试端口未就绪')
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
    socket.addEventListener('error', reject)
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

  const chrome = spawn(CHROME, [
    '--headless=new', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' })

  const client = createClient(await waitForDebugger())
  await client.ready

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank', width: 1440, height: 900 })
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

  async function open(url, width = 1440, height = 900) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url })
    await sleep(1400)
    drain()
  }

  async function shot(file) {
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(path.join(SHOTS, file), Buffer.from(data, 'base64'))
  }

  const states = [
    ['01-shelf.png', PAGE],
    ['02-focus-claret.png', `${PAGE}?focus=4`],
    ['03-tab-series.png', `${PAGE}?tab=series`],
    ['04-search.png', `${PAGE}?q=雨`],
    ['05-wide-1920.png', `${PAGE}?focus=6`, 1920, 1080],
    ['07-pixel0.png', `${PAGE}?pixel=0`],
    ['08-pixel1.png', `${PAGE}?pixel=1`],
    ['09-cpu-fallback.png', `${PAGE}?gpu=0`],
    ['10-module.png', `${PAGE}?module=outline`]
  ]
  for (const [file, url, w, h] of states) {
    await open(url, w || 1440, h || 900)
    await shot(file)
  }

  // 后端与帧时取证：先 GPU，再强制 CPU 对照
  await open(PAGE)
  const gpuStats = await call('Runtime.evaluate', { expression: 'JSON.stringify(window.__latentStats ? window.__latentStats() : null)', returnByValue: true })
  await open(`${PAGE}?gpu=0`)
  const cpuStats = await call('Runtime.evaluate', { expression: 'JSON.stringify(window.__latentStats ? window.__latentStats() : null)', returnByValue: true })

  // 动效帧带：右移两格，看封面位移 + 背景换色 + 标题切换
  await open(PAGE)
  const frames = []
  const capture = async label => {
    const { data } = await call('Page.captureScreenshot', { format: 'jpeg', quality: 84 })
    frames.push({ label, data })
  }
  await capture('静息')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  for (const delay of [110, 120, 150]) { await sleep(delay); await capture('换书·1') }
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  for (const delay of [130, 150, 180]) { await sleep(delay); await capture('换书·2') }
  for (const [index, frame] of frames.entries()) {
    await writeFile(path.join(FRAMES, `motion-${String(index + 1).padStart(2, '0')}.jpg`), Buffer.from(frame.data, 'base64'))
  }

  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await open(PAGE)
  const reduced = await call('Runtime.evaluate', {
    expression: `JSON.stringify({
      scene: document.querySelectorAll('.layer').length,
      card: getComputedStyle(document.querySelector('.card')).transitionDuration,
      motion: matchMedia('(prefers-reduced-motion: reduce)').matches
    })`,
    returnByValue: true
  })
  await call('Emulation.setEmulatedMedia', { features: [] })

  const overflow = await call('Runtime.evaluate', {
    expression: `JSON.stringify({ scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth })`,
    returnByValue: true
  })
  const cards = await call('Runtime.evaluate', {
    expression: `document.querySelectorAll('.card:not(.is-out)').length`,
    returnByValue: true
  })

  const report = {
    capturedAt: new Date().toISOString(),
    gpu: gpuStats.result.value ? JSON.parse(gpuStats.result.value) : null,
    cpuFallback: cpuStats.result.value ? JSON.parse(cpuStats.result.value) : null,
    page: PAGE,
    states: states.map(item => item[0]),
    blueNoise: gpuStats.result.value && JSON.parse(gpuStats.result.value).noise,
    frames: frames.map(frame => frame.label),
    visibleCards: cards.result.value,
    consoleErrors,
    reducedMotion: JSON.parse(reduced.result.value),
    overflow: JSON.parse(overflow.result.value)
  }
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))

  client.close()
  chrome.kill()
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => { console.error(error); process.exit(1) })
