import { db } from '../db/database.js'
import { isNewerWritingPosition } from './writing-position-core.js'

const pending = new Map(), captures = new Set()
const writerId = crypto.randomUUID()
let sequence = 0, timer, active
export const writingPositionKey = workId => 'writing-position:' + workId

export function registerWritingCapture(capture) {
  captures.add(capture)
  return () => captures.delete(capture)
}
export function captureWritingPositions() {
  for (const capture of captures) capture()
}
export function queueWritingPosition(workId, value) {
  if (!workId || !value.chapterId) return
  pending.set(workId, {...value,writerId,sequence:++sequence,updatedAt:performance.timeOrigin + performance.now()})
  clearTimeout(timer)
  timer = setTimeout(() => flushWritingPositions().catch(report),300)
}
function report(error) { console.warn('[writing-position] 位置保存失败，保留待存记录',error) }

export async function readWritingPosition(workId) {
  const stored = (await db.appconfig.get(writingPositionKey(workId)))?.value || null
  const waiting = pending.get(workId)
  return isNewerWritingPosition(waiting,stored) ? waiting : stored
}

export async function flushWritingPositions() {
  clearTimeout(timer)
  if (active) { await active; if (pending.size) return flushWritingPositions(); return }
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  active = db.transaction('rw',db.appconfig,async()=>{
    for (const [workId,position] of batch) {
      const key=writingPositionKey(workId),existing=await db.appconfig.get(key)
      if (isNewerWritingPosition(position,existing?.value)) await db.appconfig.put({key,value:position})
    }
  })
  try { await active }
  catch(error) {
    for (const [id,value] of batch) if (!pending.has(id)) pending.set(id,value)
    throw error
  } finally { active=null }
  if (pending.size) await flushWritingPositions()
}

export function discardWritingPositions() {
  clearTimeout(timer)
  pending.clear()
}
