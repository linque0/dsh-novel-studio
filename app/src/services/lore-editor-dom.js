/**
 * 设定幕布 / 导图富文本 DOM 工具集：
 * 负责 HTML 消毒与双链不可编辑标记加固、内嵌图片显隐与宽度修改、以及选区光标读写与回车拆行。
 */
import DOMPurify from 'dompurify'
const imageSelector = 'img.lore-image'
const hiddenImageAttribute = 'data-lore-image-hidden'
const imageHidden = image => image.getAttribute(hiddenImageAttribute) === 'true'

export function cleanLoreHtml(html) {
  const fragment = DOMPurify.sanitize(String(html || ''), { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['data-dl-target', 'data-dl-title'], FORBID_TAGS: ['script', 'style', 'iframe', 'object'] })
  fragment.querySelectorAll('span[data-dl-target]').forEach(link => { link.classList.add('dl-link'); link.setAttribute('contenteditable', 'false') })
  const box = document.createElement('div'); box.append(fragment); return box.innerHTML
}
export function loreImageHtml(html) {
  if (!html?.includes('lore-image')) return ''
  const box = document.createElement('div')
  box.innerHTML = cleanLoreHtml(html)
  return Array.from(box.querySelectorAll(imageSelector), image => image.outerHTML).join('')
}
export function hasHiddenLoreImages(html) {
  return Boolean(html?.includes('data-lore-image-hidden="true')) &&
    /<img\b[^>]*\bdata-lore-image-hidden="true"/i.test(html)
}
export function setLoreImageHtml(html, index, { width, hidden }) {
  if (!html?.includes('lore-image')) return html
  const box = document.createElement('div')
  box.innerHTML = cleanLoreHtml(html)
  const images = Array.from(box.querySelectorAll(imageSelector))
  const targets = index == null ? images.filter(imageHidden) : images.slice(index, index + 1)
  if (!targets.length) return html
  for (const image of targets) {
    if (width != null) image.setAttribute('width', String(width))
    if (hidden === true) image.setAttribute(hiddenImageAttribute, 'true')
    if (hidden === false) image.removeAttribute(hiddenImageAttribute)
  }
  return box.innerHTML
}
export function changeLoreImages(work, id, index, patch, syncEditor) {
  const node = work.mubu.find(item => item.id === id && !item.deletedAt)
  if (!node) return false
  const html = setLoreImageHtml(node.html, index, patch)
  if (html === node.html) return false
  work.mubuCheckpoint()
  syncEditor?.()
  work.mubuSetText(id, node.text, html)
  return true
}
export function loreContentHtml(node) {
  return cleanLoreHtml(node.html || String(node.text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>'))
}
export function loreMapContent(node) {
  const html = loreContentHtml(node)
  if (!html.includes('lore-image')) return { html, imageWidth: 0 }
  const box = document.createElement('div')
  box.innerHTML = html
  let imageWidth = 0
  for (const image of box.querySelectorAll(imageSelector)) {
    const width = Number(image.getAttribute('width'))
    if (!imageHidden(image) && Number.isSafeInteger(width)) imageWidth = Math.max(imageWidth, width)
  }
  return { html, imageWidth }
}
export function loreText(el, countImages = false) {
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (node.nodeName === 'BR') return '\n'
    if (node.nodeName === 'IMG') return countImages && !imageHidden(node) ? '\ufffc' : ''
    const lineBreak = ['DIV', 'P'].includes(node.nodeName) && node.nextSibling ? '\n' : ''
    return Array.from(node.childNodes, walk).join('') + lineBreak
  }
  return [...el.childNodes].map(walk).join('').replace(/\u00a0/g, ' ')
}
export function loreCaret(el) {
  const s = getSelection(); if (!s?.rangeCount || !el.contains(s.anchorNode)) return 0
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.anchorNode, s.anchorOffset)
  const fragment = document.createElement('div'); fragment.append(r.cloneContents()); return loreText(fragment, true).length
}
export function setLoreCaret(el, value = 0) {
  if (!el) return
  el.focus({ preventScroll: true })
  let left = Math.max(0, Number(value) || 0)
  const range = document.createRange()
  const leaves = []
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeName === 'IMG' && imageHidden(child)) continue
      if (child.nodeType === Node.TEXT_NODE || ['BR', 'IMG'].includes(child.nodeName) ||
          child.nodeType === Node.ELEMENT_NODE && child.getAttribute('contenteditable') === 'false') {
        leaves.push(child)
      } else walk(child)
    }
  }
  walk(el)
  for (const n of leaves) {
    const length = n.nodeName === 'BR' || n.nodeName === 'IMG' ? 1 : n.textContent.length
    if (left <= length) {
      if (n.nodeType === 3) range.setStart(n, left)
      else if (left === 0) range.setStartBefore(n)
      else range.setStartAfter(n)
      range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range); return
    }
    left -= length
  }
  range.selectNodeContents(el); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range)
}
export function splitLoreSelection(el) {
  const s = getSelection(), selected = s?.rangeCount && el.contains(s.anchorNode) ? s.getRangeAt(0) : null
  if (!selected) return { beforeText: loreText(el), beforeHtml: cleanLoreHtml(el.innerHTML), afterText: '', afterHtml: null }
  selected.deleteContents()
  const before = selected.cloneRange(), after = selected.cloneRange()
  before.selectNodeContents(el); before.setEnd(selected.startContainer, selected.startOffset)
  after.selectNodeContents(el); after.setStart(selected.startContainer, selected.startOffset)
  const a = document.createElement('div'), b = document.createElement('div'); a.append(before.cloneContents()); b.append(after.cloneContents())
  return { beforeText: loreText(a), beforeHtml: cleanLoreHtml(a.innerHTML), afterText: loreText(b), afterHtml: cleanLoreHtml(b.innerHTML) }
}

