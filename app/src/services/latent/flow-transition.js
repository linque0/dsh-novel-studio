function defaultReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function createFlowTransitionController({
  isReducedMotion = defaultReducedMotion,
  hasDocument = () => typeof document !== 'undefined'
} = {}) {
  let prepare
  let active
  let pendingCommit

  function reset() {
    active?.request.abort()
    active = null
  }

  async function run(commit, options = {}) {
    const intent = { commit, options }
    const reduced = options.reducedMotion ?? isReducedMotion()
    const animate = prepare && (!options.skin || options.skin === 'dsh') && !reduced && hasDocument() ? prepare : null
    let navigation = active
    if (animate && navigation?.animate === animate && !navigation.committed) {
      navigation.intent = intent
    } else {
      if (!navigation?.committing) reset()
      navigation = { request: new AbortController(), animate, intent, committing: false, committed: false }
      active = navigation
      navigation.finished = execute(navigation)
    }
    try {
      const result = await navigation.finished
      if (navigation.intent === intent) return result
    } catch (error) {
      if (navigation.intent === intent) throw error
    }
  }

  async function execute(navigation) {
    const { request, animate } = navigation
    const { signal } = request
    let surface

    try {
      // A book can still be loading or flushing under the preceding cover.
      if (pendingCommit) await pendingCommit.catch(() => {})
      if (signal.aborted) return
      if (animate) {
        try {
          surface = await animate({ signal })
          if (!signal.aborted) await surface?.play()
        } catch {
          surface?.dispose()
          surface = null
        }
      }
      if (signal.aborted) return

      const applying = Promise.resolve().then(async () => {
        if (signal.aborted) return
        navigation.committed = true
        navigation.committing = true
        const { commit, options } = navigation.intent
        const result = await commit?.()
        await options.afterCommit?.()
        return result
      })
      pendingCommit = applying
      let result
      try {
        result = await applying
      } finally {
        if (pendingCommit === applying) pendingCommit = null
        navigation.committing = false
      }
      if (!signal.aborted) {
        try { await surface?.reveal?.() } catch { /* The live page is already ready. */ }
      }
      return result
    } finally {
      surface?.dispose()
      if (active === navigation) active = null
    }
  }

  return {
    attach(fn) {
      prepare = fn
      return () => {
        if (prepare !== fn) return
        prepare = null
        reset()
      }
    },
    run,
    cancelPending() {
      if (active && !active.committed) reset()
    },
    reset
  }
}

export const flowTransition = createFlowTransitionController()

export function runFlowTransition(commit, options) {
  return flowTransition.run(commit, options)
}
