import {esc,icon,markup,cleanHtml,caretOffset,setCaret} from './ui.mjs'

export function referenceIds(n){return [...String(n?.html||'').matchAll(/data-link-id="([^"]+)"/g)].map(m=>m[1])}

export function bindLinks(ctx){
 let saved=null,field=null,picker=null,query='',index=0,range=null,items=[],hoverTimer=null;
 const editorField=el=>el?.closest?.('[data-edit-node]');
 const currentRange=()=>{const s=getSelection();return s?.rangeCount?s.getRangeAt(0).cloneRange():null};
 function close(){picker?.remove();picker=null;query='';index=0;document.querySelector('#link-hover')?.remove()}
 function position(el,rect){el.style.left=Math.max(12,Math.min(innerWidth-el.offsetWidth-12,rect.left))+'px';el.style.top=Math.max(100,Math.min(innerHeight-el.offsetHeight-12,rect.bottom+9))+'px'}
 function update(){
  items=ctx.store.data.nodes.filter(n=>n.id!==field?.dataset.editNode&&n.text.trim()&&(!query||n.text.toLowerCase().includes(query.toLowerCase()))).slice(0,7);
  if(index>=items.length)index=0;
  picker.innerHTML=`<div class="link-picker-label">${icon('link',13)} 链接到节点 <kbd>Esc</kbd></div>${items.map((n,i)=>`<button class="${index===i?'active':''}" data-link-choice="${n.id}"><span>${icon(n.kind||'entry',14)}<strong>${esc(n.text.length>26?n.text.slice(0,26)+'…':n.text)}</strong></span><small>${esc(ctx.store.path(n.id).slice(0,-1).map(n=>n.text.slice(0,10)).join(' › ')||'世界设定')}</small>${index===i?'<kbd>↵</kbd>':''}</button>`).join('')||'<p class="link-picker-empty">没有匹配节点</p>'}${query?`<button data-link-create="true" class="create-linked">${icon('plus',13)} 创建「${esc(query.slice(0,24))}」</button>`:''}<footer>↑ ↓ 选择 · Enter 插入 · 悬停链接预览</footer>`;
  const rect=range?.getBoundingClientRect();position(picker,rect?.width||rect?.height?rect:field.getBoundingClientRect());
 }
 function openPicker(){
  if(!field?.isConnected)field=document.querySelector(`[data-edit-node="${ctx.selected}"]`)||document.querySelector('.write-surface [data-edit-node]');
  if(!field)return ctx.toast('先点击一个节点，再插入链接');
  if(!range||!field.contains(range.startContainer)){setCaret(field,field.textContent.length);range=currentRange()}
  saved=range?.cloneRange();query='';index=0;
  picker?.remove();picker=document.createElement('div');picker.id='link-picker';picker.className='link-picker';picker.setAttribute('role','dialog');picker.setAttribute('aria-label','选择链接节点');document.body.append(picker);update();
 }
 function detect(el){
  const selection=getSelection();if(!selection?.isCollapsed)return;
  const before=selection.getRangeAt(0).cloneRange();before.selectNodeContents(el);before.setEnd(selection.anchorNode,selection.anchorOffset);
  const match=before.toString().match(/\[\[([^\[\]\n]*)$/);
  if(!match){if(picker)close();return}
  field=el;query=match[1];index=0;range=currentRange();saved=range.cloneRange();
  let remaining=before.toString().length-match[0].length;
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){if(remaining<=node.textContent.length){saved.setStart(node,remaining);break}remaining-=node.textContent.length}
  if(!picker){picker=document.createElement('div');picker.id='link-picker';picker.className='link-picker';picker.setAttribute('role','dialog');picker.setAttribute('aria-label','选择链接节点');document.body.append(picker)}update();
 }
 function insert(id){
  const target=ctx.store.node(id);if(!target||!field?.isConnected||!saved)return;
  const sourceId=field.dataset.editNode;ctx.commit();
  const a=document.createElement('a');a.className='wiki-link';a.dataset.linkId=id;a.href='#node='+encodeURIComponent(id);a.textContent=target.text;a.contentEditable='false';
  saved.deleteContents();saved.insertNode(a);saved.setStartAfter(a);saved.collapse(true);getSelection().removeAllRanges();getSelection().addRange(saved);
  const offset=caretOffset(field);ctx.store.edit(sourceId,field.textContent,cleanHtml(field.innerHTML));close();ctx.save();ctx.render();ctx.editor.focus(sourceId,offset);
 }
 function decorate(){for(const a of document.querySelectorAll('a[data-link-id]')){const n=ctx.store.node(a.dataset.linkId);a.classList.toggle('broken-link',!n);a.setAttribute('title',n?'预览 '+n.text+' · 点击侧边查看 · Ctrl+点击进入':'目标节点已删除');a.setAttribute('contenteditable','false')}}
 function hover(a){
  clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{const n=ctx.store.node(a.dataset.linkId);if(!n||!a.isConnected)return;document.querySelector('#link-hover')?.remove();const el=document.createElement('div');el.id='link-hover';el.className='link-hover';el.innerHTML=`<span>${icon('link',12)} ${esc(ctx.store.path(n.id).slice(0,-1).map(n=>n.text.slice(0,10)).join(' › '))}</span><h3>${esc(n.text)}</h3><p>${esc(ctx.store.children(n.id).slice(0,2).map(n=>n.text).join(' ').slice(0,150)||'进入节点继续补充内容')}</p><footer>点击侧边查看 · Ctrl+点击进入</footer>`;document.body.append(el);position(el,a.getBoundingClientRect())},260)
 }
 document.addEventListener('selectionchange',()=>{const el=editorField(getSelection()?.anchorNode?.parentElement);if(el&&!picker){field=el;range=currentRange()}});
 document.addEventListener('input',e=>{const el=editorField(e.target);if(el&&!e.isComposing)detect(el)});
 document.addEventListener('compositionend',e=>{const el=editorField(e.target);if(el)queueMicrotask(()=>detect(el))});
 document.addEventListener('keydown',e=>{
  if(!picker||e.isComposing)return;
  if(['ArrowDown','ArrowUp','Enter','Escape','Tab'].includes(e.key)){
   e.preventDefault();e.stopImmediatePropagation();
   if(e.key==='Escape'||e.key==='Tab'){close();return}
   if(e.key==='Enter'){if(items[index])insert(items[index].id);return}
   index=(index+(e.key==='ArrowDown'?1:-1)+Math.max(1,items.length))%Math.max(1,items.length);update();
  }
 },true);
 document.addEventListener('mousedown',e=>{if(e.target.closest('#link-picker'))e.preventDefault();else if(picker&&!editorField(e.target))close()});
 document.addEventListener('click',e=>{
  const choice=e.target.closest('[data-link-choice]');if(choice){e.preventDefault();e.stopImmediatePropagation();insert(choice.dataset.linkChoice);return}
  if(e.target.closest('[data-link-create]')){e.preventDefault();e.stopImmediatePropagation();const n=ctx.store.add(ctx.rootId,null,query.trim());if(n)insert(n.id);return}
  const a=e.target.closest('a[data-link-id]');if(!a)return;e.preventDefault();e.stopImmediatePropagation();close();ctx.commit();if(!ctx.store.node(a.dataset.linkId))return ctx.toast('目标节点已删除，可撤销删除恢复');if(e.ctrlKey||e.metaKey)ctx.focusNode(a.dataset.linkId);else ctx.showPeek(a.dataset.linkId);
 },true);
 document.addEventListener('mouseover',e=>{const a=e.target.closest('a[data-link-id]');if(a&&!a.contains(e.relatedTarget))hover(a)});
 document.addEventListener('mouseout',e=>{if(e.target.closest('a[data-link-id]')){clearTimeout(hoverTimer);document.querySelector('#link-hover')?.remove()}});
 return {openPicker,decorate,close};
}
