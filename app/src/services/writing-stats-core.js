import { primaryRole, uniqTags } from './character-tags.js'
import { countWords, stripTags } from './wordcount.js'
import { buildWritingAnalysis } from './writing-analysis-data.js'

export const STATS_TABLES = ['works', 'volumes', 'chapters', 'olnodes', 'mubu', 'lorelinks', 'characters', 'relations', 'snippets', 'wordlog']
const CHAPTER_LABELS = { draft: '草稿', done: '完成', revise: '待修改' }
const EVENT_LABELS = { planned: '待展开', writing: '进行中', done: '已完成', revise: '待修改' }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const identity = (workId, id) => JSON.stringify([workId, id])
const key = row => identity(row.workId, row.id)
const alive = rows => (rows || []).filter(row => row && !row.deletedAt)
const tagsOf = row => uniqTags(Array.isArray(row.tags) ? row.tags : [])
const textOf = (value, fallback) => String(value || '').trim() || fallback

export function chapterWords(row) {
  if (!row) return 0
  // A library-side writer can commit content without refreshing its cached word count.
  if (typeof row.content === 'string') return countWords(row.fmt === 'html' ? stripTags(row.content) : row.content)
  return Number.isFinite(row.wordCount) && row.wordCount >= 0 ? Math.round(row.wordCount) : 0
}

export function chapterWordChange(previous, next) {
  if (!next || next.deletedAt || previous?.deletedAt || (previous && previous.workId !== next.workId)) return 0
  return chapterWords(next) - chapterWords(previous)
}

