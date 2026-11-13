// Plan the entire tree change before touching the store or its undo history.
export function planLoreMove(nodes, sourceId, targetId, mode, placement) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const source = byId.get(sourceId)
  const target = byId.get(targetId)
  if (!source?.parentId || sourceId === targetId) return []
  const parentOf = node => node?.parentId || null
  const siblings = parentId => nodes.filter(node => parentOf(node) === parentId).map(node => node.id)
  const oldParent = parentOf(source)
  if (!byId.has(oldParent)) return []
  const lists = new Map()
  const list = parentId => {
    if (!lists.has(parentId)) lists.set(parentId, siblings(parentId))
    return lists.get(parentId)
  }
  const remove = (ids, id) => ids.splice(ids.indexOf(id), 1)
  const replace = (ids, id, next) => ids.splice(ids.indexOf(id), 1, next)
  const newParents = new Map()
  const path = new Set()
  let pathChild
  let targetRoot = target
  while (targetRoot?.parentId) {
    if (path.has(targetRoot.id)) return []
    path.add(targetRoot.id)
    if (targetRoot.parentId === sourceId) pathChild = targetRoot.id
    targetRoot = byId.get(targetRoot.parentId)
  }
  const descendant = path.has(sourceId)

  if (mode === 'swap') {
    if (!descendant) return []
    const targetParent = parentOf(target)
    replace(list(oldParent), sourceId, targetId)
    if (targetParent === sourceId) {
      remove(list(sourceId), targetId)
      list(targetId).push(sourceId)
      newParents.set(sourceId, targetId)
    } else {
      replace(list(targetParent), targetId, sourceId)
      remove(list(sourceId), pathChild)
      list(targetId).push(pathChild)
      newParents.set(pathChild, targetId)
      newParents.set(sourceId, targetParent)
    }
    newParents.set(targetId, oldParent)
  } else {
    if (descendant || !['before', 'after', 'inside', 'outdent', 'lift', 'sink'].includes(mode)) return []
    const reference = mode === 'outdent' ? byId.get(oldParent) : target
    if (!reference) return []
    const byLevel = mode === 'lift' || mode === 'sink'
    const parent = mode === 'inside' || byLevel ? reference.id : parentOf(reference)
    if (!parent) return []
    if (mode === 'lift') {
      const ancestors = new Set()
      for (let cursor = parentOf(byId.get(oldParent)); cursor; cursor = parentOf(byId.get(cursor))) {
        if (ancestors.has(cursor) || !byId.has(cursor)) return []
        ancestors.add(cursor)
      }
      if (!ancestors.has(parent)) return []
    }
    if (mode === 'sink') {
      const ancestors = new Set()
      let root = oldParent
      while (parentOf(byId.get(root))) {
        if (ancestors.has(root)) return []
        ancestors.add(root)
        root = parentOf(byId.get(root))
        if (!byId.has(root)) return []
      }
      if (path.size <= ancestors.size || targetRoot?.id !== root) return []
    }
    if (byLevel && placement?.referenceId && parentOf(byId.get(placement.referenceId)) !== parent) return []
    const origin = list(oldParent)
    const destination = list(parent)
    const before = origin.slice()
    remove(origin, sourceId)
    const index = byLevel
      ? placement?.referenceId
        ? destination.indexOf(placement.referenceId) + Number(placement.side === 'after')
        : destination.length
      : mode === 'inside' ? destination.length
        : destination.indexOf(reference.id) + Number(mode !== 'before')
    destination.splice(index, 0, sourceId)
    if (parent === oldParent && before.every((id, i) => id === origin[i])) return []
    newParents.set(sourceId, parent)
  }

  for (const id of newParents.keys()) {
    const seen = new Set()
    for (let cursor = id; cursor; cursor = newParents.get(cursor) ?? parentOf(byId.get(cursor))) {
      if (seen.has(cursor) || !byId.has(cursor)) return []
      seen.add(cursor)
    }
  }
  return Array.from(lists).flatMap(([parentId, ids]) => ids.flatMap((id, index) => {
    const node = byId.get(id)
    const sortOrder = index * 1000
    return parentOf(node) === parentId && node.sortOrder === sortOrder ? [] : [{ id, parentId, sortOrder }]
  }))
}
