import JSZip from 'jszip'

/* ================= 文本解码（中文编码兼容） ================= */

export function decodeText(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'utf-16le' }
  if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'utf-16be' }
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'utf-8' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('gb18030').decode(u8), encoding: 'gb18030' }
  }
}

/* ================= 智能分章 ================= */

const TXT_TITLE_RE =
  /^\s*((?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷部集幕场])|(?:Chapter\s+\d+)|(?:CHAPTER\s+\d+)|(?:楔子)|(?:序章)|(?:序言)|(?:序)|(?:引子)|(?:序幕)|(?:尾声)|(?:后记)|(?:终章)|(?:番外\S{0,12}))(?:[\s：:|·、]*(\S.{0,40}))?\s*$/

export function splitTxtChapters(text, fallbackTitle = '导入章节') {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let cur = null
  for (const line of lines) {
    const m = line.match(TXT_TITLE_RE)
    if (m) {
      const suffix = (m[2] || '').trim()
      cur = { title: (suffix ? `${m[1]} ${suffix}` : m[1]).slice(0, 60), text: [], fromHeading: true }
      sections.push(cur)
    } else {
      if (!cur) {
        cur = { title: fallbackTitle.slice(0, 60), text: [], fromHeading: false }
        sections.push(cur)
      }
      cur.text.push(line)
    }
  }
  const out = sections.map((s) => ({ title: s.title, text: s.text.join('\n').trim(), fromHeading: s.fromHeading })).filter((s) => s.text.length > 0)
  if (out.length < 2) {
    const firstLine = text.trim().split('\n')[0]?.trim() || fallbackTitle
    return [{ title: firstLine.slice(0, 40), text: text.trim() }]
  }
  // 开头无章节标题的短前言（书名/作者行）并入第一章，避免产生孤章。
  // 仅限「文件开头本就没有章节标题」的段——真正的短首章（如短楔子）标题不丢（v1.0.22 修复）
  if (out.length >= 2 && !out[0].fromHeading && out[0].text.length < 120) {
    out[1].text = (out[0].text + '\n\n' + out[1].text).trim()
    out.shift()
  }
  return out
}

