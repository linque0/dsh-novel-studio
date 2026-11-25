/**
 * 幻流工作台页面切换 WebGL 液态转场调度器：
 * 结合 SnapDOM 预采集与 MutationObserver 脏检测，在点击顶部导航时立即以水波纹遮罩
 * 隐藏路由切换闪烁，待目标页首帧采集上传后平滑融合退场；不支持 WebGL2 时静默降级直切。
 */
import { getTransitionBackdrop } from './flow.js'
import { blendFlowStops } from './flow-color-stops.js'
import { createFlowCaptureQueue } from './flow-capture-queue.js'
import { liveCapturePlugin, renderLiveCapture } from './flow-live-capture.js'
import { COVER_DURATION, createLiquidRenderer, FALLBACK_HANDOFF_POINT, LIQUID_DURATION, liquidPhase } from './liquid-transition-gl.js'

const CAPTURE_BUDGET_MS = 650
const IDLE_CAPTURE_BUDGET_MS = 3000
const MODULE_CACHE_LIMIT = 5
const HANDOFF_POINT = .86
const GLIDE_START = .15
const INCOMING_GATE = .24
const GLIDE_RATE = .20
const FALLBACK_MID_RATE = 1.45
const PRECAPTURE_IDLE_MS = 350
const hasNativeCapture = () => typeof window !== 'undefined' && typeof window.native?.captureScene === 'function'
const samePixel = (a, b) => Math.abs(a - b) < 1
const transitioningTokens = new WeakMap()
const navButtonSelector = '.app-topnav-item[data-nav]:enabled'
const sceneActivityEvents = ['scroll', 'wheel', 'input', 'keydown', 'pointerdown', 'pointerover', 'pointerout', 'focusin', 'focusout', 'load']

/** 根据点击/键盘事件判断是否属于会触发液态转场的顶栏模块切换意图。 */
export function isFlowNavigationIntent(event) {
  if (!event.target?.closest?.(navButtonSelector)) return false
  return (event.type === 'pointerdown' && event.isPrimary && event.button === 0) ||
    (event.type === 'keydown' && (event.key === 'Enter' || event.key === ' '))
}

function beginTransitioning(el) {
  if (!el) return 0
  const token = (transitioningTokens.get(el) || 0) + 1
  transitioningTokens.set(el, token)
  el.setAttribute('data-flow-transitioning', '')
  return token
}

function endTransitioning(el, token) {
  if (!el || transitioningTokens.get(el) !== token) return
  el.removeAttribute('data-flow-transitioning')
}

export function liquidProgress(elapsed) {
  return Math.min(1, Math.max(0, elapsed / LIQUID_DURATION))
}

export function liquidFrame(now, start, speed, hold = 0) {
  const time = liquidProgress(now - start)
  return { time, phase: liquidPhase(time, speed, hold) }
}

function captureKey(root, rect) {
  const view = root.querySelector('.workbench-shell[data-module], .latent-shelf') || root
  const focus = root.ownerDocument.activeElement
  const nav = view.querySelector('.app-topnav')
  return {
    root,
    view,
    module: view.dataset.module,
    rev: view.dataset.flowRev || '',
    palette: view.dataset.flowPalette || '',
    rect,
    dpr: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focus: root.contains(focus) && focus?.matches(':focus-visible') ? focus : null,
    navPaint: nav ? Array.from(nav.querySelectorAll(navButtonSelector), button => {
      const style = getComputedStyle(button)
      return [style.color, style.backgroundColor, style.borderColor, style.boxShadow,
        style.outline, style.outlineOffset, style.transform].join('|')
    }).join(';') : ''
  }
}

function sameScene(a, b) {
  return a.root === b.root && a.view === b.view && a.module === b.module &&
    a.rev === b.rev && a.palette === b.palette && a.dpr === b.dpr &&
    a.scrollX === b.scrollX && a.scrollY === b.scrollY && sameSceneRect(a.rect, b.rect)
}

