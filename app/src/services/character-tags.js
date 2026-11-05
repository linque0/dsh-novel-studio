/* 人物标签工具：role 与 aliases 沿用字符串存储（可用 / 、 , 空白分隔），tags 为数组。
 * 统一在这里拆分/合并，避免各处对多角色、多别名的解析不一致。 */

const TAG_SPLIT = /[/、,，;；\s]+/

export function splitTagString(value) {
  return String(value || '')
    .split(TAG_SPLIT)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function uniqTags(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const v = String(raw || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** 角色定位（支持多值，如「主角/导师」） */
export function rolesOf(c) {
  return uniqTags(splitTagString(c?.role))
}

/** 第一个角色：页头、列表、图谱节点等单值展示处使用 */
export function primaryRole(c) {
  return rolesOf(c)[0] || ''
}

/** 别名（字符串，兼容 / 、 , 空白分隔） */
export function aliasesOf(c) {
  return uniqTags(splitTagString(c?.aliases))
}

/** 别名区合并展示：aliases（实线）+ 旧 tags（虚线）；kind 用于删除时写回对应字段 */
export function aliasTagEntries(c) {
  const out = []
  const seen = new Set()
  for (const v of aliasesOf(c)) {
    seen.add(v)
    out.push({ value: v, kind: 'alias' })
  }
  for (const v of uniqTags(c?.tags || [])) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, kind: 'tag' })
  }
  return out
}

/** 检索与筛选：角色 + 别名 + 标签（去重） */
export function characterTagList(c) {
  return uniqTags([...rolesOf(c), ...aliasesOf(c), ...(c?.tags || [])])
}
