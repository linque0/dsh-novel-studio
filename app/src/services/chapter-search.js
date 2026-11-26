/**
 * 正文全文检索纯逻辑内核（ChapterTree 左侧检索列表与 EditorPane 章内高亮共用）。
 * 支持全书卷/章序排列、纯文本增量缓存、空格多词 AND 组合、人物别名一键扩展、
 * 上下文摘录提取（附精确 occurrenceIndex）以及无 XSS 的高亮区间切分。
 */
import { stripTags } from './wordcount.js'
import { aliasesOf } from './character-tags.js'

const plainCache = new WeakMap()

/** 提取章节纯文本并按 (content, fmt) 引用缓存，未改动章节零重复剥离。 */
export function chapterPlainText(chapter) {
  if (!chapter) return ''
  const raw = String(chapter.content || '')
  const fmt = chapter.fmt || 'html'
  const cached = plainCache.get(chapter)
  if (cached && cached.raw === raw && cached.fmt === fmt) return cached.plain
  const plain = fmt === 'html' ? stripTags(raw) : raw
  plainCache.set(chapter, { raw, fmt, plain })
  return plain
}

/** 拆分为去重小写词元（空格分隔）。 */
export function parseChapterQuery(raw) {
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
 * 检查搜索词是否匹配人物库中带别名的角色（命中本名或任一别名）。
 * 支持单关键词（如「林砚」或「老林」），或多词中的首词精准命中人物名。
 * 返回 { characterId, name, matchedTerm, extraTerms, allTerms } 或 null。
 */
export function findCharacterAliasSuggestion(rawQuery, characters = []) {
  const tokens = parseChapterQuery(rawQuery)
  if (!tokens.length || !Array.isArray(characters) || !characters.length) return null
  for (const c of characters) {
    if (!c || c.deletedAt) continue
    const name = String(c.name || '').trim()
    if (!name) continue
    const aliases = aliasesOf(c).map(s => String(s || '').trim()).filter(Boolean)
    if (!aliases.length) continue
    const allDisplay = []
    const seenLow = new Set()
    for (const term of [name, ...aliases]) {
      const low = term.toLowerCase()
      if (!low || seenLow.has(low)) continue
      seenLow.add(low)
      allDisplay.push(term)
    }
    if (allDisplay.length < 2) continue
    const matchedIdx = tokens.findIndex(tok => seenLow.has(tok))
    if (matchedIdx === -1) continue
    const matchedTok = tokens[matchedIdx]
    const extraTerms = allDisplay.filter(t => t.toLowerCase() !== matchedTok)
    if (!extraTerms.length) continue
    return {
      characterId: c.id,
      name,
      matchedToken: matchedTok,
      extraTerms,
      allTerms: allDisplay
    }
  }
  return null
}

/** 在文本中查找词组的所有命中区间（长词优先，自动去重叠并按 start 升序）。 */
export function findTermOccurrences(text, terms) {
  const str = String(text || '')
  if (!str || !terms?.length) return []
  const cleanTerms = [...new Set(terms.map(t => String(t || '').trim().toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  if (!cleanTerms.length) return []
  const low = str.toLowerCase()
  const raw = []
  for (const term of cleanTerms) {
    let from = 0
    while (from < low.length) {
      const idx = low.indexOf(term, from)
      if (idx === -1) break
      raw.push({ start: idx, end: idx + term.length, term })
      from = idx + term.length
    }
  }
  if (!raw.length) return []
  // 按起点升序，同起点按更长词优先，过滤重叠区间
  raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const out = []
  let lastEnd = -1
  for (const item of raw) {
    if (item.start < lastEnd) continue
    out.push(item)
    lastEnd = item.end
  }
  return out
}

/** 从正文与命中位置中抽取最多 maxCount 条互不重叠的干净上下文摘录。 */
export function buildExcerpts(plain, occurrences, maxCount = 2) {
  if (!plain || !occurrences.length) return []
  const excerpts = []
  let coveredUntil = -1
  for (let i = 0; i < occurrences.length && excerpts.length < maxCount; i++) {
    const occ = occurrences[i]
    if (occ.start < coveredUntil) continue
    const winStart = Math.max(0, occ.start - 14)
    const winEnd = Math.min(plain.length, occ.end + 28)
    // 尽量不跨越整段空行
    const rawSlice = plain.slice(winStart, winEnd)
    const clean = rawSlice.replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const prefix = winStart > 0 ? '…' : ''
    const suffix = winEnd < plain.length ? '…' : ''
    excerpts.push({
      text: `${prefix}${clean}${suffix}`,
      occurrenceIndex: i
    })
    coveredUntil = occ.end + 22
  }
  return excerpts
}

/** 按全书卷序与章序展开所有活跃章节（未分卷章排在最后，与 work.treeData 一致）。 */
function orderedChapters(volumes = [], chapters = []) {
  const liveVols = (volumes || [])
    .filter(v => v && !v.deletedAt)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const volMap = new Map(liveVols.map(v => [v.id, v]))
  const liveChaps = (chapters || [])
    .filter(c => c && !c.deletedAt)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  const byVol = new Map()
  const orphans = []
  for (const c of liveChaps) {
    if (c.volumeId && volMap.has(c.volumeId)) {
      if (!byVol.has(c.volumeId)) byVol.set(c.volumeId, [])
      byVol.get(c.volumeId).push(c)
    } else {
      orphans.push(c)
    }
  }

  const out = []
  let ordinal = 0
  for (const v of liveVols) {
    for (const c of byVol.get(v.id) || []) {
      out.push({ chapter: c, volumeTitle: v.title || '', ordinal: ++ordinal })
    }
  }
  for (const c of orphans) {
    out.push({ chapter: c, volumeTitle: '', ordinal: ++ordinal })
  }
  return out
}

/**
 * 执行全书正文 + 标题联合检索（按全书章节先后排序）。
 */
export function searchChapters({
  volumes = [],
  chapters = [],
  query = '',
  aliasSuggestion = null,
  includeAliases = false,
  bookmarkedIds = null
} = {}) {
  const cleanQuery = String(query || '').trim()
  const tokens = parseChapterQuery(cleanQuery)
  if (!tokens.length) {
    return { query: cleanQuery, tokens: [], highlightTerms: [], results: [], totalHits: 0 }
  }

  const useAlias = Boolean(includeAliases && aliasSuggestion?.allTerms?.length > 1)
  const aliasGroupLow = useAlias
    ? [...new Set(aliasSuggestion.allTerms.map(t => t.toLowerCase()).filter(Boolean))]
    : []
  const requiredTokens = useAlias
    ? tokens.filter(tok => tok !== aliasSuggestion.matchedToken)
    : tokens
  const highlightTerms = useAlias
    ? [...new Set([...aliasGroupLow, ...requiredTokens])]
    : tokens

  const ordered = orderedChapters(volumes, chapters)
  const results = []
  let totalHits = 0

  for (const { chapter, volumeTitle, ordinal } of ordered) {
    const title = String(chapter.title || '未命名章节')
    const plain = chapterPlainText(chapter)
    const volLow = volumeTitle.toLowerCase()
    const titleLow = title.toLowerCase()
    const plainLow = plain.toLowerCase()
    const combinedLow = `${volLow}\n${titleLow}\n${plainLow}`

    // 校验所有必选词元
    let allRequiredOk = true
    for (const tok of requiredTokens) {
      if (!combinedLow.includes(tok)) {
        allRequiredOk = false
        break
      }
    }
    if (!allRequiredOk) continue

    // 别名扩展模式：本名或任一别名至少命中其一
    if (useAlias && !aliasGroupLow.some(term => combinedLow.includes(term))) continue

    const titleHit = highlightTerms.some(term => titleLow.includes(term))
    const volumeHit = Boolean(volumeTitle && highlightTerms.some(term => volLow.includes(term)))
    const occurrences = findTermOccurrences(plain, highlightTerms)
    const bodyHitCount = occurrences.length
    if (!bodyHitCount && !titleHit && !volumeHit) continue

    totalHits += bodyHitCount
    results.push({
      chapterId: chapter.id,
      chapter,
      ordinal,
      title,
      volumeTitle,
      bookmarked: Boolean(bookmarkedIds?.has?.(chapter.id)),
      titleHit,
      volumeHit,
      bodyHitCount,
      excerpts: buildExcerpts(plain, occurrences, 2)
    })
  }

  return {
    query: cleanQuery,
    tokens,
    highlightTerms,
    results,
    totalHits
  }
}

/**
 * 将纯文本按词组切分为高亮片段（长词优先、合并重叠区间），供 Vue 声明式渲染 <mark>。
 */
export function highlightChapterSegments(text, terms) {
  const str = String(text || '')
  if (!str || !terms?.length) return [{ text: str, mark: false }]
  const occurrences = findTermOccurrences(str, terms)
  if (!occurrences.length) return [{ text: str, mark: false }]
  const out = []
  let pos = 0
  for (const { start, end } of occurrences) {
    if (start > pos) out.push({ text: str.slice(pos, start), mark: false })
    out.push({ text: str.slice(start, end), mark: true })
    pos = end
  }
  if (pos < str.length) out.push({ text: str.slice(pos), mark: false })
  return out
}

/**
 * 在 ProseMirror / TipTap 编辑器根 DOM 内收集所有命中词的精确 DOM Range。
 * 按块级元素逐段拼接文本节点，支持跨行内标记（如加粗/变色/批注 span 拆词）精准匹配，
 * 且不在不同段落之间产生跨段误拼。
 */
export function collectProseMatchRanges(rootEl, terms) {
  if (!rootEl || !terms?.length || typeof document === 'undefined') return []
  const cleanTerms = [...new Set(terms.map(t => String(t || '').trim().toLowerCase()).filter(Boolean))]
  if (!cleanTerms.length) return []

  const blocks = []
  const walkBlocks = (parent) => {
    for (const child of parent.children || []) {
      const tag = child.tagName
      if (tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE') walkBlocks(child)
      else blocks.push(child)
    }
  }
  walkBlocks(rootEl)
  if (!blocks.length) blocks.push(rootEl)

  const ranges = []
  for (const block of blocks) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const segs = []
    let full = ''
    let node
    while ((node = walker.nextNode())) {
      const val = node.nodeValue || ''
      if (!val) continue
      const start = full.length
      full += val
      segs.push({ node, start, end: full.length })
    }
    if (!full) continue
    const occs = findTermOccurrences(full, cleanTerms)
    if (!occs.length) continue
    let sIdx = 0
    for (const occ of occs) {
      while (sIdx < segs.length && segs[sIdx].end <= occ.start) sIdx++
      if (sIdx >= segs.length) break
      const startSeg = segs[sIdx]
      let eIdx = sIdx
      while (eIdx < segs.length && segs[eIdx].end < occ.end) eIdx++
      if (eIdx >= segs.length) break
      const endSeg = segs[eIdx]
      try {
        const range = document.createRange()
        range.setStart(startSeg.node, occ.start - startSeg.start)
        range.setEnd(endSeg.node, occ.end - endSeg.start)
        ranges.push(range)
      } catch {
        // 节点瞬时变动时安全跳过
      }
    }
  }
  return ranges
}
