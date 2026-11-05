/* studio-gl.js — 小说工坊「正文」界面背板：静水·墨晕（ink）/ 灯下·微光（lamp）/ 远山·雾（ridge）。
   三支流体层片段着色器共用一套骨架：WebGL2/WebGL1 双通道、自适应分辨率、蓝噪声 6 级量化、
   打字涟漪、色板插值；骨架沿用 app/src/services/latent/latent-gl.js，流体层与量化层是新的。

   契约：
     window.createStudioBackdrop(canvas, opts) -> api
       opts = { mode:'ink'|'lamp'|'ridge', speed, pixel, palette:{a,b,c}, reduced, gpu }
       api  = { setMode(m), setPalette(p,{duration}), pulse(strength), stats(), destroy() }
     window.__nsStudioStats() -> 当前实例的 stats()；未建实例时给一份 backend:'css' 的空值。

   取不到 WebGL 时不抛错、不 console.error：返回 backend:'css' 的空操作 api，由 index.html 的 CSS 兜底。 */

;(function () {
  'use strict'

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 v_uv;',
    'void main(){ v_uv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n')

  /* 尘埃点精灵：位置用 CSS px，点大小 1 设备像素（真 1px）。 */
  var DUST_VERT = [
    'attribute vec2 aPos;',
    'uniform vec2 u_size;',
    'void main(){',
    '  vec2 n = aPos / max(vec2(1.0), u_size);',
    '  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '}'
  ].join('\n')

  var DUST_FRAG = [
    'precision mediump float;',
    'uniform float u_alpha;',
    'void main(){ gl_FragColor = vec4(vec3(1.0, 0.93, 0.84) * u_alpha, 1.0); }'
  ].join('\n')

  /* 骨架：三支流体层共用的 uniform、噪声、量化、涟漪与颗粒。 */
  var COMMON = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform float u_time;',       /* 已按方向 flow 缩放的流体时间 */
    'uniform float u_clock;',      /* 真实秒数：呼吸 24s 周期、山线视差 px/s 都按它算 */
    'uniform vec2  u_resolution;',
    'uniform float u_dpr;',        /* 设备像素 / CSS 像素（含自适应档位） */
    'uniform vec3  u_pal0;',
    'uniform vec3  u_pal1;',
    'uniform vec3  u_pal2;',
    'uniform float u_pixel;',
    'uniform float u_ripple;',
    'uniform float u_phase;',
    'uniform sampler2D u_noise;',
    'varying vec2 v_uv;',
    '',
    'float hash21(vec2 p){ p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1; p += dot(p, p + 19.19); return fract(p.x * p.y); }',
    'float vnoise(vec2 st){',
    '  vec2 i = floor(st); vec2 f = fract(st);',
    '  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    'float fbm4(vec2 st){',
    '  float sum = 0.0; float amp = 0.5;',
    '  for (int i = 0; i < 4; i++) { sum += amp * vnoise(st); st = st * 2.03 + vec2(11.7, 5.3); amp *= 0.5; }',
    '  return sum;',
    '}',
    /* 蓝噪声 6 级量化：把连续 alpha 压成 0/0.2/0.4/0.6/0.8/1.0 六档，阈值取自 64×64 蓝噪声 */
    'float quantize6(float a, vec2 fragPx){ return floor(clamp(a, 0.0, 1.0) * 5.0 + texture2D(u_noise, fragPx / 64.0).r) / 5.0; }',
    /* 像素格：pixel 0 → 1px，0.35 → 2px，1 → 4px（设备像素） */
    'vec2 pixelCell(vec2 fragPx){ float s = max(1.0, floor(1.0 + u_pixel * 3.0)); return floor(fragPx / s) * s + s * 0.5; }',
    /* 打字涟漪：以画布中心为圆心、半径 220 CSS px 的墨晕光斑 */
    'float rippleSpot(vec2 fragPx){ float d = length(fragPx - u_resolution * 0.5) / max(1.0, 220.0 * u_dpr); return exp(-d * d * 2.2); }',
    'float grainAt(vec2 fragPx){ return hash21(floor(fragPx) + u_phase * 37.0) - 0.5; }',
    'float vignetteAt(vec2 uv, float amount){ return 1.0 - amount * smoothstep(0.30, 0.92, length(uv - vec2(0.5)) * 1.30); }',
    ''
  ].join('\n')

  /* ink 静水·墨晕：4 octave fbm 极慢对流 + 三层 1/d^2.2 墨团，色板压到 12–18% alpha。 */
  var INK_FRAG = COMMON + [
    'void main(){',
    '  vec2 cell = pixelCell(gl_FragCoord.xy);',
    '  vec2 uv = cell / u_resolution;',
    '  float aspect = u_resolution.x / max(1.0, u_resolution.y);',
    '  vec2 p = vec2(uv.x * aspect, uv.y);',
    /* 呼吸：域扭曲振幅 0.006、周期 24s（2π/24 = 0.2618）、相位随机 */
    '  float breathe = 0.006 * sin(u_clock * 0.26179939 + u_phase);',
    '  vec2 flow = vec2(',
    '    fbm4(p * 1.7 + vec2(u_time, -u_time * 0.7)),',
    '    fbm4(p * 1.7 + vec2(5.2 - u_time * 0.8, 3.1 + u_time))',
    '  ) - 0.5;',
    '  vec2 q = p + flow * 0.055 + breathe;',
    '  vec3 ink = vec3(0.0);',
    '  float weight = 0.0;',
    '  for (int i = 0; i < 3; i++) {',
    '    float fi = float(i);',
    '    vec2 center = vec2(0.5 * aspect + 0.26 * sin(u_time * 0.9 + fi * 2.1),',
    '                       0.5 + 0.24 * cos(u_time * 0.7 + fi * 1.7));',
    '    float d = length(q - center) + 0.001;',
    '    float w = 1.0 / pow(d, 2.2);',
    '    vec3 tint = u_pal1;',
    '    if (i == 0) { tint = u_pal0; }',
    '    if (i == 2) { tint = u_pal2; }',
    '    ink += tint * w;',
    '    weight += w;',
    '  }',
    '  ink /= max(0.0001, weight);',
    '  float alpha = mix(0.12, 0.18, fbm4(q * 2.4));',
    '  alpha += u_ripple * rippleSpot(cell) * 3.0;',
    '  float cover = quantize6(alpha, cell);',
    '  vec3 col = mix(u_pal1 * 0.30, ink, cover);',
    '  col *= vignetteAt(uv, 0.34);',
    '  col += vec3(grainAt(cell) * 0.03);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n')

  /* lamp 灯下·微光：单光源椭圆光池 + 边缘低频微颤（尘埃由 JS 逐帧算、用 GL_POINTS 画）。 */
  var LAMP_FRAG = COMMON + [
    'void main(){',
    '  vec2 cell = pixelCell(gl_FragCoord.xy);',
    '  vec2 uv = cell / u_resolution;',
    '  vec2 t = vec2(uv.x, 1.0 - uv.y);',
    /* 光池中心 uv y = 0.18（自上而下计），椭圆半径 0.62 / 0.42 */
    '  float wob = 1.0 + 0.004 * (vnoise(vec2(u_clock * 0.13, 1.7)) - 0.5) * 2.0;',
    '  float d = length((t - vec2(0.5, 0.18)) / vec2(0.62, 0.42)) * wob;',
    '  float pool = clamp(exp(-d * d * 1.45) * 1.06, 0.0, 1.0);',
    '  float cover = quantize6(pool + u_ripple * rippleSpot(cell) * 2.0, cell);',
    '  vec3 col = mix(u_pal1, u_pal0, cover);',
    '  col += u_pal0 * pool * 0.22;',
    '  col *= vignetteAt(uv, 0.30);',
    '  col += vec3(grainAt(cell) * 0.02);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n')

  /* ridge 远山·雾：上方近乎纯平 + 月晕，底部三分之一四层 1D 噪声山线（视差 0.3–1.2 px/s）。 */
  var RIDGE_FRAG = COMMON + [
    'void main(){',
    '  vec2 cell = pixelCell(gl_FragCoord.xy);',
    '  vec2 uv = cell / u_resolution;',
    '  vec2 t = vec2(uv.x, 1.0 - uv.y);',
    '  vec3 col = u_pal0;',
    '  vec2 mt = (t - vec2(0.74, 0.20)) / vec2(0.30, 0.24);',
    '  col += u_pal2 * exp(-dot(mt, mt) * 1.6) * 0.10;',
    '  vec3 ink = u_pal0;',
    '  float cover = 0.0;',
    '  for (int i = 0; i < 4; i++) {',
    '    float fi = float(i);',
    '    float speed = 0.3 + fi * 0.3;',
    '    float x = (cell.x + u_clock * speed) / u_resolution.x;',
    '    float line = 0.64 + fi * 0.070',
    '      + 0.070 * vnoise(vec2(x * (3.5 + fi * 2.0), 9.1 + fi * 5.7))',
    '      + 0.028 * vnoise(vec2(x * (11.0 + fi * 4.0), 2.3 + fi * 3.1));',
    '    float inside = smoothstep(line - 0.004, line + 0.004, t.y);',
    '    float a = (0.52 + fi * 0.13) * inside;',
    '    if (a > cover) {',
    '      cover = a;',
    '      ink = mix(u_pal0, u_pal1, 0.28 + fi * 0.16) * (1.0 - fi * 0.08);',
    '    }',
    '  }',
    '  cover += 0.14 * fbm4(vec2(t.x * 2.6, t.y * 7.0 - u_time * 1.2)) * smoothstep(0.52, 0.95, t.y);',
    '  cover += u_ripple * rippleSpot(cell) * 1.6;',
    '  col = mix(col, ink, quantize6(cover, cell));',
    '  col *= vignetteAt(uv, 0.22);',
    '  col += vec3(grainAt(cell) * 0.02);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n')

  var SCALES = [1.5, 1.25, 1, 0.75]
  var MAX_EDGE = 1600
  var DPR_CAP = 2
  var RIPPLE_MAX = 0.12
  var RIPPLE_LIFE = 1400
  var DUST_COUNT = 200

  function toRgb(value, fallback) {
    if (Array.isArray(value) && value.length >= 3) {
      const list = value.slice(0, 3).map(Number)
      const scale = list.some(v => v > 1.0001) ? 255 : 1
      return list.map(v => Math.min(1, Math.max(0, (Number(v) || 0) / scale)))
    }
    if (typeof value === 'string') {
      const text = value.trim()
      const hex = /^#?([0-9a-f]{6})$/i.exec(text)
      if (hex) {
        const n = parseInt(hex[1], 16)
        return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
      }
      const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
      if (rgb) {
        const parts = rgb[1].split(',').map(x => parseFloat(x))
        if (parts.length >= 3) return parts.slice(0, 3).map(v => Math.min(1, Math.max(0, (Number(v) || 0) / 255)))
      }
    }
    return fallback
  }

  function normalizePalette(input, fallback) {
    const src = input && typeof input === 'object' ? input : {}
    return {
      a: toRgb(src.a, fallback.a),
      b: toRgb(src.b, fallback.b),
      c: toRgb(src.c, fallback.c)
    }
  }

  const FALLBACK_RGB = { a: [0.105, 0.14, 0.188], b: [0.133, 0.149, 0.169], c: [0.29, 0.165, 0.141] }

  /* 三个方向：同骨架，只换流体层片元着色器与默认色板。flow 是各自的流体时间流速。 */
  const MODES = {
    ink: {
      flow: 0.015,
      frag: INK_FRAG,
      palette: normalizePalette({ a: '#1b2430', b: '#22262b', c: '#4a2a24' }, FALLBACK_RGB)
    },
    lamp: {
      flow: 0.02,
      frag: LAMP_FRAG,
      palette: normalizePalette({ a: '#2a1f18', b: '#08090c', c: '#1a1512' }, FALLBACK_RGB)
    },
    ridge: {
      flow: 0.02,
      frag: RIDGE_FRAG,
      palette: normalizePalette({ a: '#07090d', b: '#101820', c: '#8fa6bd' }, FALLBACK_RGB)
    }
  }

  const UNIFORM_NAMES = ['u_time', 'u_clock', 'u_resolution', 'u_dpr', 'u_pal0', 'u_pal1', 'u_pal2', 'u_pixel', 'u_ripple', 'u_phase', 'u_noise']

  /* 64×64 蓝噪声：优先用同页 blue-noise.js 的全局常量（内联脚本里是 const，经典脚本共享全局词法环境），
     独立引入时退回同尺寸确定性哈希噪声，保证纹理始终是 64×64、逐字节上传。 */
  function noiseSource() {
    const size = (typeof BLUE_NOISE_SIZE === 'number' && BLUE_NOISE_SIZE > 0) ? (BLUE_NOISE_SIZE | 0) : 64
    const b64 = (typeof BLUE_NOISE_B64 === 'string') ? BLUE_NOISE_B64 : ''
    const total = size * size
    const bytes = new Uint8Array(total)
    if (b64) {
      try {
        const bin = window.atob(b64)
        if (bin.length >= total) {
          for (let i = 0; i < total; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff
          return { size, bytes }
        }
      } catch (_error) { /* 解码失败就走下面的哈希兜底 */ }
    }
    for (let i = 0; i < total; i += 1) {
      const h = Math.sin((i % size) * 12.9898 + Math.floor(i / size) * 78.233) * 43758.5453
      bytes[i] = Math.round((h - Math.floor(h)) * 255)
    }
    return { size, bytes }
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(shader) || 'compile'))
    return shader
  }

  function link(gl, fragment) {
    const program = gl.createProgram()
    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program) || 'link'))
    return program
  }

  function emptyStats(mode) {
    return {
      backend: 'css',
      renderer: '',
      avgFrameMs: 0,
      scale: 0,
      pixels: [0, 0],
      noise: 'blue+dither',
      mode: mode || 'ink',
      time: 0,
      ripple: { amp: 0 },
      shaderLog: ''
    }
  }

  /* 取不到 WebGL：不抛错、不 console.error，回调全部空操作，交给页面 CSS 兜底。 */
  function cssFallback(reason, mode) {
    let current = MODES[mode] ? mode : 'ink'
    return {
      backend: 'css',
      setMode(next) { if (MODES[next]) current = next },
      setPalette() {},
      pulse() {},
      stats() {
        const base = emptyStats(current)
        base.renderer = 'css-fallback:' + reason
        return base
      },
      destroy() {}
    }
  }

  let activeApi = null

  function createStudioBackdrop(canvas, options) {
    const opts = options && typeof options === 'object' ? options : {}
    const wanted = MODES[opts.mode] ? opts.mode : 'ink'
    if (!canvas || typeof canvas.getContext !== 'function') return cssFallback('no-canvas', wanted)
    if (opts.gpu === false) return cssFallback('gpu-off', wanted)

    let gl = null
    try {
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' })
        || canvas.getContext('webgl', { antialias: false, alpha: false, depth: false })
        || canvas.getContext('experimental-webgl', { antialias: false, alpha: false, depth: false })
    } catch (_error) {
      gl = null
    }
    if (!gl) return cssFallback('no-webgl', wanted)

    /* 三支着色器各自编译，日志按方向拼起来；全通过时 shaderLog 是空串。 */
    const programs = {}
    const logs = []
    for (const name of Object.keys(MODES)) {
      try {
        programs[name] = link(gl, MODES[name].frag)
      } catch (error) {
        programs[name] = null
        logs.push(name + ': ' + error.message)
      }
    }
    let dustProgram = null
    try {
      dustProgram = link(gl, DUST_FRAG)
    } catch (error) {
      dustProgram = null
      logs.push('dust: ' + error.message)
    }
    let shaderLog = logs.join(' | ')

    let current = programs[wanted] ? wanted : (programs.ink ? 'ink' : (programs.lamp ? 'lamp' : (programs.ridge ? 'ridge' : null)))
    if (!current) {
      try { gl.getExtension('WEBGL_lose_context')?.loseContext() } catch (_error) { /* 老浏览器没有该扩展 */ }
      return cssFallback('shader-error', wanted)
    }

    const uniforms = {}
    const attribs = {}
    for (const name of Object.keys(programs)) {
      if (!programs[name]) continue
      uniforms[name] = {}
      for (const key of UNIFORM_NAMES) uniforms[name][key] = gl.getUniformLocation(programs[name], key)
      attribs[name] = gl.getAttribLocation(programs[name], 'aPos')
    }

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const noise = noiseSource()
    const noiseTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, noiseTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, noise.size, noise.size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noise.bytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)

    let dustLoc = -1
    let dustSizeLoc = null
    let dustAlphaLoc = null
    let dustBuffer = null
    let dustData = null
    const dustBase = new Float32Array(DUST_COUNT * 2)
    const dustPhase = new Float32Array(DUST_COUNT)
    if (dustProgram) {
      dustLoc = gl.getAttribLocation(dustProgram, 'aPos')
      dustSizeLoc = gl.getUniformLocation(dustProgram, 'u_size')
      dustAlphaLoc = gl.getUniformLocation(dustProgram, 'u_alpha')
      dustBuffer = gl.createBuffer()
      dustData = new Float32Array(DUST_COUNT * 2)
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, dustData.byteLength, gl.DYNAMIC_DRAW)
    }

    /* 固定种子的 LCG：同一次截图里的尘埃每次运行都落同一处，取证可复现。 */
    let seed = 20261103
    function rand() {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    const palettePinned = Boolean(opts.palette)
    let from = normalizePalette(opts.palette, MODES[current].palette)
    let to = { a: from.a.slice(), b: from.b.slice(), c: from.c.slice() }
    let blendStart = 0
    let blendDuration = 0

    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    const frozen = Boolean(opts.reduced) || Boolean(media && media.matches)
    const flowScale = Number(opts.speed) > 0 ? Number(opts.speed) : 1
    let pixel = Number.isFinite(Number(opts.pixel)) ? Math.min(1, Math.max(0, Number(opts.pixel))) : 0.35

    let clock = 0
    let rippleAmp = 0
    let rippleAge = 0
    let rippleMark = 0
    let lastFrame = 0
    let running = false
    let raf = 0
    let disposed = false
    let contextLost = false
    let scaleIndex = 0
    let frameTimes = []
    let avgFrameMs = 0
    let cssW = 1
    let cssH = 1
    let effDpr = 1
    const phase = Math.random() * Math.PI * 2

    let rendererName = 'webgl'
    try {
      rendererName = String(gl.getParameter(gl.VERSION) || 'webgl')
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info) {
        const unmasked = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '')
        if (unmasked) rendererName += ' · ' + unmasked
      }
    } catch (_error) { /* 取不到就用兜底名字 */ }

    function measure() {
      const parent = canvas.parentElement
      if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) return [parent.clientWidth, parent.clientHeight]
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) return [canvas.clientWidth, canvas.clientHeight]
      return [window.innerWidth || 1, window.innerHeight || 1]
    }

    function seedDust() {
      for (let i = 0; i < DUST_COUNT; i += 1) {
        dustBase[i * 2] = rand() * Math.max(1, cssW)
        dustBase[i * 2 + 1] = rand() * Math.max(1, cssH)
        dustPhase[i] = rand() * Math.PI * 2
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      const scale = SCALES[scaleIndex]
      const size = measure()
      cssW = Math.max(1, size[0])
      cssH = Math.max(1, size[1])
      let width = Math.max(1, Math.round(cssW * dpr * scale))
      let height = Math.max(1, Math.round(cssH * dpr * scale))
      const edge = Math.max(width, height)
      if (edge > MAX_EDGE) {
        const k = MAX_EDGE / edge
        width = Math.max(1, Math.round(width * k))
        height = Math.max(1, Math.round(height * k))
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      effDpr = width / cssW
      gl.viewport(0, 0, width, height)
      seedDust()
      /* 冻结态没有 rAF：尺寸一变压根不会重画，这里补一帧。 */
      if (!running && !disposed && !contextLost) render(performance.now())
    }

    function currentPalette(now) {
      const t = blendDuration > 0 ? Math.min(1, Math.max(0, (now - blendStart) / blendDuration)) : 1
      const e = t * t * (3 - 2 * t)
      return {
        a: [from.a[0] + (to.a[0] - from.a[0]) * e, from.a[1] + (to.a[1] - from.a[1]) * e, from.a[2] + (to.a[2] - from.a[2]) * e],
        b: [from.b[0] + (to.b[0] - from.b[0]) * e, from.b[1] + (to.b[1] - from.b[1]) * e, from.b[2] + (to.b[2] - from.b[2]) * e],
        c: [from.c[0] + (to.c[0] - from.c[0]) * e, from.c[1] + (to.c[1] - from.c[1]) * e, from.c[2] + (to.c[2] - from.c[2]) * e]
      }
    }

    function drawDust() {
      if (!dustProgram || !dustBuffer) return
      const height = Math.max(1, cssH)
      for (let i = 0; i < DUST_COUNT; i += 1) {
        /* 向上 0.4 px/s + sin 微抖，越界绕回底部 */
        let y = dustBase[i * 2 + 1] - clock * 0.4
        y = y - Math.floor(y / height) * height
        dustData[i * 2] = dustBase[i * 2] + Math.sin(clock * 0.9 + dustPhase[i]) * 1.2
        dustData[i * 2 + 1] = y
      }
      gl.useProgram(dustProgram)
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dustData)
      gl.enableVertexAttribArray(dustLoc)
      gl.vertexAttribPointer(dustLoc, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(dustSizeLoc, cssW, cssH)
      gl.uniform1f(dustAlphaLoc, 0.10)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.drawArrays(gl.POINTS, 0, DUST_COUNT)
      gl.disable(gl.BLEND)
    }

    function render(now) {
      const program = programs[current]
      if (!program) return
      const uni = uniforms[current]
      const pal = currentPalette(now)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(attribs[current])
      gl.vertexAttribPointer(attribs[current], 2, gl.FLOAT, false, 0, 0)
      gl.uniform1f(uni.u_time, clock * MODES[current].flow * flowScale)
      gl.uniform1f(uni.u_clock, clock)
      gl.uniform2f(uni.u_resolution, canvas.width, canvas.height)
      gl.uniform1f(uni.u_dpr, effDpr)
      gl.uniform3fv(uni.u_pal0, new Float32Array(pal.a))
      gl.uniform3fv(uni.u_pal1, new Float32Array(pal.b))
      gl.uniform3fv(uni.u_pal2, new Float32Array(pal.c))
      gl.uniform1f(uni.u_pixel, pixel)
      gl.uniform1f(uni.u_ripple, rippleAmp)
      gl.uniform1f(uni.u_phase, phase)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, noiseTex)
      gl.uniform1i(uni.u_noise, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (current === 'lamp') drawDust()
    }

    function draw(now) {
      if (disposed || contextLost) return
      const delta = Math.max(0, Math.min(64, now - lastFrame))
      lastFrame = now

      frameTimes.push(delta)
      if (frameTimes.length > 60) frameTimes.shift()
      if (frameTimes.length === 60) {
        /* 自适应分辨率：60 帧均值 >22ms 降档、<12ms 升档 */
        const average = frameTimes.reduce((sum, value) => sum + value, 0) / 60
        avgFrameMs = Number(average.toFixed(2))
        if (average > 22 && scaleIndex < SCALES.length - 1) {
          scaleIndex += 1
          frameTimes = []
          resize()
        } else if (average < 12 && scaleIndex > 0) {
          scaleIndex -= 1
          frameTimes = []
          resize()
        }
      }

      /* reduced：时钟不推进，u_time 恒定 */
      if (!frozen) clock += delta / 1000

      /* 涟漪按墙钟衰减：τ≈0.35s、1.4s 内归零。不用被夹住的 delta——软件渲染掉到 5fps 时
         delta 每帧最多 64ms，衰减会比真实时间拖长两三倍，1.4s 到不了零。 */
      if (rippleAmp > 0) {
        const rippleDelta = Math.max(0, now - rippleMark)
        rippleAmp *= Math.exp(-rippleDelta / 350)
        rippleAge += rippleDelta
        rippleMark = now
        if (rippleAge >= RIPPLE_LIFE || rippleAmp < 0.0002) rippleAmp = 0
      }

      render(now)
      raf = requestAnimationFrame(draw)
    }

    function start() {
      if (running || disposed || contextLost || frozen) return
      running = true
      lastFrame = performance.now()
      raf = requestAnimationFrame(draw)
    }

    function stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const onResize = () => resize()
    const parent = canvas.parentElement
    const observer = (typeof ResizeObserver === 'function' && parent) ? new ResizeObserver(onResize) : null
    /* 父容器量不到时（比如被 display:none 过一下）只剩 window，这条兜底必须留着 */
    if (observer) observer.observe(parent)
    const onVisibility = () => { if (document.hidden) stop(); else start() }
    const onContextLost = (event) => {
      event.preventDefault()
      contextLost = true
      stop()
    }

    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onContextLost, false)

    resize()
    if (frozen) render(performance.now())
    else start()

    const api = {
      backend: 'gpu',
      setMode(next) {
        if (!MODES[next] || !programs[next] || next === current) return
        current = next
        /* 调用方没指定过色板时，换方向就跟着换该方向的默认色板 */
        if (!palettePinned) {
          const now = performance.now()
          from = currentPalette(now)
          to = normalizePalette(null, MODES[next].palette)
          blendDuration = frozen ? 0 : 300
          blendStart = now
        }
        if (!running) render(performance.now())
      },
      setPalette(palette, options2) {
        const now = performance.now()
        from = currentPalette(now)
        to = normalizePalette(palette, MODES[current].palette)
        blendDuration = frozen ? 0 : Math.max(0, Number(options2 && options2.duration) || 300)
        blendStart = now
        if (!running) render(performance.now())
      },
      pulse(strength) {
        const add = Number(strength)
        if (!Number.isFinite(add) || add <= 0) return
        rippleAmp = Math.min(RIPPLE_MAX, rippleAmp + add)
        rippleAge = 0
        rippleMark = performance.now()
      },
      stats() {
        return {
          backend: 'gpu',
          renderer: rendererName,
          avgFrameMs,
          scale: SCALES[scaleIndex],
          pixels: [canvas.width, canvas.height],
          noise: 'blue+dither',
          mode: current,
          time: Number(clock.toFixed(3)),
          ripple: { amp: Number(rippleAmp.toFixed(4)) },
          shaderLog
        }
      },
      destroy() {
        if (disposed) return
        disposed = true
        stop()
        if (observer) observer.disconnect()
        window.removeEventListener('resize', onResize)
        document.removeEventListener('visibilitychange', onVisibility)
        canvas.removeEventListener('webglcontextlost', onContextLost)
        gl.deleteBuffer(quad)
        gl.deleteTexture(noiseTex)
        for (const name of Object.keys(programs)) if (programs[name]) gl.deleteProgram(programs[name])
        if (dustProgram) gl.deleteProgram(dustProgram)
        if (dustBuffer) gl.deleteBuffer(dustBuffer)
        /* 反复进出正文页会不断建上下文，浏览器上限约 16 个：不主动放弃，下一次切换就拿不到上下文 */
        try { gl.getExtension('WEBGL_lose_context')?.loseContext() } catch (_error) { /* 老浏览器没有该扩展 */ }
        if (activeApi === api) activeApi = null
      }
    }

    activeApi = api
    return api
  }

  function __nsStudioStats() {
    if (activeApi) return activeApi.stats()
    return emptyStats('ink')
  }

  window.createStudioBackdrop = createStudioBackdrop
  window.__nsStudioStats = __nsStudioStats
})()
