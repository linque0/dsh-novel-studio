/** Read both generations without rewriting source rows or guessing by title. */
export function snippetReferences(row){
 const seen=new Set(),out=[]
 for(const item of [...(row.links||[]),...(row.aiLinks||[])]){
  const type=item.kind||item.type,kind=type==='lore'?'mubu':type,id=item.id
  if(!['chapter','mubu','character','outline','olnode','snippet'].includes(kind)||!id||seen.has(kind+':'+id))continue
  seen.add(kind+':'+id);out.push({kind,id})
 }
 return out
}
