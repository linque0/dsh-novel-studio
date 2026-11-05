/* CPU 兜底：没有 WebGL 时流动底也不能空着。域扭曲 + 三控制点权重 + Bayer 抖动，
   逐像素算在低分辨率画布上再由浏览器放大，采样损失被模糊掩盖。 */

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

export function createCpuBackdrop(canvas, options = {}) {
  const settings = { simWidth: 640, ...options }
  const ctx = canvas.getContext('2d')
  if (!ctx) return { supported: false, reason: 'no-canvas2d' }

  const simWidth = Math.max(32, Math.round(Number(settings.simWidth) || 640))
  let simHeight = Math.round(simWidth * 0.62)
  let from = { a: [0.18, 0.22, 0.5], b: [0.85, 0.4, 0.35], c: [0.06, 0.07, 0.16] }
  let to = { a: [...from.a], b: [...from.b], c: [...from.c] }
  let energy = 0
  let energyTarget = 0
  let simTime = 0
  let lastFrame = performance.now()
  let pixelMix = 0.5
  let frozen = false
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

  function resize() {
    const [width, height] = canvasSize()
    const ratio = width / Math.max(1, height)
    const nextHeight = Math.max(1, Math.round(simWidth / ratio))
    if (canvas.width !== simWidth || canvas.height !== nextHeight) {
      canvas.width = simWidth
      canvas.height = nextHeight
      simHeight = nextHeight
      frameData = ctx.createImageData(simWidth, simHeight)
    }
  }

  function draw(now) {
    if (disposed) return
    const dt = Math.min(80, now - lastFrame)
    lastFrame = now
    if (!frozen) simTime += dt / 1000
    energy += (energyTarget - energy) * Math.min(1, dt / 240)
    energyTarget *= 0.985
    for (const k of ['a', 'b', 'c']) {
      for (let i = 0; i < 3; i += 1) from[k][i] += (to[k][i] - from[k][i]) * Math.min(1, dt / 300)
    }
    resize()
    /* resize 会换一张新的 ImageData，像素数组必须每帧重取 */
    const pixels = frameData.data
    const t = simTime * (0.09 + 0.22 * energy)
    const W = canvas.width
    const H = canvas.height
    const A = from.a
    const B = from.b
    const C = from.c
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
        let r = (A[0] * w1 + B[0] * w2 + C[0] * w3) / sum
        let g = (A[1] * w1 + B[1] * w2 + C[1] * w3) / sum
        let b = (A[2] * w1 + B[2] * w2 + C[2] * w3) / sum
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = lum + (r - lum) * 1.12; g = lum + (g - lum) * 1.12; b = lum + (b - lum) * 1.12
        const dx = (u - 0.5) * 1.25
        const dy = v - 0.44
        const glow = Math.pow(Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)), 2.6) * (0.16 + 0.1 * energy)
        r += glow; g += glow; b += glow
        const dith = (BAYER[y & 3][x & 3] / 16 - 0.5) / 6
        const pr = Math.floor((r + dith) * 6 + 0.5) / 6
        const pg = Math.floor((g + dith) * 6 + 0.5) / 6
        const pb = Math.floor((b + dith) * 6 + 0.5) / 6
        r = r + (pr - r) * pixelMix; g = g + (pg - g) * pixelMix; b = b + (pb - b) * pixelMix
        const vig = 1 - Math.min(1, Math.pow(Math.sqrt((u - 0.5) * (u - 0.5) * 1.45 + (v - 0.5) * (v - 0.5)) * 1.28, 2))
        const tone = 0.42 + 0.58 * (0.5 + 0.5 * vig)
        const noise = (Math.random() - 0.5) * 0.022
        const at = (y * W + x) * 4
        pixels[at] = Math.max(0, Math.min(255, (r * tone + noise) * 255))
        pixels[at + 1] = Math.max(0, Math.min(255, (g * tone + noise) * 255))
        pixels[at + 2] = Math.max(0, Math.min(255, (b * tone + noise) * 255))
        pixels[at + 3] = 255
      }
    }
    ctx.putImageData(frameData, 0, 0)
    if (!frozen) raf = requestAnimationFrame(draw)
  }

  function start() {
    if (disposed || frozen) return
    cancelAnimationFrame(raf)
    lastFrame = performance.now()
    raf = requestAnimationFrame(draw)
  }

  /* 栏宽三档与窗口高度都在父容器上变化，只挂 window resize 会漏掉容器自身的变化 */
  const parent = canvas.parentElement
  const observer = typeof ResizeObserver === 'function' && parent ? new ResizeObserver(() => resize()) : null
  if (observer) observer.observe(parent)

  resize()
  start()

  return {
    backend: 'cpu',
    supported: true,
    setPalette(palette, opts = {}) {
      /* 从当前显示色起跳，连续换书时不会跳回上一次的目标色（与 GPU 版一致） */
      for (const k of ['a', 'b', 'c']) from[k] = [...to[k]]
      to = { a: [...palette.a], b: [...palette.b], c: [...palette.c] }
      if (frozen) draw(performance.now())
    },
    pulse(strength = 1) { energyTarget = Math.max(energyTarget, Math.min(1, strength)) },
    setPixelMix(value) { pixelMix = Math.min(1, Math.max(0, Number(value) || 0)) },
    setReducedMotion(value) {
      const next = Boolean(value)
      if (next === frozen) return
      frozen = next
      if (frozen) cancelAnimationFrame(raf)
      else start()
    },
    resize,
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
      cancelAnimationFrame(raf)
      if (observer) observer.disconnect()
    }
  }
}