export function splitMarkdown(text, fallbackTitle = '导入章节') {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const used = lines.find((l) => /^#{1,2}\s+\S/.test(l))?.match(/^(#+)/)?.[1]
  if (!used) {
    const firstLine = text.trim().split('\n')[0]?.trim() || fallbackTitle
    return [{ title: firstLine.replace(/^#+\s*/, '').slice(0, 40), text: text.trim() }]
  }
  const re = new RegExp(`^${used}\\s+(.+)`)
  const sections = []
  let cur = null
  for (const line of lines) {
    const m = line.match(re)
    if (m) {
      cur = { title: m[1].trim().slice(0, 60), text: [] }
      sections.push(cur)
    } else if (cur) {
      cur.text.push(line)
    }
  }
  const out = sections.map((s) => ({ title: s.title, text: s.text.join('\n').trim() })).filter((s) => s.text)
  return out.length ? out : [{ title: fallbackTitle, text: text.trim() }]
}

/* ================= HTML → Markdown ================= */

export function htmlToMd(html) {  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        out.push(n.textContent)
        continue
      }
      if (n.nodeType !== 1) continue
      const tag = n.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        out.push('\n\n' + '#'.repeat(+tag[1]) + ' ' + n.textContent.trim() + '\n\n')
      } else if (tag === 'br') {
        out.push('\n')
      } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
        walk(n)
        out.push('\n\n')
      } else if (tag === 'li') {
        out.push('\n- ')
        walk(n)
      } else if (tag === 'blockquote') {
        out.push('\n> ')
        walk(n)
        out.push('\n')
      } else if (tag === 'hr') {
        out.push('\n\n---\n\n')
      } else if (tag === 'img') {
        out.push(`![](${n.getAttribute('src') || ''})`)
      } else if (tag === 'strong' || tag === 'b') {
        out.push('**')
        walk(n)
        out.push('**')
      } else if (tag === 'em' || tag === 'i') {
        out.push('*')
        walk(n)
        out.push('*')
      } else {
        walk(n)
      }
    }
  }
  walk(doc.body)
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** HTML → 纯文本（块级元素转换行），用于 TXT 导出 */
export function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,tr').forEach((el) => el.append('\n'))
  return (doc.body.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function splitHtmlByHeadings(html, fallbackTitle = '导入章节') {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const children = [...doc.body.children]
  const firstHeading = children.find((el) => /^H[12]$/.test(el.tagName))
  if (!firstHeading) return [{ title: (doc.title || fallbackTitle).slice(0, 60), text: htmlToMd(html) }]
  const level = firstHeading.tagName
  const sections = []
  let cur = null
  for (const el of children) {
    if (el.tagName === level) {
      cur = { title: el.textContent.trim().slice(0, 60) || `章节 ${sections.length + 1}`, parts: [] }
      sections.push(cur)
    } else if (cur) {
      cur.parts.push(el.outerHTML)
    } else {
      cur = { title: fallbackTitle, parts: [el.outerHTML] }
      sections.push(cur)
    }
  }
  return sections.map((s) => ({ title: s.title, text: htmlToMd(s.parts.join('\n')) })).filter((s) => s.text.trim())
}

/* ================= PDF ================= */

export async function parsePdf(data, onProgress = () => {}) {
  const pdfjsLib = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const n = pdf.numPages
  const pages = []
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    pages.push(
      tc.items
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    onProgress(i, n)
  }
  const totalChars = pages.join('').length
  const scanned = totalChars < n * 20

  let sections = null
  if (!scanned) {
    try {
      const outline = await pdf.getOutline()
      if (outline?.length) {
        const items = []
        const resolvePage = async (dest) => {
          try {
            const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
            if (!d?.length) return null
            const ref = d[0]
            if (ref && typeof ref === 'object') return await pdf.getPageIndex(ref)
            return null
          } catch {
            return null
          }
        }
        for (const it of outline) {
          const pi = await resolvePage(it.dest)
          if (pi != null) items.push({ title: (it.title || '').trim().slice(0, 60), page: pi })
        }
        if (items.length >= 2) {
          items.sort((a, b) => a.page - b.page)
          sections = items.map((it, idx) => ({
            title: it.title || `第${idx + 1}节`,
            text: pages.slice(it.page, items[idx + 1]?.page ?? n).join('\n')
          })).filter((s) => s.text.trim())
        }
      }
    } catch {
      /* 无书签或解析失败，回退单章 */
    }
  }
  return { numPages: n, pages, scanned, sections }
}

/** 扫描版 PDF：把页面渲染为图片以便存为素材 */
export async function pdfPagesToImages(data, maxPages = 30, onProgress = () => {}) {
  const pdfjsLib = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const out = []
  const count = Math.min(pdf.numPages, maxPages)
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    if (blob) out.push({ name: `page-${String(i).padStart(3, '0')}.jpg`, blob })
    onProgress(i, count)
  }
  return out
}

/* ================= EPUB ================= */

