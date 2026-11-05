// latent-gl.js — 直接移植 Folia 用到的 Paper Design 着色器（MeshGradient + Dithering）。
// 来源：https://github.com/paper-design/shaders（MIT，见 THIRD-PARTY-NOTICES.md）
// 端口说明：Paper 用 #version 300 es，这里改写成 GLSL 100 以兼容 WebGL1/2；
// 其余算法（控制点轨迹、distortion、swirl、1/d^3.5 权重、Bayer 表、像素化）保持一致。

const VERT = [
  'attribute vec2 aPos;',
  'varying vec2 v_uv;',
  'void main(){ v_uv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
].join('\n');

/* ---------------- Paper Design: MeshGradient ---------------- */

const MESH_FRAG = [
  'precision highp float;',
  'uniform float u_time;',
  'uniform vec4 u_colors[5];',
  'uniform float u_colorsCount;',
  'uniform float u_distortion;',
  'uniform float u_swirl;',
  'uniform float u_grainMixer;',
  'uniform float u_grainOverlay;',
  'uniform vec2 u_resolution;',
  'uniform float u_seed;',
  'varying vec2 v_uv;',
  '#define PI 3.141592653589793',
  'vec2 rotate(vec2 uv, float th){ return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }',
  'float hash21(vec2 p){ p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1; p += dot(p, p + 19.19); return fract(p.x * p.y); }',
  'float valueNoise(vec2 st){',
  '  vec2 i = floor(st); vec2 f = fract(st);',
  '  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));',
  '  float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
  '}',
  'float noise(vec2 n, vec2 seedOffset){ return valueNoise(n + seedOffset); }',
  'vec2 getPosition(int i, float t){',
  '  float a = float(i) * 0.37 + u_seed;',
  '  float b = 0.6 + fract(float(i) / 3.0) * 0.9;',
  '  float c = 0.8 + fract(float(i + 1) / 4.0);',
  '  float x = sin(t * b + a);',
  '  float y = cos(t * c + a * 1.5);',
  '  return 0.5 + 0.5 * vec2(x, y);',
  '}',
  'void main(){',
  '  vec2 uv = v_uv;',
  '  vec2 grainUV = uv * 1000.0;',
  '  float mixerGrain = 0.0;',
  '  if (u_grainMixer > 0.0) mixerGrain = 0.4 * u_grainMixer * (noise(grainUV, vec2(0.0)) - 0.5);',
  '  float firstFrameOffset = 41.5;',
  '  float t = 0.5 * (u_time + firstFrameOffset);',
  '  float radius = smoothstep(0.0, 1.0, length(uv - 0.5));',
  '  float center = 1.0 - radius;',
  '  for (float i = 1.0; i <= 2.0; i += 1.0) {',
  '    uv.x += u_distortion * center / i * sin(t + i * 0.4 * smoothstep(0.0, 1.0, uv.y)) * cos(0.2 * t + i * 2.4 * smoothstep(0.0, 1.0, uv.y));',
  '    uv.y += u_distortion * center / i * cos(t + i * 2.0 * smoothstep(0.0, 1.0, uv.x));',
  '  }',
  '  vec2 uvRotated = uv - vec2(0.5);',
  '  uvRotated = rotate(uvRotated, -(3.0 * u_swirl * radius));',
  '  uvRotated += vec2(0.5);',
  '  vec3 color = vec3(0.0);',
  '  float opacity = 0.0;',
  '  float totalWeight = 0.0;',
  '  for (int i = 0; i < 5; i++) {',
  '    if (i >= int(u_colorsCount)) break;',
  '    vec2 pos = getPosition(i, t) + mixerGrain;',
  '    vec3 colorFraction = u_colors[i].rgb * u_colors[i].a;',
  '    float opacityFraction = u_colors[i].a;',
  '    float dist = length(uvRotated - pos);',
  '    dist = pow(dist, 3.5);',
  '    float weight = 1.0 / (dist + 1e-3);',
  '    color += colorFraction * weight;',
  '    opacity += opacityFraction * weight;',
  '    totalWeight += weight;',
  '  }',
  '  color /= max(1e-4, totalWeight);',
  '  opacity /= max(1e-4, totalWeight);',
  '  if (u_grainOverlay > 0.0) {',
  '    float g = valueNoise(rotate(grainUV, 1.0) + vec2(3.0));',
  '    g = mix(g, valueNoise(rotate(grainUV, 2.0) + vec2(-1.0)), 0.5);',
  '    g = pow(g, 1.3);',
  '    float gv = g * 2.0 - 1.0;',
  '    float strength = pow(u_grainOverlay * abs(gv), 0.8);',
  '    color = mix(color, vec3(step(0.0, gv)), 0.35 * strength);',
  '  }',
  '  gl_FragColor = vec4(color, clamp(opacity, 0.0, 1.0));',
  '}'
].join('\n');

