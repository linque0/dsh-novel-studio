import {protocolHash,assertReviewCurrent} from './review-cycle.js'

export const storyHash=protocolHash
export function storyPreview(raw){
  const match=String(raw||'').match(/"text"\s*:\s*"((?:\\[\s\S]|[^"\\])*)/)
  if(!match)return ''
  try{return JSON.parse('"'+match[1]+'"')}catch{return ''}
}
const copy=x=>JSON.parse(JSON.stringify(x))
export const storyHtml=text=>String(text).split(/\n\s*\n|\n/).filter(Boolean).map(p=>'<p>'+p.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</p>').join('')||'<p></p>'
export function createStoryDocument({workId,chapterId,text='',html='',sourceHash,config={}}){
  if(!workId||!chapterId)throw new Error('故事需要明确作品与章节')
  return {id:'story-document:'+workId+':'+chapterId,type:'story-document',schemaVersion:1,incarnation:crypto.randomUUID(),workId,chapterId,version:0,revision:0,text,html:html||storyHtml(text),sourceHash,config:{genre:'自由构思',guidance:'',controlPolicy:'narrator',...config},turns:[],review:null,reviewHistory:[],status:'draft',createdAt:Date.now(),updatedAt:Date.now()}
}
export function storyRequest(doc,instruction='',operation='advance'){
  if(!['advance','regenerate','discuss'].includes(operation))throw new Error('未知故事动作')
  const last=doc.turns.at(-1)
  if(operation==='regenerate')assertVariantCurrent(doc)
  return {type:'chapter.story',workId:doc.workId,chapterId:doc.chapterId,story:{documentId:doc.id,revision:doc.revision,operation,controlPolicy:doc.config.controlPolicy,genre:doc.config.genre,guidance:doc.config.guidance||'',instruction:String(instruction||''),text:operation==='regenerate'?last.baseText:doc.text}}
}
function changed(doc){doc.revision++;doc.status='draft';doc.check=null;doc.confirmation=null;doc.decisions={};if(doc.review){doc.reviewHistory.push(doc.review);doc.review=null}}
export function editStoryDocument(doc,{text,html}){
  if(typeof text!=='string'||text.length>200000)throw new Error('当前稿件超过单章上限，请分章')
  if(text===doc.text&&html===doc.html)return
  changed(doc);doc.text=text;doc.html=html||storyHtml(text)
}
function assertVariantCurrent(doc){
  const turn=doc.turns.at(-1),variant=turn?.variants[turn.selected]
  if(!variant||variant.documentHash!==protocolHash([doc.text,doc.html]))throw new Error('本轮之后已有人工编辑，请继续故事以保留编辑；不能直接覆盖换版本')
  return turn
}
export function appendStoryTurn(doc,result,{regenerate=false}={}){
  if(typeof result.text!=='string'||!result.text.trim())throw new Error('模型没有返回完整故事正文')
  const turn=regenerate?assertVariantCurrent(doc):{id:result.id||crypto.randomUUID(),baseText:doc.text,baseHtml:doc.html,variants:[],selected:0,instruction:result.instruction||'',createdAt:Date.now()}
  const text=[turn.baseText,result.text.trim()].filter(Boolean).join('\n\n')
  if(text.length>200000)throw new Error('当前章节过长，请先分章')
  const html=(turn.baseText?turn.baseHtml:'')+storyHtml(result.text.trim())
  const variant={id:result.id||crypto.randomUUID(),text,html,documentHash:protocolHash([text,html]),source:copy(result.source||{}),createdAt:Date.now()}
  changed(doc);turn.variants.push(variant);turn.selected=turn.variants.length-1
  if(!regenerate)doc.turns.push(turn)
  doc.text=text;doc.html=html
}
export function selectStoryVariant(doc,index){
  const turn=assertVariantCurrent(doc)
  if(!Number.isInteger(index)||!turn.variants[index])throw new Error('故事版本不存在')
  changed(doc);turn.selected=index;doc.text=turn.variants[index].text;doc.html=turn.variants[index].html
}
export function assertStoryReview(doc){
  if(!doc.review)throw new Error('当前稿件尚未审稿或稿件已变化')
  return assertReviewCurrent(doc.review,{id:doc.id,revision:doc.revision,text:doc.text})
}
export function canAutoAdvance({round,maxRounds=6,remaining,targetWords},doc){
  return round<Math.min(6,maxRounds)&&remaining>=2048&&doc.text.replace(/\s/g,'').length<targetWords
}
