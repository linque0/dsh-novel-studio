export function createFlowCaptureQueue(matches) {
  let current

  return async function capture(key, produce, { signal, timeoutMs, skipBusy = false }) {
    if (signal.aborted) return null
    let expired = false
    let release
    const deadline = new Promise(resolve => { release = () => { expired = true; resolve(null) } })
    const timer = setTimeout(release, timeoutMs)
    signal.addEventListener('abort', release, { once: true })

    const acquire = async () => {
      // A caller may leave, but a DOM rasterization cannot be interrupted once it begins.
      while (current && !matches(current.key, key)) {
        if (skipBusy) return null
        await current.job.catch(() => {})
        if (expired || signal.aborted) return null
      }
      if (expired || signal.aborted) return null
      if (!current) {
        const slot = { key }
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
      signal.removeEventListener('abort', release)
    }
  }
}
