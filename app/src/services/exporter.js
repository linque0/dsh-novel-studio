import { exportBackupJson, importBackupJson, buildBookText, collectExportChapters } from '../db/repo'
import { saveTextFile } from './fileio'
import { decodeText, htmlToMd, htmlToPlain } from './importers'
import { autosave } from './autosave'
import JSZip from 'jszip'

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export async function backupAll() {
  const json = await exportBackupJson()
  return saveTextFile(`novel-studio-备份-${stamp()}.json`, json)
}

export async function restoreBackup(arrayBuffer) {
  /* 恢复语义以备份为准：先落盘在途脏数据、再丢弃待存队列——否则恢复完成后的防抖落盘
   * 会把「恢复前的旧状态」写回新库，覆盖备份内容（v1.0.22 修复，已实测复现） */
  await autosave.flushAll()
  autosave.discardPending()
  const { text } = decodeText(arrayBuffer)
  await importBackupJson(text)
}

/* ---------- v1.0.4：按章节勾选导出 + docx ---------- */

export async function exportBookWithFilter(work, volumes, chapters, fmt, onlyIds) {
  const name = work.title || '未命名作品'
  if (fmt === 'txt') {
    const text = await buildBookText(work, volumes, chapters, false, onlyIds)
    return saveTextFile(`${name}.txt`, text)
  }
  if (fmt === 'md') {
    const text = await buildBookText(work, volumes, chapters, true, onlyIds)
    return saveTextFile(`${name}.md`, text)
  }
  const zip = await buildBookDocx(work, volumes, chapters, onlyIds)
  return saveTextFile(`${name}.docx`, zip, { isBase64: true })
}

/* ---------- v1.0.5：单章命名 / 逐章分批 / zip 批量 ---------- */

const FMT_EXT = { txt: 'txt', md: 'md', docx: 'docx' }
/** 文件名安全化：去掉 Windows 非法字符，限长 60 */
function safeName(s) {
  return String(s || '未命名章节').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || '未命名章节'
}

/** 单章导出：文件名 = 章节名.格式 */
export async function exportSingleChapter(work, volumes, chapter, fmt) {
  const rows = [{ vol: null, ch: chapter }]
  return exportChapterRows(work, rows, fmt, safeName(chapter.title))
}

/** 逐章分批导出（v1.0.6：仅首次弹保存对话框确认位置，后续章节自动写入同目录）；
 * 首步取消即中止全部。返回 { exported, canceledAt, dir } */
export async function exportChapterRowsSequential(work, volumes, chapters, rows, fmt) {
  let exported = 0
  let dir = null
  for (const { ch } of rows) {
    const r = await exportChapterRows(work, [{ vol: null, ch }], fmt, safeName(ch.title), dir)
    if (r?.canceled) return { exported, canceledAt: ch.title, dir }
    /* 从首个保存路径提取目录 */
    if (!dir && r?.path) dir = r.path.replace(/[\\/][^\\/]+$/, '')
    exported++
  }
  return { exported, canceledAt: null, dir }
}

/** zip 批量：每章一个文件（NN-章节名.格式，NN 按顺序 01 起）打成一个压缩包 */
export async function exportRowsAsZip(work, rows, fmt) {
  const zip = new JSZip()
  const pad = String(rows.length).length
  let i = 0
  let lastVol = null
  for (const { vol, ch } of rows) {
    i++
    if (vol && vol !== lastVol) {
      zip.folder(safeName(vol.title))
      lastVol = vol
    }
    const dir = vol && vol === lastVol ? safeName(vol.title) : ''
    const label = String(i).padStart(Math.max(2, pad), '0') + '-' + safeName(ch.title)
    if (fmt === 'txt') zip.file((dir ? dir + '/' : '') + label + '.txt', await chapterText(work, [ch], false))
    else if (fmt === 'md') zip.file((dir ? dir + '/' : '') + label + '.md', await chapterText(work, [ch], true))
    else zip.file((dir ? dir + '/' : '') + label + '.docx', await buildBookDocx(work, [], [ch], null), { base64: true })
  }
  const b64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
  return saveTextFile(`${safeName(work.title)}-${rows.length}章.zip`, b64, { isBase64: true })
}

/** 单章/单批文本（无卷头，仅章节正文） */
async function chapterText(work, chapters, asMarkdown) {
  const lines = []
  for (const c of chapters) {
    const asFmt = (ch) => {
      if (ch.fmt === 'html' || (ch.fmt !== 'text' && /<[a-z][\s\S]*>/i.test(ch.content || ''))) return asMarkdown ? htmlToMd(ch.content) : htmlToPlain(ch.content)
      return ch.content || ''
    }
    lines.push(asMarkdown ? `### ${c.title || '未命名章节'}` : c.title || '未命名章节', '', asFmt(c), '', '')
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}

/** rows（[{vol, ch}]）→ 一个合并文件（供单章导出与合并导出共用；dir 给定时跳过对话框直写该目录） */
async function exportChapterRows(work, rows, fmt, name, dir = null) {
  if (fmt === 'txt') return saveTextFile(`${name}.txt`, await chapterText(work, rows.map((r) => r.ch), false), { dirPath: dir })
  if (fmt === 'md') return saveTextFile(`${name}.md`, await chapterText(work, rows.map((r) => r.ch), true), { dirPath: dir })
  /* docx：rows 含卷信息时带卷标题 */
  const chapters = rows.map((r) => r.ch)
  const fakeVols = []
  return saveTextFile(`${name}.docx`, await buildBookDocx(work, fakeVols, chapters, null), { isBase64: true, dirPath: dir })
}

/* OOXML 转义 */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 内联富文本 html → w:r 序列（保留加粗/斜体/下划线/删除线与颜色） */
function htmlToRuns(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  const runs = []
  const walk = (node, style) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.textContent.replace(/\s+/g, ' ')
        if (t.trim()) runs.push({ t, ...style })
        continue
      }
      if (n.nodeType !== 1) continue
      const tag = n.tagName.toLowerCase()
      const st = { ...style }
      if (tag === 'b' || tag === 'strong') st.b = true
      if (tag === 'i' || tag === 'em') st.i = true
      if (tag === 'u') st.u = true
      if (tag === 's' || tag === 'del' || tag === 'strike') st.s = true
      if (tag === 'br') {
        runs.push({ br: true })
        continue
      }
      const color = (n.getAttribute && n.getAttribute('color')) || (n.style && n.style.color)
      if (color && /^#[0-9a-f]{6}$/i.test(color)) st.color = color.slice(1)
      walk(n, st)
    }
  }
  walk(doc.body, {})
  return runs
}

