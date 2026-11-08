/* 灵感模型：纯函数，不碰 DOM / Dexie / Vue（与 char-layout.js、lore-layout.js 同构）。
   设计真源：docs/前端美化/灵感-融合总稿-20261107/（model.js + render.js + studio.js）。
   存储口径（不改表结构、不改既有消费者）：
   - 行里只有 content：首行 = 标题，其余 = 正文。doublelink-titles.js:6 / writing-analysis-data.js:70 /
     normalize.js:107 / writing-stats-core.js 都按「首行 = 标题」读，拆成独立列会同时打坏这四处。
   - tags: string[]（早于本设计已存在的字段）
   - links: [{kind, id}]，kind ∈ chapter | mubu | character；只存 ID，名字渲染时实时解析
     （设计稿要求「目标改名后仍保留关联」「按 ID 区分不按同名标题猜测」）。
   - 手动顺序按作品存一个 id 数组（snipstate 的 order），不写回行，避免每次拖动重写全表。 */

export const LINK_KINDS = ['chapter', 'mubu', 'character']
export const FILTERS = ['all', 'untagged', 'linked', 'trash']
export const SORTS = ['new', 'old', 'manual']
export const VIEWS = ['journal', 'board']
export const MAX_TAG = 30

/** content → {title, body}：首个非空行作标题，其后去掉开头空行作正文。 */
export function splitNote(row) {
  const raw = String(row?.content ?? '')
  const lines = raw.split('\n')
  const first = (lines[0] || '').trim()
  if (row?.title && !first) return { title: String(row.title).trim(), body: '' }
  const title = first || String(row?.title || '').trim()
  const body = lines.slice(1).join('\n').replace(/^\n+/, '')
  return { title, body }
}

/** {title, body} → content：标题独占首行，正文前留一空行（与既有 content 写法一致）。 */
export function joinContent(title, body) {
  const t = String(title ?? '').trim()
  const b = String(body ?? '').replace(/^\n+/, '').replace(/\s+$/, '')
  return b ? t + '\n\n' + b : t
}

const pad = (n) => String(n).padStart(2, '0')

/** 时间戳 → 手札分组用的 {date:'YYYY-MM-DD', time:'HH:mm'}（本地时区，与设计稿 stamp() 同口径）。 */
export function stamp(createdAt) {
  const d = new Date(Number(createdAt) || Date.now())
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-'),
    time: pad(d.getHours()) + ':' + pad(d.getMinutes())
  }
}

/** 日期标题：今天 / 11 月 07 日（设计稿 render.js:22 的口径）。 */
export function dateLabel(date, today = stamp(Date.now()).date) {
  if (!date) return ''
  if (date === today) return '今天'
  const [, m, d] = date.split('-')
  return Number(m) + ' 月 ' + d + ' 日'
}

/** 标签归一：去首尾空白与前导 #、折叠内部空白、上限 30 字；空串返回 ''。 */
export function normalizeTag(value) {
  const t = String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > MAX_TAG ? t.slice(0, MAX_TAG) : t
}

export function normalizeTags(list) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const t = normalizeTag(raw)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 关联归一：只留三种合法 kind、必须有 id、按 kind:id 去重。 */
export function normalizeLinks(list) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const kind = String(raw?.kind || '')
    const id = String(raw?.id || '')
    if (!LINK_KINDS.includes(kind) || !id) continue
    const key = kind + ':' + id
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id })
  }
  return out
}

export const linkKey = (l) => String(l?.kind || '') + ':' + String(l?.id || '')

/** 一条灵感在手札/拼板里显示用的视图对象；names 由调用方注入（实时解析目标标题）。 */
export function noteView(row, names = {}) {
  const { title, body } = splitNote(row)
  const at = stamp(row.createdAt)
  return {
    id: row.id,
    title,
    body,
    tags: normalizeTags(row.tags),
    links: normalizeLinks(row.links).map((l) => ({ ...l, name: names[l.kind + ':' + l.id] || '', missing: !names[l.kind + ':' + l.id] })),
    date: at.date,
    time: at.time,
    createdAt: Number(row.createdAt) || 0,
    deletedAt: row.deletedAt || null
  }
}