export function statsDates(today, days) {
  const date = new Date(today + 'T00:00:00Z')
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(date)
    d.setUTCDate(d.getUTCDate() - (days - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}

function histogram(entries, orderedLabels) {
  const counts = new Map((orderedLabels || []).map(label => [label, 0]))
  for (const label of entries) counts.set(label, (counts.get(label) || 0) + 1)
  const rows = [...counts].map(([label, value]) => ({ id: label, label, value }))
  return orderedLabels ? rows : rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN'))
}

function ancestors(row, index) {
  const result = [], seen = new Set([row.id])
  for (let id = row.parentId; id && !seen.has(id); ) {
    const parent = index.get(identity(row.workId, id))
    if (!parent) break
    result.push(parent)
    seen.add(id)
    id = parent.parentId
  }
  return result
}

export function buildWritingStats(source, { workId = null, days = 30, today } = {}) {
  const works = alive(source.works).filter(w => workId == null || w.id === workId)
  const workNames = new Map(works.map(w => [w.id, textOf(w.title, '未命名作品')]))
  const workLabel = row => workNames.get(row.workId)
  const current = table => alive(source[table]).filter(row => workNames.has(row.workId))
  const chapters = current('chapters')
  const volumes = new Map(current('volumes').map(row => [key(row), row]))
  const volumeFor = row => volumes.get(identity(row.workId, row.volumeId))
  const workOrder = new Map(works.map((row, i) => [row.id, i]))
  const volumeOrder = row => volumeFor(row) ? Number(volumeFor(row).sortOrder) || 0 : Number.MAX_SAFE_INTEGER
  chapters.sort((a,b) => workOrder.get(a.workId)-workOrder.get(b.workId) || volumeOrder(a)-volumeOrder(b) || (a.sortOrder || 0)-(b.sortOrder || 0) || a.id.localeCompare(b.id))
  const byVolume = new Map(), byWork = new Map(works.map(w => [w.id, { id: w.id, label: workNames.get(w.id), words: 0, chapters: 0 }]))
  const chapterRows = chapters.map(row => {
    const words = chapterWords(row), volume = volumeFor(row)
    const book = byWork.get(row.workId)
    book.words += words; book.chapters++
    const id = identity(row.workId, volume?.id || null)
    if (!byVolume.has(id)) byVolume.set(id, { id, label: volume ? textOf(volume.title, '未命名卷') : '未分卷', work: book.label, value: 0 })
    byVolume.get(id).value += words
    return { id: key(row), label: textOf(row.title, '未命名章节'), work: book.label, volume: volume ? textOf(volume.title, '未命名卷') : '未分卷', words, status: CHAPTER_LABELS[row.status || 'draft'] || '未标记' }
  })
  const workRows = [...byWork.values()].sort((a,b) => b.words-a.words)
  const logs = new Map()
  for (const row of current('wordlog')) {
    if (!DATE.test(row.date) || !Number.isFinite(row.delta) || !row.delta) continue
    logs.set(row.date, (logs.get(row.date) || 0) + row.delta)
  }
  const timeline = length => statsDates(today, length).map(date => ({ date, net: logs.get(date) || 0, active: logs.has(date) }))
  const daily = timeline(days)
  const week = timeline(7)

  const outline = current('olnodes'), outlineIndex = new Map(outline.map(row => [key(row), row]))
  const events = outline.filter(row => row.kind === 'event')
  const containers = new Map(outline.filter(row => row.kind === 'container').map(row => [key(row), { id: row.id, key: key(row), label: textOf(row.title || row.text, '未命名容器'), work: workLabel(row), done: 0, total: 0 }]))
  const unassigned = new Map()
  for (const event of events) {
    const groups = ancestors(event, outlineIndex).map(row => containers.get(key(row))).filter(Boolean)
    if (!groups.length) {
      if (!unassigned.has(event.workId)) unassigned.set(event.workId, { id: 'unassigned', key: identity(event.workId, null), label: '未分组事件', work: workLabel(event), done: 0, total: 0 })
      groups.push(unassigned.get(event.workId))
    }
    for (const group of groups) {
      group.total++
      if (event.status === 'done') group.done++
    }
  }

  const lore = current('mubu'), loreIndex = new Map(lore.map(row => [key(row), row]))
  const branches = new Map()
  for (const row of lore) {
    const chain = [row, ...ancestors(row, loreIndex)]
    const candidate = chain.at(-1)
    const root = candidate.parentId ? null : candidate
    const id = identity(row.workId, root?.id || null)
    if (!branches.has(id)) branches.set(id, { id, label: root ? textOf(root.text, '未命名节点') : '未归入根节点', work: workLabel(row), value: 0 })
    branches.get(id).value++
  }

  const characters = current('characters'), charIds = new Set(characters.map(key)), connected = new Set()
  const relationships = current('relations').filter(row => {
    const a = identity(row.workId, row.fromId), b = identity(row.workId, row.toId)
    if (!charIds.has(a) || !charIds.has(b)) return false
    connected.add(a); connected.add(b)
    return true
  })
  const endpoint = (workId, kind, id) => kind === 'mubu' ? loreIndex.has(identity(workId, id)) : kind === 'character' && charIds.has(identity(workId, id))
  const loreRelations = current('lorelinks').filter(row => endpoint(row.workId, row.fromKind, row.fromId) && endpoint(row.workId, row.toKind, row.toId))
  const snippets = current('snippets')
  return {
    analysis: buildWritingAnalysis(source, { workId, today }),
    works: workRows,
    totalWords: workRows.reduce((sum, row) => sum + row.words, 0),
    chapterCount: chapters.length,
    daily, week, todayNet: week.at(-1).net, todayActive: week.at(-1).active,
    hasHistory: daily.some(d => d.active), activeDays: daily.filter(d => d.active).length,
    chapters: { rows: chapterRows, volumes: [...byVolume.values()], statuses: histogram(chapterRows.map(row => row.status), Object.values(CHAPTER_LABELS)) },
    outline: { events: events.length, statuses: histogram(events.map(row => EVENT_LABELS[row.status] || EVENT_LABELS.planned), Object.values(EVENT_LABELS)), groups: [...containers.values(), ...unassigned.values()] },
    lore: { total: lore.length, branches: [...branches.values()].sort((a,b) => b.value-a.value), tagged: lore.filter(row => tagsOf(row).length).length, relationships: loreRelations.length },
    characters: { total: characters.length, roles: histogram(characters.map(row => primaryRole(row) || '未标记')), relationships: relationships.length, isolated: characters.length - connected.size },
    snippets: {
      total: snippets.length, tagged: snippets.filter(row => tagsOf(row).length).length, tags: histogram(snippets.flatMap(tagsOf)),
      recent: [...snippets].filter(row => Number.isFinite(row.createdAt) && row.createdAt > 0).sort((a,b) => b.createdAt-a.createdAt).slice(0,8).map(row => ({
        id: key(row), label: textOf(row.content, '空白灵感').replace(/\s+/g, ' ').slice(0,80), work: workLabel(row), at: row.createdAt
      }))
    }
  }
}

export function createStatsLoader(read) {
  let version = 0
  return {
    invalidate() { version++ },
    async read(...args) {
      const request = ++version
      try {
        const value = await read(...args)
        return request === version ? { value } : null
      } catch (error) {
        return request === version ? { error } : null
      }
    }
  }
}
