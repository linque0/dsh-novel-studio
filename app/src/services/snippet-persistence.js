import {normalizeDrafts,normalizeSnipState} from '../components/snippets/snippet-model.js'
const copy=value=>JSON.parse(JSON.stringify(value))
export function sameSnipValue(a,b){
 if(Object.is(a,b))return true
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false
 if(Array.isArray(a)||Array.isArray(b)){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false
  for(let i=0;i<a.length;i++)if(!sameSnipValue(a[i],b[i]))return false
  return true
 }
 const ka=Object.keys(a),kb=Object.keys(b)
 if(ka.length!==kb.length)return false
 for(const k of ka)if(!Object.hasOwn(b,k)||!sameSnipValue(a[k],b[k]))return false
 return true
}
/** 仅写回实际发生变更的灵感字段，保持未变数组/对象引用稳定，避免选卡/滚动触发整板派生重算。 */
export function applySnipSnapshot(store,snapshot,fieldMap){
 if(store.snipStateWorkId!==snapshot.id)store.snipStateWorkId=snapshot.id
 for(const [key,field] of Object.entries(fieldMap)){
  const next=snapshot.state[key]
  if(!sameSnipValue(store[field],next))store[field]=next
 }
 if(!sameSnipValue(store.snipDrafts,snapshot.drafts))store.snipDrafts=snapshot.drafts
 if(!sameSnipValue(store.snipPersistence,snapshot.status))store.snipPersistence=snapshot.status
}
/** Each timer owns a work ID and immutable value. Failed reads never become empty writes. */
export function createSnippetPersistence({read,write,apply=()=>{},delay=250}){
 const sessions=new Map();let active=null,disposed=false
 const get=id=>{
  if(!sessions.has(id))sessions.set(id,{state:normalizeSnipState(null),drafts:normalizeDrafts(null),status:{reading:false,pending:false,readError:false,writeError:false},dirty:new Set(),failed:new Set(),version:{state:0,drafts:0},statePatch:{},draftPatch:{edit:{}},loaded:false,timer:null,loading:null,flushing:null})
  return sessions.get(id)
 }
 const emit=id=>{const s=get(id);s.status.pending=!!s.dirty.size;if(active===id&&!disposed)apply(copy({id,state:s.state,drafts:s.drafts,status:s.status}))}
 const key=(id,kind)=>(kind==='state'?'snipstate:':'snipdraft:')+id
 async function load(id){
  const s=get(id);if(s.loading)return s.loading
  s.status.reading=true;emit(id)
  s.loading=(async()=>{
   await Promise.all(['state','drafts'].map(async kind=>{
    try{
     const value=await read(key(id,kind))
     if(kind==='state')s.state=normalizeSnipState({...normalizeSnipState(value),...s.statePatch})
     else{
      const old=normalizeDrafts(value),patch=s.draftPatch
      if(Object.hasOwn(patch,'quick'))old.quick=patch.quick
      for(const [id,draft] of Object.entries(patch.edit)){if(draft)old.edit[id]=copy(draft);else delete old.edit[id]}
      s.drafts=old
     }
     s.failed.delete(kind)
    }catch{s.failed.add(kind)}
   }))
   s.loaded=!s.failed.size;s.status.readError=!!s.failed.size;s.status.reading=false;emit(id)
  })()
  try{await s.loading}finally{s.loading=null}
 }
 function schedule(id){const s=get(id);clearTimeout(s.timer);s.timer=setTimeout(()=>flush(id),delay)}
 function patchState(id,patch){
  const s=get(id),clean=copy(patch),next=normalizeSnipState({...s.state,...clean})
  if(sameSnipValue(s.state,next))return
  Object.assign(s.statePatch,clean);s.state=next;s.version.state++;s.dirty.add('state');emit(id);schedule(id)
 }
 function patchDrafts(id,patch){
  const s=get(id)
  if(Object.hasOwn(patch,'quick')){s.drafts.quick=String(patch.quick||'');s.draftPatch.quick=s.drafts.quick}
  for(const [key,value] of Object.entries(patch.edit||{})){s.draftPatch.edit[key]=value?copy(value):null;if(value)s.drafts.edit[key]=copy(value);else delete s.drafts.edit[key]}
  s.version.drafts++;s.dirty.add('drafts');emit(id);schedule(id)
 }
 async function flush(id){
  const s=get(id);clearTimeout(s.timer);if(s.loading)await s.loading
  if(s.flushing){await s.flushing;if(s.status.writeError)return false;return s.dirty.size?flush(id):true}
  s.flushing=(async()=>{
   let ok=true
   for(const kind of [...s.dirty]){
    if(s.failed.has(kind)){ok=false;continue}
    const version=s.version[kind],snapshot=copy(s[kind])
    try{
     await write(key(id,kind),snapshot)
     if(s.version[kind]===version){s.dirty.delete(kind);if(kind==='state')s.statePatch={};else s.draftPatch={edit:{}}}
    }catch{ok=false}
   }
   s.status.writeError=!ok&&!s.failed.size;emit(id);return ok
  })()
  let ok;try{ok=await s.flushing}finally{s.flushing=null}
  return ok&&s.dirty.size&&!s.failed.size?flush(id):ok
 }
 return {
  get active(){return active},get,patchState,patchDrafts,
  async activate(id){active=id;if(!id)return;emit(id);const s=get(id);if(!s.loaded)await load(id);emit(id)},
  async retry(id=active){if(!id)return true;const s=get(id);if(s.failed.size)await load(id);return flush(id)},
  flush,async flushAll(){const all=await Promise.all([...sessions.keys()].map(flush));return all.every(Boolean)},
  dispose(){disposed=true;for(const s of sessions.values())clearTimeout(s.timer)}
 }
}
