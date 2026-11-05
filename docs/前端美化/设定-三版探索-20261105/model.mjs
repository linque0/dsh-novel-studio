const clone=value=>structuredClone(value)
export class LoreModel {
 constructor(seed){this.data=clone(seed);this.selected='lighthouse';this.setId='geography';this.history=[];this.future=[]}
 node(id){return this.data.nodes.find(n=>n.id===id)}
 children(id){return this.data.nodes.filter(n=>n.parentId===id).sort((a,b)=>(a.order||0)-(b.order||0))}
 path(id){const out=[],seen=new Set();let n=this.node(id);while(n&&!seen.has(n.id)){seen.add(n.id);out.unshift(n);n=this.node(n.parentId)}return out}
 root(id){return this.path(id).find(n=>n.isSet)}
 descendants(id){const out=[],seen=new Set([id]);const walk=p=>{for(const n of this.children(p)){if(seen.has(n.id))continue;seen.add(n.id);out.push(n);walk(n.id)}};walk(id);return out}
 search(q,tag=''){q=q.trim().toLowerCase();return this.data.nodes.filter(n=>!n.isSet&&(!q||[n.title,n.body,...(n.tags||[])].join(' ').toLowerCase().includes(q))&&(!tag||(n.tags||[]).includes(tag)))}
 snapshot(){return {data:clone(this.data),selected:this.selected,setId:this.setId}}
 checkpoint(){this.history.push(this.snapshot());if(this.history.length>60)this.history.shift();this.future=[]}
 restore(s){this.data=clone(s.data);this.selected=this.node(s.selected)?.id||this.data.nodes.find(n=>!n.isSet)?.id||null;this.setId=this.node(s.setId)?.id||this.data.nodes.find(n=>n.isSet)?.id||null}
 update(id,patch){const n=this.node(id);if(!n)return false;if(Object.entries(patch).every(([k,v])=>JSON.stringify(n[k])===JSON.stringify(v)))return false;this.checkpoint();Object.assign(n,patch);return true}
 add(parentId,fields={},afterId=null){if(!this.node(parentId)||this.node(parentId).kind==='person')return false;this.checkpoint();const siblings=this.children(parentId);siblings.forEach((n,i)=>n.order=i*100);const at=siblings.findIndex(n=>n.id===afterId),order=at<0?(siblings.at(-1)?.order||0)+100:((siblings[at].order||0)+(siblings[at+1]?.order??(siblings[at].order||0)+200))/2;const row={id:'n-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),parentId,title:'未命名设定',body:'',tags:[],kind:'entry',order,...fields};this.data.nodes.push(row);this.selected=row.id;this.setId=this.root(row.id)?.id||this.setId;return row}
 move(id,parentId,beforeId=null){const n=this.node(id),p=this.node(parentId);if(!n||n.isSet||!p||p.kind==='person'||id===parentId||this.descendants(id).some(c=>c.id===parentId))return false;this.checkpoint();n.parentId=parentId;const siblings=this.children(parentId).filter(c=>c.id!==id),at=siblings.findIndex(c=>c.id===beforeId);siblings.splice(at<0?siblings.length:at,0,n);siblings.forEach((c,i)=>c.order=i*100);this.setId=this.root(id)?.id||this.setId;return true}
 indent(id){const n=this.node(id);if(!n||n.isSet)return false;const sib=this.children(n.parentId),i=sib.findIndex(n=>n.id===id);return i>0?this.move(id,sib[i-1].id):false}
 outdent(id){const n=this.node(id),p=n&&this.node(n.parentId);if(!p||p.isSet||!p.parentId)return false;const siblings=this.children(p.parentId),next=siblings[siblings.findIndex(n=>n.id===p.id)+1];return this.move(id,p.parentId,next?.id)}
 remove(id){const n=this.node(id);if(!n||n.isSet)return false;this.checkpoint();const ids=new Set([id,...this.descendants(id).map(n=>n.id)]);this.data.nodes=this.data.nodes.filter(n=>!ids.has(n.id));this.data.relations=this.data.relations.filter(r=>!ids.has(r.from)&&!ids.has(r.to));if(ids.has(this.selected))this.selected=this.children(this.setId)[0]?.id||null;return true}
 links(id){return this.data.relations.filter(r=>r.from===id||r.to===id).map(r=>({...r,otherId:r.from===id?r.to:r.from,direction:r.from===id?'out':'in',displayLabel:r.from===id?r.label:r.reverseLabel||r.label}))}
 addRelation(from,to,label,reverseLabel='',description=''){label=label.trim();if(from===to||!this.node(from)||!this.node(to)||!label||this.data.relations.some(r=>r.from===from&&r.to===to&&r.label===label))return false;this.checkpoint();const r={id:'r-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),from,to,label,reverseLabel,description};this.data.relations.push(r);return r}
 removeRelation(id){if(!this.data.relations.some(r=>r.id===id))return false;this.checkpoint();this.data.relations=this.data.relations.filter(r=>r.id!==id);return true}
 undo(){if(!this.history.length)return false;this.future.push(this.snapshot());this.restore(this.history.pop());return true}
 redo(){if(!this.future.length)return false;this.history.push(this.snapshot());this.restore(this.future.pop());return true}
}
