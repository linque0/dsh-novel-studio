<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { flowTransition } from '../services/latent/flow-transition.js'

const state = ref(flowTransition.state)
const curtain = ref(null)
const echoWave = ref(null)
let unsubscribe = null
let activeAnim = null
let echoAnim = null

const colors = computed(() => state.value.colors || {
  main: 'rgb(59 88 138)',
  accent: 'rgb(118 174 215)',
  accentGlow: 'rgb(118 174 215 / 0.56)',
  accentSoft: 'rgb(118 174 215 / 0.24)',
  deep: 'rgb(45 70 112)',
  highlight: 'rgb(220 230 240)',
  highlightSoft: 'rgb(220 230 240 / 0.34)',
  shadow: 'rgb(26 36 58)',
  mist: 'rgb(160 185 215)',
  mistSoft: 'rgb(160 185 215 / 0.42)'
})

function stopAnimations() {
  try { activeAnim?.cancel() } catch { /* ignore */ }
  try { echoAnim?.cancel() } catch { /* ignore */ }
  activeAnim = null
  echoAnim = null
}

watch(
  () => [state.value.active, state.value.runId, state.value.phase],
  async ([active, , phase]) => {
    if (!active || phase === 'idle') {
      stopAnimations()
      return
    }
    await nextTick()
    const el = curtain.value
    if (!el || typeof el.animate !== 'function') return

    if (phase === 'covering') {
      stopAnimations()
      activeAnim = el.animate(
        [
          { transform: 'translate3d(100vw, 0, 0)' },
          { transform: 'translate3d(-28vw, 0, 0)' }
        ],
        {
          duration: state.value.coverMs,
          easing: 'cubic-bezier(0.36, 0.04, 0.28, 1)',
          fill: 'forwards'
        }
      )
      if (echoWave.value && typeof echoWave.value.animate === 'function') {
        echoAnim = echoWave.value.animate(
          [
            { transform: 'translate3d(0, 2.5%, 0)' },
            { transform: 'translate3d(0, -2.5%, 0)' }
          ],
          {
            duration: state.value.coverMs + state.value.revealMs,
            easing: 'ease-in-out',
            fill: 'forwards'
          }
        )
      }
    } else if (phase === 'revealing') {
      try { activeAnim?.cancel() } catch { /* ignore */ }
      activeAnim = el.animate(
        [
          { transform: 'translate3d(-28vw, 0, 0)' },
          { transform: 'translate3d(-164vw, 0, 0)' }
        ],
        {
          duration: state.value.revealMs,
          easing: 'cubic-bezier(0.22, 0.08, 0.16, 1)',
          fill: 'forwards'
        }
      )
    }
  }
)

onMounted(() => {
  unsubscribe = flowTransition.subscribe(next => {
    state.value = { ...next }
  })
})

