/* 书架、正文与其余功能页共用的流动底引擎：GPU（MeshGradient + Dithering）优先，
   取不到 WebGL 或上下文丢失时退 CPU 逐像素底。挂载、降级、统计全仓只有这一份实现。 */
import { createLatentBackdrop } from './latent-gl.js'
import { createCpuBackdrop } from './cpu-backdrop.js'
import { BLUE_NOISE_B64, BLUE_NOISE_SIZE } from './blue-noise.js'

/* 碰过 WebGL 的画布在 loseContext 之后拿不回可用上下文，被 2D 占过的画布同样拿不到 WebGL，
   所以换页重挂必须换一张新画布。调用方的 ref 指向的元素在 replaceWith 之后已脱流，
   新画布记在它身上，下次挂载顺着找回。 */
function reusableCanvas(root) {
  const current = root.__nsFlowLive && root.__nsFlowLive.isConnected ? root.__nsFlowLive : root
  if (!current.__nsFlowUsed) return current
  const fresh = document.createElement('canvas')
  fresh.className = current.className
  fresh.__nsFlowUsed = true
  current.replaceWith(fresh)
  root.__nsFlowLive = fresh
  return fresh
}

export function mountFlowBackdrop(canvas, options = {}) {
  if (!canvas) return null
  const settings = { palette: null, reducedMotion: false, simWidth: 640, maxEdge: 1600, onFallback: null, ...options }
  let backend = null
  let palette = settings.palette || null
  let live = reusableCanvas(canvas)

  function attach(next) {
    backend = next && next.supported !== false ? next : null
    backend?.setReducedMotion?.(settings.reducedMotion)
    backend?.setPixelMix?.(0.5)
    /* 挂载时给定的色板直接落位，不要从默认色慢慢化开（换页会看到一次闪白） */
    if (palette) backend?.setPalette?.(palette, { duration: 0 })
  }

  function notify(reason) {
    try { settings.onFallback?.(reason) } catch { /* 调用方回调不该影响背板本身 */ }
  }

  function switchToCpu() {
    try { backend?.dispose?.() } catch { /* GPU 上下文已丢失，销毁失败不影响兜底 */ }
    backend = null
   /* 只要碰过 WebGL，这张画布就再也取不到 2D 上下文（"no-webgl" 时没碰过，可原地复用）：一律换新画布再兜底。 */
    live = reusableCanvas(canvas)
    attach(createCpuBackdrop(live, { simWidth: settings.simWidth }))
    live.__nsFlowUsed = true
  }

  const gpu = createLatentBackdrop(live, {
    noiseB64: BLUE_NOISE_B64,
    noiseSize: BLUE_NOISE_SIZE,
    maxEdge: settings.maxEdge,
    /* 上下文丢失交给引擎处理：先换画布接 CPU 底，再通知调用方 */
    onFallback: () => { switchToCpu(); notify('context-lost') }
  })
  if (gpu && gpu.supported) attach(gpu)
  else {
    switchToCpu()
    notify((gpu && gpu.reason) || 'gpu-unavailable')
  }
  live.__nsFlowUsed = true

  return {
    get backend() { return backend && backend.backend === 'gpu' ? 'gpu' : 'cpu' },
    setPalette(next, opts = {}) {
      palette = next || null
      backend?.setPalette?.(next, opts)
    },
    pulse(strength) { backend?.pulse?.(strength) },
    setReducedMotion(value) {
      settings.reducedMotion = Boolean(value)
      backend?.setReducedMotion?.(value)
    },
    setPixelMix(value) { backend?.setPixelMix?.(value) },
    resize() { backend?.resize?.() },
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
        shaderLog: base.shaderLog || ''
      }
    },
    dispose() {
      try { backend?.dispose?.() } catch { /* 已销毁 */ }
      backend = null
    }
  }
}
