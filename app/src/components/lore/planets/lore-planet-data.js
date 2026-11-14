const colors = ['#a1c7bb', '#c5adcf', '#d5ac8b', '#a8a7c4', '#b9b2a2']

export function lorePlanetData(entries, relationships, characters) {
  const live = new Map(entries.map(entry => [entry.id, entry]))
  const rootIds = new Map()
  for (const entry of entries) {
    const path = new Set()
    let cursor = entry
    while (cursor && !path.has(cursor.id) && !rootIds.has(cursor.id)) {
      path.add(cursor.id)
      if (!cursor.parentId) break
      cursor = live.get(cursor.parentId)
    }
    const root = cursor && (rootIds.get(cursor.id) || (!cursor.parentId && cursor.id)) || null
    for (const id of path) rootIds.set(id, root)
  }

  const sets = [], nodes = [], links = [], satellites = []
  for (const entry of entries) {
    const setId = rootIds.get(entry.id)
    if (!setId) continue
    const summary = String(entry.text || '').trim()
    const title = summary.split('\n')[0] || '未命名节点'
    const item = { id: entry.id, title, summary, createdAt: entry.createdAt }
    if (entry.id === setId) sets.push({ ...item, color: colors[sets.length % colors.length] })
    else nodes.push({ ...item, setId, parentId: entry.parentId })
  }

  const people = new Map(characters.map(person => [person.id, person]))
  for (const relation of relationships) {
    const fromLore = relation.fromKind === 'mubu'
    const toLore = relation.toKind === 'mubu'
    if (fromLore && toLore) {
      if (rootIds.get(relation.fromId) && rootIds.get(relation.toId)) {
        links.push({ id: relation.id, from: relation.fromId, to: relation.toId, label: relation.label,
          reverseLabel: relation.reverseLabel, description: relation.description })
      }
    } else if (fromLore || toLore) {
      const owner = fromLore ? relation.fromId : relation.toId
      const person = people.get(fromLore ? relation.toId : relation.fromId)
      if (!rootIds.get(owner) || !person) continue
      satellites.push({
        id: relation.id, nodeId: owner,
        target: { kind: 'character', id: person.id, title: person.name || '未命名人物' },
        label: (toLore && relation.reverseLabel) || relation.label,
        description: relation.description
      })
    }
  }
  return { sets, nodes, links, satellites }
}
