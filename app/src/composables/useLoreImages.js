import { ref } from 'vue'
import DOMPurify from 'dompurify'
import { IMAGE_EXTS, imageMime } from '../services/fileio'
import { cleanLoreHtml, loreText } from '../services/lore-editor-dom'

const extensions = IMAGE_EXTS.filter(ext => ext !== 'svg')
const imageTypes = new Set(extensions.map(imageMime))
const maxBytes = 10 * 1024 * 1024
const dataUrlType = /^data:(image\/[a-z]+);base64,/i
const rowSelector = ':is(.ob-text, [data-lore-entry-editor])[contenteditable="true"]'

function readImageFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const type = imageTypes.has(file.type) ? file.type : imageMime(ext)
  if (!imageTypes.has(type)) throw new Error('支持 PNG、JPEG、WebP、GIF、BMP 和 AVIF 图片')
  if (file.size > maxBytes) throw new Error('单张图片不能超过 10 MB')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ src: reader.result, alt: file.name })
    reader.onerror = () => reject(new Error('无法读取图片文件'))
    reader.readAsDataURL(file.slice(0, file.size, type))
  })
}

function clipboardImages(transfer) {
  const files = Array.from(transfer?.files || [])
  if (files.length) return files

  const html = transfer?.getData('text/html')
  if (!html || !/<img\b/i.test(html)) return []
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src', 'alt'], RETURN_DOM_FRAGMENT: true
  })
  return Array.from(fragment.querySelectorAll('img'), img => ({
    src: img.getAttribute('src') || '', alt: img.alt || '粘贴的图片'
  })).filter(image => imageTypes.has(image.src.match(dataUrlType)?.[1]?.toLowerCase()))
}

async function createImage(source) {
  const { src, alt } = source instanceof File ? await readImageFile(source) : source
  const payloadLength = src.length - src.indexOf(',') - 1
  if (payloadLength > Math.ceil(maxBytes / 3) * 4) throw new Error('单张图片不能超过 10 MB')
  const image = new Image()
  image.src = src
  image.alt = alt
  image.className = 'lore-image'
  image.draggable = false
  try {
    await image.decode()
  } catch {
    throw new Error('无法解码图片')
  }
  return image
}

function rangeInRow(range, row) {
  return range && row?.contains(range.startContainer) && row.contains(range.endContainer)
}

function endOf(row) {
  const range = document.createRange()
  range.selectNodeContents(row)
  range.collapse(false)
  return range
}

export function useLoreImages(editor, { work, selectedId, parentId, checkpoint, focusNew, readText = loreText, allowRoot = false }) {
  const imageInput = ref(null)
  const imageAccept = extensions.map(ext => '.' + ext).join(',')
  let pickerTarget

  function targetFor(row, useSelection = false) {
    const id = row?.closest('[data-lore-sort-row]')?.dataset.loreSortRow
    const selection = getSelection()
    const range = useSelection && selection?.rangeCount ? selection.getRangeAt(0) : null
    return {
      row, id, range: rangeInRow(range, row) ? range.cloneRange() : null,
      workId: work.work?.id, parent: parentId(),
      html: work.mubu.find(node => node.id === id)?.html
    }
  }

  async function insert(sources, target) {
    if (!target?.workId || (!target.id && !target.parent && !allowRoot) || !sources.length) return
    const images = document.createDocumentFragment()
    const errors = new Set()
    for (const source of sources) {
      try {
        images.append(await createImage(source))
      } catch (error) {
        errors.add(error.message)
      }
    }
    if (!editor.value?.getClientRects().length ||
        target.workId !== work.work?.id || target.parent !== parentId()) return
    if (errors.size) {
      const message = images.lastChild ? '部分图片未能插入' : '无法插入图片'
      window.$msg?.warning(`${message}：${Array.from(errors).join('；')}`)
    }
    if (!images.lastChild) return

    if (!target.row) {
      if (target.parent && !work.mubu.some(node => node.id === target.parent && !node.deletedAt)) return
      const box = document.createElement('div')
      box.append(images)
      checkpoint()
      const node = work.mubuAdd(target.parent, null, '', box.innerHTML)
      focusNew(node.id)
      return
    }

    const { row, id } = target
    const node = work.mubu.find(item => item.id === id && !item.deletedAt)
    if (!node || !editor.value.contains(row)) return
    const range = target.html === node.html && rangeInRow(target.range, row) ? target.range : endOf(row)
    const last = images.lastChild
    checkpoint()
    range.deleteContents()
    range.insertNode(images)
    if (document.activeElement === row) {
      range.setStartAfter(last)
      range.collapse(true)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }
    work.mubuSetText(id, readText(row), cleanLoreHtml(row.innerHTML))
  }

  function chooseImages() {
    const active = document.activeElement
    const editable = editor.value?.contains(active) && active.matches(rowSelector) ? active : null
    const id = selectedId()
    const selector = id && `[data-lore-sort-row="${CSS.escape(id)}"]`
    const selected = selector && (editor.value?.matches(selector) ? editor.value : editor.value?.querySelector(selector))
    const row = editable || selected?.querySelector?.(rowSelector) || null
    pickerTarget = targetFor(row, true)
    imageInput.value?.click()
  }

  function onImageFiles(event) {
    const input = event.currentTarget
    const files = Array.from(input.files || [])
    input.value = ''
    void insert(files, pickerTarget)
    pickerTarget = null
  }

  function onLorePaste(event) {
    event.preventDefault()
    const transfer = event.clipboardData
    const images = clipboardImages(transfer)
    if (images.length) {
      void insert(images, targetFor(event.currentTarget, true))
      return
    }
    const text = transfer?.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
    else if (/<img\b/i.test(transfer?.getData('text/html') || '')) {
      window.$msg?.warning('剪贴板没有可读取的图片，请先保存图片，再用「插入图片」添加')
    }
  }

  function onLoreDragOver(event) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onLoreDrop(event) {
    const files = Array.from(event.dataTransfer?.files || [])
    if (!files.length) return
    event.preventDefault()
    const row = event.target.closest('[data-lore-sort-row]')?.querySelector(rowSelector)
    const target = targetFor(row)
    if (row) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY)
      target.range = rangeInRow(range, row) ? range : endOf(row)
      row.focus()
    }
    void insert(files, target)
  }

  return { imageInput, imageAccept, chooseImages, onImageFiles, onLorePaste, onLoreDragOver, onLoreDrop }
}
