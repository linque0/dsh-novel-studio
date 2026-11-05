import { chapterHash, hashContent, normalizeText, plainChapter } from '../project/text.js'

export function captureWritingAnchor(editor,{workId,chapterId,chapter,mode='insert'}={}) {
  if(!editor||editor.isDestroyed||!editor.isEditable||chapter?.id!==chapterId||chapter.workId!==workId)throw new Error('请在可编辑的目标正文窗口启动任务')
  const {doc,selection}=editor.state
  if(!['insert','append','afterSelection','replace'].includes(mode))throw new Error('写作位置模式无效')
  if(mode==='replace'&&selection.from===selection.to)throw new Error('请先选中要改写的正文')
  const clamp=pos=>Math.max(1,Math.min(doc.content.size-1,pos))
  const from=mode==='append'?doc.content.size-1:clamp(mode==='afterSelection'?selection.to:selection.from)
  const to=mode==='replace'?clamp(selection.to):from
  const prefix=normalizeText(doc.textBetween(0,from,'\n\n'),'text'),text=plainChapter(chapter)
  if(!text.startsWith(prefix))throw new Error('正文位置尚未同步，请重新定位后启动')
  const selected=mode==='replace'?doc.textBetween(from,to,'\n\n'):''
  return {workId,chapterId,mode,from,to,docHash:hashContent(JSON.stringify(doc.toJSON())),sourceHash:chapterHash(chapter),
    selection:selected,cutoff:prefix.length,left:prefix.slice(-2400),right:doc.textBetween(to,doc.content.size,'\n\n').slice(0,1200),
    label:mode==='append'?'章节末尾':mode==='replace'?`替换所选 ${selected.length} 字`:mode==='afterSelection'?'所选内容之后':'启动时光标位置'}
}

export function validateWritingAnchor(editor,anchor) {
  if(!editor||editor.isDestroyed||!editor.isEditable)throw new Error('目标编辑器不可编辑')
  const doc=editor.state.doc
  if(hashContent(JSON.stringify(doc.toJSON()))!==anchor.docHash)throw new Error('正文已变化，请基于新位置重新生成')
  if(!Number.isInteger(anchor.from)||!Number.isInteger(anchor.to)||anchor.from<1||anchor.to<anchor.from||anchor.to>doc.content.size-1)throw new Error('写作范围已无效')
  if(anchor.mode==='replace'&&doc.textBetween(anchor.from,anchor.to,'\n\n')!==anchor.selection)throw new Error('原选区已变化')
  let protectedMark=false
  const protectedNode=node=>{if(node.marks?.some(m=>/dl|link|note|annotation/i.test(m.type.name)))protectedMark=true}
  if(anchor.to>anchor.from)doc.nodesBetween(anchor.from,anchor.to,protectedNode)
  else doc.resolve(anchor.from).marks().forEach(m=>{if(/dl|link|note|annotation/i.test(m.type.name))protectedMark=true})
  if(protectedMark)throw new Error('写入范围包含关系链接或批注，请调整范围')
  return true
}

export function normalizeWritingAnchor(anchor,work,chapterId) {
  if(!anchor)return null
  const ch=work.chapters.find(c=>c.id===chapterId&&!c.deletedAt)
  if(!ch||anchor.workId!==work.work.id||anchor.chapterId!==chapterId||anchor.sourceHash!==chapterHash(ch))throw new Error('写作位置属于其他作品或正文版本已变化')
  if(!['insert','append','afterSelection','replace'].includes(anchor.mode)||!Number.isInteger(anchor.from)||!Number.isInteger(anchor.to)||anchor.from<1||anchor.to<anchor.from||!Number.isInteger(anchor.cutoff)||anchor.cutoff<0||anchor.cutoff>plainChapter(ch).length||typeof anchor.docHash!=='string')throw new Error('写作位置格式无效')
  for(const key of ['selection','left','right','label'])if(typeof anchor[key]!=='string')throw new Error('写作位置内容无效')
  if(anchor.mode==='replace'&&(!anchor.selection||anchor.to===anchor.from))throw new Error('改写选段不能为空')
  if(anchor.mode!=='replace'&&anchor.to!==anchor.from)throw new Error('插入范围不能替换正文')
  return JSON.parse(JSON.stringify(anchor))
}
