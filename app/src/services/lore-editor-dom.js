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
