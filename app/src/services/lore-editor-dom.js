import DOMPurify from 'dompurify'
export function cleanLoreHtml(html) {
  const fragment = DOMPurify.sanitize(String(html || ''), { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ['data-dl-target', 'data-dl-title'], FORBID_TAGS: ['script', 'style', 'iframe', 'object'] })
  fragment.querySelectorAll('span[data-dl-target]').forEach(link => { link.classList.add('dl-link'); link.setAttribute('contenteditable', 'false') })
  const box = document.createElement('div'); box.append(fragment); return box.innerHTML
}
export function loreText(el) {
  const walk = n => n.nodeType === 3 ? n.textContent : n.nodeName === 'BR' ? '\n' : [...n.childNodes].map(walk).join('') + (['DIV', 'P'].includes(n.nodeName) && n.nextSibling ? '\n' : '')
  return [...el.childNodes].map(walk).join('').replace(/\u00a0/g, ' ')
}
export function loreCaret(el) {
  const s = getSelection(); if (!s?.rangeCount || !el.contains(s.anchorNode)) return 0
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.anchorNode, s.anchorOffset)
  const fragment = document.createElement('div'); fragment.append(r.cloneContents()); return loreText(fragment).length
}
export function setLoreCaret(el, value = 0) {
  if (!el) return
  el.focus({ preventScroll: true })
  let left = Math.max(0, Number(value) || 0)
  const range = document.createRange()
  const leaves = []
  const walk = node => { for (const n of node.childNodes) { if (n.nodeType === 3 || n.nodeName === 'BR' || n.nodeType === 1 && n.getAttribute('contenteditable') === 'false') leaves.push(n); else walk(n) } }
  walk(el)
  for (const n of leaves) {
    const length = n.nodeName === 'BR' ? 1 : n.textContent.length
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
