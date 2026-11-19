export const STARTER_LORE_ENTRIES = [
  { kind: 'place', text: '地理与场所' },
  { kind: 'faction', text: '组织与势力' },
  { kind: 'rule', text: '规则与禁忌' },
  { kind: 'history', text: '历史与纪年' },
  { kind: 'object', text: '物件与线索' },
  { kind: 'belief', text: '民俗与信仰' }
]

export function starterLoreEntries(workId, id, at) {
  return STARTER_LORE_ENTRIES.map((entry, index) => ({
    ...entry, id: id(), workId, parentId: null, sortOrder: index * 1000,
    html: null, fold: false, deletedAt: null, createdAt: at, updatedAt: at
  }))
}
