import { DEFAULT_FLOW_PALETTE, paletteOf } from './palette.js'
import { flowColorStops } from './flow-color-stops.js'

const DEFAULT_COVER_MS = 230
const DEFAULT_REVEAL_MS = 310

function defaultReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function rgbCss(rgb, alpha = 1) {
  const channels = (rgb || [0.2, 0.24, 0.36]).map(value => Math.round(Math.max(0, Math.min(1, value)) * 255))
  return alpha >= 1
    ? `rgb(${channels[0]} ${channels[1]} ${channels[2]})`
    : `rgb(${channels[0]} ${channels[1]} ${channels[2]} / ${alpha})`
}

function buildColors(stops) {
  const [main, accent, deep, highlight, shadow, mist] = stops
  return {
    main: rgbCss(main),
    accent: rgbCss(accent),
    accentGlow: rgbCss(accent, 0.56),
    accentSoft: rgbCss(accent, 0.24),
    deep: rgbCss(deep),
    highlight: rgbCss(highlight),
    highlightSoft: rgbCss(highlight, 0.34),
    shadow: rgbCss(shadow),
    mist: rgbCss(mist),
    mistSoft: rgbCss(mist, 0.42)
  }
}

export function createFlowTransitionController({
  setTimeoutFn = (...args) => setTimeout(...args),
  clearTimeoutFn = id => clearTimeout(id),
  isReducedMotion = defaultReducedMotion,
  hasDocument = () => typeof document !== 'undefined'
} = {}) {
  let state = {
    active: false,
    runId: 0,
    phase: 'idle',
    palette: null,
    stops: null,
    colors: null,
    coverMs: DEFAULT_COVER_MS,
    revealMs: DEFAULT_REVEAL_MS
  }
  let activeToken = 0
  let timer = null
  let settleWait = null
  const listeners = new Set()

  function emit(next) {
    state = { ...state, ...next }
    for (const listener of listeners) listener(state)
  }

  function clearTimer() {
    if (timer != null) {
      clearTimeoutFn(timer)
      timer = null
    }
    if (settleWait) {
      const done = settleWait
      settleWait = null
      done(false)
    }
  }

  function wait(ms, token) {
    clearTimer()
    return new Promise(resolve => {
      settleWait = resolve
      timer = setTimeoutFn(() => {
        timer = null
        settleWait = null
        resolve(token === activeToken)
      }, Math.max(0, ms))
    })
  }

  function reset() {
    activeToken += 1
    clearTimer()
    emit({
      active: false,
      phase: 'idle',
      palette: null,
      stops: null,
      colors: null
    })
  }

  async function run(commit, options = {}) {
    const reduced = typeof options.reducedMotion === 'boolean' ? options.reducedMotion : isReducedMotion()
    const isDsh = !options.skin || options.skin === 'dsh'
    if (!isDsh || reduced || !hasDocument()) {
      return await commit?.()
    }

    const token = ++activeToken
    const coverMs = Math.max(40, Number(options.coverMs) || DEFAULT_COVER_MS)
    const revealMs = Math.max(40, Number(options.revealMs) || DEFAULT_REVEAL_MS)
    const palette = options.work ? paletteOf(options.work) : DEFAULT_FLOW_PALETTE
    const stops = flowColorStops(palette)
    const colors = buildColors(stops)

    emit({
      active: true,
      runId: token,
      phase: 'covering',
      palette,
      stops,
      colors,
      coverMs,
      revealMs
    })

    if (!(await wait(coverMs, token))) return undefined

    emit({ phase: 'switching' })
    let result
    try {
      result = await commit?.()
    } catch (error) {
      if (token === activeToken) reset()
      throw error
    }
    if (token !== activeToken) return result

    if (typeof options.afterCommit === 'function') {
      await options.afterCommit()
      if (token !== activeToken) return result
    }

    emit({ phase: 'revealing' })
    if (!(await wait(revealMs, token))) return result

    emit({
      active: false,
      phase: 'idle',
      palette: null,
      stops: null,
      colors: null
    })
    return result
  }

  return {
    get state() { return state },
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    run,
    reset
  }
}

export const flowTransition = createFlowTransitionController()

export function runFlowTransition(commit, options = {}) {
  return flowTransition.run(commit, options)
}
