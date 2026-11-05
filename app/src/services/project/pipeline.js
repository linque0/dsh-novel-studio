import { db } from '../../db/database.js'
import { ensureProjection, markProjectionDirty, suspendProjection, resumeProjection } from '../../db/project-repo.js'

let installed = false, timer, firstDirty = 0, running = false
const queue = new Set()
const main = () => typeof location === 'undefined' || !new URLSearchParams(location.search).has('panel')
export async function queueProjection(workId) {
  if (!workId) return
  await markProjectionDirty(workId)
  if (!main()) return
  queue.add(workId)
  if (!firstDirty) firstDirty = Date.now()
  clearTimeout(timer)
  timer = setTimeout(drain, Math.max(0, Math.min(3000,10000 - (Date.now() - firstDirty))))
}
async function drain() {
  if (running) { timer = setTimeout(drain,300); return }
  running = true; firstDirty = 0
  try {
    for (const workId of [...queue]) {
      queue.delete(workId)
      try { await ensureProjection(workId) }
      catch (e) {
        if (e.code === 'source-changed') queue.add(workId)
        else await db.aiindex.update(workId,{status:'failed',error:e.message})
      }
    }
  } finally { running = false; if (queue.size) timer = setTimeout(drain,3000) }
}
export function projectionRestoreBegin() { clearTimeout(timer); queue.clear(); suspendProjection() }
export function projectionRestored() { resumeProjection() }
export function installProjectionPipeline() {
  if (installed) return
  installed = true
  window.addEventListener('book-source-changed',(e) => queueProjection(e.detail?.workId).catch(console.error))
  if (main()) db.aiindex.where('status').equals('dirty').toArray().then((rows) => {
    rows.forEach((r) => queue.add(r.workId)); if (queue.size) timer = setTimeout(drain,3000)
  }).catch(console.error)
}
