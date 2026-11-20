import { getTransitionBackdrop } from './flow.js'
import { blendFlowStops } from './flow-color-stops.js'
import { createFlowCaptureQueue } from './flow-capture-queue.js'
import { createLiquidRenderer, LIQUID_DURATION, liquidPhase } from './liquid-transition-gl.js'

const CAPTURE_BUDGET_MS = 650
const HANDOFF_POINT = .86
const GLIDE_START = .15
const INCOMING_GATE = .24
const GLIDE_RATE = .20
const PRECAPTURE_IDLE_MS = 350
const samePixel = (a, b) => Math.abs(a - b) < 1
const transitioningTokens = new WeakMap()

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
  return {
    root,
    view,
    module: view.dataset.module,
    rev: view.dataset.flowRev || '',
    palette: view.dataset.flowPalette || '',
    rect
  }
}

function sameCapture(a, b) {
  return a.root === b.root && a.view === b.view && a.module === b.module &&
    a.rev === b.rev && a.palette === b.palette && sameSceneRect(a.rect, b.rect)
}

export function sameSceneRect(a, b) {
  return ['left', 'top', 'width', 'height'].every(key => samePixel(a[key], b[key]))
}

export function matchesSceneAspect(image, rect) {
  return image.width > 0 && image.height > 0 && rect.width > 0 && rect.height > 0 &&
    Math.abs(image.height - image.width * rect.height / rect.width) <= 2
}

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
      afterClone({ clone, element }) {
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
        for (const idleControl of clone.querySelectorAll('.oc-rs, .oc-apt, .ob-op, .lore-nav-more')) {
          idleControl.remove()
        }
        // In the isolated capture tree there is no live backdrop behind glass panels; skip expensive blur filters.
        const style = clone.ownerDocument.createElement('style')
        style.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
        clone.prepend(style)
      }
    }]
  }
}