function sameCapture(a, b) {
  return sameScene(a, b) && a.focus === b.focus && a.navPaint === b.navPaint
}

/** 判断 DOM 变动记录是否真实影响了可见画面（忽略过渡自身产生的属性和背景层变动）。 */
export function changedScene(records) {
  if (!records?.length) return false
  const seen = new Map()
  for (const r of records) {
    const el = r.target.nodeType === 1 ? r.target : r.target.parentElement
    if (el?.closest('.flow-liquid-overlay, .st-backdrop-wrap, .ls-backdrop-wrap')) continue
    if (r.type === 'childList') return true
    const name = r.attributeName
    if (name === 'data-flow-transitioning' || name === 'data-flow-rev' || name === 'data-flow-palette') continue
    let fields = seen.get(r.target)
    if (!fields) seen.set(r.target, fields = new Set())
    if (fields.has(name)) continue
    fields.add(name)
    const current = r.type === 'characterData' ? r.target.data : r.target.getAttribute(name)
    if (r.oldValue !== current) return true
  }
  return false
}

export function sameSceneRect(a, b) {
  return ['left', 'top', 'width', 'height'].every(key => samePixel(a[key], b[key]))
}

export function matchesSceneAspect(image, rect) {
  return image.width > 0 && image.height > 0 && rect.width > 0 && rect.height > 0 &&
    Math.abs(image.height - image.width * rect.height / rect.width) <= 2
}

/** 构造 SnapDOM 截图选项：隐藏实景流动背景与悬停控件，并禁用隔离树内高开销的 backdrop-filter。 */
export function sceneCaptureOptions(rect, density, scrollX, scrollY, fast = true) {
  return {
    dpr: density,
    clip: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
    exclude: '[data-flow-transition-backdrop], .ls-card.is-out',
    excludeMode: 'hide',
    excludeStyleProps: /^--/,
    embedFonts: false,
    fast,
    outerTransforms: false,
    plugins: [{
      name: 'novel-studio-transition',
      afterClone({ clone, element, nodeMap }) {
        if (!clone) return
        clone.style.setProperty('box-sizing', 'border-box', 'important')
        clone.style.setProperty('width', element.offsetWidth + 'px', 'important')
        clone.style.setProperty('height', element.offsetHeight + 'px', 'important')
        clone.style.setProperty('background', 'none', 'important')
        for (const layer of clone.querySelectorAll('.latent-shelf, .workbench-shell[data-flow]')) {
          layer.style.setProperty('background', 'none', 'important')
        }
        for (const backdrop of clone.querySelectorAll('.ls-backdrop-wrap, .st-backdrop-wrap')) {
          backdrop.style.setProperty('display', 'none', 'important')
        }
        for (const idleControl of clone.querySelectorAll('.oc-rs, .oc-apt, .ob-op, .lore-nav-more, .snip-drag-ghost')) {
          idleControl.remove()
        }
        // Prune offscreen snippet lanes/cards outside the capture viewport to keep SVG serialization lean.
        if (nodeMap && rect.width > 0 && rect.height > 0) {
          const pad = 32
          const vLeft = rect.left - pad
          const vTop = rect.top - pad
          const vRight = rect.left + rect.width + pad
          const vBottom = rect.top + rect.height + pad
          const offscreen = (clonedNode) => {
            const liveNode = nodeMap.get(clonedNode)
            if (!liveNode || typeof liveNode.getBoundingClientRect !== 'function') return false
            const b = liveNode.getBoundingClientRect()
            return b.right < vLeft || b.left > vRight || b.bottom < vTop || b.top > vBottom
          }
          for (const lane of clone.querySelectorAll('.snip-lane')) {
            if (offscreen(lane)) { lane.remove(); continue }
            for (const card of lane.querySelectorAll('.snip-note')) {
              if (offscreen(card)) card.remove()
            }
          }
          for (const navItem of clone.querySelectorAll('.snip-nav-notes > li')) {
            if (offscreen(navItem)) navItem.remove()
          }
        }
        // In the isolated capture tree there is no live backdrop behind glass panels; skip expensive blur filters.
        const style = clone.ownerDocument.createElement('style')
        style.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
        clone.prepend(style)
      }
    }]
  }
}

