/**
 * 设定条目五级权重（Entry Weight）统一领域模型（零 DOM 依赖）：
 * - 定义「核心 / 关键 / 标准 / 点缀 / 末节」五档常量、倍率、径向层级与 LOD 阈值；
 * - 兼容历史 mubuTagMeta（旧格式 `{ [name]: createdAt }` 与新格式 `{ [name]: { createdAt, weight } }`）；
 * - 提供由条目显式权重 + 绑定标签权重推导最终有效权重的纯函数。
 */

export const DEFAULT_ENTRY_WEIGHT = 'standard'

export const ENTRY_WEIGHT_ORDER = Object.freeze(['core', 'key', 'standard', 'accent', 'trivial'])

export const ENTRY_WEIGHTS = Object.freeze([
  Object.freeze({
    id: 'core',
    label: '核心',
    en: 'CORE',
    value: 5,
    tier: 1,
    scale: 1.38,
    radialMin: 0.12,
    radialMax: 0.32,
    lodZoom: 0,
    concept: '双层四芒十字星核',
    color: '#47D7E8'
  }),
  Object.freeze({
    id: 'key',
    label: '关键',
    en: 'KEY',
    value: 4,
    tier: 2,
    scale: 1.18,
    radialMin: 0.30,
    radialMax: 0.52,
    lodZoom: 1.12,
    concept: '日蚀星环',
    color: '#5CE1F2'
  }),
  Object.freeze({
    id: 'standard',
    label: '标准',
    en: 'STANDARD',
    value: 3,
    tier: 3,
    scale: 1.00,
    radialMin: 0.46,
    radialMax: 0.70,
    lodZoom: 1.25,
    concept: '经典双切面实心菱晶',
    color: '#EAF3FF'
  }),
  Object.freeze({
    id: 'accent',
    label: '点缀',
    en: 'ACCENT',
    value: 2,
    tier: 4,
    scale: 0.80,
    radialMin: 0.62,
    radialMax: 0.80,
    lodZoom: 1.42,
    concept: '双星共轭结',
    color: '#96B6FF'
  }),
  Object.freeze({
    id: 'trivial',
    label: '末节',
    en: 'TRIVIAL',
    value: 1,
    tier: 5,
    scale: 0.62,
    radialMin: 0.72,
    radialMax: 0.86,
    lodZoom: 1.65,
    concept: '悬涡星屑',
    color: '#8CB4FF'
  })
])

export const ENTRY_WEIGHT_MAP = Object.freeze(
  Object.fromEntries(ENTRY_WEIGHTS.map((item) => [item.id, item]))
)

export function isValidEntryWeight(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENTRY_WEIGHT_MAP, value)
}

export function normalizeEntryWeight(value) {
  return isValidEntryWeight(value) ? value : DEFAULT_ENTRY_WEIGHT
}

export function entryWeightMeta(weight) {
  return ENTRY_WEIGHT_MAP[normalizeEntryWeight(weight)]
}

export function entryWeightRank(weight) {
  return entryWeightMeta(weight).value
}

export function entryWeightScale(weight) {
  return entryWeightMeta(weight).scale
}

export function tagMetaCreatedAt(entry) {
  if (typeof entry === 'number') return Number.isFinite(entry) ? entry : 0
  if (entry && typeof entry === 'object') {
    const t = Number(entry.createdAt)
    return Number.isFinite(t) ? t : 0
  }
  return 0
}

export function tagMetaWeight(entry) {
  if (entry && typeof entry === 'object') return normalizeEntryWeight(entry.weight)
  return DEFAULT_ENTRY_WEIGHT
}

export function tagWeightOf(tagMeta, tagName) {
  if (!tagMeta || typeof tagMeta !== 'object' || !tagName) return DEFAULT_ENTRY_WEIGHT
  return tagMetaWeight(tagMeta[tagName])
}

/**
 * 仅从条目绑定的标签推导有效权重：
 * - 若挂载了一个或多个非标准权重标签，优先取优先级最高者（core > key > accent > trivial）；
 * - 若全为标准或无标签，返回 'standard'。
 */
export function deriveWeightFromTags(tags, tagMeta) {
  if (!Array.isArray(tags) || !tags.length || !tagMeta || typeof tagMeta !== 'object') {
    return DEFAULT_ENTRY_WEIGHT
  }
  let best = null
  let bestRank = -1
  for (const raw of tags) {
    const name = String(raw || '').trim()
    if (!name) continue
    const w = tagWeightOf(tagMeta, name)
    if (w === DEFAULT_ENTRY_WEIGHT) continue
    const rank = entryWeightRank(w)
    if (rank > bestRank) {
      bestRank = rank
      best = w
    }
  }
  return best || DEFAULT_ENTRY_WEIGHT
}

/**
 * 解析条目的最终生效权重：
 * - 若条目自身显式设置了合法的 `weight` 字段，以显式值为准；
 * - 否则自动依据所绑定标签的权重推导（无非标准标签时回退 `'standard'`）。
 */
export function resolveEntryWeight(entry, tagMeta) {
  if (entry && isValidEntryWeight(entry.weight)) return entry.weight
  return deriveWeightFromTags(entry?.tags, tagMeta)
}
