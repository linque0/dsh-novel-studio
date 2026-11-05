async function flushCurrent({ui,work,flush}){
  const id=work.work?.id
  if(!id)throw new Error('请先打开作品')
  await flush()
  if(work.work?.id!==id)throw new Error('作品已切换，请重新进入')
  if(ui.autosave?.pending)throw new Error('当前编辑尚未保存，请处理保存错误后再切换模式')
}
export async function enterDreamMode(context){
  const {ui,work}=context
  if(!work.work){ui.dreamLauncherOpen=true;return}
  await flushCurrent(context)
  ui.focusMode=false;ui.readMode=false;ui.workbenchMode='agent'
}
export async function enterLightSleepMode(context){
  const {ui,isDetached=()=>false,focusDetached,toggle=false}=context
  await flushCurrent(context)
  ui.focusMode=false;ui.readMode=false;ui.workbenchMode='writing'
  if(isDetached()){await focusDetached?.();return}
  ui.aiDrawerOpen=toggle?!ui.aiDrawerOpen:true
}
export async function openDreamBook({ui,work,workId}){
  const previous=ui.workbenchMode
  ui.workbenchMode='agent'
  try{
    await work.open(workId)
    if(work.work?.id!==workId)throw new Error('故事未能打开，请重试')
    ui.focusMode=false;ui.readMode=false;ui.dreamLauncherOpen=false
  }catch(e){ui.workbenchMode=previous;throw e}
}
