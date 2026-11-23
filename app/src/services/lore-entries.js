/**
 * 幻流（dsh）皮肤新作品预置的 12 类设定顶层条目模板。
 */
export const STARTER_LORE_ENTRIES = [
  { kind: 'place', text: '地理与场所' },
  { kind: 'faction', text: '社会与势力' },
  { kind: 'rule', text: '规则与禁忌' },
  { kind: 'history', text: '历史与纪年' },
  { kind: 'object', text: '物件与线索' },
  { kind: 'belief', text: '民俗与信仰' },
  { kind: 'tech', text: '科技与造物' },
  { kind: 'creature', text: '生灵与异类' },
  { kind: 'power', text: '能力与体系' },
  { kind: 'record', text: '典籍与传闻' },
  { kind: 'resource', text: '货币与资源' },
  { kind: 'event', text: '事件与伏笔' }
]

export function starterLoreEntries(workId, id, at) {
  return STARTER_LORE_ENTRIES.map((entry, index) => ({
    ...entry, id: id(), workId, parentId: null, sortOrder: index * 1000,
    html: null, fold: false, deletedAt: null, createdAt: at, updatedAt: at
  }))
}
