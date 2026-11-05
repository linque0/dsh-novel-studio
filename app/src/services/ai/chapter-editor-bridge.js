// The domain command names the target explicitly. Each window supplies its
// shared editor session; no dependency on the hand-writing page being open.
let current = null
export function registerChapterEditorBridge(bridge) {
  current=bridge
  return ()=>{if(current===bridge)current=null}
}
export async function ensureChapterEditor(workId,chapterId) {
  const bridge=current
  if(!bridge || bridge.getWorkId()!==workId)throw new Error('目标作品的编辑会话不可用')
  const result=await bridge.ensure(chapterId)
  if(current!==bridge || bridge.getWorkId()!==workId)throw new Error('作品已切换，拒绝应用旧稿')
  return result
}