/** 检索命中：标题、正文、标签、关联目标名（设计稿 column「查找」）。 */
export function matchesQuery(note, q) {
  if (!q) return true
  const hay = [note.title, note.body, ...note.tags, ...note.links.map((l) => l.name)].join('\n').toLowerCase()
  return hay.includes(q)
}

/** 手动顺序：order 里有的按 order 升序，缺的排在后面按 createdAt 倒序（新记录天然在最前）。 */
export function orderIndex(order) {
  const map = new Map()
  for (const [i, id] of (Array.isArray(order) ? order : []).entries()) map.set(String(id), i)
  return map
}

export function sortNotes(notes, sort = 'new', order = []) {
  const idx = orderIndex(order)
  const byNew = (a, b) => b.createdAt - a.createdAt || String(a.id).localeCompare(String(b.id))
  if (sort === 'old') return [...notes].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))
  if (sort === 'manual') {
    return [...notes].sort((a, b) => {
      const ia = idx.has(a.id) ? idx.get(a.id) : Number.MAX_SAFE_INTEGER
      const ib = idx.has(b.id) ? idx.get(b.id) : Number.MAX_SAFE_INTEGER
      return ia - ib || byNew(a, b)
    })
  }
  return [...notes].sort(byNew)
}

/** 可见集：筛选（全部/未标记/有关联/回收站）+ 单标签 + 检索 + 排序。 */
export function visibleNotes(notes, state = {}) {
  const filter = FILTERS.includes(state.filter) ? state.filter : 'all'
  const q = String(state.query || '').trim().toLowerCase()
  const tag = normalizeTag(state.tag)
  const rows = notes.filter((n) => {
    const trash = !!n.deletedAt
    if (filter === 'trash' && !trash) return false
    if (filter !== 'trash' && trash) return false
    if (tag && !n.tags.includes(tag)) return false
    if (filter === 'untagged' && n.tags.length) return false
    if (filter === 'linked' && !n.links.length) return false
    return matchesQuery(n, q)
  })
  return sortNotes(rows, state.sort, state.order)
}

/** 左栏与拼板共用的计数（回收站独立统计，不进「全部」）。 */
export function stableTagOrder(notes, previous = []) {
  const live = notes.filter(n=>!n.deletedAt).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
  // Remember zero-count tags too: deleting and restoring the last use keeps its slot.
  const order = [...new Set(previous)]
  for(const n of live)for(const t of n.tags)if(!order.includes(t))order.push(t)
  return order
}
export const UNTAGGED_GROUP = "untagged:"
export const tagGroupId = tag => "tag:" + tag
export function noteCounts(notes, tagOrder = []) {
  const live = notes.filter((n) => !n.deletedAt)
  const tags = new Map()
  for (const n of live) for (const t of n.tags) tags.set(t, (tags.get(t) || 0) + 1)
  return {
    all: live.length,
    untagged: live.filter((n) => !n.tags.length).length,
    linked: live.filter((n) => n.links.length).length,
    trash: notes.length - live.length,
    tags: stableTagOrder(notes, tagOrder).filter(tag=>tags.has(tag)).map(tag => ({ tag, count: tags.get(tag) }))
  }
}

/** 拼板分栏：每个标签一栏（沿用作品稳定序列），未标记固定末栏。
    设计稿原型把「场景/人物/对白」写死成三栏，那是演示数据的标签；真实作品标签任意，
    按实际标签成栏才留得住「未标记和其他标签同样可到达，不隐藏内容」。 */