export async function parseEpub(data) {
  const zip = await JSZip.loadAsync(data)
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('不是有效的 EPUB 文件')
  const containerXml = await containerFile.async('string')
  const opfPath = new DOMParser().parseFromString(containerXml, 'text/xml').querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB 缺少 OPF 描述文件')
  const opfName = opfPath.split('/').pop()
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const opfXml = await zip.file(opfPath).async('string')
  const opf = new DOMParser().parseFromString(opfXml, 'text/xml')
  const manifest = {}
  opf.querySelectorAll('manifest > item').forEach((it) => {
    manifest[it.getAttribute('id')] = {
      href: it.getAttribute('href'),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || ''
    }
  })
  const resolveHref = (href) => zip.file(opfDir + href) || zip.file(opfDir + decodeURIComponent(href)) || zip.file(decodeURIComponent(href))
  const spine = [...opf.querySelectorAll('spine > itemref')]
    .map((r) => manifest[r.getAttribute('idref')])
    .filter((m) => m && /html|xml/.test(m.type))

  const chapters = []
  for (const item of spine) {
    const f = resolveHref(item.href)
    if (!f) continue
    const html = await f.async('string')
    const md = htmlToMd(html)
    if (!md.trim()) continue
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const title =
      [...doc.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim()).find(Boolean) ||
      (doc.title || '').trim() ||
      `章节 ${chapters.length + 1}`
    chapters.push({ title: title.slice(0, 60), text: md })
  }

  let coverBlob = null
  const coverItem = Object.values(manifest).find((m) => /cover-image/.test(m.props))
  const coverMeta = opf.querySelector('meta[name="cover"]')
  const cover = coverItem || (coverMeta ? manifest[coverMeta.getAttribute('content')] : null)
  if (cover) {
    const f = resolveHref(cover.href)
    if (f) coverBlob = await f.async('blob')
  }
  return { chapters: chapters.length ? chapters : [{ title: opfName || '导入章节', text: '' }], coverBlob }
}

/* ================= 设定库 MD 导入解析 ================= */
/**
 * 幕布节点导入：H1–H6 → 对应层级节点，正文行 → 末级节点的子节点。
 * 返回 [{ text, children }]
 */
export function parseMubuMd(text) {
  const root = { children: [] }
  const stack = [{ level: 0, node: root }]
  for (const raw of String(text || '').split(/\r?\n/)) {
    const hm = raw.match(/^(#{1,6})\s+(.*)$/)
    if (hm) {
      const level = hm[1].length
      const title = hm[2].trim()
      if (!title) continue
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      const n = { text: title, children: [] }
      stack[stack.length - 1].node.children.push(n)
      stack.push({ level, node: n })
    } else if (raw.trim()) {
      stack[stack.length - 1].node.children.push({ text: raw.trim(), children: [] })
    }
  }
  return root.children
}

/* ================= 汇总入口 ================= */

export const DOC_EXTS = ['txt', 'md', 'markdown', 'docx', 'pdf', 'epub']
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']
const baseName = (n) => n.replace(/\.[^.]+$/, '')

export async function parseImportFiles(files, onProgress = () => {}) {
  const docs = []
  const images = []
  for (const f of files) {
    if (IMAGE_EXTS.includes(f.ext)) {
      images.push(f)
      continue
    }
    if (!DOC_EXTS.includes(f.ext)) continue
    if (f.ext === 'txt') {
      const { text, encoding } = decodeText(f.data)
      docs.push({ file: f.name, encoding, sections: splitTxtChapters(text, baseName(f.name)) })
    } else if (f.ext === 'md' || f.ext === 'markdown') {
      const { text } = decodeText(f.data)
      docs.push({ file: f.name, encoding: 'utf-8', sections: splitMarkdown(text, baseName(f.name)) })
    } else if (f.ext === 'docx') {
      if (!window.native?.docxToHtml) throw new Error('网页版暂不支持 Word(.docx) 导入，请使用桌面版')
      const r = await window.native.docxToHtml(f.data)
      docs.push({ file: f.name, encoding: 'docx', sections: splitHtmlByHeadings(r.html, baseName(f.name)) })
    } else if (f.ext === 'epub') {
      const r = await parseEpub(f.data)
      docs.push({ file: f.name, encoding: 'epub', sections: r.chapters, coverBlob: r.coverBlob })
    } else if (f.ext === 'pdf') {
      const r = await parsePdf(f.data, onProgress)
      docs.push({ file: f.name, encoding: 'pdf', sections: r.sections, scanned: r.scanned, numPages: r.numPages, raw: f.data, pages: r.pages })
    }
  }
  return { docs, images }
}
