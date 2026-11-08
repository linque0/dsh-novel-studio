const clone=x=>JSON.parse(JSON.stringify(x))
export function fingerprint(row){
 function clean(x){if(Array.isArray(x))return x.map(clean);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().filter(k=>k!=='updatedAt').map(k=>[k,clean(x[k])]));return x}
 return JSON.stringify(clean(row??null))
}
export function inverseChanges(changes){return changes.map(c=>({...c,before:clone(c.after),after:c.before==null?{...clone(c.after),deletedAt:Date.now()}:clone(c.before)}))}
/** Command preparation happens once. A failed commit retries the same IDs and expected rows. */
export function createSnippetHistory({apply,before=async()=>{},committed=()=>{},changed=()=>{}}){
 const works=new Map()
 const get=id=>{if(!works.has(id))works.set(id,{past:[],future:[],pending:null,error:null,queue:Promise.resolve(),busy:false});return works.get(id)}
 function serial(id,fn){const s=get(id),job=s.queue.catch(()=>{}).then(async()=>{s.busy=true;changed(id,s);try{return await fn(s)}finally{s.busy=false;changed(id,s)}});s.queue=job;return job}
 async function perform(id,s,pending){
  try{
   await before(id)
   await apply(id,pending.changes,{created:pending.created||[]})
   const {phase,entry}=pending
   if(phase==='execute'){s.past.push({...entry,changes:clone(pending.changes)});if(s.past.length>40)s.past.shift();s.future=[]}
   else if(phase==='undo'){s.past.pop();s.future.push({...entry,changes:clone(pending.changes)})}
   else{s.future.pop();s.past.push({...entry,changes:clone(pending.changes)})}
   s.pending=null;s.error=null
  }catch(error){
   const conflict=error.code==='CONFLICT'
   if(conflict){s.past=[];s.future=[];s.pending=null}else s.pending=pending
   s.error=error;return {ok:false,conflict,error}
  }
  // The transaction is already durable. A view notification must never make it retryable.
  try{await committed(id,pending)}catch(error){s.error=error}
  return {ok:true,result:pending.entry.result,context:pending.entry.context,phase:pending.phase}
 }
 return {
  get,
  execute(id,prepare){return serial(id,async s=>{
   if(s.pending)return {ok:false,error:Error('请先重试尚未保存的操作')}
   try{await before(id);const entry=await prepare();if(!entry.changes.length)return {ok:true,result:entry.result,empty:true};return perform(id,s,{phase:'execute',entry,changes:clone(entry.changes)})}catch(error){s.error=error;if(error.code==='CONFLICT'){s.past=[];s.future=[]}return {ok:false,conflict:error.code==='CONFLICT',error}}
  })},
  retry(id){return serial(id,s=>s.pending?perform(id,s,s.pending):Promise.resolve({ok:true}))},
  step(id,direction){return serial(id,async s=>{
   if(s.pending)return {ok:false,error:Error('请先重试尚未保存的操作')}
   const list=direction==='redo'?s.future:s.past,entry=list.at(-1)
   if(!entry)return {ok:true,empty:true}
   const changes=inverseChanges(entry.changes),created=changes.filter(c=>entry.createdIds?.includes(c.id)&&c.after?.deletedAt).map(c=>({table:c.table,id:c.id}))
   return perform(id,s,{phase:direction,entry,changes,created})
  })}
 }
}
