/* CPU 兜底：没有 WebGL 时流动底也不能空着。域扭曲 + 三控制点权重 + Bayer 抖动，
   逐像素算在低分辨率画布上再由浏览器放大，采样损失被模糊掩盖。 */

import { DEFAULT_FLOW_PALETTE } from './palette.js'
import { advanceFlowTime, normalizeFlowSpeed } from './flow-motion.js'
import { blendFlowStops, flowColorStops } from './flow-color-stops.js'

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

export function createCpuBackdrop(canvas, options = {}) {
  const settings = { simWidth: 640, ...options }
  const ctx = canvas.getContext('2d')
  if (!ctx) return { supported: false, reason: 'no-canvas2d' }

  const simWidth = Math.max(32, Math.round(Number(settings.simWidth) || 640))
  let simHeight = Math.round(simWidth * 0.62)
  let from = options.stops || flowColorStops(options.palette || DEFAULT_FLOW_PALETTE)
  let to = from
  let lastDrawnStops = from
  let blendStart = 0
  let blendDuration = 0
  let simTime = options.time ?? 0
  let speed = normalizeFlowSpeed(options.speed)
  let lastFrame = performance.now()
  let reducedMotion = Boolean(options.reducedMotion)
  let running = false
  let transitionHolds = 0
  let disposed = false
  let raf = 0
  let frameData = ctx.createImageData(simWidth, simHeight)

  /* 与 GPU 版同一套尺寸规则：画布自身优先，取不到才退回窗口，窄栏里 window 比例会把底拉扁。 */
  function canvasSize() {
    const width = canvas.clientWidth || 0
    const height = canvas.clientHeight || 0
    if (width > 0 && height > 0) return [width, height]
    return [window.innerWidth || 1, window.innerHeight || 1]
  }

  function resizeCanvas() {
    const [width, height] = canvasSize()
    const ratio = width / Math.max(1, height)
    const nextWidth = Math.max(1, Math.round(simWidth * Math.min(1, ratio)))
    const nextHeight = Math.max(1, Math.round(nextWidth / ratio))
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth
      canvas.height = nextHeight
      simHeight = nextHeight
      frameData = ctx.createImageData(nextWidth, simHeight)
      return true
    }
    return false
  }

  function resize() {
    if (resizeCanvas() && !running && !document.hidden) draw(performance.now())
  }

  function draw(now, schedule = true) {
    if (disposed) return
    if (running) simTime = advanceFlowTime(simTime, now - lastFrame, speed)
    lastFrame = now
    // ResizeObserver replaces the ImageData after the host changes size.
    const pixels = frameData.data
    const t = simTime * 0.15
    const W = canvas.width
    const H = canvas.height
    const colors = blendFlowStops(from, to, now - blendStart, blendDuration)
    const [main, accent, , highlight, shadow] = colors
    const aspect = W / H
    const cx1 = 0.5 * (1) + 0.34 * Math.sin(t * 0.31)
    const cy1 = 0.40 + 0.26 * Math.cos(t * 0.27)
    const cx2 = 0.5 + 0.36 * Math.sin(t * 0.23 + 2.1)
    const cy2 = 0.58 + 0.28 * Math.cos(t * 0.19 + 1.3)
    const cx3 = 0.5 + 0.32 * Math.sin(t * 0.17 + 4.2)
    const cy3 = 0.46 + 0.30 * Math.cos(t * 0.29 + 3.1)
    for (let y = 0; y < H; y += 1) {
      const v = y / H
      for (let x = 0; x < W; x += 1) {
        const u = x / W
        let qx = u * aspect
        let qy = v
        qx += 0.22 * Math.sin(qy * 3.1 + t * 0.9); qy += 0.22 * Math.cos(qx * 2.7 - t * 0.8)
        qx += 0.12 * Math.sin(qy * 6.3 - t * 1.4); qy += 0.12 * Math.cos(qx * 5.9 + t * 1.2)
        const d1 = 1 / (((qx - cx1 * aspect) * (qx - cx1 * aspect) + (qy - cy1) * (qy - cy1)) + 0.012)
        const d2 = 1 / (((qx - cx2 * aspect) * (qx - cx2 * aspect) + (qy - cy2) * (qy - cy2)) + 0.012)
        const d3 = 1 / (((qx - cx3 * aspect) * (qx - cx3 * aspect) + (qy - cy3) * (qy - cy3)) + 0.012)
        const w1 = Math.pow(d1, 1.35)
        const w2 = Math.pow(d2, 1.35)
        const w3 = Math.pow(d3, 1.35)
        const sum = w1 + w2 + w3
        const wHighlight = w2 / sum
        const ribbon = 1.5 * wHighlight * (1 - wHighlight)
        const r = (main[0] * w1 + highlight[0] * w2 + shadow[0] * w3) / sum
        const g = (main[1] * w1 + highlight[1] * w2 + shadow[1] * w3) / sum
        const b = (main[2] * w1 + highlight[2] * w2 + shadow[2] * w3) / sum
        const texture = (BAYER[y & 3][x & 3] / 16 - 0.5) * 0.018
        const at = (y * W + x) * 4
        pixels[at] = (r + (accent[0] - r) * ribbon + texture) * 255
        pixels[at + 1] = (g + (accent[1] - g) * ribbon + texture) * 255
        pixels[at + 2] = (b + (accent[2] - b) * ribbon + texture) * 255
        pixels[at + 3] = 255
      }
    }
    ctx.putImageData(frameData, 0, 0)
    lastDrawnStops = colors
    if (running && schedule) raf = requestAnimationFrame(draw)
  }

  function start() {
    if (running || disposed || transitionHolds || reducedMotion || speed === 0 || document.hidden) return
    running = true
    lastFrame = performance.now()
    raf = requestAnimationFrame(draw)
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
  }

  function onVisibility() {
    if (document.hidden) stop()
    else {
      resizeCanvas()
      draw(performance.now())
      start()
    }
  }

  /* 栏宽三档与窗口高度都在父容器上变化，只挂 window resize 会漏掉容器自身的变化 */
  const parent = canvas.parentElement
  const observer = typeof ResizeObserver === 'function' && parent ? new ResizeObserver(() => resize()) : null
  if (observer) observer.observe(parent)

  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  resizeCanvas()
  if (!document.hidden) draw(performance.now())
  start()

  return {
    backend: 'cpu',
    supported: true,
    setPalette(palette, opts = {}) {
      const now = performance.now()
      from = lastDrawnStops
      blendStart = now
      to = flowColorStops(palette || DEFAULT_FLOW_PALETTE)
      blendDuration = running ? Math.max(0, opts.duration ?? 300) : 0
      if (!running && !document.hidden) draw(blendStart)
    },
    setSpeed(value) {
      speed = normalizeFlowSpeed(value)
      if (speed === 0) {
        stop()
        blendDuration = 0
        if (!document.hidden) draw(performance.now())
      } else start()
    },
    setReducedMotion(value) {
      const next = Boolean(value)
      if (next === reducedMotion) return
      reducedMotion = next
      if (reducedMotion) {
        stop()
        blendDuration = 0
        if (!document.hidden) draw(performance.now())
      } else start()
    },
    resize,
    transitionFrame() { return { time: simTime, stops: lastDrawnStops } },
    holdTransition() {
      transitionHolds += 1
      stop()
      return () => {
        transitionHolds -= 1
        start()
      }
    },
    syncTransitionTime(next) {
      simTime = next
      lastFrame = performance.now()
      if (!document.hidden) draw(lastFrame, false)
    },
    stats() {
      return {
        backend: 'cpu',
        avgFrameMs: 0,
        scale: 1,
        pixels: [canvas.width, canvas.height],
        noise: 'bayer',
        time: Number(simTime.toFixed(3))
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }
}
