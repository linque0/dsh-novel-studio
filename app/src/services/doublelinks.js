/* 多模块内容互联（关系链接）：目标检索 / 预览内容 / 跳转 / 令牌解析（共享服务，无副作用）
 * 标签形态：
 *  - 富文本（正文 TipTap、设定幕布）：<span class="dl-link" data-dl-target="kind:id" data-dl-title="标题">选中文字</span>
 *  - 纯文本（大纲 / 人物小传 / 灵感）：[[标题]] 或 [[标题|显示文字]] 令牌
 * 目标模型：kind = chapter 章节 | mubu 设定节点 | character 人物 | outline 大纲 | snippet 灵感
 */
import { Mark } from '@tiptap/core'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { stripTags } from './wordcount'
import { primaryRole } from './character-tags'
import { doublelinkTitle } from './doublelink-titles.js'

export const KIND_LABEL = { chapter: '正文', mubu: '设定', character: '人物', outline: '大纲', snippet: '灵感' }

/* ---------- TipTap 关系链接标记：正文中的关系链接以标签样式渲染并携带目标 ---------- */
export const DlLinkMark = Mark.create({
  name: 'dlLink',
  inclusive: false, // 光标贴边续写不连带成链接
  addAttributes() {
    return {
      target: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-dl-target'),
        renderHTML: (a) => (a.target ? { 'data-dl-target': a.target } : {})
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-dl-title') || '',
        renderHTML: (a) => ({ 'data-dl-title': a.title || '' })
      }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-dl-target]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'dl-link', ...HTMLAttributes }, 0]
  }
})

/* ---------- 大纲条目标签（总纲 / 卷纲 · X / 章纲 · X） ---------- */
export function outlineLabel(refId) {
  const work = useWorkStore()
  if (!work.work) return ''
  return doublelinkTitle('outline',{id:refId},work)
}

/* ---------- 全库可链接目标检索：标题或内容命中关键词，内容命中附选段 ---------- */

/** 关键词在文本中的命中选段（前后留窗口），未命中返回空串 */
function excerptOf(text, q, win = 26) {
  if (!q) return ''
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const i = t.toLowerCase().indexOf(q)
  if (i < 0) return ''
  const start = Math.max(0, i - win)
  const end = Math.min(t.length, i + q.length + win * 2)
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '')
}

export function searchTargets(query, limit = 40) {
  const work = useWorkStore()
  const q = (query || '').trim().toLowerCase()
  const out = []
  const outlineBody = (refId) => {
    const o = work.outlines.find((x) => x.refId === refId && !x.deletedAt)
    return o ? o.content || '' : ''
  }
  const push = (kind, id, title, extra, body) => {
    const viaTitle = !q || String(title || '').toLowerCase().includes(q)
    const ex = q ? excerptOf(body, q) : ''
    if (!viaTitle && !ex) return
    out.push({ kind, id, title, extra, excerpt: ex, viaTitle })
  }
  for (const c of work.liveChapters) {
    push('chapter', c.id, c.title || '未命名章节', `正文 · ${c.wordCount || 0}字`, stripTags(c.content))
  }
  for (const n of work.liveMubu()) {
    push('mubu', n.id, doublelinkTitle('mubu',n,work), '设定', n.text)
  }
  for (const c of work.liveCharacters) {
    push('character', c.id, c.name || '未命名', `人物${primaryRole(c) ? ' · ' + primaryRole(c) : ''}`, (c.content || '') + ' ' + (c.aliases || ''))
  }
  if (work.work) push('outline', work.work.id, '总纲', '大纲', outlineBody(work.work.id))
  for (const v of work.liveVolumes) {
    push('outline', v.id, '卷纲 · ' + v.title, '大纲', outlineBody(v.id))
  }
  for (const c of work.liveChapters) {
    push('outline', c.id, '章纲 · ' + c.title, '大纲', outlineBody(c.id))
  }
  for (const s of work.liveSnippets) {
    push('snippet', s.id, doublelinkTitle('snippet',s,work), '灵感', s.content)
  }
  // 标题命中优先（稳定排序，保持模块内顺序）
  if (q) out.sort((a, b) => (b.viaTitle ? 1 : 0) - (a.viaTitle ? 1 : 0))
  return out.slice(0, limit)
}

/** 选段 HTML：先转义再对关键词包 mark（防注入） */
export function highlightExcerpt(excerpt, keyword) {
  const esc = (s) =>
    String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const e = esc(excerpt)
  const q = String(keyword || '').trim()
  if (!e || !q) return e
  const eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return e.replace(new RegExp(eq, 'gi'), (m) => '<mark>' + m + '</mark>')
  } catch {
    return e
  }
}