/* ---------------- Paper Design: Dithering（2 色 · Bayer · 像素化） ---------------- */

const DITHER_FRAG = [
  'precision highp float;',
  'uniform sampler2D u_scene;',
  'uniform vec2 u_resolution;',
  'uniform float u_time;',
  'uniform float u_pxSize;',
  'uniform float u_pixelRatio;',
  'uniform vec4 u_colorBack;',
  'uniform vec4 u_colorFront;',
  'uniform float u_mix;',
  'uniform float u_seed;',
  'varying vec2 v_uv;',
  'float hash21(vec2 p){ p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1; p += dot(p, p + 19.19); return fract(p.x * p.y); }',
  'float valueNoise(vec2 st){',
  '  vec2 i = floor(st); vec2 f = fract(st);',
  '  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));',
  '  float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
  '}',
  'float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }',
  'float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }',
  'float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }',
  'void main(){',
  '  float t = 0.5 * u_time;',
  '  float pxSize = max(1.0, u_pxSize * u_pixelRatio);',
  '  vec2 grid = floor(gl_FragCoord.xy / pxSize);',
  '  vec2 pxUV = grid * pxSize / u_resolution;',
  '  float bayer = bayer8(grid);',
  /* 形状：warp（Paper 的 warp/dots 一路），带缓慢流动 */
  '  float n = valueNoise(grid * 0.012 + vec2(t * 0.06 + u_seed, -t * 0.05));',
  '  float shape = 0.5 + 0.5 * sin((grid.x + grid.y) * 0.035 + n * 6.0 + t * 0.5);',
  '  float ink = step(shape, bayer);',
  '  vec3 ditherColor = mix(u_colorBack.rgb, u_colorFront.rgb, ink);',
  '  vec3 scene = texture2D(u_scene, pxUV).rgb;',
  '  gl_FragColor = vec4(mix(scene, ditherColor, clamp(u_mix, 0.0, 1.0)), 1.0);',
  '}'
].join('\n');

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(shader) || 'compile'));
  return shader;
}

function link(gl, fragment) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program) || 'link'));
  return program;
}

let coverRenderer = null;

function renderer(gl) {
  const mesh = link(gl, MESH_FRAG);
  const dither = link(gl, DITHER_FRAG);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(mesh, 'aPos');
  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  return { mesh, dither, buffer, position, target, framebuffer };
}

function bindQuad(gl, state) {
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  const loc = gl.getAttribLocation(state.mesh, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const loc2 = gl.getAttribLocation(state.dither, 'aPos');
  if (loc2 >= 0) {
    gl.enableVertexAttribArray(loc2);
    gl.vertexAttribPointer(loc2, 2, gl.FLOAT, false, 0, 0);
  }
}

function ensureTarget(gl, state, width, height) {
  gl.bindTexture(gl.TEXTURE_2D, state.target);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.target, 0);
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
}