onBeforeUnmount(() => {
  stopAnimations()
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div v-if="state.active" class="flow-wave-overlay" :data-phase="state.phase" aria-hidden="true">
    <div ref="curtain" class="flow-wave-curtain">
      <svg class="flow-wave-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none">
        <defs>
          <linearGradient id="flow-wave-body" x1="0%" y1="12%" x2="100%" y2="88%">
            <stop offset="0%" :stop-color="colors.deep" />
            <stop offset="28%" :stop-color="colors.main" />
            <stop offset="56%" :stop-color="colors.shadow" />
            <stop offset="82%" :stop-color="colors.deep" />
            <stop offset="100%" :stop-color="colors.main" />
          </linearGradient>

          <radialGradient id="flow-wave-glow-a" cx="24%" cy="32%" r="48%">
            <stop offset="0%" :stop-color="colors.accent" stop-opacity="0.52" />
            <stop offset="55%" :stop-color="colors.mist" stop-opacity="0.22" />
            <stop offset="100%" :stop-color="colors.shadow" stop-opacity="0" />
          </radialGradient>

          <radialGradient id="flow-wave-glow-b" cx="72%" cy="68%" r="52%">
            <stop offset="0%" :stop-color="colors.highlight" stop-opacity="0.28" />
            <stop offset="48%" :stop-color="colors.accent" stop-opacity="0.24" />
            <stop offset="100%" :stop-color="colors.shadow" stop-opacity="0" />
          </radialGradient>

          <linearGradient id="flow-wave-ribbon-lead" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" :stop-color="colors.mist" stop-opacity="0.45" />
            <stop offset="32%" :stop-color="colors.accent" stop-opacity="0.92" />
            <stop offset="68%" :stop-color="colors.highlight" stop-opacity="0.85" />
            <stop offset="100%" :stop-color="colors.accent" stop-opacity="0.45" />
          </linearGradient>

          <linearGradient id="flow-wave-echo-fill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" :stop-color="colors.accent" stop-opacity="0.06" />
            <stop offset="38%" :stop-color="colors.accent" stop-opacity="0.42" />
            <stop offset="75%" :stop-color="colors.main" stop-opacity="0.65" />
            <stop offset="100%" :stop-color="colors.shadow" stop-opacity="0.2" />
          </linearGradient>

          <pattern id="flow-wave-bayer" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="2" height="2" :fill="colors.highlight" fill-opacity="0.16" />
            <rect x="4" y="0" width="2" height="2" :fill="colors.highlight" fill-opacity="0.08" />
            <rect x="2" y="2" width="2" height="2" :fill="colors.shadow" fill-opacity="0.22" />
            <rect x="6" y="2" width="2" height="2" :fill="colors.highlight" fill-opacity="0.12" />
            <rect x="0" y="4" width="2" height="2" :fill="colors.shadow" fill-opacity="0.14" />
            <rect x="4" y="4" width="2" height="2" :fill="colors.highlight" fill-opacity="0.18" />
            <rect x="2" y="6" width="2" height="2" :fill="colors.highlight" fill-opacity="0.1" />
            <rect x="6" y="6" width="2" height="2" :fill="colors.shadow" fill-opacity="0.2" />
          </pattern>

          <filter id="flow-wave-blur" x="-10%" y="-5%" width="120%" height="110%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
        </defs>

        <g ref="echoWave" class="flow-wave-echo">
          <path
            d="M 135 0 C 35 170, 215 350, 110 520 C 18 690, 195 855, 98 1000 L 1495 1000 C 1585 840, 1410 665, 1508 490 C 1592 315, 1418 148, 1515 0 Z"
            fill="url(#flow-wave-echo-fill)"
            filter="url(#flow-wave-blur)"
          />
        </g>

        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000 L 1396 1000 C 1480 845, 1326 675, 1412 495 C 1492 325, 1336 155, 1422 0 Z"
          fill="url(#flow-wave-body)"
        />
        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000 L 1396 1000 C 1480 845, 1326 675, 1412 495 C 1492 325, 1336 155, 1422 0 Z"
          fill="url(#flow-wave-glow-a)"
        />
        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000 L 1396 1000 C 1480 845, 1326 675, 1412 495 C 1492 325, 1336 155, 1422 0 Z"
          fill="url(#flow-wave-glow-b)"
        />

        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000 L 1396 1000 C 1480 845, 1326 675, 1412 495 C 1492 325, 1336 155, 1422 0 Z"
          fill="url(#flow-wave-bayer)"
        />

        <path
          d="M 540 0 C 445 190, 625 385, 515 565 C 420 725, 585 875, 498 1000"
          fill="none"
          :stroke="colors.accentSoft"
          stroke-width="76"
          filter="url(#flow-wave-blur)"
        />
        <path
          d="M 990 0 C 1085 180, 915 360, 1020 545 C 1110 705, 945 860, 1030 1000"
          fill="none"
          :stroke="colors.highlightSoft"
          stroke-width="64"
          filter="url(#flow-wave-blur)"
        />

        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000"
          fill="none"
          stroke="url(#flow-wave-ribbon-lead)"
          stroke-width="26"
          opacity="0.44"
          filter="url(#flow-wave-blur)"
        />
        <path
          d="M 210 0 C 118 175, 274 352, 184 525 C 102 695, 258 855, 172 1000"
          fill="none"
          stroke="url(#flow-wave-ribbon-lead)"
          stroke-width="4"
          opacity="0.72"
        />
        <path
          d="M 1422 0 C 1336 155, 1492 325, 1412 495 C 1326 675, 1480 845, 1396 1000"
          fill="none"
          stroke="url(#flow-wave-ribbon-lead)"
          stroke-width="28"
          opacity="0.46"
          filter="url(#flow-wave-blur)"
        />
        <path
          d="M 1422 0 C 1336 155, 1492 325, 1412 495 C 1326 675, 1480 845, 1396 1000"
          fill="none"
          stroke="url(#flow-wave-ribbon-lead)"
          stroke-width="4"
          opacity="0.68"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.flow-wave-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  overflow: hidden;
  contain: layout style paint;
}
.flow-wave-curtain {
  position: absolute;
  top: -4vh;
  bottom: -4vh;
  left: 0;
  width: 162vw;
  transform: translate3d(100vw, 0, 0);
  will-change: transform;
}
.flow-wave-svg {
  display: block;
  width: 100%;
  height: 100%;
}
.flow-wave-echo {
  transform-box: fill-box;
  transform-origin: center;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .flow-wave-overlay {
    display: none;
  }
}
</style>