/**
 * 创建绑定到覆盖层画布的液态转场实例，对外提供 prepare(signal) 与 dispose()。
 * 内部维护启动预热、空闲预采缓存与按模块 rev 复用的高清保活帧缓存。
 */
export function createLiquidTransition(canvas, getScene) {
  let renderer
  let disposed = false
  let disposeSurface
  let sceneRevision = 0
  let captureMutations
  const queueCapture = createFlowCaptureQueue((running, requested) => !requested.fresh &&
    running.revision === requested.revision && running.live === requested.live && running.density >= requested.density &&
    sameCapture(running.scene, requested.scene) && !changedScene(captureMutations))
  let snapdomModule
  const loadSnapdom = () => {
    snapdomModule ||= import('@zumer/snapdom').catch(error => {
      snapdomModule = null
      throw error
    })
    return snapdomModule
  }
  let warmupTimer
  let warmupIdle
  function cancelWarmup() {
    if (warmupTimer !== undefined) {
      clearTimeout(warmupTimer)
      warmupTimer = undefined
    }
    if (warmupIdle !== undefined) {
      window.cancelIdleCallback?.(warmupIdle)
      warmupIdle = undefined
    }
  }
  function scheduleBootWarmup() {
    cancelWarmup()
    if (disposed) return
    const run = () => {
      warmupIdle = undefined
      if (disposed || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      if (!hasNativeCapture()) loadSnapdom().catch(() => {})
      if (renderer) return
      try {
        renderer = createLiquidRenderer(canvas)
        const root = getScene()
        const frame = root && getTransitionBackdrop(root)?.transitionFrame()
        if (frame) {
          renderer.resize(2, 2)
          renderer.draw(.5, frame.time, frame.stops)
          const rect = root.getBoundingClientRect()
          if (rect.width >= 1 && rect.height >= 1) renderer.resize(rect.width, rect.height)
        }
      } catch { /* Navigate directly if WebGL2 is unavailable. */ }
    }
    if (typeof window.requestIdleCallback === 'function') {
      warmupIdle = window.requestIdleCallback(run, { timeout: 1200 })
    } else {
      warmupTimer = setTimeout(run, 120)
    }
  }
  scheduleBootWarmup()

  // 空闲预采 + 场景快照缓存：离开大纲/设定等重内容页时尽量零等待起浪，同时保持任一 DOM/滚动/数据变更即失效。
  let cachedScene = null
  const moduleCache = new Map()
  let observedRoot = null
  let domObserver = null
  let precaptureTimer
  let precaptureIdle
  let precaptureAbort = null

  function cancelPrecapture() {
    if (precaptureTimer !== undefined) {
      clearTimeout(precaptureTimer)
      precaptureTimer = undefined
    }
    if (precaptureIdle !== undefined) {
      window.cancelIdleCallback?.(precaptureIdle)
      precaptureIdle = undefined
    }
    precaptureAbort?.abort()
    precaptureAbort = null
  }

  function storeCachedScene(snapshot) {
    const { key } = snapshot
    const live = liveGalaxyCanvas(key.root)
    if (!snapshotIsCurrent(snapshot)) return
    if (live) {
      if (snapshot.live?.canvas === live || snapshot.opaque) cachedScene = { ...snapshot, image: snapshot.opaque ? snapshot.image : null }
      return
    }
    cachedScene = snapshot
    if (key.rev && key.module) {
      if (moduleCache.size >= MODULE_CACHE_LIMIT && !moduleCache.has(key.module)) {
        moduleCache.delete(moduleCache.keys().next().value)
      }
      moduleCache.set(key.module, snapshot)
    }
  }

  function matchCachedScene(root, rect) {
    if (!cachedScene || disposed || changedScene(captureMutations)) return null
    if (liveGalaxyCanvas(root) !== (cachedScene.live?.canvas || null) && !cachedScene.opaque) return null
    const nowKey = captureKey(root, rect)
    // 忽略顶栏按钮悬停/焦点样式波动，防止移动鼠标准备点击时误击穿刚建好的空闲缓存。
    return sameScene(cachedScene.key, nowKey) ? cachedScene : null
  }

  function matchModuleCache(root, rect) {
    if (!root || disposed || liveGalaxyCanvas(root)) return null
    const nowKey = captureKey(root, rect)
    if (!nowKey.rev || !nowKey.module) return null
    const hit = moduleCache.get(nowKey.module)
    // 跨模块重访时顶栏按钮往往处于悬停/焦点态，按 sameScene 匹配避免误击穿有效模块缓存。
    return hit && sameScene(hit.key, nowKey) ? hit : null
  }

  function invalidateActiveCache(root) {
    cachedScene = null
    const view = root?.querySelector?.('.workbench-shell[data-module], .latent-shelf') || root
    const mod = view?.dataset?.module
    if (mod) moduleCache.delete(mod)
  }

  function liveGalaxyCanvas(root) {
    const canvas = root.querySelector('.lpn-stage > canvas')
    return canvas?.offsetWidth > 0 && canvas.offsetHeight > 0 ? canvas : null
  }

  function scheduleIdlePrecapture(root) {
    cancelPrecapture()
    if (disposed || !root || document.hidden || disposeSurface) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const run = () => {
      precaptureIdle = undefined
      if (disposed || document.hidden || disposeSurface || !root.isConnected) return
      const live = liveGalaxyCanvas(root)
      const useNative = hasNativeCapture()
      // Only prepare the SnapDOM galaxy shell when the pointer or keyboard focus reaches module navigation.
      if (!useNative && live && !root.querySelector(navButtonSelector + ':is(:hover,:focus-visible)')) return
      const rect = root.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      if (matchCachedScene(root, rect)) return
      const ac = new AbortController()
      precaptureAbort = ac
      if (!renderer) {
        try {
          renderer = createLiquidRenderer(canvas)
        } catch { return }
      }
      renderer.resize(rect.width, rect.height)
      // 桌面端空闲预采直接走原生 capturePage（~15ms，1:1 清晰度且保留真实毛玻璃）；DSH 插件回落空闲 SnapDOM 预采。
      const job = useNative
        ? captureNative(root, rect, ac.signal)
        : capture(root, rect, ac.signal, live ? .85 : 1.5, true, live, false, IDLE_CAPTURE_BUDGET_MS)
      job.then(snapshot => {
        if (precaptureAbort === ac) precaptureAbort = null
        if (snapshot && !ac.signal.aborted && !disposeSurface && canvas.hidden) storeCachedScene(snapshot)
      }).catch(() => {
        if (precaptureAbort === ac) precaptureAbort = null
      })
    }
    precaptureTimer = setTimeout(() => {
      precaptureTimer = undefined
      if (typeof window.requestIdleCallback === 'function') {
        precaptureIdle = window.requestIdleCallback(run, { timeout: 1500 })
      } else {
        run()
      }
    }, PRECAPTURE_IDLE_MS)
  }

  function onSceneActivity(event) {
    if (isFlowNavigationIntent(event)) return
    const nav = event.target?.closest?.(navButtonSelector)
    if (event.type === 'pointerover' || event.type === 'pointerout') {
      // 已有当前缓存时悬停顶栏不再打断或重跑预采；仅星系页面首次悬停导航且无缓存时触发。
      if (!disposeSurface && !cachedScene && nav && !nav.contains(event.relatedTarget)) scheduleIdlePrecapture(observedRoot)
      return
    }
    if (nav && (event.type === 'focusin' || event.type === 'focusout')) {
      if (!disposeSurface && !cachedScene) scheduleIdlePrecapture(observedRoot)
      return
    }
    sceneRevision++
    invalidateActiveCache(observedRoot)
    if (!disposeSurface) scheduleIdlePrecapture(observedRoot)
  }

  function onFontsChanged() {
    sceneRevision++
    cachedScene = null
    moduleCache.clear()
    if (!disposeSurface) scheduleIdlePrecapture(observedRoot)
  }

  function onSceneMutations(root, records) {
    if (!changedScene(records)) return
    sceneRevision++
    if (disposeSurface && !cachedScene) return
    invalidateActiveCache(root)
    if (!disposeSurface) scheduleIdlePrecapture(root)
  }

  function attachSceneObserver(root) {
    if (!root || typeof MutationObserver !== 'function') return
    if (observedRoot === root) return
    detachSceneObserver()
    observedRoot = root
    domObserver = new MutationObserver(records => {
      if (captureMutations) {
        for (const record of records) captureMutations.push(record)
      }
      else onSceneMutations(root, records)
    })
    domObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true,
      characterData: true, characterDataOldValue: true })
    for (const ev of sceneActivityEvents) {
      root.addEventListener(ev, onSceneActivity, { capture: true, passive: true })
    }
    root.ownerDocument.fonts?.addEventListener('loadingdone', onFontsChanged)
  }

  function detachSceneObserver() {
    cancelPrecapture()
    domObserver?.disconnect()
    domObserver = null
    if (observedRoot) {
      observedRoot.ownerDocument.fonts?.removeEventListener('loadingdone', onFontsChanged)
      for (const ev of sceneActivityEvents) {
        observedRoot.removeEventListener(ev, onSceneActivity, { capture: true })
      }
      observedRoot = null
    }
  }

  function snapshotIsCurrent(snapshot) {
    const { key, revision } = snapshot
    return !disposed && getScene() === key.root && key.root.isConnected && revision === sceneRevision &&
      sameScene(key, captureKey(key.root, key.root.getBoundingClientRect()))
  }

  /** Electron 桌面端原生硬件抓帧（~15–30ms，零主线程克隆、保留真实毛玻璃与 1:1 清晰度）。 */
  async function captureNative(root, rect, signal) {
    if (signal.aborted || disposed || rect.width < 1 || rect.height < 1 || !canvas.hidden || disposeSurface) return null
    const key = captureKey(root, rect)
    const revision = sceneRevision
    const density = Math.min(window.devicePixelRatio || 1, 1.5, 4096 / Math.max(rect.width, rect.height))
    const box = {
      left: Math.max(0, Math.floor(rect.left)),
      top: Math.max(0, Math.floor(rect.top)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    try {
      const bytes = await window.native.captureScene(box)
      if (!bytes || signal.aborted || disposed || !root.isConnected || !canvas.hidden || disposeSurface) return null
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      if (signal.aborted || disposed || !root.isConnected || !matchesSceneAspect(image, rect) ||
        !sameScene(key, captureKey(root, root.getBoundingClientRect()))) {
        image.close?.()
        return null
      }
      return { key, revision, image, opaque: true, live: null, density }
    } catch {
      return null
    }
  }

  async function capture(root, rect, signal, maxDensity, idle = false, live = null, fresh = false, timeoutMs = CAPTURE_BUDGET_MS) {
    if (signal.aborted || disposed || rect.height < 1) return null
    const key = captureKey(root, rect)
    const revision = sceneRevision
    const density = Math.min(maxDensity, canvas.width / rect.width, canvas.height / rect.height)
    const isCurrent = () => !disposed && getScene() === root && root.isConnected &&
      sameScene(key, captureKey(root, root.getBoundingClientRect()))
    try {
      let ownsCapture = false
      const snapshot = await queueCapture({ scene: key, revision, density, live, fresh }, async () => {
        ownsCapture = true
        const { snapdom } = await loadSnapdom()
        if (!isCurrent()) return null
        const paintKey = captureKey(root, rect)
        const paintRevision = sceneRevision
        // SnapDOM temporarily edits live text and inline styles to measure layout. Compare the
        // first value to the restored value before invalidating a snapshot for those writes.
        const records = captureMutations = []
        let image
        const slot = live && liveCapturePlugin(live)
        try {
          // 交互切页用 fast=true 一次性完成克隆，避免按帧让出拉长到 800ms；空闲预采保持 fast=false 不抢交互帧。
          const options = sceneCaptureOptions(rect, density, key.scrollX, key.scrollY, !idle)
          if (slot) options.plugins.push(slot.plugin)
          image = await snapdom.toCanvas(root, options)
        } finally {
          captureMutations = null
          if (observedRoot === root) onSceneMutations(root, records.concat(domObserver?.takeRecords() || []))
        }
        return image && matchesSceneAspect(image, rect)
          ? { key: paintKey, revision: paintRevision, image, live: slot?.template(), density }
          : null
      }, {
        signal,
        timeoutMs,
        skipBusy: idle
      })
      if (!snapshot || signal.aborted || !isCurrent()) return null
      // An input or a real DOM update may have made a shared idle result stale while it was in flight.
      if (!ownsCapture && !idle && !snapshotIsCurrent(snapshot)) {
        return capture(root, rect, signal, maxDensity, false, live, true, timeoutMs)
      }
      return snapshot
    } catch { return null }
  }

  async function prepare({ signal }) {
    cancelWarmup()
    cancelPrecapture()
    const root = getScene()
    const backdrop = root && getTransitionBackdrop(root)
    if (disposed || document.hidden || !backdrop?.transitionFrame()) return null
    const rect = root.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    attachSceneObserver(root)
    renderer ||= createLiquidRenderer(canvas)
    renderer.resize(rect.width, rect.height)
    const cachedOutgoing = matchCachedScene(root, rect) || matchModuleCache(root, rect)
    let outgoing = cachedOutgoing?.image
    let outgoingOpaque = Boolean(cachedOutgoing?.opaque)
    if (cachedOutgoing?.live) {
      try {
        outgoing = await renderLiveCapture(cachedOutgoing.live, cachedOutgoing.density)
        outgoingOpaque = false
        if (!outgoing || !matchesSceneAspect(outgoing, rect)) outgoing = null
      } catch {
        // Keep the full-scene capture available if the prepared SVG cannot be painted.
      }
    }
    // 桌面端未命中缓存时使用原生 capturePage（~15–30ms，不阻塞主线程）；DSH 插件绝不在点击瞬间同步跑耗时 DOM 克隆。
    if (!outgoing && !signal.aborted && hasNativeCapture()) {
      const snap = await captureNative(root, rect, signal)
      outgoing = snap?.image || null
      outgoingOpaque = Boolean(snap?.opaque)
    }
    cachedScene = null
    if (signal.aborted || disposed || !root.isConnected ||
      document.hidden || !sameSceneRect(rect, root.getBoundingClientRect())) return null
    const source = backdrop.transitionFrame()
    if (!source) return null

    const hasOutgoing = Boolean(outgoing)
    let raf
    let active = true
    let rootToken = 0
    let targetToken = 0
    let transitionTarget
    let lastTickNow
    let virtualElapsed = 0
    let incomingDone = false
    let hasIncoming = false
    let handedOff = false
    let stage = 'idle'
    let coverElapsed = 0
    let coverPhase = source.time
    let revealPhaseOffset = source.time
    let resolveCover = null
    let destination
    let destinationBackdrop
    let releaseSource
    let releaseDestination
    let cancelPaintWait
    let finish
    const finished = new Promise(resolve => { finish = resolve })

    function cleanup() {
      if (!active) return
      active = false
      disposeSurface = null
      cancelAnimationFrame(raf)
      cancelPaintWait?.()
      const pendingCover = resolveCover
      resolveCover = null
      pendingCover?.()
      signal.removeEventListener('abort', cleanup)
      window.removeEventListener('resize', cleanup)
      document.removeEventListener('visibilitychange', cleanup)
      canvas.hidden = true
      const doneTarget = transitionTarget
      const rTok = rootToken
      const tTok = targetToken
      transitionTarget = null
      rootToken = 0
      targetToken = 0
      if (disposed) {
        endTransitioning(root, rTok)
        endTransitioning(doneTarget, tTok)
      } else {
        // 延后 1 帧拆除过渡抑制属性，错开 canvas 隐藏与实景合成恢复的样式重算峰值。
        requestAnimationFrame(() => {
          endTransitioning(root, rTok)
          endTransitioning(doneTarget, tTok)
          const settled = getScene()
          if (settled && !disposeSurface) scheduleIdlePrecapture(settled)
        })
      }
      try {
        renderer?.clear()
      } finally {
        releaseSource?.()
        releaseDestination?.()
        finish()
      }
    }

    function nextPaint() {
      return new Promise(resolve => {
        let timer
        const done = () => {
          cancelPaintWait = null
          resolve()
        }
        const frame = requestAnimationFrame(() => { timer = setTimeout(done, 0) })
        cancelPaintWait = () => {
          cancelAnimationFrame(frame)
          clearTimeout(timer)
          done()
        }
      })
    }

    function tick(now) {
      if (!active) return
      const dt = lastTickNow === undefined ? 0 : Math.min(48, Math.max(0, now - lastTickNow))
      lastTickNow = now
      if (stage === 'cover' || stage === 'hold') {
        coverPhase += (dt / 1000) * (source.speed + 2.4)
        if (stage === 'cover') {
          coverElapsed = Math.min(COVER_DURATION, coverElapsed + dt)
          const cover = coverElapsed / COVER_DURATION
          const time = cover * INCOMING_GATE
          try {
            renderer.draw(time, coverPhase, source.stops, cover)
            if (cover >= 1) {
              stage = 'hold'
              const done = resolveCover
              resolveCover = null
              done?.()
            }
            raf = requestAnimationFrame(tick)
          } catch {
            cleanup()
          }
          return
        }
        try {
          renderer.draw(INCOMING_GATE, coverPhase, source.stops, 1)
          raf = requestAnimationFrame(tick)
        } catch {
          cleanup()
        }
        return
      }

      if (incomingDone) {
        const rate = !hasOutgoing && !hasIncoming && liquidProgress(virtualElapsed) < FALLBACK_HANDOFF_POINT
          ? FALLBACK_MID_RATE
          : 1
        virtualElapsed += dt * rate
      } else {
        const curProgress = liquidProgress(virtualElapsed)
        if (curProgress < GLIDE_START) {
          virtualElapsed = Math.min(GLIDE_START * LIQUID_DURATION, virtualElapsed + dt)
        } else if (curProgress < INCOMING_GATE) {
          // 柔和减速滑行窗：等待目标页采集时波浪保持慢速前进而非一帧冻死。
          virtualElapsed = Math.min(INCOMING_GATE * LIQUID_DURATION, virtualElapsed + dt * GLIDE_RATE)
        } else {
          revealPhaseOffset += (dt / 1000) * (source.speed + 2.4)
        }
      }
      const time = liquidProgress(virtualElapsed)
      const phase = revealPhaseOffset + liquidPhase(time, source.speed)
      const colorT = hasOutgoing
        ? time
        : Math.min(1, Math.max(0, (time - INCOMING_GATE) / (1 - INCOMING_GATE)))
      const stops = destination
        ? blendFlowStops(source.stops, destination.stops, colorT, 1)
        : source.stops
      const handoffPoint = hasIncoming ? HANDOFF_POINT : FALLBACK_HANDOFF_POINT
      try {
        if (time >= handoffPoint && !handedOff) {
          handedOff = true
          // Sync and wake the live backdrop right before the final fade-out so handoff has zero pop.
          destinationBackdrop?.syncTransitionTime(phase)
          releaseSource?.()
          releaseSource = null
          releaseDestination?.()
          releaseDestination = null
        }
        if (time === 1) {
          cleanup()
        } else {
          renderer.draw(time, phase, stops, 1)
          raf = requestAnimationFrame(tick)
        }
      } catch {
        cleanup()
      }
    }

    try {
      if (outgoing) renderer.setScene(outgoing, 'outgoing', { opaque: outgoingOpaque })
    } catch (error) {
      renderer?.clear()
      throw error
    }
    for (const key of ['left', 'top', 'width', 'height']) canvas.style[key] = rect[key] + 'px'
    disposeSurface = cleanup
    signal.addEventListener('abort', cleanup, { once: true })
    window.addEventListener('resize', cleanup, { once: true })
    document.addEventListener('visibilitychange', cleanup, { once: true })

    return {
      play() {
        if (!active) return Promise.resolve()
        // 冻结源场景在切换与提交阶段的 CSS 过渡，确保顶栏与进场面板在采集前已落定。
        rootToken = beginTransitioning(root)
        releaseSource = backdrop.holdTransition()
        if (hasOutgoing) {
          renderer.draw(0, source.time, source.stops, 1)
          canvas.hidden = false
          return Promise.resolve()
        }
        // 无旧页快照时必须先以液态浪涌盖严真实旧页，再放行 commit()，杜绝新界面提前露底。
        stage = 'cover'
        coverElapsed = 0
        coverPhase = source.time
        lastTickNow = undefined
        renderer.draw(0, coverPhase, source.stops, 0)
        canvas.hidden = false
        return new Promise(resolve => {
          resolveCover = resolve
          raf = requestAnimationFrame(tick)
        })
      },
      async reveal() {
        if (!active) return
        const next = getScene()
        if (!next || !sameSceneRect(rect, next.getBoundingClientRect())) return cleanup()
        transitionTarget = next
        targetToken = beginTransitioning(next)
        destinationBackdrop = getTransitionBackdrop(next)
        destination = destinationBackdrop?.transitionFrame()
        if (destinationBackdrop !== backdrop) releaseDestination = destinationBackdrop?.holdTransition()
        if (canvas.hidden) {
          renderer.draw(0, source.time, source.stops, 1)
          canvas.hidden = false
        }
        if (hasOutgoing) {
          stage = 'reveal'
          virtualElapsed = 0
          revealPhaseOffset = source.time
          lastTickNow = undefined
          // Start the diagonal wave immediately: incoming isn't sampled until u_progress > 0.24.
          raf = requestAnimationFrame(tick)
        } else {
          // 承接 cover/hold 阶段已运行中的 rAF，无缝续接相位与 u_progress = INCOMING_GATE。
          stage = 'reveal'
          virtualElapsed = INCOMING_GATE * LIQUID_DURATION
          revealPhaseOffset = coverPhase - liquidPhase(INCOMING_GATE, source.speed)
        }
        try {
          // 命中 moduleCache 时 0ms 上传原生/预采高清帧实现完整「旧页融墨 + 新页聚墨」；
          // 首访冷目标绝不在 rAF 期间跑阻塞主线程的 DOM 克隆，由同源对角波纹自然扫开直接揭示底下锐利真页面，
          // 页面稳定后后台以 capturePage / 空闲预采写入 moduleCache 供后续往返复用。
          const cachedIncoming = matchModuleCache(next, rect)
          if (cachedIncoming && active && sameSceneRect(rect, next.getBoundingClientRect())) {
            renderer.setScene(cachedIncoming.image, 'incoming', { opaque: Boolean(cachedIncoming.opaque) })
            hasIncoming = true
            storeCachedScene({ ...cachedIncoming, revision: sceneRevision })
          }
          attachSceneObserver(next)
        } catch {
          // The same moving flow can uncover the live page if its texture cannot be uploaded.
        } finally {
          incomingDone = true
        }
        await finished
      },
      dispose: cleanup
    }
  }

  return {
    prepare,
    dispose() {
      disposed = true
      cancelWarmup()
      detachSceneObserver()
      cachedScene = null
      moduleCache.clear()
      disposeSurface?.()
      renderer?.dispose()
      renderer = null
    }
  }
}
