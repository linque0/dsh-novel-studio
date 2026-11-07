/* 设定类型（kind）与默认设定集 —— 三单（侧栏 / 集头 / 详情 / 导图）共用契约的唯一真源。
   kindOf 兜底顺序（自上而下，先命中先返回）：
     ① node.kind 命中 KINDS（键名）→ 用它；
     ② node.tags[0] 命中 KINDS（键名或 KINDS 的中文 label）→ 用它；
     ③ 名称启发式（node.text，兼容 node.name）：地理/场所/地点→place、组织/势力→faction、
        规则/禁忌/体系→rule、历史/纪年/大事记→history、物件/线索/物品→object、民俗/信仰/习俗→belief
        （旧 lorecats 的分类名「地点/势力/物品/体系/大事记」即是靠这一档判出类型的）；
     ④ 都未命中 → 兜底 { kind:'entry', label:'条目', icon:'tag' }。
   setKindOf 走完全相同的 ①②③，只是 ④ 的兜底换成设定集 { kind:'container', label:'设定集', icon:'container' }；
   container 不是「类型」，所以不进 KINDS。 */

export const KINDS = {
  place: { label: '地点', icon: 'map-pin' },
  faction: { label: '组织', icon: 'landmark' },
  rule: { label: '规则', icon: 'shield' },
  history: { label: '历史', icon: 'clock' },
  object: { label: '物件', icon: 'box' },
  belief: { label: '民俗', icon: 'moon' },
  entry: { label: '条目', icon: 'tag' }
}

export const DEFAULT_MUBU_SETS = [
  { kind: 'place', text: '地理与场所' },
  { kind: 'faction', text: '组织与势力' },
  { kind: 'rule', text: '规则与禁忌' },
  { kind: 'history', text: '历史与纪年' },
  { kind: 'object', text: '物件与线索' },
  { kind: 'belief', text: '民俗与信仰' }
]

/* 兜底（④）：条目 / 设定集。container 只出现在这里，不进 KINDS */
const ENTRY_FALLBACK = { kind: 'entry', label: '条目', icon: 'tag' }
const SET_FALLBACK = { kind: 'container', label: '设定集', icon: 'container' }

/* ③ 名称启发式表（顺序即优先级，取第一个命中的关键词组） */
const NAME_HINTS = [
  [['地理', '场所', '地点'], 'place'],
  [['组织', '势力'], 'faction'],
  [['规则', '禁忌', '体系'], 'rule'],
  [['历史', '纪年', '大事记'], 'history'],
  [['物件', '线索', '物品'], 'object'],
  [['民俗', '信仰', '习俗'], 'belief']
]

const metaOf = (kind) => ({ kind, label: KINDS[kind].label, icon: KINDS[kind].icon })

/* 令牌 → kind：先按键名，再按中文 label（旧数据里标签常写成「地点」而不是 place） */
function kindFromToken(token) {
  const t = String(token == null ? '' : token).trim()
  if (!t) return null
  if (KINDS[t]) return t
  for (const key of Object.keys(KINDS)) {
    if (KINDS[key].label === t) return key
  }
  return null
}

/* ①②③ —— 命中返回类型元数据，未命中返回 null（由调用方决定 ④ 兜底成条目还是设定集） */
function resolveKind(node) {
  if (!node) return null
  const direct = kindFromToken(node.kind)
  if (direct) return metaOf(direct)
  const byTag = kindFromToken((node.tags || [])[0])
  if (byTag) return metaOf(byTag)
  const name = String(node.text || node.name || '').trim()
  if (name) {
    for (const [words, kind] of NAME_HINTS) {
      if (words.some((w) => name.includes(w))) return metaOf(kind)
    }
  }
  return null
}

/** 条目用：node.kind → node.tags[0] → 名称启发式 → entry */
export function kindOf(node) {
  return resolveKind(node) || { ...ENTRY_FALLBACK }
}

/** 设定集用：node.kind → node.tags[0] → 名称启发式 → container（设定集） */
export function setKindOf(node) {
  return resolveKind(node) || { ...SET_FALLBACK }
}
