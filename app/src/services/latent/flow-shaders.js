/* MeshGradient and Warp adapted from Paper Shaders 0.0.80.
   https://github.com/paper-design/shaders/tree/60467401863c1917dd02016d0c1ff2f791d0b3c8
   Apache-2.0. See paper-shaders-LICENSE.txt.
   Adapted to GLSL ES 1.00, full-canvas sizing, and single-canvas soft-light composition. */
export const FLOW_MESH_FRAGMENT = `
precision highp float;

uniform float u_time;

uniform vec4 u_colors[6];
uniform float u_colorsCount;

uniform float u_distortion;
uniform float u_swirl;
uniform float u_grainMixer;
uniform float u_grainOverlay;
uniform vec2 u_resolution;

varying vec2 v_uv;


vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}
float hash21(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

float valueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x1 = mix(a, b, u.x);
  float x2 = mix(c, d, u.x);
  return mix(x1, x2, u.y);
}

float noise(vec2 n, vec2 seedOffset) {
  return valueNoise(n + seedOffset);
}

vec2 getPosition(int i, float t) {
  float a = float(i) * .37;
  float b = .6 + fract(float(i) / 3.) * .9;
  float c = .8 + fract(float(i + 1) / 4.);

  float x = sin(t * b + a);
  float y = cos(t * c + a * 1.5);

  return .5 + .5 * vec2(x, y);
}

void main() {
  vec2 objectScale = u_resolution / min(u_resolution.x, u_resolution.y);
  vec2 uv = (v_uv - .5) * objectScale / 1.025 + .5;
  vec2 grainUV = uv * 1000.;

  float grain = noise(grainUV, vec2(0.));
  float mixerGrain = .4 * u_grainMixer * (grain - .5);

  const float firstFrameOffset = 41.5;
  float t = .5 * (u_time + firstFrameOffset);

  float radius = smoothstep(0., 1., length(uv - .5));
  float center = 1. - radius;
  for (float i = 1.; i <= 2.; i++) {
    uv.x += u_distortion * center / i * sin(t + i * .4 * smoothstep(.0, 1., uv.y)) * cos(.2 * t + i * 2.4 * smoothstep(.0, 1., uv.y));
    uv.y += u_distortion * center / i * cos(t + i * 2. * smoothstep(.0, 1., uv.x));
  }

  vec2 uvRotated = uv;
  uvRotated -= vec2(.5);
  float angle = 3. * u_swirl * radius;
  uvRotated = rotate(uvRotated, -angle);
  uvRotated += vec2(.5);

  vec3 color = vec3(0.);
  float opacity = 0.;
  float totalWeight = 0.;

  for (int i = 0; i < 6; i++) {
    if (i >= int(u_colorsCount)) break;

    vec2 pos = getPosition(i, t) + mixerGrain;
    vec3 colorFraction = u_colors[i].rgb * u_colors[i].a;
    float opacityFraction = u_colors[i].a;

    float dist = length(uvRotated - pos);

    dist = pow(dist, 3.5);
    float weight = 1. / (dist + 1e-3);
    color += colorFraction * weight;
    opacity += opacityFraction * weight;
    totalWeight += weight;
  }

  color /= max(1e-4, totalWeight);
  opacity /= max(1e-4, totalWeight);

  float grainOverlay = valueNoise(rotate(grainUV, 1.) + vec2(3.));
  grainOverlay = mix(grainOverlay, valueNoise(rotate(grainUV, 2.) + vec2(-1.)), .5);
  grainOverlay = pow(grainOverlay, 1.3);

  float grainOverlayV = grainOverlay * 2. - 1.;
  vec3 grainOverlayColor = vec3(step(0., grainOverlayV));
  float grainOverlayStrength = u_grainOverlay * abs(grainOverlayV);
  grainOverlayStrength = pow(grainOverlayStrength, .8);
  color = mix(color, grainOverlayColor, .35 * grainOverlayStrength);

  opacity += .5 * grainOverlayStrength;
  opacity = clamp(opacity, 0., 1.);

  gl_FragColor = vec4(color, opacity);
}
`

export const FLOW_DITHER_FRAGMENT = `
precision highp float;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec3 u_colorBack;
uniform vec3 u_colorFront;
uniform vec3 u_colorRibbon;
varying vec2 v_uv;

// Evaluate Paper's ordered 4×4 Bayer matrix without array indexing (GLSL ES 1.00).
float bayer2(vec2 cell) {
  cell = mod(floor(cell), 2.0);
  return fract(cell.x * 0.5 + cell.y * 0.75);
}

vec3 softLight(vec3 base, vec3 blend) {
  vec3 curve = mix(((16.0 * base - 12.0) * base + 4.0) * base, sqrt(base), step(0.25, base));
  vec3 dark = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  vec3 light = base + (2.0 * blend - 1.0) * (curve - base);
  return mix(dark, light, step(0.5, blend));
}

void main() {
  float t = 0.5 * u_time;
  float cellSize = max(1.0, 2.5 * u_pixelRatio);
  vec2 centered = (gl_FragCoord.xy - 0.5 * u_resolution) / 1.015;
  vec2 cell = floor(centered / cellSize);
  vec2 shapeUV = centered / (u_pixelRatio * 0.6) + 0.5;
  float shape;
  shapeUV *= .003;

  for (float i = 1.0; i < 6.0; i++) {
    shapeUV.x += 0.6 / i * cos(i * 2.5 * shapeUV.y + t);
    shapeUV.y += 0.6 / i * cos(i * 1.5 * shapeUV.x + t);
  }

  shape = .15 / max(0.001, abs(sin(t - shapeUV.y - shapeUV.x)));
  shape = smoothstep(0.02, 1., shape);

  float threshold = bayer2(cell) + bayer2(cell * 0.5) * 0.25;
  vec3 textureColor = mix(u_colorBack, u_colorFront, step(1.0, shape + threshold));
  vec3 meshColor = texture2D(u_scene, v_uv).rgb;
  // The sides of each crest carry color. Bayer only affects the texture on top.
  float ribbon = smoothstep(0.16, 0.36, shape) * (1.0 - smoothstep(0.52, 0.83, shape));
  vec3 waveColor = mix(meshColor, u_colorRibbon, ribbon * 0.46);
  vec3 blended = mix(waveColor, softLight(waveColor, textureColor), 0.55);
  gl_FragColor = vec4(blended, 1.0);
}
`