/** 用 MeshGradient 离屏画一张封面小样（readPixels），失败返回 null。 */
export function paintCoverArt(palette, seed, width, height) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true })
    || canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  try {
    const state = renderer(gl);
    bindQuad(gl, state);
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(state.mesh);
    const colors = paletteColors(palette);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_time'), seed * 37.0);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_seed'), seed);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_colorsCount'), colors.count);
    gl.uniform4fv(gl.getUniformLocation(state.mesh, 'u_colors'), colors.data);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_distortion'), 0.65);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_swirl'), 0.55);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_grainMixer'), 0.35);
    gl.uniform1f(gl.getUniformLocation(state.mesh, 'u_grainOverlay'), 0.0);
    gl.uniform2f(gl.getUniformLocation(state.mesh, 'u_resolution'), width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width, height, pixels };
  } catch {
    return null;
  }
}

function paletteColors(palette) {
  const data = new Float32Array(20);
  const list = [palette.a, palette.b, palette.c,
    [palette.b[0] * 0.6 + 0.4, palette.b[1] * 0.6 + 0.36, palette.b[2] * 0.6 + 0.38],
    [palette.c[0] * 0.8, palette.c[1] * 0.8, palette.c[2] * 0.85]];
  list.forEach((rgb, i) => {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 1;
  });
  return { data, count: 5 };
}

