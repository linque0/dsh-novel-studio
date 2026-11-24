// Pure tree/history/reference rules shared by the setting workspace and its regressions.
export const captureLoreNodes = (nodes) => JSON.parse(JSON.stringify(nodes))
export function indexLoreTree(nodes) {
  const live = nodes.filter(node => !node.deletedAt)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  const byId = new Map()
  const children = new Map()
  for (const node of live) {
    byId.set(node.id, node)
    const parent = node.parentId || null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(node)
  }
  return { live, byId, children }
}

export function loreRowAtOffset(offsets, offset) {
  let low = 0, high = offsets.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (offsets[mid + 1] <= offset) low = mid + 1
    else high = mid
  }
  return low
}

export function loreViewportIndices(offsets, top, height, overscan, pinned) {
  const count = offsets.length - 1
  const start = loreRowAtOffset(offsets, top - overscan)
  const bottom = top + height + overscan
  const indices = new Set(pinned.filter(index => index >= 0 && index < count))
  for (let index = start; index < count && offsets[index] < bottom; index++) indices.add(index)
  return [...indices].sort((a, b) => a - b)
}

export function loreDescendants(children, id) {
  const result = []
  const seen = new Set([id])
  const pending = (children.get(id || null) || []).slice().reverse()
  while (pending.length) {
    const node = pending.pop()
    if (seen.has(node.id)) continue
    seen.add(node.id)
    result.push(node)
    const branch = children.get(node.id)
    if (branch) {
      for (let i = branch.length - 1; i >= 0; i--) pending.push(branch[i])
    }
  }
  return result
}

export function lorePath(nodes, id) {
  const byId = nodes instanceof Map ? nodes : new Map(nodes.map(n => [n.id, n])), seen = new Set(), result = []
  let n = byId.get(id)
  while (n && !seen.has(n.id)) { seen.add(n.id); result.unshift(n); n = byId.get(n.parentId) }
  return result
}
export function validLoreMove(nodes, id, targetId, workId) {
  const a = nodes.find(n => n.id === id && !n.deletedAt), b = nodes.find(n => n.id === targetId && !n.deletedAt)
  return !!a && !!b && id !== targetId && a.workId === b.workId && (!workId || a.workId === workId) && !lorePath(nodes, targetId).some(n => n.id === id)
}
export function resolveLoreFocus(nodes, id, ancestors = [], workId) {
  if (!id) return null
  const live = new Set(nodes.filter(n => !n.deletedAt && (!workId || n.workId === workId)).map(n => n.id))
  return [id, ...[...ancestors].reverse()].find(k => live.has(k)) || null
}
// The graph shows children and grandchildren of its current center.
export function resolveLoreGalaxy(nodes, location, workId) {
  const live = new Map(nodes.filter(node => !node.deletedAt && (!workId || node.workId === workId)).map(node => [node.id, node]))
  const { rootId, rootPath = [], activeId } = location
  let center = rootId ? [rootId, ...[...rootPath].reverse()].find(id => live.has(id)) || null : null
  let active = activeId !== rootId && live.has(activeId) ? activeId : null
  if (active) {
    const path = lorePath(live, active).map(node => node.id)
    const index = center ? path.indexOf(center) : -1
    const visible = (!center || index >= 0) && path.length - 1 - index <= 2
    if (!visible) center = path.at(-2) || null
    if (active === center) active = null
  }
  return {
    rootId: center,
    rootPath: lorePath(live, center).map(node => node.id),
    activeId: active || center,
    selectedId: active || center,
    scope: active || center ? 'set' : 'all'
  }
}

export const createLoreHistory = () => ({ past: [], future: [], group: null, at: 0 })
export function checkpointLore(history, nodes, { group = null, at = Date.now(), selection = null } = {}) {
  if (!group || group !== history.group || at - history.at > 1200 || !history.past.length) {
    history.past.push({ nodes: captureLoreNodes(nodes), selection })
    if (history.past.length > 60) history.past.shift()
  }
  history.group = group; history.at = at; history.future = []
}
export function stepLoreHistory(history, nodes, direction, selection = null) {
  const from = direction === 'redo' ? history.future : history.past, to = direction === 'redo' ? history.past : history.future
  const state = from.pop()
  if (!state) return null
  to.push({ nodes: captureLoreNodes(nodes), selection }); history.group = null
  return state
}
const key = t => t.kind + ':' + t.id
export function referenceTargets(source, targets = []) {
  const found = new Map(), html = String(source.html || ''), text = String(source.text || '')
  for (const match of html.matchAll(/data-dl-target\s*=\s*(["'])(.*?)\1/g)) {
    const m = match[2].match(/^(chapter|mubu|character|outline|olnode|snippet):([^<>\s]+)$/)
    if (m) { const t = { kind: m[1], id: m[2] }; found.set(key(t), targets.find(x => key(x) === key(t)) || t) }
  }
  // Rich-text labels are not legacy tokens; parse plain tokens only outside tags.
  const legacy = source.html ? html.replace(/<span\b[^>]*data-dl-target\s*=\s*(["'])[^"']*\1[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, '') : text
  for (const match of legacy.matchAll(/\[\[([^\[\]\n|]+)(?:\|[^\[\]\n]*)?\]\]/g)) {
    const title = match[1].trim().toLowerCase(), hits = targets.filter(t => String(t.title || '').trim().toLowerCase() === title)
    if (hits.length === 1) found.set(key(hits[0]), hits[0])
  }
  return [...found.values()]
}
export function incomingReferences(sources, target, targets = []) {
  return sources.filter(s => key(s) !== key(target) && referenceTargets(s, targets).some(t => key(t) === key(target)))
}
