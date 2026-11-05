// UI-only preference shared by the manuscript, toolbar and settings preview.
export const WRITING_PAPERS=Object.freeze([
  {id:'booklet',label:'轻装帧书册',description:'细纸纹 · 柔和书脊 · 薄页边'},
  {id:'manuscript',label:'旧纸手稿',description:'淡纤维 · 自然纸边 · 温润纸色'},
  {id:'hardcover',label:'摊开的精装书',description:'装订凹槽 · 叠页厚度 · 封面衬边'},
])
export const normalizeWritingPaper=value=>WRITING_PAPERS.some(p=>p.id===value)?value:'booklet'
export async function saveWritingPaperPreference(state,value,{write,notify}){
  if(state.writingPaperSaving)return false
  state.writingPaperSaving=true
  try{
    const next=normalizeWritingPaper(value)
    await write({key:'writingPaperStyle',value:next})
    state.writingPaperStyle=next
    notify()
    return true
  }finally{state.writingPaperSaving=false}
}
