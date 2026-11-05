// UI labels are also aliases for plain [[title]] references in the AI read model.
export function doublelinkTitle(kind,row,book) {
  if(kind==='chapter')return row.title||'未命名章节'
  if(kind==='mubu')return (row.text||'').slice(0,40)||'（空节点）'
  if(kind==='character')return row.name||'未命名'
  if(kind==='snippet')return ((row.content||'').split('\n').find(s=>s.trim())||'（空）').slice(0,30)
  if(kind==='outline') {
    if(row.id===book.work?.id)return '总纲'
    const volume=book.volumes?.find(v=>v.id===row.id&&!v.deletedAt)
    if(volume)return '卷纲 · '+volume.title
    const chapter=book.chapters?.find(c=>c.id===row.id&&!c.deletedAt)
    return chapter?'章纲 · '+chapter.title:'大纲'
  }
  return ''
}
