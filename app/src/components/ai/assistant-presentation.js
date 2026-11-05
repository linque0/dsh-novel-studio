// View-only associations. Keep original messages and canonical writing state intact.
export function directionMessageId(messages,session){
  if(!session)return null
  return messages.filter(m=>m.workId===session.workId&&m.source?.taskRequest?.type==='chapter.directions'&&m.source.taskRequest.writingSessionId===session.id).at(-1)?.id||null
}
export function messageCards(message,session){
  const cards=message.cards||[]
  if(!session||message.workId!==session.workId)return cards
  const canonical=new Map(session.candidates.map(c=>[c.id,c]))
  return cards.map(c=>canonical.get(c.id)||c)
}
export function showRecoveredWriting(messages,session){
  if(!session)return false
  const represented=new Set(messages.filter(m=>m.workId===session.workId).flatMap(m=>(m.cards||[]).map(c=>c.id)))
  return session.directions.length>0&&!directionMessageId(messages,session)||session.candidates.some(c=>!represented.has(c.id))
}