const isProtectedInline = el => Boolean(el?.classList?.contains('dl-link') || el?.getAttribute?.('contenteditable') === 'false')
const hasInlineColor = (el, kind) => {
  if (!el || el.nodeType !== 1 || isProtectedInline(el)) return false
  if (kind === 'color') return Boolean((el.nodeName === 'FONT' && el.hasAttribute('color')) || el.style?.color)
  return Boolean(el.nodeName === 'MARK' || el.style?.backgroundColor || (el.style?.background && el.style.background !== 'none'))
}
const isEmptyShell = el => {
  if (!el || el.nodeType !== 1 || isProtectedInline(el)) return false
  if (el.querySelector('img, br, .dl-link, [contenteditable="false"]')) return false
  return el.textContent === ''
}
function unwrapNode(el) {
  const parent = el?.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}
function stripInlineColorFromEl(el, kind) {
  if (!el || el.nodeType !== 1 || isProtectedInline(el)) return false
  let changed = false
  if (kind === 'color') {
    if (el.nodeName === 'FONT' && el.hasAttribute('color')) { el.removeAttribute('color'); changed = true }
    if (el.style?.color) { el.style.removeProperty('color'); changed = true }
  } else {
    if (el.style?.backgroundColor) { el.style.removeProperty('background-color'); changed = true }
    if (el.style?.background) { el.style.removeProperty('background'); changed = true }
    if (el.nodeName === 'MARK') changed = true
  }
  if (el.hasAttribute('style') && !el.getAttribute('style').trim()) el.removeAttribute('style')
  if (!changed) return false
  if (kind === 'background' && el.nodeName === 'MARK') {
    if (el.attributes.length === 0) unwrapNode(el)
    else {
      const span = el.ownerDocument.createElement('span')
      for (const attr of Array.from(el.attributes)) span.setAttribute(attr.name, attr.value)
      while (el.firstChild) span.appendChild(el.firstChild)
      el.parentNode?.replaceChild(span, el)
    }
  } else if ((el.nodeName === 'SPAN' || el.nodeName === 'FONT') && el.attributes.length === 0) {
    unwrapNode(el)
  }
  return true
}
function splitColoredAncestorsAt(rootEl, marker, placeBefore, kind) {
  let top = null
  let cur = marker.parentNode
  while (cur && cur !== rootEl) {
    if (isProtectedInline(cur)) return
    if (hasInlineColor(cur, kind)) top = cur
    cur = cur.parentNode
  }
  if (!top || !top.parentNode) return
  const doc = rootEl.ownerDocument
  const r = doc.createRange()
  if (placeBefore) r.setStartBefore(marker)
  else r.setStartAfter(marker)
  r.setEndAfter(top)
  const afterFrag = r.extractContents()
  const nextSibling = top.nextSibling
  top.parentNode.insertBefore(afterFrag, nextSibling)
  const inserted = top.nextSibling
  if (isEmptyShell(top)) top.remove()
  if (inserted && isEmptyShell(inserted)) inserted.remove()
}
/** 精准移除选区（或光标所在节点）的文字颜色或底色，保留加粗/斜体/下划线/删除线/双链及另一种颜色。 */
export function clearLoreInlineColor(rootEl, kind = 'color') {
  if (!rootEl || (kind !== 'color' && kind !== 'background')) return false
  const doc = rootEl.ownerDocument
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null)
  const sel = win?.getSelection?.()
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null
  if (!range || !rootEl.contains(range.commonAncestorContainer)) return false

  if (range.collapsed) {
    const ancestors = []
    let cur = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer
    while (cur && cur !== rootEl) {
      if (isProtectedInline(cur)) return false
      if (hasInlineColor(cur, kind)) ancestors.push(cur)
      cur = cur.parentNode
    }
    let changed = false
    for (const el of ancestors) changed = stripInlineColorFromEl(el, kind) || changed
    return changed
  }

  const sMark = doc.createComment('lore-clr-s')
  const eMark = doc.createComment('lore-clr-e')
  const endRange = range.cloneRange()
  endRange.collapse(false)
  endRange.insertNode(eMark)
  const startRange = range.cloneRange()
  startRange.collapse(true)
  startRange.insertNode(sMark)

  splitColoredAncestorsAt(rootEl, sMark, true, kind)
  splitColoredAncestorsAt(rootEl, eMark, false, kind)

  const selRange = doc.createRange()
  selRange.setStartAfter(sMark)
  selRange.setEndBefore(eMark)

  const targets = []
  const walker = doc.createTreeWalker(rootEl, 1 /* SHOW_ELEMENT */)
  let node = walker.nextNode()
  while (node) {
    if (hasInlineColor(node, kind) && selRange.intersectsNode(node)) targets.push(node)
    node = walker.nextNode()
  }
  let changed = false
  for (let i = targets.length - 1; i >= 0; i--) {
    changed = stripInlineColorFromEl(targets[i], kind) || changed
  }

  const restore = doc.createRange()
  restore.setStartAfter(sMark)
  restore.setEndBefore(eMark)
  sel.removeAllRanges()
  sel.addRange(restore)
  sMark.remove()
  eMark.remove()
  return changed
}
