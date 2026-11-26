/**
 * 设定模块共享纯逻辑检索工具（MubuTree 左侧检索列表与 MubuView 主区整库筛选共用）。
 * 支持多词元 AND 匹配、相关性排序、O(1) 祖先路径构建以及无 XSS 的高亮区间切分。
 */

/** 将用户输入拆分为去重小写词元（空格分隔，单关键词等价子串匹配）。 */
export function parseLoreQuery(raw) {
  const seen = new Set()
  const out = []
  for (const part of String(raw || '').trim().toLowerCase().split(/\s+/)) {
    if (!part || seen.has(part)) continue
    seen.add(part)
    out.push(part)
  }
  return out
}

/**
 * 判定单条设定节点是否命中所有检索词元，并返回匹配明细与相关性分值。
 * @param {object} node
 * @param {string[]} tokens
 */
export function matchLoreNode(node, tokens) {
  if (!node || !tokens.length) return { matched: false, textHit: false, matchedTags: [], score: 0 }
  const textRaw = String(node.text || '')
  const textLow = textRaw.toLowerCase()
  const tags = Array.isArray(node.tags) ? node.tags.map(t => String(t || '')).filter(Boolean) : []
  const tagsLow = tags.map(t => t.toLowerCase())

  let textHit = false
  const matchedTagSet = new Set()
  let score = 0

  for (const tok of tokens) {
    const textIdx = textLow.indexOf(tok)
    const inText = textIdx !== -1
    let inTag = false
    for (let i = 0; i < tagsLow.length; i++) {
      const idx = tagsLow[i].indexOf(tok)
      if (idx !== -1) {
        inTag = true
        matchedTagSet.add(tags[i])
        score += tagsLow[i] === tok ? 70 : (idx === 0 ? 45 : 30)
      }
    }
    if (!inText && !inTag) {
      return { matched: false, textHit: false, matchedTags: [], score: 0 }
    }
    if (inText) {
      textHit = true
      if (textLow === tok) score += 120
      else if (textIdx === 0) score += 90
      else score += Math.max(25, 65 - Math.min(textIdx, 40))
    }
  }

  // 多词整体连续命中额外加权
  if (tokens.length > 1) {
    const phrase = tokens.join(' ')
    if (textLow.includes(phrase)) score += 35
  }

  return {
    matched: true,
    textHit,
    matchedTags: tags.filter(t => matchedTagSet.has(t)),
    score
  }
}

/** 基于 O(1) byId Map 收集祖先链标题（不含自身），带防环保护。 */
export function ancestorPathText(node, byId, separator = ' › ') {
  if (!node?.parentId || !byId) return ''
  const segs = []
  const visited = new Set([node.id])
  let cur = byId.get(node.parentId) || null
  let guard = 0
  while (cur && !visited.has(cur.id) && guard++ < 200) {
    visited.add(cur.id)
    segs.unshift((cur.text || '').trim() || '未命名节点')
    cur = cur.parentId ? (byId.get(cur.parentId) || null) : null
  }
  return segs.join(separator)
}

/**
 * 执行整库设定检索，返回排序后的命中列表、直接命中集合与包含祖先链的保留集合。
 * @param {Array} live 活跃节点列表
 * @param {Map} byId id -> node 索引
 * @param {string} rawQuery 原始检索词
 */
export function searchLoreNodes(live, byId, rawQuery) {
  const query = String(rawQuery || '').trim()
  const tokens = parseLoreQuery(query)
  const hitIds = new Set()
  const keepIds = new Set()
  if (!tokens.length || !Array.isArray(live)) {
    return { query, tokens, hits: [], hitIds, keepIds }
  }

  const hits = []
  for (let order = 0; order < live.length; order++) {
    const n = live[order]
    if (!n || n.deletedAt) continue
    const m = matchLoreNode(n, tokens)
    if (!m.matched) continue
    hitIds.add(n.id)
    keepIds.add(n.id)
    let cur = n
    let guard = 0
    while (cur?.parentId && guard++ < 200) {
      if (keepIds.has(cur.parentId)) break
      keepIds.add(cur.parentId)
      cur = byId?.get(cur.parentId) || null
    }
    hits.push({
      node: n,
      path: ancestorPathText(n, byId),
      tags: Array.isArray(n.tags) ? n.tags : [],
      matchedTags: m.matchedTags,
      matchedTagSet: new Set(m.matchedTags),
      textHit: m.textHit,
      score: m.score,
      order
    })
  }

  hits.sort((a, b) => (b.score - a.score) || (a.order - b.order))
  return { query, tokens, hits, hitIds, keepIds }
}

/**
 * 将纯文本按词元切分为高亮片段，自动合并重叠/相邻区间，供 Vue 声明式渲染 <mark>。
 * @param {string} text
 * @param {string[]} tokens 小写去重词元数组
 * @returns {Array<{ text: string, mark: boolean }>}
 */
export function highlightSegments(text, tokens) {
  const str = String(text || '')
  if (!str || !tokens?.length) return [{ text: str, mark: false }]
  const low = str.toLowerCase()
  const ranges = []
  for (const tok of tokens) {
    if (!tok) continue
    let from = 0
    while (from < low.length) {
      const idx = low.indexOf(tok, from)
      if (idx === -1) break
      ranges.push([idx, idx + tok.length])
      from = idx + tok.length
    }
  }
  if (!ranges.length) return [{ text: str, mark: false }]
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = [ranges[0]]
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = ranges[i]
    if (cur[0] <= prev[1]) prev[1] = Math.max(prev[1], cur[1])
    else merged.push(cur)
  }
  const out = []
  let pos = 0
  for (const [start, end] of merged) {
    if (start > pos) out.push({ text: str.slice(pos, start), mark: false })
    out.push({ text: str.slice(start, end), mark: true })
    pos = end
  }
  if (pos < str.length) out.push({ text: str.slice(pos), mark: false })
  return out
}
