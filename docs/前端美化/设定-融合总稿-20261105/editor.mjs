import {$,$$,cleanHtml,markup,caretOffset,setCaret} from './ui.mjs'
export function bindEditor(ctx){let dragId=null,composing=false,range=null
 const field=e=>e.target.closest('[data-edit-node]')
 function draft(el){const id=el.dataset.editNode;if(!ctx.store.node(id))return;ctx.drafts.set(id,{id,text:el.innerText.replace(/\u00a0/g,' '),html:cleanHtml(el.innerHTML)});ctx.caret={id,offset:caretOffset(el)};ctx.status()}
 function focus(id,offset=null){requestAnimationFrame(()=>{const el=$(`[data-edit-node="${id}"]`);if(el){el.scrollIntoView({block:'nearest'});setCaret(el,offset??ctx.store.node(id)?.text.length??0)}})}
 function change(fn,id,offset=null){ctx.commit();const result=fn();if(!result)ctx.toast('该操作在当前层级不可用');ctx.save();ctx.render();focus(typeof result==='string'?result:id,offset);return result}
 document.addEventListener('compositionstart',e=>{if(field(e))composing=true})
 document.addEventListener('compositionend',e=>{if(field(e)){composing=false;draft(field(e))}})
 document.addEventListener('input',e=>{const el=field(e);if(el)draft(el)})
 document.addEventListener('focusin',e=>{const el=field(e);if(!el)return;const id=el.dataset.editNode;ctx.store.selected=id;ctx.caret={id,offset:caretOffset(el)};$$('.mubu-row').forEach(row=>row.classList.toggle('selected',row.dataset.row===id));ctx.updateLocation();ctx.save()})
 document.addEventListener('focusout',e=>{const el=field(e);if(el&&!composing){ctx.caret={id:el.dataset.editNode,offset:caretOffset(el)};ctx.commit(el.dataset.editNode)}})
 document.addEventListener('paste',e=>{if(!field(e))return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))})
 document.addEventListener('keydown',e=>{const el=field(e);if(!el||composing||e.isComposing||e.keyCode===229)return;const id=el.dataset.editNode,offset=caretOffset(el),m=ctx.store;ctx.caret={id,offset}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();ctx.drafts.delete(id);el.innerHTML=markup(m.node(id));ctx.status();setCaret(el,Math.min(offset,m.node(id).text.length));return}
  if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();ctx.commit();e.key.toLowerCase()==='y'||e.shiftKey?m.redo():m.undo();ctx.save();ctx.render();focus(m.selected);return}
  if((e.ctrlKey||e.metaKey)&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault();document.execCommand(({b:'bold',i:'italic',u:'underline'})[e.key.toLowerCase()]);draft(el);return}
  if(e.key==='Enter'&&e.shiftKey){e.preventDefault();document.execCommand('insertLineBreak');draft(el);return}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ctx.commit();const n=m.node(id),row=m.add(n.parentId,id,'');ctx.reveal(row.id);ctx.save();ctx.render();focus(row.id,0);return}
  if(e.key==='Tab'){e.preventDefault();change(()=>e.shiftKey?m.outdent(id):m.indent(id),id,offset);return}
  if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();change(()=>m.reorder(id,e.key==='ArrowUp'?-1:1),id,offset);return}
  if(e.key==='Backspace'&&offset===0){e.preventDefault();const previous=m.children(m.node(id).parentId),at=previous.findIndex(n=>n.id===id),target=previous[at-1],len=target?.text.length;change(()=>m.backspace(id),id,len);return}
  const rows=ctx.store.visible(ctx.store.setId,ctx.prefs.writeFold,ctx.query,ctx.tag),i=rows.findIndex(r=>r.node.id===id)
  if(e.key==='ArrowUp'&&offset===0&&i>0){e.preventDefault();focus(rows[i-1].node.id)}
  if(e.key==='ArrowDown'&&offset===el.innerText.length&&i<rows.length-1){e.preventDefault();focus(rows[i+1].node.id,0)}
 })
 document.addEventListener('selectionchange',()=>{const s=getSelection(),el=s?.anchorNode?.parentElement?.closest('[data-edit-node]'),bar=$('#selection-tools');if(el&&s.isCollapsed)ctx.caret={id:el.dataset.editNode,offset:caretOffset(el)};if(!bar)return;if(!el||s.isCollapsed||!el.contains(s.focusNode)){bar.hidden=true;return}range=s.getRangeAt(0).cloneRange();const r=range.getBoundingClientRect();bar.hidden=false;bar.style.left=Math.max(12,Math.min(innerWidth-190,r.x+r.width/2-88))+'px';bar.style.top=Math.max(88,r.top-42)+'px'})
 document.addEventListener('mousedown',e=>{if(e.target.closest('[data-format],[data-editor-command]'))e.preventDefault()})
 document.addEventListener('click',e=>{const format=e.target.closest('[data-format]');if(!format)return;e.preventDefault();if(format.closest('#selection-tools')&&range){const s=getSelection();s.removeAllRanges();s.addRange(range)}const el=getSelection()?.anchorNode?.parentElement?.closest('[data-edit-node]');if(!el)return;document.execCommand(format.dataset.format);draft(el)})
 document.addEventListener('dblclick',e=>{const el=field(e);if(el&&ctx.view==='write'){e.preventDefault();ctx.open('detail',el.dataset.editNode)}})
 document.addEventListener('contextmenu',e=>{const row=e.target.closest('[data-row]');if(!row)return;e.preventDefault();ctx.showNodeMenu(row.dataset.row)})
 document.addEventListener('dragstart',e=>{const h=e.target.closest('[data-drag]');if(!h)return;ctx.commit();dragId=h.dataset.drag;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';h.closest('[data-row]').classList.add('dragging')})
 document.addEventListener('dragover',e=>{const row=e.target.closest('[data-row]');if(!dragId||!row)return;e.preventDefault();$$('[data-drop]').forEach(el=>delete el.dataset.drop);const r=row.getBoundingClientRect(),p=(e.clientY-r.top)/r.height;row.dataset.drop=p<.28?'before':p>.72?'after':'inside'})
 document.addEventListener('drop',e=>{const row=e.target.closest('[data-row]'),surface=e.target.closest('.write-surface');if(!dragId||!surface)return;e.preventDefault();const group=e.target.closest('[data-write-set]'),target=row?.dataset.row||group?.dataset.writeSet||ctx.store.setId,zone=row?.dataset.drop||'inside';const ok=ctx.store.move(dragId,target,zone);dragId=null;if(!ok)ctx.toast('不能归入自身或后代条目');ctx.save();ctx.render()})
 document.addEventListener('dragend',()=>{dragId=null;$$('[data-drop]').forEach(el=>delete el.dataset.drop);$$('.dragging').forEach(el=>el.classList.remove('dragging'))})
 return {focus,draft,get composing(){return composing}}
}
