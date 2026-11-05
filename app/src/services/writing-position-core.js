// UI navigation state only: never modifies manuscript or projection sources.
export function resolveWritingChapter(bundle, position, explicitChapterId) {
  const live = (bundle.chapters || []).filter(c => !c.deletedAt)
  const explicit = live.find(c => c.id === explicitChapterId)
  if (explicit) return explicit
  const remembered = live.find(c => c.id === position?.chapterId)
  if (remembered) return remembered
  const byOrder = (a,b) => (a.sortOrder || 0)-(b.sortOrder || 0) || String(a.id).localeCompare(String(b.id))
  for (const v of (bundle.volumes || []).filter(v=>!v.deletedAt).sort(byOrder)) {
    const first = live.filter(c=>c.volumeId===v.id).sort(byOrder)[0]
    if (first) return first
  }
  return live.sort(byOrder)[0] || null
}

export function restoreWritingSelection(position, size) {
  const clamp = n => Math.max(1,Math.min(Math.max(1,size),Number.isFinite(n)?Math.floor(n):1))
  const from=clamp(position?.selection?.from),to=clamp(position?.selection?.to)
  return {from:Math.min(from,to),to:Math.max(from,to)}
}

export function isNewerWritingPosition(candidate, previous) {
  if (!candidate || !Number.isFinite(candidate.updatedAt)) return false
  if (!previous) return true
  if (candidate.updatedAt !== previous.updatedAt) return candidate.updatedAt > previous.updatedAt
  if (candidate.writerId === previous.writerId) return (candidate.sequence || 0) > (previous.sequence || 0)
  return String(candidate.writerId || '') > String(previous.writerId || '')
}