export function createLiquidTransition(canvas, getScene) {
  let renderer
  let disposed = false
  let disposeSurface
  const queueCapture = createFlowCaptureQueue(sameCapture)
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
      loadSnapdom().catch(() => {})
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

  function storeCachedScene(root, rect, image, hd = false) {
    if (!root || !image) return
    const key = captureKey(root, rect)
    cachedScene = { key, image, hd }
    if (key.rev && key.module && hd) {
      if (moduleCache.size >= 4 && !moduleCache.has(key.module)) {
        moduleCache.delete(moduleCache.keys().next().value)
      }
      moduleCache.set(key.module, { key, image })
    }
  }

  function matchCachedScene(root, rect) {
    if (!cachedScene || !root || disposed) return null
    const nowKey = captureKey(root, rect)
    return sameCapture(cachedScene.key, nowKey) ? cachedScene.image : null
  }

  function matchModuleCache(root, rect) {
    if (!root || disposed) return null
    const nowKey = captureKey(root, rect)
    if (!nowKey.rev || !nowKey.module) return null
    const hit = moduleCache.get(nowKey.module)
    return hit && sameCapture(hit.key, nowKey) ? hit.image : null
  }

  function invalidateActiveCache(root) {
    cachedScene = null
    const view = root?.querySelector?.('.workbench-shell[data-module], .latent-shelf') || root
    const mod = view?.dataset?.module
    if (mod) moduleCache.delete(mod)
  }

  function scheduleIdlePrecapture(root) {
    cancelPrecapture()
    if (disposed || !root || document.hidden || disposeSurface) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const run = () => {
      precaptureIdle = undefined
      if (disposed || document.hidden || disposeSurface || !root.isConnected) return
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
      // 空闲预采直接按最高 1.5x（与画布 DPR 对齐），令重访保活页也可无损复用为 incoming。
      capture(root, rect, ac.signal, false, 1.5).then(img => {
        if (precaptureAbort === ac) precaptureAbort = null
        if (img && !ac.signal.aborted && !disposeSurface && root.isConnected &&
          sameSceneRect(rect, root.getBoundingClientRect())) {
          storeCachedScene(root, rect, img, true)
        }
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
    if (disposeSurface) return
    if (event?.type === 'scroll' || event?.type === 'wheel' || event?.type === 'input' ||
      event?.type === 'keydown' || event?.type === 'pointerdown') {
      invalidateActiveCache(observedRoot)
      if (observedRoot) scheduleIdlePrecapture(observedRoot)
    }
  }

  function attachSceneObserver(root) {
    if (!root || typeof MutationObserver !== 'function') return
    if (observedRoot === root) return
    detachSceneObserver()
    observedRoot = root
    domObserver = new MutationObserver(records => {
      if (disposeSurface) return
      let meaningful = false
      for (const r of records) {
        if (r.type === 'attributes' && (r.attributeName === 'data-flow-transitioning' ||
          r.attributeName === 'data-flow-rev' || r.attributeName === 'data-flow-palette')) continue
        const el = r.target?.nodeType === 1 ? r.target : r.target?.parentElement
        if (el?.closest?.('.flow-liquid-overlay, .st-backdrop-wrap, .ls-backdrop-wrap')) continue
        meaningful = true
        break
      }
      if (meaningful) {
        invalidateActiveCache(root)
        scheduleIdlePrecapture(root)
      }
    })
    domObserver.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
    for (const ev of ['scroll', 'wheel', 'input', 'keydown', 'pointerdown']) {
      root.addEventListener(ev, onSceneActivity, { capture: true, passive: true })
    }
  }

  function detachSceneObserver() {
    cancelPrecapture()
    domObserver?.disconnect()
    domObserver = null
    if (observedRoot) {
      for (const ev of ['scroll', 'wheel', 'input', 'keydown', 'pointerdown']) {
        observedRoot.removeEventListener(ev, onSceneActivity, { capture: true })
      }
      observedRoot = null
    }
  }

  async function capture(root, rect, signal, fast = true, maxDensity = .85) {
    if (signal.aborted || disposed || rect.height < 1) return null
    const key = captureKey(root, rect)
    const isCurrent = () => !disposed && root.isConnected && sameCapture(key, captureKey(root, rect))
    try {
      const image = await queueCapture(key, async () => {
        if (!isCurrent()) return null
        const { snapdom } = await loadSnapdom()
        if (!isCurrent()) return null
        const density = Math.min(maxDensity, canvas.width / rect.width, canvas.height / rect.height)
        return snapdom.toCanvas(root, sceneCaptureOptions(rect, density, window.scrollX, window.scrollY, fast))
      }, {
        signal,
        timeoutMs: CAPTURE_BUDGET_MS,
        skipBusy: true
      })
      if (!isCurrent()) return null
      return image && matchesSceneAspect(image, rect) ? image : null
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
    const cachedOutgoing = matchCachedScene(root, rect)
    const outgoing = cachedOutgoing || await capture(root, rect, signal, false, .85)
    cachedScene = null
    if (signal.aborted || disposed || !root.isConnected ||
      document.hidden || !sameSceneRect(rect, root.getBoundingClientRect())) return null
    const source = backdrop.transitionFrame()
    if (!source) return null

    let raf
    let active = true
    let rootToken = 0
    let targetToken = 0
    let transitionTarget
    let lastTickNow
    let virtualElapsed = 0
    let incomingDone = false
    let handedOff = false
    let destination
    let destinationBackdrop
    let releaseSource
    let releaseDestination
    let finish
    const finished = new Promise(resolve => { finish = resolve })

    function cleanup() {
      if (!active) return
      active = false
      disposeSurface = null
      cancelAnimationFrame(raf)
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
          if (settled && !disposeSurface && !cachedScene) scheduleIdlePrecapture(settled)
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

    function tick(now) {
      if (!active) return
      const dt = lastTickNow === undefined ? 0 : Math.min(48, Math.max(0, now - lastTickNow))
      lastTickNow = now
      if (incomingDone) {
        virtualElapsed += dt
      } else {
        const curProgress = liquidProgress(virtualElapsed)
        if (curProgress < GLIDE_START) {
          virtualElapsed = Math.min(GLIDE_START * LIQUID_DURATION, virtualElapsed + dt)
        } else if (curProgress < INCOMING_GATE) {
          // 柔和减速滑行窗：等待目标页采集时波浪保持慢速前进而非一帧冻死。
          virtualElapsed = Math.min(INCOMING_GATE * LIQUID_DURATION, virtualElapsed + dt * GLIDE_RATE)
        }
      }
      const time = liquidProgress(virtualElapsed)
      const phase = source.time + liquidPhase(time, source.speed)
      const stops = destination
        ? blendFlowStops(source.stops, destination.stops, time, 1)
        : source.stops
      try {
        if (time >= HANDOFF_POINT && !handedOff) {
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
          renderer.draw(time, phase, stops)
          raf = requestAnimationFrame(tick)
        }
      } catch {
        cleanup()
      }
    }

    try {
      if (outgoing) renderer.setScene(outgoing, 'outgoing')
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
        if (outgoing) {
          renderer.draw(0, source.time, source.stops)
          canvas.hidden = false
        }
        return Promise.resolve()
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
          renderer.draw(0, source.time, source.stops)
          canvas.hidden = false
        }
        // Start the diagonal wave immediately: incoming isn't sampled until u_progress > 0.24.
        raf = requestAnimationFrame(tick)
        try {
          // 若重访保活模块（大纲/设定）且版本、调色与视口未变，直接零耗时复用高清缓存帧；否则按 1.5x 分帧采集。
          const cachedIncoming = matchModuleCache(next, rect)
          const incoming = cachedIncoming || await capture(next, rect, signal, false, 1.5)
          if (active && incoming && sameSceneRect(rect, next.getBoundingClientRect())) {
            // Yield a frame between SVG rasterization and WebGL mipmap upload so opening frames stay smooth.
            if (!cachedIncoming) await new Promise(resolve => requestAnimationFrame(resolve))
            if (active && sameSceneRect(rect, next.getBoundingClientRect())) {
              renderer.setScene(incoming, 'incoming')
              storeCachedScene(next, rect, incoming, true)
              attachSceneObserver(next)
            }
          }
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
