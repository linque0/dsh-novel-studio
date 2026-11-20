/* 书架、正文与其余功能页共用的流动底引擎：GPU（MeshGradient + Dithering）优先，
   取不到 WebGL 或上下文丢失时退 CPU 逐像素底。挂载、降级、统计全仓只有这一份实现。 */
import { createLatentBackdrop } from './latent-gl.js'
import { createCpuBackdrop } from './cpu-backdrop.js'
import { normalizeFlowSpeed } from './flow-motion.js'

const transitionBackdrops = new WeakMap()
let pooledTransitionBackdrop = null

export function getTransitionBackdrop(root) {
  return transitionBackdrops.get(root.querySelector('[data-flow-transition-backdrop]'))
}

/* 碰过 WebGL 的画布在 loseContext 之后拿不回可用上下文，被 2D 占过的画布同样拿不到 WebGL，
   所以换页重挂必须换一张新画布。调用方的 ref 指向的元素在 replaceWith 之后已脱流，
   新画布记在它身上，下次挂载顺着找回。 */
function reusableCanvas(root) {
  const current = root.__nsFlowLive && root.__nsFlowLive.isConnected ? root.__nsFlowLive : root
  if (!current.__nsFlowUsed) return current
  const fresh = document.createElement('canvas')
  fresh.className = current.className
  fresh.style.cssText = current.style.cssText
  fresh.__nsFlowUsed = true
  current.replaceWith(fresh)
  root.__nsFlowLive = fresh
  return fresh
}

export function mountFlowBackdrop(canvas, options = {}) {
  if (!canvas) return null
  const settings = { palette: null, reducedMotion: false, simWidth: 640, onFallback: null, ...options }
  let backend = null
  let shaderLog = ''
  let palette = settings.palette || null
  let speed = normalizeFlowSpeed(settings.speed)
  let live = reusableCanvas(canvas)
  let api

  function registerTransitionBackdrop() {
    if (!settings.transitionSurface || !api) return
    live.dataset.flowTransitionBackdrop = ''
    transitionBackdrops.set(live, api)
  }

  function notify(reason) {
    try { settings.onFallback?.(reason) } catch { /* 调用方回调不该影响背板本身 */ }
  }

  function switchToCpu(snapshot = {}) {
    try { backend?.dispose?.() } catch { /* GPU 上下文已丢失，销毁失败不影响兜底 */ }
    backend = null
   /* 只要碰过 WebGL，这张画布就再也取不到 2D 上下文（"no-webgl" 时没碰过，可原地复用）：一律换新画布再兜底。 */
    live = reusableCanvas(canvas)
    const cpu = createCpuBackdrop(live, {
      simWidth: settings.simWidth, reducedMotion: settings.reducedMotion, speed,
      palette, stops: snapshot.stops, time: snapshot.time
    })
    backend = cpu.supported ? cpu : null
    if (snapshot.stops) backend?.setPalette(palette, { duration: 300 })
    live.__nsFlowUsed = true
    registerTransitionBackdrop()
  }

  const onFallback = (reason, snapshot) => { switchToCpu(snapshot); notify(reason) }
  const pooled = settings.transitionSurface ? pooledTransitionBackdrop : null
  if (pooled) {
    pooledTransitionBackdrop = null
    pooled.canvas.className = live.className
    pooled.canvas.style.cssText = live.style.cssText
    pooled.canvas.__nsFlowUsed = true
    live.replaceWith(pooled.canvas)
    canvas.__nsFlowLive = pooled.canvas
    live = pooled.canvas
    backend = pooled.backend
    backend.setPalette(palette, { duration: 0 })
    backend.setSpeed(speed)
    backend.setReducedMotion(settings.reducedMotion)
    backend.reattach(onFallback)
  } else {
    live.__nsFlowUsed = true
    const gpu = createLatentBackdrop(live, {
      palette, speed, reducedMotion: settings.reducedMotion,
      onFallback
    })
    shaderLog = gpu.shaderLog || ''
    if (gpu.supported) backend = gpu
    else {
      switchToCpu()
      notify((gpu && gpu.reason) || 'gpu-unavailable')
    }
  }
  live.__nsFlowUsed = true

  api = {
    get backend() { return backend && backend.backend === 'gpu' ? 'gpu' : 'cpu' },
    setPalette(next, opts = {}) {
      palette = next || null
      backend?.setPalette?.(next, settings.reducedMotion ? { ...opts, duration: 0 } : opts)
    },
    setSpeed(value) {
      speed = normalizeFlowSpeed(value)
      backend?.setSpeed(speed)
    },
    setReducedMotion(value) {
      settings.reducedMotion = Boolean(value)
      backend?.setReducedMotion?.(value)
    },
    resize() { backend?.resize?.() },
    transitionFrame() {
      const frame = backend?.transitionFrame()
      return frame && { ...frame, speed }
    },
    syncTransitionTime(time) { backend?.syncTransitionTime(time) },
    holdTransition() { return backend?.holdTransition() },
    stats() {
      const base = backend && typeof backend.stats === 'function' ? backend.stats() : {}
      return {
        backend: base.backend === 'gpu' ? 'gpu' : 'cpu',
        renderer: base.renderer || '',
        avgFrameMs: Number(base.avgFrameMs) || 0,
        scale: Number(base.scale) || 1,
        pixels: base.pixels || [0, 0],
        time: Number(base.time) || 0,
        /* 书架既有的取证字段（noise/shaderLog）不删：验收脚本与排查都还在读 */
        noise: base.noise || '',
        shaderLog: base.shaderLog || shaderLog,
        speed
      }
    },
    dispose() {
      transitionBackdrops.delete(live)
      delete live.dataset.flowTransitionBackdrop
      if (settings.transitionSurface && backend?.backend === 'gpu' && typeof backend.reattach === 'function') {
        backend.setParked(true)
        const previous = pooledTransitionBackdrop
        pooledTransitionBackdrop = { canvas: live, backend }
        if (previous && previous.backend !== backend) {
          try { previous.backend.dispose?.() } catch { /* 已销毁 */ }
        }
      } else {
        try { backend?.dispose?.() } catch { /* 已销毁 */ }
      }
      backend = null
      if (live !== canvas && live.parentNode) live.replaceWith(canvas)
      delete canvas.__nsFlowLive
    }
  }
  registerTransitionBackdrop()
  return api
}
