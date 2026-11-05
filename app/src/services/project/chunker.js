import { hashContent, tokens } from './text.js'

export const CHUNKER_VERSION = 1
function units(text) {
  const out = []
  let start = 0
  // Keep delimiters and whitespace in the core, so ranges exactly cover the input.
  for (const match of text.matchAll(/[。！？!?；;](?:[”’"']*)|\n+/gu)) {
    const end = match.index + match[0].length
    out.push({ start, end }); start = end
  }
  if (start < text.length) out.push({ start, end: text.length })
  return out
}
function cut(text, start, end, budget) {
  let cost = 0, at = start
  for (const ch of text.slice(start, end)) {
    const n = ch.codePointAt(0) > 0x2e7f ? 1 : 0.25
    if (cost + n > budget) break
    cost += n; at += ch.length
  }
  return at
}
export function chunkText(text, { budget = 640, overlap = 96, docId = 'document', paragraphs = [] } = {}) {
  budget = Math.floor(Number(budget))
  if (!Number.isFinite(budget) || budget < 4) throw new Error('分块预算至少为 4')
  overlap = Math.max(0, Math.min(Math.floor(Number(overlap) || 0), Math.floor(budget / 3)))
  const coreBudget = budget - overlap, ranges = [], input = units(text)
  for (const unit of input) {
    let start = unit.start
    while (start < unit.end) {
      const end = cut(text, start, unit.end, coreBudget)
      const last = ranges.at(-1)
      if (last && last.end === start && tokens(text.slice(last.start, end)) <= coreBudget) last.end = end
      else ranges.push({ start, end })
      start = end
    }
  }
  const duplicates = new Map()
  return ranges.map(({ start, end }, idx) => {
    let contextStart = start
    if (overlap && idx) {
      const prefix = []
      for (const ch of [...text.slice(ranges[idx - 1].start, start)].reverse()) {
        if (tokens(ch + prefix.join('')) > overlap) break
        prefix.unshift(ch); contextStart -= ch.length
      }
    }
    const core = text.slice(start, end), hash = hashContent(text.slice(contextStart, end))
    const paragraphIds = paragraphs.filter((p) => p.start < end && p.end > start).map((p) => p.id)
    const identity = hashContent(JSON.stringify([paragraphIds, hashContent(core), CHUNKER_VERSION]))
    const occurrence = duplicates.get(identity) || 0; duplicates.set(identity, occurrence + 1)
    return { id: 'chunk:' + docId + ':' + identity + ':' + occurrence, docId, idx, text: text.slice(contextStart, end),
      coreStart: start, coreEnd: end, contextStart, headLen: start - contextStart, offset: start,
      paragraphIds, hash, tokenEstimate: tokens(text.slice(contextStart, end)), chunkerVersion: CHUNKER_VERSION }
  })
}

export function paragraphRanges(text, previous = []) {
  const old = new Map()
  for (const p of previous) {
    if (!old.has(p.hash)) old.set(p.hash, [])
    old.get(p.hash).push(p)
  }
  const occurrences = new Map(), out = []
  for (const match of text.matchAll(/[^\n]+(?:\n+|$)/g)) {
    const hash = hashContent(match[0]), n = occurrences.get(hash) || 0
    occurrences.set(hash, n + 1)
    out.push({ id: old.get(hash)?.[n]?.id || 'p:' + hash + ':' + n, hash, start: match.index, end: match.index + match[0].length })
  }
  return out
}