/** 一个块级段落（html 的 p、h1-h6、li、blockquote 或纯文本行）→ <w:p> */
function paraXml(runs, opts = {}) {
  const pPr = []
  if (opts.heading) pPr.push(`<w:pStyle w:val="Heading${opts.heading}"/>`)
  if (opts.quote) pPr.push('<w:ind w:left="480"/>')
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`)
  if (opts.center) pPr.push('<w:jc w:val="center"/>')
  const body = runs.length
    ? runs
        .map((r) => {
          if (r.br) return '<w:r><w:br/></w:r>'
          const rPr = []
          if (r.b) rPr.push('<w:b/>')
          if (r.i) rPr.push('<w:i/>')
          if (r.u) rPr.push('<w:u w:val="single"/>')
          if (r.s) rPr.push('<w:strike/>')
          if (r.color) rPr.push(`<w:color w:val="${r.color}"/>`)
          return `<w:r>${rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`
        })
        .join('')
    : ''
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${body}</w:p>`
}

/** 章节正文 html → 段落序列：p → 正文、h1-h6 → Heading 样式、ul/ol li → 列表缩进、blockquote → 引用 */
function htmlToParas(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  const out = []
  const H = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
  const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both' }
  /* 顶层裸文本节点也成段（v1.0.22：此前只遍历元素子节点，块级标签外的裸文本会整段丢失） */
  for (const node of doc.body.childNodes) {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) out.push(paraXml([{ t: node.textContent.replace(/\s+/g, ' ').trim() }]))
      continue
    }
    if (node.nodeType !== 1) continue
    const el = node
    const tag = el.tagName.toLowerCase()
    if (tag === 'p' || tag === 'div') {
      const style = el.getAttribute('style') || ''
      const m = style.match(/text-align:\s*(\w+)/)
      out.push(paraXml(htmlToRuns(el.innerHTML), { align: m && ALIGN[m[1]] }))
    } else if (H[tag]) out.push(paraXml(htmlToRuns(el.innerHTML), { heading: H[tag] }))
    else if (tag === 'blockquote') for (const p of el.querySelectorAll('p')) out.push(paraXml(htmlToRuns(p.innerHTML), { quote: true }))
    else if (tag === 'ul' || tag === 'ol') for (const li of el.children) out.push(paraXml(htmlToRuns(li.innerHTML), { quote: true }))
    else if (el.textContent.trim()) out.push(paraXml(htmlToRuns(el.innerHTML)))
  }
  if (!out.length && doc.body.textContent.trim()) out.push(paraXml(htmlToRuns(doc.body.innerHTML)))
  return out.join('')
}

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (l) => `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(24, 56 - l * 6)}"/></w:rPr></w:style>`
  )
  .join('')}
</w:styles>`

/** 生成 docx（WordprocessingML，JSZip 手组 OOXML——零新依赖） */
export async function buildBookDocx(work, volumes, chapters, onlyIds) {
  const rows = collectExportChapters(volumes, chapters, onlyIds)
  const paras = []
  paras.push(paraXml(htmlToRuns(esc(work.title || '未命名作品')), { heading: 1, center: true }))
  if (work.author) paras.push(paraXml(htmlToRuns(`作者：${esc(work.author)}`), { center: true }))
  paras.push(paraXml([]))
  let lastVol = undefined
  for (const { vol, ch } of rows) {
    if (vol && vol !== lastVol) {
      paras.push(paraXml(htmlToRuns(esc(vol.title)), { heading: 2 }))
      lastVol = vol
    }
    paras.push(paraXml(htmlToRuns(esc(ch.title || '未命名章节')), { heading: 3 }))
    /* fmt=html 走富文本解析；纯文本但内容含标签（历史数据 fmt 缺失）也按 html 识别 */
    if (ch.fmt === 'html' || (ch.fmt !== 'text' && /<[a-z][\s\S]*>/i.test(ch.content || ''))) paras.push(htmlToParas(ch.content))
    else for (const line of String(ch.content || '').split('\n')) paras.push(paraXml(line.trim() ? htmlToRuns(esc(line)) : []))
    paras.push(paraXml([]))
  }
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(work.title)}</dc:title>${work.author ? `<dc:creator>${esc(work.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Novel Studio</Application></Properties>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.folder('_rels').file('.rels', relsXml)
  zip.folder('docProps').file('core.xml', coreXml)
  zip.folder('docProps').file('app.xml', appXml)
  zip.folder('word').file('document.xml', docXml)
  zip.folder('word').file('styles.xml', stylesXml)
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
}
