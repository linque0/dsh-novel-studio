/**
 * 关系星系数据组装器（lorePlanetData）：
 * 将幕布设定节点按顶层根归组为恒星系（sets）与行星（nodes），
 * 并汇集显式关联关系（lorelinks）及跨模块（人物/大纲/画布/正文/灵感）双向引用作为卫星节点（satellites）。
 */
import { entryCircleGlyphs } from './entry-circles.js'
import { referenceTargets } from '../../../services/lore-core.js'
import { characterBiographyText } from '../../../services/character-biographies.js'
import { doublelinkTitle } from '../../../services/doublelink-titles.js'
import { stripTags } from '../../../services/wordcount.js'
import { resolveEntryWeight } from '../../../services/lore-weights.js'

// Scheme B · 引力势阱与晶体星座冷色星域色板
const colors = ['#47D7E8', '#8CB4FF', '#B6A6FF', '#F2CF9C', '#EBA99E', '#7CE6C8']

const MODULE_KIND_LABEL = {
  character: '人物',
  outline: '大纲',
  olnode: '画布',
  chapter: '正文',
  snippet: '灵感'
}

const DEFAULT_INCOMING_REL = {
  character: '人物引用',
  outline: '大纲引用',
  olnode: '画布引用',
  chapter: '正文提及',
  snippet: '灵感提及'
}

function summarize(raw, max = 140) {
  const plain = stripTags(String(raw || '')).replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  return plain.length > max ? plain.slice(0, max) + '…' : plain
}

function parseExplicitTarget(str) {
  const m = String(str || '').match(/^(chapter|mubu|character|outline|olnode|snippet):([^<>\s]+)$/)
  return m ? { kind: m[1], id: m[2] } : null
}

function outlineTitle(refId, extras) {
  const workLike = {
    work: extras.work,
    volumes: extras.volumes || [],
    chapters: extras.chapters || []
  }
  return doublelinkTitle('outline', { id: refId }, workLike) || '大纲'
}