export function boardGroups(notes, tagOrder = [], trash = false) {
  const rows = notes.filter(n=>trash?!!n.deletedAt:!n.deletedAt)
  const order = trash?stableTagOrder(rows.map(n=>({...n,deletedAt:null})),tagOrder):stableTagOrder(rows,tagOrder)
  const groups = order.filter(tag=>rows.some(n=>n.tags.includes(tag))).map(tag=>({id:tagGroupId(tag),label:tag,tag,notes:rows.filter(n=>n.tags.includes(tag))}))
  const untagged = rows.filter(n=>!n.tags.length)
  if(untagged.length)groups.push({id:UNTAGGED_GROUP,label:'未标记',tag:null,notes:untagged})
  return groups
}

/** 上移/下移：在给定同组顺序里换位；没有相邻项时返回 null（调用方给提示，不改数据）。 */
export function neighbourId(list, id, direction) {
  const i = list.findIndex((n) => n.id === id)
  if (i < 0) return null
  const other = list[i + (direction < 0 ? -1 : 1)]
  return other ? other.id : null
}

/** 把 id 挪到 beforeId 之前（beforeId 为空则追加到末尾），返回新的 order 数组。 */
export function moveBefore(order, id, beforeId) {
  const next = (Array.isArray(order) ? order : []).map(String).filter((x) => x !== String(id))
  const at = beforeId ? next.indexOf(String(beforeId)) : -1
  if (at < 0) next.push(String(id))
  else next.splice(at, 0, String(id))
  return next
}

/** 让 order 覆盖给定 id 集合：已有顺序保留，新 id 按传入顺序补到最前（新记录在默认视图里本来就排第一）。 */
export function reconcileOrder(order, ids) {
  const have = (Array.isArray(order) ? order : []).map(String)
  const known = new Set(have)
  const fresh = ids.map(String).filter((id) => !known.has(id))
  const alive = new Set(ids.map(String))
  return [...fresh, ...have.filter((id) => alive.has(id))]
}

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)

/** 每作品 UI 状态归一（读库损坏或旧版本时退回默认，不让界面卡死）。 */
export function normalizeSnipState(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const inspector = v.inspector && typeof v.inspector === 'object' ? v.inspector : {}
  const scroll = v.scroll && typeof v.scroll === 'object' ? v.scroll : {}
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0)
  return {
    view: VIEWS.includes(v.view) ? v.view : 'journal',
    filter: FILTERS.includes(v.filter) ? v.filter : 'all',
    tag: normalizeTag(v.tag),
    sort: SORTS.includes(v.sort) ? v.sort : 'new',
    selected: v.selected == null ? '' : str(v.selected),
    group: !v.group ? '' : String(v.group).startsWith('tag:') || v.group === UNTAGGED_GROUP ? String(v.group) : v.group === '未标记' ? UNTAGGED_GROUP : tagGroupId(String(v.group)),
    tagOrder: Array.isArray(v.tagOrder)?[...new Set(v.tagOrder.map(String))]:[],
    query: str(v.query),
    moreTags: v.moreTags === true,
    inspector: { journal: inspector.journal !== false, board: inspector.board === true },
    order: Array.isArray(v.order) ? v.order.map(String) : [],
    scroll: Object.fromEntries(['journal','board'].map(k=>[k,typeof scroll[k]==='object'&&scroll[k] ? {top:num(scroll[k].top),left:num(scroll[k].left)} : {top:num(scroll[k]),left:0}]))
  }
}

/** 草稿归一：quick 是随手记输入，edit 按条 id 存未提交的 {title, body}。 */
export function normalizeDrafts(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const edit = {}
  const src = v.edit && typeof v.edit === 'object' ? v.edit : {}
  for (const [id, draft] of Object.entries(src)) {
    if (!id || !draft || typeof draft !== 'object') continue
    edit[id] = { title: str(draft.title), body: str(draft.body), ...(typeof draft.base === "string" ? {base:draft.base} : {}) }
  }
  return { quick: str(v.quick), edit }
}

/** 关联目标可用性：渲染名由调用方查表，查不到就是「目标已不可用」（设计稿 preview 口径）。 */
export function linkLabel(link, nameOf) {
  const name = nameOf(link.kind, link.id)
  return name || ''
}
