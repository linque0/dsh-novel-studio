import { countWords, stripTags } from './wordcount.js'
import { primaryRole, uniqTags } from './character-tags.js'
export const analysisKey=(work,id)=>JSON.stringify([work,id])
export function snapshotPreview(content, fmt) {
  const raw=String(content||''), known=fmt==='html'||fmt==='text'
  const html=fmt==='html'||!known&&/^\s*<(p|div|h[1-6]|ul|ol|blockquote|pre|table)(?:\s[^>]*|)>[\s\S]*<\/\1>\s*$/i.test(raw)
  let plain=raw
  if(html){
    if(typeof DOMParser!=='undefined'){
      const doc=new DOMParser().parseFromString(raw,'text/html')
      doc.querySelectorAll('script,style').forEach(node=>node.remove())
      doc.querySelectorAll('br').forEach(node=>node.replaceWith(doc.createTextNode('\n')))
      doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr').forEach(node=>node.appendChild(doc.createTextNode('\n')))
      plain=(doc.body.textContent||'').replace(/\n{3,}/g,'\n\n')
    }else plain=stripTags(raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')).replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    plain=plain.trim()
  }
  return {plain,words:countWords(plain),legacy:!known,format:html?'html':'text'}
}
export function localStatsDate(value){
  const date=new Date(value)
  if(!Number.isFinite(date.getTime()))return null
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
}
const words=c=>typeof c.content==='string'?countWords(c.fmt==='html'?stripTags(c.content):c.content):Math.max(0,Number(c.wordCount)||0)
const order=(a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||String(a.id).localeCompare(String(b.id))
export function buildWritingAnalysis(source,{today,workId=null}={}){
  const works=(source.works||[]).filter(w=>!w.deletedAt&&(workId==null||w.id===workId))
  const ids=new Set(works.map(w=>w.id))
  const live=table=>(source[table]||[]).filter(r=>r&&!r.deletedAt&&ids.has(r.workId))
  const text=(value,fallback)=>String(value||'').trim()||fallback
  const volumes=live('volumes').sort(order)
  const vi=new Map(volumes.map(v=>[analysisKey(v.workId,v.id),v]))
  const unassigned=new Map()
  const chapters=live('chapters').sort((a,b)=>{
    const workOrder=works.findIndex(w=>w.id===a.workId)-works.findIndex(w=>w.id===b.workId)
    return workOrder||(vi.get(analysisKey(a.workId,a.volumeId))?.sortOrder??1e12)-(vi.get(analysisKey(b.workId,b.volumeId))?.sortOrder??1e12)||order(a,b)
  }).map(c=>{
    const valid=vi.has(analysisKey(c.workId,c.volumeId)),volume=valid?analysisKey(c.workId,c.volumeId):JSON.stringify([c.workId,null,'unassigned-volume'])
    if(!valid&&!unassigned.has(volume))unassigned.set(volume,{id:volume,work:c.workId,title:'未分卷'})
    return {id:analysisKey(c.workId,c.id),rawId:c.id,work:c.workId,volume,title:text(c.title,'未命名章节'),words:words(c),status:c.status||'draft'}
  })
  const ci=new Map(chapters.map(c=>[c.id,c]))
  const logs=live('wordlog').filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.delta)).map(r=>({id:r.id,work:r.workId,chapter:ci.has(analysisKey(r.workId,r.chapterId))?analysisKey(r.workId,r.chapterId):null,title:'来源章节不可用',date:r.date,delta:r.delta,createdAt:r.createdAt}))
  const versions=(source.revisions||[]).filter(r=>r.entityType==='chapter'&&ci.has(analysisKey(r.workId,r.entityId))&&localStatsDate(r.createdAt)).map(r=>({id:r.id,work:r.workId,chapter:analysisKey(r.workId,r.entityId),rawChapterId:r.entityId,date:localStatsDate(r.createdAt),createdAt:r.createdAt,title:'版本 · '+new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false}),words:null}))
  const events=live('olnodes'), oi=new Map(events.map(r=>[analysisKey(r.workId,r.id),r]))
  const chain=(row,index)=>{const rows=[],seen=new Set([row.id]);for(let id=row.parentId;id&&!seen.has(id);){const p=index.get(analysisKey(row.workId,id));if(!p)break;rows.push(p);seen.add(id);id=p.parentId}return rows}
  const containers=events.filter(r=>r.kind==='container').map(r=>({id:analysisKey(r.workId,r.id),rawId:r.id,work:r.workId,title:text(r.title||r.text,'未命名容器'),events:[]}))
  const groups=new Map(containers.map(r=>[r.id,r]))
  for(const row of events.filter(r=>r.kind==='event')){
    const parents=chain(row,oi).filter(r=>r.kind==='container')
    const all=parents.map(r=>groups.get(analysisKey(r.workId,r.id))).filter(Boolean)
    if(!all.length){
      const key=JSON.stringify([row.workId,null,'unassigned-events'])
      if(!groups.has(key))groups.set(key,{id:key,work:row.workId,title:'未分组事件',events:[]})
      all.push(groups.get(key))
    }
    for(const group of all)group.events.push({id:analysisKey(row.workId,row.id),work:row.workId,title:text(row.title||row.text,'未命名事件'),status:row.status||'planned'})
  }
  const lore=live('mubu'), li=new Map(lore.map(r=>[analysisKey(r.workId,r.id),r])), branches=new Map()
  for(const row of lore){
    const root=[row,...chain(row,li)].at(-1), valid=!root.parentId, id=valid?analysisKey(row.workId,root.id):JSON.stringify([row.workId,null,'unassigned-lore'])
    if(!branches.has(id))branches.set(id,{id,work:row.workId,title:valid?text(root.text,'未命名节点'):'未归入根节点',nodes:[],records:[]})
    const b=branches.get(id);b.records.push({id:analysisKey(row.workId,row.id),title:text(row.text,'未命名节点'),tags:uniqTags(row.tags||[])});if(row!==root||!valid)b.nodes.push(text(row.text,'未命名节点'))
  }
  const people=live('characters').map(r=>({id:analysisKey(r.workId,r.id),rawId:r.id,work:r.workId,title:text(r.name,'未命名人物'),role:primaryRole(r)||'未标记',text:text(r.bio||r.description||r.summary,'暂无人物小传')}))
  const pi=new Set(people.map(r=>r.id))
  const relations=live('relations').filter(r=>pi.has(analysisKey(r.workId,r.fromId))&&pi.has(analysisKey(r.workId,r.toId))).map(r=>({id:analysisKey(r.workId,r.id),work:r.workId,from:analysisKey(r.workId,r.fromId),to:analysisKey(r.workId,r.toId),label:text(r.label||r.type,'关联')}))
  const lorelinks=live('lorelinks').filter(r=>[r.fromKind==='mubu'?li.has(analysisKey(r.workId,r.fromId)):r.fromKind==='character'&&pi.has(analysisKey(r.workId,r.fromId)),r.toKind==='mubu'?li.has(analysisKey(r.workId,r.toId)):r.toKind==='character'&&pi.has(analysisKey(r.workId,r.toId))].every(Boolean))
  const snippets=live('snippets').map(r=>({id:analysisKey(r.workId,r.id),work:r.workId,title:text(r.title||String(r.content||'').replace(/\s+/g,' ').slice(0,70),'未命名灵感'),text:String(r.content||''),date:r.createdAt>0?localStatsDate(r.createdAt):null,createdAt:r.createdAt,tags:uniqTags(r.tags||[])}))
  const day=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
  return {end:today,day,works:works.map((w,i)=>({id:w.id,title:text(w.title,'未命名作品'),genre:text(w.genre,'作品'),mark:text(w.title,'稿').slice(0,1),color:['#b9d8c6','#cab9de','#e2baab'][i%3]})),volumes:[...volumes.map(v=>({id:analysisKey(v.workId,v.id),work:v.workId,title:text(v.title,'未命名卷')})),...unassigned.values()],chapters,logs,versions,outline:[...groups.values()],lore:[...branches.values()],people,relations,lorelinks,snippets}
}

