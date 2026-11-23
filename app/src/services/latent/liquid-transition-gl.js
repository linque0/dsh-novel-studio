/**
 * 幻流液态转场 WebGL2 渲染管线（两遍绘制：半分辨率网格流体底色 → 全分辨率波动平流与画面融墨合成）。
 * 离场与进场页面分别作为 u_oldInk / u_newInk 纹理传入，沿对角线流场产生墨水融散与聚拢效果。
 */
import { FLOW_DITHER_FRAGMENT, FLOW_MESH_FRAGMENT } from './flow-shaders.js'

export const LIQUID_DURATION = 1000

/** 计算转场期间流场相位的积分增量，使结束接管时实景背景能无缝续接动画进度。 */
export function liquidPhase(elapsed, speed, hold = 0) {
  // Integrate the speed pulse so the live backdrop can resume at the last rendered phase.
  const bell = elapsed / 2 - Math.sin(2 * Math.PI * elapsed) / (4 * Math.PI)
  const pulse = 4.8
  const coverSpeed = speed + pulse
  return speed * elapsed + pulse * bell + coverSpeed * hold
}

const FLOW_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = .5 * (a_position + 1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

function glsl3(source) {
  return '#version 300 es\n' + source
    .replace('precision highp float;', 'precision highp float;\nout vec4 outColor;')
    .replace('varying vec2 v_uv;', 'in vec2 v_uv;')
    .replaceAll('texture2D(', 'texture(')
    .replaceAll('gl_FragColor', 'outColor')
}

const FLOW_SHARED = `
uniform float u_progress;
uniform float u_aspect;
uniform vec3 u_primary;
uniform vec3 u_accent;
uniform sampler2D u_oldInk;
uniform sampler2D u_newInk;
uniform bool u_outgoingReady;
uniform bool u_incomingReady;

const float PI = 3.141592653589793;
const vec2 DIAGONAL = vec2(-.8660254, .5);
const vec2 ACROSS = vec2(.5, .8660254);

vec2 flow(vec2 uv) {
  vec2 pos = vec2((uv.x - .5) * u_aspect, .5 - uv.y);
  float t = u_progress;
  float bend = .185 * sin(4.4 * pos.y + 2.1 * pos.x - 3.7 * t)
    + .075 * sin(11.1 * pos.y - 1.6 * pos.x + 3.2 * t);
  vec2 physical = DIAGONAL + ACROSS * bend;
  return vec2(physical.x / u_aspect, -physical.y);
}

vec2 traceFlow(vec2 origin, float length) {
  // Midpoint sampling bends the advection and the individual blur taps along the same field.
  return origin + length * flow(origin + .5 * length * flow(origin));
}

float localProgress(vec2 uv) {
  float horizontal = .8660254 * u_aspect;
  float s = (horizontal * (1.0 - uv.x) + .5 * (1.0 - uv.y)) / (horizontal + .5);
  s += .37 * s * (1.0 - s) * sin(6.1 * uv.y + 1.7 * s);
  return clamp((u_progress - .46 * s) / .43, 0.0, 1.0);
}

vec4 sampleInk(sampler2D image, vec2 uv, float lod) {
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return vec4(0.0);
  return textureLod(image, uv, lod);
}

vec4 inkAlongFlow(sampler2D image, vec2 uv, float shift, float span, float haze) {
  vec2 source = traceFlow(uv, shift);
  if (span < .0002) return sampleInk(image, source, 0.0);
  vec2 stepAlong = flow(source) * span;
  vec2 spread = vec2(stepAlong.y / u_aspect, -stepAlong.x * u_aspect) * haze;
  // The mip footprint bridges adjacent taps so stretched strokes form a smear, not copies of glyphs.
  float lod = log2(max(1.0, length(stepAlong * vec2(textureSize(image, 0))) * .48));
  vec4 value = sampleInk(image, source, lod) * .26;
  value += sampleInk(image, source - .41 * stepAlong - spread, lod) * .19;
  value += sampleInk(image, source + .41 * stepAlong + spread, lod) * .19;
  value += sampleInk(image, source - .83 * stepAlong + .73 * spread, lod) * .13;
  value += sampleInk(image, source + .83 * stepAlong - .73 * spread, lod) * .13;
  value += sampleInk(image, source - 1.34 * stepAlong, lod) * .05;
  value += sampleInk(image, source + 1.34 * stepAlong, lod) * .05;
  return value;
}

// Simulates frosted glass (backdrop-filter blur) over the fluid canvas for translucent UI panels
// so bright crests don't pierce unblurred through panels during the capture crossfade.
vec3 frostedBackdrop(vec2 uv, vec3 sharpMaterial) {
  vec2 stepUv = 22.0 * u_pixelRatio / max(u_resolution, vec2(1.0));
  vec3 acc = texture2D(u_scene, clamp(uv, 0.0, 1.0)).rgb * 0.28;
  acc += texture2D(u_scene, clamp(uv + vec2(stepUv.x, stepUv.y * 0.5), 0.0, 1.0)).rgb * 0.18;
  acc += texture2D(u_scene, clamp(uv + vec2(-stepUv.x, stepUv.y * 0.5), 0.0, 1.0)).rgb * 0.18;
  acc += texture2D(u_scene, clamp(uv + vec2(stepUv.x * 0.5, -stepUv.y), 0.0, 1.0)).rgb * 0.18;
  acc += texture2D(u_scene, clamp(uv + vec2(-stepUv.x * 0.5, -stepUv.y), 0.0, 1.0)).rgb * 0.18;
  float luma = dot(acc, vec3(.299, .587, .114));
  vec3 saturated = clamp(vec3(luma) + (acc - vec3(luma)) * 1.18, 0.0, 1.0);
  return mix(saturated, sharpMaterial, 0.12);
}

vec3 placeInk(vec3 color, vec3 frosted, vec3 material, vec4 ink, float visibility, float dilution, float frostWeight) {
  float glass = smoothstep(.05, .24, ink.a) * (1.0 - smoothstep(.92, .99, ink.a)) * frostWeight;
  vec3 base = mix(color, frosted, glass);
  vec3 tint = mix(ink.rgb, material * ink.a, dilution);
  return base * (1.0 - visibility * ink.a) + tint * visibility;
}

// Diluted source color becomes an optical density in the same crests as the background.
vec3 pigment(vec3 material, vec4 ink, float crest, float strength) {
  float luminance = dot(ink.rgb, vec3(.299, .587, .114));
  float lightInk = max(0.0, luminance - .32 * ink.a);
  float darkInk = max(0.0, .62 * ink.a - luminance);
  vec3 dyed = mix(material, u_colorBack, darkInk * strength * (.16 + .48 * crest));
  return mix(dyed, u_colorFront, lightInk * strength * (.15 + .61 * crest));
}

vec3 compositeScene(vec3 material, vec3 frosted, float p, vec2 refraction, float crest, float filament) {
  if (u_outgoingReady && p < .44) {
    float melt = smoothstep(.008, .36, p);
    float erosion = smoothstep(.10, .44, p);
    float shift = -melt * (.17 + .085 * crest);
    vec2 wet = v_uv + refraction * melt;
    vec4 ink = inkAlongFlow(u_oldInk, wet, shift, .085 * melt, .13);
    float drift = smoothstep(.045, .275, p) * (1.0 - smoothstep(.292, .44, p));
    vec3 tint = pigment(material, ink, crest, drift * (.60 + .38 * filament));
    return placeInk(tint, frosted, tint, ink, 1.0 - erosion, .94 * melt, 1.0 - melt);
  }
  if (u_incomingReady && p > .56) {
    float structure = smoothstep(.56, .80, p);
    float gather = 1.0 - structure;
    float clarity = smoothstep(.66, .90, p);
    vec2 wet = v_uv + refraction * gather;
    vec4 form = inkAlongFlow(u_newInk, wet, (.126 + .086 * crest) * gather, .085 * gather, .13);
    vec4 detail = sampleInk(u_newInk, wet, 2.35 * (1.0 - clarity));
    vec4 ink = mix(form, detail, structure);
    float deposition = smoothstep(.56, .664, p) * (1.0 - smoothstep(.75, .91, p));
    vec3 tint = pigment(material, ink, crest, deposition * (.58 + .42 * filament));
    return placeInk(tint, frosted, tint, ink, structure, .88 * gather, structure);
  }
  return material;
}
`

const FLOW_COMPOSITE = glsl3(FLOW_DITHER_FRAGMENT
  .replace('void main() {', FLOW_SHARED + `
void main() {
  float baseProgress = localProgress(v_uv);
  float bell = sin(PI * u_progress);
  bell *= bell;
  float local = sin(PI * baseProgress);
  float transport = -.228 * bell * (.62 + .38 * local);
  vec2 advected = traceFlow(v_uv, transport);
  vec2 advectedUV = 1.0 - abs(mod(advected, 2.0) - 1.0);`)
  .replace('  vec2 shapeUV = centered /', '  vec2 shapeUV = (centered + (advected - v_uv) * u_resolution / 1.015) /')
  .replace('  shape = .15 / max(0.001, abs(sin(t - shapeUV.y - shapeUV.x)));', `
  float wavePhase = t - shapeUV.y - shapeUV.x;
  shape = .15 / max(.001, abs(sin(wavePhase)));`)
  .replace('texture2D(u_scene, v_uv)', 'texture2D(u_scene, advectedUV)')
  .replace('ribbon * 0.46', 'ribbon * (.46 - .04 * bell)')
  .replace('textureColor), 0.55', 'textureColor), .55 - .17 * bell')
  .replace('  gl_FragColor = vec4(blended, 1.0);', `
  // The moving crests color the current, refract the UI, and determine where it melts or gathers first.
  vec2 physical = vec2((advected.x - .5) * u_aspect, .5 - advected.y);
  float along = dot(physical, DIAGONAL);
  float across = dot(physical, ACROSS);
  float streamPhase = wavePhase * 1.72 + along * 4.5 + .61 * sin(across * 10.8 + t * 1.28);
  float crest = smoothstep(-.39, .86, sin(streamPhase));
  float fiber = .5 + .5 * sin(2.66 * streamPhase + .64 * sin(along * 10.0 + across * 9.4));
  float spread = bell * baseProgress * (1.0 - baseProgress);
  float p = clamp(baseProgress + spread * (.43 * (crest - .5) + .22 * (fiber - .5)), 0.0, 1.0);
  vec2 crossUV = vec2(ACROSS.x / u_aspect, -ACROSS.y);
  float ripple = .031 * sin(streamPhase) + .012 * cos(2.66 * streamPhase + across * 7.7);
  vec2 refraction = crossUV * ripple + (advected - v_uv) * .40;
  float current = bell * (.34 + .66 * local);
  vec3 undertow = mix(blended, u_primary, .11 * current * (1.0 - crest));
  vec3 material = mix(undertow, u_accent, current * crest * (.09 + .18 * fiber));
  vec3 frosted = frostedBackdrop(advectedUV, material);
  float opacity = 1.0;
  if (!u_outgoingReady && p < .44) {
    opacity = smoothstep(0.0, .44, p);
  } else if (!u_incomingReady && p > .56) {
    opacity = 1.0 - smoothstep(.56, 1.0, p);
  } else if (u_incomingReady) {
    opacity = 1.0 - smoothstep(.88, 1.0, u_progress);
  }
  vec3 color = compositeScene(material, frosted, p, refraction, crest, fiber);
  gl_FragColor = vec4(color * opacity, opacity);`))

/** 初始化 WebGL2 渲染器、离屏网格 FBO 与双场景 Mipmap 纹理，返回 resize / setScene / draw / clear / dispose。 */
export function createLiquidRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) throw new Error('WebGL2 is unavailable.')
  function shader(type, source) {
    const id = gl.createShader(type)
    gl.shaderSource(id, source)
    gl.compileShader(id)
    if (!gl.getShaderParameter(id, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(id))
    return id
  }
  const vertex = shader(gl.VERTEX_SHADER, FLOW_VERTEX)
  function program(source) {
    const fragment = shader(gl.FRAGMENT_SHADER, source)
    const id = gl.createProgram()
    gl.attachShader(id, vertex)
    gl.attachShader(id, fragment)
    gl.bindAttribLocation(id, 0, 'a_position')
    gl.linkProgram(id)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(id))
    const uniform = {}
    for (let i = 0; i < gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS); i += 1) {
      const { name } = gl.getActiveUniform(id, i)
      uniform[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(id, name)
    }
    return { id, uniform }
  }

  const mesh = program(glsl3(FLOW_MESH_FRAGMENT))
  const composite = program(FLOW_COMPOSITE)
  gl.deleteShader(vertex)
  const shape = gl.createVertexArray()
  gl.bindVertexArray(shape)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  function allocateTexture() {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }
  function allocateInkTexture() {
    const tex = allocateTexture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    return tex
  }
  const meshTexture = allocateTexture()
  const oldInk = allocateInkTexture()
  const newInk = allocateInkTexture()
  const inkSize = { outgoing: { w: 1, h: 1 }, incoming: { w: 1, h: 1 } }
  const framebuffer = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, meshTexture, 0)
  const maxEdge = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 3200)
  const channels = new Float32Array(24)
  let pixelRatio = 1
  let allocated = false
  let meshWidth = 0
  let meshHeight = 0
  let outgoingReady = false
  let incomingReady = false

  function bindTexture(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  return {
    resize(cssWidth, cssHeight) {
      const density = Math.min(window.devicePixelRatio || 1, 1.5,
        maxEdge / Math.max(cssWidth, cssHeight), Math.sqrt(3600000 / (cssWidth * cssHeight)))
      const width = Math.max(1, Math.round(cssWidth * density))
      const height = Math.max(1, Math.round(cssHeight * density))
      pixelRatio = Math.min(width / cssWidth, height / cssHeight)
      if (canvas.width !== width || canvas.height !== height || !allocated) {
        canvas.width = width
        canvas.height = height
        // The mesh supplies smooth colors. Keep the ripple, ink and composition at full buffer size.
        meshWidth = Math.ceil(width / 2)
        meshHeight = Math.ceil(height / 2)
        bindTexture(0, meshTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, meshWidth, meshHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('The transition framebuffer is incomplete.')
        }
        allocated = true
      }
    },
    setScene(image, kind) {
      if (gl.isContextLost()) throw new Error('Transition context lost.')
      const tex = kind === 'outgoing' ? oldInk : newInk
      const size = inkSize[kind]
      bindTexture(0, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      try {
        if (size.w === image.width && size.h === image.height) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image)
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
          size.w = image.width
          size.h = image.height
        }
        gl.generateMipmap(gl.TEXTURE_2D)
        if (kind === 'outgoing') outgoingReady = true
        else incomingReady = true
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      }
    },
    draw(time, phase, palette) {
      if (gl.isContextLost()) throw new Error('Transition context lost.')
      if (time === 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clear(gl.COLOR_BUFFER_BIT)
        return
      }
      gl.bindVertexArray(shape)
      palette.forEach((rgb, index) => {
        channels.set(rgb, index * 4)
        channels[index * 4 + 3] = 1
      })
      const { width, height } = canvas
      const m = mesh.uniform
      bindTexture(0, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.viewport(0, 0, meshWidth, meshHeight)
      gl.useProgram(mesh.id)
      gl.uniform2f(m.u_resolution, width, height)
      gl.uniform1f(m.u_time, phase * .3)
      gl.uniform1f(m.u_colorsCount, palette.length)
      gl.uniform4fv(m.u_colors, channels)
      gl.uniform1f(m.u_distortion, .8)
      gl.uniform1f(m.u_swirl, .1)
      gl.uniform1f(m.u_grainMixer, 0)
      gl.uniform1f(m.u_grainOverlay, .01)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      const [primary, accent, , , shadow, mist] = palette
      const s = composite.uniform
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      gl.useProgram(composite.id)
      gl.uniform2f(s.u_resolution, width, height)
      gl.uniform1f(s.u_pixelRatio, pixelRatio)
      gl.uniform1f(s.u_time, phase * .1)
      gl.uniform1f(s.u_aspect, width / height)
      gl.uniform1f(s.u_progress, time)
      gl.uniform1i(s.u_outgoingReady, outgoingReady ? 1 : 0)
      gl.uniform1i(s.u_incomingReady, incomingReady ? 1 : 0)
      gl.uniform3fv(s.u_primary, primary)
      gl.uniform3fv(s.u_accent, accent)
      gl.uniform3fv(s.u_colorBack, shadow)
      gl.uniform3fv(s.u_colorFront, mist)
      gl.uniform3fv(s.u_colorRibbon, accent)
      bindTexture(0, meshTexture)
      gl.uniform1i(s.u_scene, 0)
      bindTexture(1, oldInk)
      gl.uniform1i(s.u_oldInk, 1)
      bindTexture(2, newInk)
      gl.uniform1i(s.u_newInk, 2)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    clear() {
      // Keep texture storage for the next capture, but never sample an image from a previous route.
      outgoingReady = false
      incomingReady = false
    },
    dispose() {
      gl.deleteTexture(meshTexture)
      gl.deleteTexture(oldInk)
      gl.deleteTexture(newInk)
      gl.deleteFramebuffer(framebuffer)
      gl.deleteVertexArray(shape)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(mesh.id)
      gl.deleteProgram(composite.id)
    }
  }
}
