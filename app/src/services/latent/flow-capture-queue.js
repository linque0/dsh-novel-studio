export function createFlowCaptureQueue(matches) {
  let current

  return async function capture(key, produce, { signal, timeoutMs, skipBusy = false }) {
    if (signal.aborted) return null
    let expired = false
    let ownedSlot = null
    let release
    const deadline = new Promise(resolve => {
      release = (timedOut = false) => {
        expired = true
        if (timedOut && ownedSlot) ownedSlot.timedOut = true
        resolve(null)
      }
    })
    const onAbort = () => release(false)
    const timer = setTimeout(() => release(true), timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })

    const acquire = async () => {
      // A caller may leave, but a DOM rasterization cannot be interrupted once it begins.
      // Never let an obsolete background precapture or an already timed-out slot stall a live navigation.
      while (current && !matches(current.key, key)) {
        if (skipBusy) return null
        if (current.idle || current.timedOut) {
          current = null
          break
        }
        await current.job.catch(() => {})
        if (expired || signal.aborted) return null
      }
      if (expired || signal.aborted) return null
      if (!current) {
        const slot = { key, idle: Boolean(skipBusy), timedOut: false }
        ownedSlot = slot
        slot.job = Promise.resolve().then(produce).finally(() => {
          if (current === slot) current = null
        })
        current = slot
      }
      return current.job
    }

    try {
      return await Promise.race([acquire(), deadline])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }
}