/** 按 kind:id 精确取目标（已删除则返回 null） */
export function targetById(kind, id) {
  if (!kind || !id) return null
  const work = useWorkStore()
  if (kind === 'chapter') {
    const c = work.liveChapters.find((x) => x.id === id)
    return c ? { kind, id, title: c.title || '未命名章节', extra: `正文 · ${c.wordCount || 0}字` } : null
  }
  if (kind === 'mubu') {
    const n = work.mubu.find((x) => x.id === id && !x.deletedAt)
    return n ? { kind, id, title: doublelinkTitle('mubu',n,work), extra: '设定' } : null
  }
  if (kind === 'character') {
    const c = work.liveCharacters.find((x) => x.id === id)
    return c ? { kind, id, title: c.name || '未命名', extra: `人物${primaryRole(c) ? ' · ' + primaryRole(c) : ''}` } : null
  }
  if (kind === 'outline') {
    const lb = outlineLabel(id)
    return lb ? { kind, id, title: lb, extra: '大纲' } : null
  }
  if (kind === 'snippet') {
    const s = work.liveSnippets.find((x) => x.id === id)
    return s ? { kind, id, title: doublelinkTitle('snippet',s,work), extra: '灵感' } : null
  }
  return null
}

/** 解析 "kind:id" 字符串 */
export function parseTarget(str) {
  const m = String(str || '').match(/^(\w+):(.+)$/)
  return m ? { kind: m[1], id: m[2] } : null
}

/** 按标题在全库解析目标（纯文本令牌用）：先精确后包含 */
export function findByTitle(title) {
  const t = String(title || '').trim().toLowerCase()
  if (!t) return null
  const all = searchTargets('', 400)
  return all.find((x) => x.title.toLowerCase() === t) || all.find((x) => x.title.toLowerCase().includes(t)) || null
}

/* ---------- 目标预览内容（悬浮窗用） ---------- */
export function previewFor(target) {
  if (!target) return null
  const work = useWorkStore()
  const cut = (s, n = 900) => {
    const t = String(s || '').trim()
    return t.length > n ? t.slice(0, n) + '…' : t
  }
  if (target.kind === 'chapter') {
    const c = work.chapters.find((x) => x.id === target.id && !x.deletedAt)
    if (!c) return null
    const vol = work.volumes.find((v) => v.id === c.volumeId)
    return {
      kindLabel: '正文',
      title: c.title || '未命名章节',
      meta: [vol?.title, `${c.wordCount || 0}字`].filter(Boolean).join(' · '),
      body: cut(c.fmt === 'html' ? stripTags(c.content) : c.content) || '（暂无内容）'
    }
  }
  if (target.kind === 'mubu') {
    const n = work.mubu.find((x) => x.id === target.id && !x.deletedAt)
    if (!n) return null
    const path = []
    let p = n.parentId ? work.mubu.find((x) => x.id === n.parentId && !x.deletedAt) : null
    let guard = 0
    while (p && guard++ < 12) {
      path.unshift((p.text || '').slice(0, 16) || '（空）')
      p = p.parentId ? work.mubu.find((x) => x.id === p.parentId && !x.deletedAt) : null
    }
    const lines = [(n.text || '').trim() || '（空节点）']
    const walk = (pid, depth) => {
      for (const ch of work.mubuChildren(pid)) {
        if (lines.length > 14) {
          lines.push('……')
          return
        }
        lines.push('　'.repeat(depth) + '· ' + ((ch.text || '').trim() || '（空）'))
        walk(ch.id, depth + 1)
      }
    }
    walk(n.id, 1)
    return { kindLabel: '设定', title: (n.text || '').slice(0, 40) || '（空节点）', meta: path.join(' / '), body: cut(lines.join('\n')) }
  }
  if (target.kind === 'character') {
    const c = work.characters.find((x) => x.id === target.id && !x.deletedAt)
    if (!c) return null
    return {
      kindLabel: '人物',
      title: c.name || '未命名',
      meta: [primaryRole(c), c.aliases ? '别名 ' + c.aliases : ''].filter(Boolean).join(' · '),
      body: cut(c.content) || '（暂无小传）'
    }
  }
  if (target.kind === 'outline') {
    const o = work.outlines.find((x) => x.refId === target.id && !x.deletedAt)
    return { kindLabel: '大纲', title: outlineLabel(target.id) || '大纲', meta: '大纲', body: cut(o?.content) || '（暂无内容）' }
  }
  if (target.kind === 'snippet') {
    const s = work.snippets.find((x) => x.id === target.id && !x.deletedAt)
    if (!s) return null
    const first = (s.content || '').split('\n').find((x) => x.trim()) || '（空）'
    return { kindLabel: '灵感', title: first.slice(0, 30), meta: '灵感记录', body: cut(s.content) || '（空）' }
  }
  return null
}