export function lorePlanetData(entries = [], relationships = [], characters = [], extras = {}) {
  const live = new Map(entries.map(entry => [entry.id, entry]))
  const rootIds = new Map()
  for (const entry of entries) {
    const path = new Set()
    let cursor = entry
    while (cursor && !path.has(cursor.id) && !rootIds.has(cursor.id)) {
      path.add(cursor.id)
      if (!cursor.parentId) break
      cursor = live.get(cursor.parentId)
    }
    const root = cursor && (rootIds.get(cursor.id) || (!cursor.parentId && cursor.id)) || null
    for (const id of path) rootIds.set(id, root)
  }

  const sets = [], nodes = [], links = [], satellites = []
  const mubuTargets = []
  const workLike = {
    mubu: entries,
    characters,
    volumes: extras.volumes || [],
    chapters: extras.chapters || [],
    snippets: extras.snippets || [],
    work: extras.work
  }

  for (const entry of entries) {
    const setId = rootIds.get(entry.id)
    if (!setId) continue
    const summary = String(entry.text || '').trim()
    const title = summary.split('\n')[0] || '未命名节点'
    const glyphs = entryCircleGlyphs(summary || title)
    const tags = Array.isArray(entry.tags) ? entry.tags.map(t => String(t || '').trim()).filter(Boolean) : []
    const weight = resolveEntryWeight(entry, extras.tagMeta)
    const item = { id: entry.id, title, summary, glyphs, tags, weight, createdAt: entry.createdAt }
    if (entry.id === setId) sets.push({ ...item, color: colors[sets.length % colors.length] })
    else nodes.push({ ...item, setId, parentId: entry.parentId })
    mubuTargets.push({ kind: 'mubu', id: entry.id, title: doublelinkTitle('mubu', entry, workLike) || title })
  }

  const moduleTargetMap = new Map()
  const externalSources = []

  const people = new Map()
  for (const person of characters || []) {
    if (!person || person.deletedAt) continue
    people.set(person.id, person)
    const title = person.name || '未命名人物'
    const bio = characterBiographyText(person)
    const target = {
      kind: 'character',
      kindLabel: MODULE_KIND_LABEL.character,
      id: person.id,
      title,
      summary: summarize(bio || person.aliases)
    }
    moduleTargetMap.set(`character:${person.id}`, target)
    if (bio) {
      externalSources.push({
        kind: 'character',
        id: person.id,
        title,
        text: bio,
        html: /<[^>]+>/.test(bio) ? bio : '',
        target
      })
    }
  }

  for (const o of extras.outlines || []) {
    if (!o || o.deletedAt) continue
    const title = outlineTitle(o.refId, extras)
    const raw = String(o.content || '')
    const target = {
      kind: 'outline',
      kindLabel: MODULE_KIND_LABEL.outline,
      id: o.refId,
      title,
      summary: summarize(raw)
    }
    moduleTargetMap.set(`outline:${o.refId}`, target)
    if (raw) {
      externalSources.push({
        kind: 'outline',
        id: o.refId,
        title,
        text: raw,
        html: /<[^>]+>/.test(raw) ? raw : '',
        target
      })
    }
  }

  for (const n of extras.olnodes || []) {
    if (!n || n.deletedAt) continue
    const explicit = n.kind === 'cite' ? parseExplicitTarget(n.refId) : null
    const rawText = String(n.text || '')
    let title = rawText.split('\n')[0]?.trim().slice(0, 32) || ''
    if (!title && explicit?.kind === 'mubu') {
      const cited = live.get(explicit.id)
      title = (cited?.text || '').split('\n')[0]?.trim().slice(0, 28) || '画布设定卡'
    }
    if (!title) title = '大纲画布节点'
    const target = {
      kind: 'olnode',
      kindLabel: MODULE_KIND_LABEL.olnode,
      id: n.id,
      title,
      summary: summarize(rawText || (explicit ? `画布引用卡 · ${title}` : ''))
    }
    moduleTargetMap.set(`olnode:${n.id}`, target)
    const html = explicit ? `<span data-dl-target="${explicit.kind}:${explicit.id.replace(/["<>]/g, '')}"></span>` : ''
    if (html || rawText) {
      externalSources.push({
        kind: 'olnode',
        id: n.id,
        title,
        text: rawText,
        html,
        target
      })
    }
  }

  for (const c of extras.chapters || []) {
    if (!c || c.deletedAt) continue
    const raw = String(c.content || '')
    const title = c.title || '未命名章节'
    const target = {
      kind: 'chapter',
      kindLabel: MODULE_KIND_LABEL.chapter,
      id: c.id,
      title,
      summary: summarize(raw)
    }
    moduleTargetMap.set(`chapter:${c.id}`, target)
    if (raw) {
      externalSources.push({
        kind: 'chapter',
        id: c.id,
        title,
        text: c.fmt === 'text' ? raw : stripTags(raw),
        html: c.fmt === 'text' ? '' : raw,
        target
      })
    }
  }

  for (const s of extras.snippets || []) {
    if (!s || s.deletedAt) continue
    const raw = String(s.content || '')
    const title = doublelinkTitle('snippet', s, workLike) || '灵感记录'
    const target = {
      kind: 'snippet',
      kindLabel: MODULE_KIND_LABEL.snippet,
      id: s.id,
      title,
      summary: summarize(raw)
    }
    moduleTargetMap.set(`snippet:${s.id}`, target)
    if (raw) {
      externalSources.push({
        kind: 'snippet',
        id: s.id,
        title,
        text: raw,
        html: /<[^>]+>/.test(raw) ? raw : '',
        target
      })
    }
  }

  const seenSatellites = new Map()
  function pushSatellite(nodeId, target, { id, label, description, direction } = {}) {
    if (!rootIds.get(nodeId) || !target?.id || !target.kind) return
    const dedupKey = `${nodeId}::${target.kind}:${target.id}`
    const existing = seenSatellites.get(dedupKey)
    if (existing) {
      if (!existing.description && description) existing.description = description
      if ((!existing.label || existing.label === DEFAULT_INCOMING_REL[target.kind]) && label) existing.label = label
      return
    }
    const sat = {
      id: id || `sat:${nodeId}:${target.kind}:${target.id}`,
      nodeId,
      target,
      label: label || DEFAULT_INCOMING_REL[target.kind] || '关联',
      description: description || '',
      direction: direction || 'incoming'
    }
    seenSatellites.set(dedupKey, sat)
    satellites.push(sat)
  }

  // 1. 显式手动关联关系（mubu <-> mubu | character）
  for (const relation of relationships || []) {
    const fromLore = relation.fromKind === 'mubu'
    const toLore = relation.toKind === 'mubu'
    if (fromLore && toLore) {
      if (rootIds.get(relation.fromId) && rootIds.get(relation.toId)) {
        links.push({
          id: relation.id,
          from: relation.fromId,
          to: relation.toId,
          label: relation.label,
          reverseLabel: relation.reverseLabel,
          description: relation.description
        })
      }
    } else if (fromLore || toLore) {
      const owner = fromLore ? relation.fromId : relation.toId
      const targetId = fromLore ? relation.toId : relation.fromId
      const person = people.get(targetId)
      if (!rootIds.get(owner) || !person) continue
      const target = moduleTargetMap.get(`character:${person.id}`) || {
        kind: 'character',
        kindLabel: '人物',
        id: person.id,
        title: person.name || '未命名人物'
      }
      pushSatellite(owner, target, {
        id: relation.id,
        label: (toLore && relation.reverseLabel) || relation.label || '人物关联',
        description: relation.description,
        direction: 'relation'
      })
    }
  }

  // 2. 跨模块传入引用（人物小传 / 总纲卷纲章纲 / 大纲画布节点 / 正文 / 灵感 -> 设定）
  for (const src of externalSources) {
    for (const hit of referenceTargets(src, mubuTargets)) {
      if (hit.kind !== 'mubu' || !rootIds.has(hit.id)) continue
      pushSatellite(hit.id, src.target, {
        label: DEFAULT_INCOMING_REL[src.kind],
        direction: 'incoming'
      })
    }
  }

  // 3. 设定条目的主动向外引用（设定 -> 人物 / 大纲 / 画布 / 正文 / 灵感）
  const allModuleTargets = [...moduleTargetMap.values()]
  if (allModuleTargets.length) {
    for (const entry of entries) {
      if (!rootIds.has(entry.id)) continue
      if (!entry.html && !String(entry.text || '').includes('[[')) continue
      for (const hit of referenceTargets({ html: entry.html, text: entry.text }, allModuleTargets)) {
        const target = moduleTargetMap.get(`${hit.kind}:${hit.id}`)
        if (!target) continue
        pushSatellite(entry.id, target, {
          label: `${target.kindLabel || '跨模块'}互链`,
          direction: 'outgoing'
        })
      }
    }
  }

  return { sets, nodes, links, satellites }
}