export function createLatentBackdrop(canvas, options = {}) {
  const settings = { maxEdge: 1600, dprCap: 1.6, scales: [1.5, 1.25, 1, 0.75], ...options };
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' })
    || canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
  if (!gl) return { supported: false, reason: 'no-webgl' };

  let state;
  let shaderLog = '';
  try {
    state = renderer(gl);
    bindQuad(gl, state);
  } catch (error) {
    shaderLog = error.message;
    return { supported: false, reason: 'shader-error', shaderLog };
  }

  const DEFAULT_PALETTE = { a: [0.18, 0.22, 0.5], b: [0.85, 0.4, 0.35], c: [0.06, 0.07, 0.16] };
  let from = { ...DEFAULT_PALETTE };
  let to = { ...DEFAULT_PALETTE };
  let blendStart = 0;
  let blendDuration = 0;
  let seedFrom = 0;
  let seedTo = 0;
  let energy = 0;
  let energyTarget = 0;
  let pixelMix = 0.5;
  let reducedMotion = false;
  let time = 0;
  let lastFrame = performance.now();
  let running = false;
  let scaleIndex = 0;
  let frameTimes = [];
  let avgFrameMs = 0;
  let raf = 0;
  let disposed = false;
  let contextLost = false;

  const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, settings.dprCap);
    const scale = settings.scales[scaleIndex];
    let width = Math.round(window.innerWidth * dpr * scale);
    let height = Math.round(window.innerHeight * dpr * scale);
    const edge = Math.max(width, height);
    if (edge > settings.maxEdge) {
      const k = settings.maxEdge / edge;
      width = Math.round(width * k);
      height = Math.round(height * k);
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      ensureTarget(gl, state, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  function draw(now) {
    if (disposed || contextLost) return;
    const dt = Math.min(64, now - lastFrame);
    lastFrame = now;

    frameTimes.push(dt);
    if (frameTimes.length > 60) frameTimes.shift();
    if (frameTimes.length === 60) {
      const average = frameTimes.reduce((sum, value) => sum + value, 0) / 60;
      avgFrameMs = Number(average.toFixed(2));
      if (average > 22 && scaleIndex < settings.scales.length - 1) { scaleIndex += 1; frameTimes = []; resize(); }
      else if (average < 12 && scaleIndex > 0) { scaleIndex -= 1; frameTimes = []; resize(); }
    }

    if (!reducedMotion) time += dt / 1000;
    energy += (energyTarget - energy) * Math.min(1, dt / 240);
    energyTarget *= 0.985;

    const linear = blendDuration > 0 ? Math.min(1, Math.max(0, (now - blendStart) / blendDuration)) : 1;
    const progress = linear * linear * (3 - 2 * linear);
    const pal = {
      a: mix3(from.a, to.a, progress),
      b: mix3(from.b, to.b, progress),
      c: mix3(from.c, to.c, progress)
    };
    const seed = 0.618;
    const colors = paletteColors(pal);

    /* 1) MeshGradient -> 纹理 */
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(state.mesh);
    bindQuad(gl, state);
    const mu = name => gl.getUniformLocation(state.mesh, name);
    gl.uniform1f(mu('u_time'), time * (1.0 + 0.6 * energy));
    gl.uniform1f(mu('u_seed'), seed);
    gl.uniform1f(mu('u_colorsCount'), colors.count);
    gl.uniform4fv(mu('u_colors'), colors.data);
    gl.uniform1f(mu('u_distortion'), 0.6);
    gl.uniform1f(mu('u_swirl'), 0.5);
    gl.uniform1f(mu('u_grainMixer'), 0.3);
    gl.uniform1f(mu('u_grainOverlay'), 0.06);
    gl.uniform2f(mu('u_resolution'), canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* 2) Dithering 叠在上面（像素/流体混合） */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(state.dither);
    bindQuad(gl, state);
    const du = name => gl.getUniformLocation(state.dither, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.target);
    gl.uniform1i(du('u_scene'), 0);
    gl.uniform2f(du('u_resolution'), canvas.width, canvas.height);
    gl.uniform1f(du('u_time'), time);
    gl.uniform1f(du('u_seed'), 0.618);
    gl.uniform1f(du('u_pxSize'), 2.0);
    gl.uniform1f(du('u_pixelRatio'), Math.min(window.devicePixelRatio || 1, settings.dprCap));
    gl.uniform4fv(du('u_colorBack'), new Float32Array([pal.c[0], pal.c[1], pal.c[2], 1]));
    gl.uniform4fv(du('u_colorFront'), new Float32Array([pal.b[0], pal.b[1], pal.b[2], 1]));
    gl.uniform1f(du('u_mix'), pixelMix * 0.62);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(draw);
  }

  function start() { if (running || disposed || contextLost) return; running = true; lastFrame = performance.now(); raf = requestAnimationFrame(draw); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  const onResize = () => resize();
  const onVisibility = () => (document.hidden ? stop() : start());
  const onContextLost = event => {
    event.preventDefault();
    contextLost = true;
    stop();
    if (typeof settings.onFallback === 'function') settings.onFallback('context-lost');
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost, false);

  resize();
  if (!reducedMotion) start(); else draw(performance.now());

  return {
    supported: true,
    backend: 'gpu',
    setPalette(palette, opts = {}) {
      /* 从当前正在显示的颜色起跳：连续换书时不会跳回上一次的目标色 */
      const now = performance.now();
      const prevProgress = blendDuration > 0 ? Math.min(1, (now - blendStart) / blendDuration) : 1;
      const eased = prevProgress * prevProgress * (3 - 2 * prevProgress);
      from = {
        a: mix3(from.a, to.a, eased),
        b: mix3(from.b, to.b, eased),
        c: mix3(from.c, to.c, eased)
      };
      to = { a: [...palette.a], b: [...palette.b], c: [...palette.c] };
      /* 相位保持不变：跳相位会让整屏图案"闪"一下 */
      blendDuration = Math.max(0, opts.duration ?? 750);
      blendStart = now;
      if (!running) draw(blendStart);
    },
    pulse(strength = 1) { energyTarget = Math.max(energyTarget, Math.min(1, strength)); },
    setPixelMix(value) { pixelMix = Math.min(1, Math.max(0, Number(value) || 0)); },
    setReducedMotion(value) { reducedMotion = Boolean(value); if (reducedMotion) stop(); else start(); },
    resize,
    stats() {
      return {
        backend: 'gpu',
        renderer: String(gl.getParameter(gl.VERSION) || ''),
        avgFrameMs,
        scale: settings.scales[scaleIndex],
        pixels: [canvas.width, canvas.height],
        shaderLog,
        noise: 'paper-mesh+dither',
        time: Number(time.toFixed(3))
      };
    },
    dispose() {
      disposed = true;
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteTexture(state.target);
      gl.deleteFramebuffer(state.framebuffer);
      gl.deleteBuffer(state.buffer);
      gl.deleteProgram(state.mesh);
      gl.deleteProgram(state.dither);
    }
  };
}