/* ---------- 跳转 ---------- */
export function jumpTo(target) {
  if (!target) return false
  const work = useWorkStore()
  const ui = useUiStore()
  if (target.kind === 'chapter') {
    work.tab = 'chapters'
    work.selChapterId = target.id
    const c = work.chapters.find((x) => x.id === target.id)
    if (c) work.selVolumeId = c.volumeId
  } else if (target.kind === 'mubu') {
    work.tab = 'lore'
    // 目标可能位于另一个设定集：先切换当前集，再由 MubuView 展开定位
    const root = work.mubuRootOf(target.id)
    if (root) work.setMubuSet(root.id)
    ui.loreFocusId = target.id
  } else if (target.kind === 'character') {
    work.tab = 'characters'
    work.selCharacterId = target.id
    // 8.8.3：关系图视图打开时，关系链接跳转人物附带画布定位
    if (work.charView === 'graph') {
      work.charFocusId = target.id
      work.charFocusTick++
    }
  } else if (target.kind === 'outline') {
    work.tab = 'outline'
    work.selOutlineId = target.id
  } else if (target.kind === 'snippet') {
    work.tab = 'snippets'
    work.selSnippetId = target.id
  } else {
    return false
  }
  ui.searchOpen = false
  return true
}

/* ---------- 反向链接：扫描全库引用了指定标题的内容 ---------- */
export function findBacklinks(title) {
  const t = String(title || '').trim()
  if (!t) return []
  const work = useWorkStore()
  const has = (s) => !!s && (s.includes(`data-dl-title="${t}"`) || s.includes(`[[${t}]]`) || s.includes(`[[${t}|`))
  const out = []
  for (const c of work.liveChapters) {
    if (has(c.content)) out.push({ kind: 'chapter', id: c.id, title: c.title || '未命名章节' })
  }
  for (const n of work.liveMubu()) {
    if (has(n.html) || has(n.text)) out.push({ kind: 'mubu', id: n.id, title: (n.text || '').slice(0, 24) || '（空）' })
  }
  for (const c of work.liveCharacters) {
    if (has(c.content)) out.push({ kind: 'character', id: c.id, title: c.name || '未命名' })
  }
  for (const o of work.outlines) {
    if (o.deletedAt) continue
    if (has(o.content)) out.push({ kind: 'outline', id: o.refId, title: outlineLabel(o.refId) || '大纲' })
  }
  for (const s of work.liveSnippets) {
    if (has(s.content)) out.push({ kind: 'snippet', id: s.id, title: (s.content || '').split('\n').find((x) => x.trim())?.slice(0, 20) || '灵感' })
  }
  return out
}

/* ---------- 纯文本令牌（大纲 / 人物 / 灵感） ---------- */
export function buildToken(title, display = '') {
  const t = String(title || '').trim()
  const d = String(display || '').trim()
  return d && d !== t ? `[[${t}|${d}]]` : `[[${t}]]`
}

/** 解析文本中的令牌 → [{ start, end, title, display }]（end 为令牌结束位置） */
export function parseTokens(text) {
  const s = String(text || '')
  const out = []
  const re = /\[\[([^\[\]\n]+?)\]\]/g
  for (const m of s.matchAll(re)) {
    const raw = m[1]
    const bar = raw.indexOf('|')
    const title = (bar >= 0 ? raw.slice(0, bar) : raw).trim()
    const display = bar >= 0 ? raw.slice(bar + 1).trim() : title
    if (title) out.push({ start: m.index, end: m.index + m[0].length, title, display })
  }
  return out
}

/** 字符偏移所在令牌（含左右边界内侧），无则 null */
export function tokenAtOffset(text, offset) {
  return parseTokens(text).find((t) => offset >= t.start && offset <= t.end) || null
}

/* 令牌命中测试用镜像（模拟 textarea 换行排版），按 host 缓存 */
const mirrorCache = new WeakMap()
function mirrorOf(ta) {
  let m = mirrorCache.get(ta)
  if (!m) {
    m = document.createElement('div')
    m.setAttribute('aria-hidden', 'true')
    m.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;box-sizing:content-box;'
    document.body.appendChild(m)
    mirrorCache.set(ta, m)
  }
  const cs = getComputedStyle(ta)
  m.style.width = Math.max(0, ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px'
  m.style.fontFamily = cs.fontFamily
  m.style.fontSize = cs.fontSize
  m.style.fontWeight = cs.fontWeight
  m.style.fontStyle = cs.fontStyle
  m.style.lineHeight = cs.lineHeight
  m.style.letterSpacing = cs.letterSpacing
  m.style.padding = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`
  const val = ta.value + '\n'
  if (m.textContent !== val) m.textContent = val
  return m
}

/** 鼠标点所在令牌（textarea 换行感知命中测试），无则 null */
export function tokenAtPoint(ta, clientX, clientY) {
  if (!ta || !ta.value) return null
  const tokens = parseTokens(ta.value)
  if (!tokens.length) return null
  const m = mirrorOf(ta)
  const tn = m.firstChild
  if (!tn || tn.nodeType !== 3) return null
  const mrect = m.getBoundingClientRect()
  const taRect = ta.getBoundingClientRect()
  const x = clientX - taRect.left + ta.scrollLeft + mrect.left
  const y = clientY - taRect.top + ta.scrollTop + mrect.top
  for (const t of tokens) {
    try {
      const r = document.createRange()
      r.setStart(tn, t.start)
      r.setEnd(tn, Math.min(t.end, tn.textContent.length))
      for (const rect of r.getClientRects()) {
        if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) return { ...t, rect }
      }
    } catch {
      /* 越界忽略 */
    }
  }
  return null
}
