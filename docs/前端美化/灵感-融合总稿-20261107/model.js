;(function(){
 const clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)
 const stamp=()=>{const d=new Date(),pad=n=>String(n).padStart(2,'0');return {date:[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-'),time:pad(d.getHours())+':'+pad(d.getMinutes())}}
 function initial(seed){return {version:1,work:seed.work,notes:clone(seed.notes),targets:clone(seed.targets),order:seed.notes.map(n=>n.id),drafts:{quick:'',edit:{}},ui:{view:'journal',filter:'all',tag:'',query:'',sort:'new',selected:'i01',group:'场景',inspector:{journal:true,board:false},positions:{journal:[0,0],board:[0,0]}}}}
 function hydrate(d){
  if(d?.version!==1||!Array.isArray(d.notes)||!Array.isArray(d.targets)||!d.drafts?.edit||!d.ui?.positions||!d.order)throw Error('读取的数据不完整')
  if(d.notes.some(n=>typeof n.id!=='string'||typeof n.title!=='string'||typeof n.body!=='string'||!Array.isArray(n.tags)||!Array.isArray(n.links)))throw Error('读取的片段不完整')
  return d
 }
 const get=(d,id)=>{const n=d.notes.find(n=>n.id===id);if(!n)throw Error('这条灵感已不可用');return n}
 function visible(d,u){
  const q=String(u.query||'').trim().toLowerCase()
  const list=d.notes.filter(n=>(u.filter==='trash'?!!n.deletedAt:!n.deletedAt)&&(!u.tag||n.tags.includes(u.tag))&&(u.filter!=='untagged'||!n.tags.length)&&(u.filter!=='linked'||n.links.length)&&(!q||[n.title,n.body,...n.tags,...n.links.map(r=>r.name)].join('\n').toLowerCase().includes(q)))
  const index=new Map(d.order.map((id,i)=>[id,i])),time=n=>n.date+' '+n.time
  return list.sort(u.sort==='manual'?(a,b)=>(index.get(a.id)??1e9)-(index.get(b.id)??1e9):u.sort==='old'?(a,b)=>time(a).localeCompare(time(b)):(a,b)=>time(b).localeCompare(time(a))||(index.get(a.id)??0)-(index.get(b.id)??0))
 }
 function groups(rows){return ['场景','人物','对白','其他标签','未标记'].map(id=>({id,notes:rows.filter(n=>id==='未标记'?!n.tags.length:id==='其他标签'?n.tags.length&&!n.tags.some(t=>['场景','人物','对白'].includes(t)):n.tags.includes(id))})).filter(g=>g.notes.length)}
 function capture(d,text,tag=''){
  const lines=String(text).trim().split('\n'),title=lines.shift().trim();if(!title)throw Error('先写下一点想法，再记录。')
  const n={id:uid(),title,body:lines.join('\n').trim(),tags:tag?[tag]:[],links:[],...stamp()};d.notes.unshift(n);d.order.unshift(n.id);d.drafts.quick='';return n
 }
 function edit(d,id,title,body){if(!title.trim())throw Error('请保留一个标题。');Object.assign(get(d,id),{title:title.trim(),body:String(body),updatedAt:Date.now()});delete d.drafts.edit[id]}
 function tag(d,id,value){const n=get(d,id),t=String(value).trim().replace(/^#+/,'');if(!t||t.length>30)throw Error('标签需要 1–30 个字。');if(!n.tags.includes(t))n.tags.push(t)}
 const untag=(d,id,t)=>get(d,id).tags=get(d,id).tags.filter(x=>x!==t)
 function link(d,id,target){const n=get(d,id),t=d.targets.find(r=>r.id===target);if(!t)throw Error('关联目标已不可用');if(!n.links.some(r=>r.id===t.id))n.links.push({id:t.id,kind:t.kind,name:t.name})}
 const unlink=(d,id,target)=>get(d,id).links=get(d,id).links.filter(r=>r.id!==target)
 function convert(d,id,kind,path){const n=get(d,id),t={id:uid(),kind,name:n.title,body:n.body,path,createdAt:Date.now()};d.targets.push(t);link(d,id,t.id);return t}
 const remove=(d,id)=>get(d,id).deletedAt=Date.now(),restore=(d,id)=>delete get(d,id).deletedAt
 function move(d,id,before){if(id===before)return;d.order=d.order.filter(i=>i!==id);const p=d.order.indexOf(before);d.order.splice(p<0?d.order.length:p,0,id)}
 globalThis.IdeaModel={initial,hydrate,visible,groups,capture,edit,tag,untag,link,unlink,convert,remove,restore,move,clone,stamp}
})();
