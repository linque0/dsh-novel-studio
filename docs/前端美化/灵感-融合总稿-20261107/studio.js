;(function(){
 'use strict'
 const M=IdeaModel,R=IdeaRender,$=s=>document.querySelector(s),KEY='latent-inspiration-fusion-v1'
 let d=M.initial(IdeaSeed),storageError='',readError=false,timer=0,toastTimer=0,editingText=false,drag=null,dialogState=null,dialogReturn=null,detailReturn=null,revealed=false,hideTimer=0
 const history=[]
 const params=new URLSearchParams(location.search)
 try{const raw=localStorage.getItem(KEY);if(raw)d=M.hydrate(JSON.parse(raw))}catch{storageError='暂时无法读取记录。当前输入会保留，请重试读取。';readError=true}
 if(['journal','board'].includes(params.get('view')))d.ui.view=params.get('view')
 function save(){
  clearTimeout(timer)
  if(readError){banner();return false}
  try{localStorage.setItem(KEY,JSON.stringify(d));storageError='';banner();return true}catch{storageError='保存未完成，内容仍保留在当前页面。';banner();return false}
 }
 function later(){clearTimeout(timer);timer=setTimeout(save,220)}
 function banner(){const e=$('#save-error');e.hidden=!storageError;e.className='storage-error';if(storageError)e.innerHTML='<span>'+R.esc(storageError)+'</span><button data-act="retry">'+(readError?'重试读取':'重试保存')+'</button>'}
 function retry(){
  if(readError){try{const raw=localStorage.getItem(KEY),v=raw?M.hydrate(JSON.parse(raw)):M.initial(IdeaSeed);v.drafts.quick=d.drafts.quick||v.drafts.quick;v.drafts.edit={...v.drafts.edit,...d.drafts.edit};d=v;readError=false;storageError='';render();save();notify('已恢复读取，未完成输入已保留。')}catch{banner()}}
  else if(save())notify('已保存当前记录。')
 }
 function notify(message,undo=false){const e=$('#toast');clearTimeout(toastTimer);e.hidden=false;e.innerHTML='<span>'+R.esc(message)+'</span>'+(undo?'<button data-act="undo">撤销</button>':'');toastTimer=setTimeout(()=>e.hidden=true,undo?6000:3200)}
 function pane(view=d.ui.view){return view==='board'?$('.board-columns')||$('#view-host'):$('#view-host')}
 function remember(){const e=pane();if(e)d.ui.positions[d.ui.view]=[e.scrollTop,e.scrollLeft]}
 function restore(){const e=pane(),p=d.ui.positions[d.ui.view]||[0,0];if(e){e.scrollTop=p[0];e.scrollLeft=p[1]}}
 function rows(){return M.visible(d,d.ui)}
 function reconcile(){const v=rows();if(!v.some(n=>n.id===d.ui.selected)){d.ui.selected=v[0]?.id||null;d.ui.editing=null}const g=M.groups(v);if(!g.some(g=>g.id===d.ui.group))d.ui.group=g[0]?.id||'场景'}
 function isNarrow(){return innerWidth<1200}
 function bars(){const hidden=!!d.ui.autoHide&&!revealed;$('#topbar').classList.toggle('auto-hidden',hidden);$('#workspace').classList.toggle('auto-hidden',hidden);$('#reveal-bar').hidden=!d.ui.autoHide;$('#pin-entry').setAttribute('aria-pressed',String(!!d.ui.autoHide));$('#pin-entry').setAttribute('aria-label',d.ui.autoHide?'固定顶栏':'自动隐藏顶栏')}
 function render(animate=false){
  reconcile();const u=d.ui,v=rows(),c=R.counts(d)
  $('#sidebar').innerHTML=R.sidebar(d,u);$('#mobile-sidebar').innerHTML=R.sidebar(d,u)
  $('#search').value=u.query||'';$('#sort').value=u.sort||'new'
  document.querySelector('.view-switch').dataset.view=u.view
  for(const view of ['journal','board']){const e=$('#'+view+'-tab');e.setAttribute('aria-selected',String(u.view===view));e.tabIndex=u.view===view?0:-1}
  $('#result-title').textContent=u.tag?'# '+u.tag:{all:'全部灵感',untagged:'未标记',linked:'有关联',trash:'回收站'}[u.filter]||'全部灵感'
  $('#result-count').textContent=v.length+' 条';$('#clear-filter').hidden=!u.tag&&!u.query&&u.filter==='all'
  $('#compose-entry').hidden=u.filter==='trash'
  $('#view-host').innerHTML=R.main(d,u)
  const show=!!u.inspector[u.view]&&!isNarrow();$('#content-grid').classList.toggle('no-inspector',!show);$('#detail-toggle').setAttribute('aria-pressed',String(show))
  if(isNarrow()){$('#inspector').innerHTML='';$('#mobile-inspector').innerHTML=R.inspector(d,u,true)}
  else{$('#mobile-inspector').innerHTML='';$('#inspector').innerHTML=R.inspector(d,u)}
  $('#search-icon').innerHTML=R.icon('search');$('#search-entry').innerHTML=R.icon('search');$('#pin-entry').innerHTML=R.icon('lock')
  bars();banner();restore()
  if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const root=$('#view-host');root.getAnimations().forEach(a=>a.cancel());root.animate([{opacity:.78,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:180,easing:'cubic-bezier(.21,.72,.21,1)'})}
 }
 function commit(change,message){
  if(readError){notify('请先重试读取。未完成输入会保留。');return null}
  const before=M.clone(d),next=M.clone(d)
  try{const result=change(next);history.push(before);if(history.length>40)history.shift();d=next;const ok=save();render();if(message)notify(message+(ok?'':'，等待保存。'),true);return result===undefined?true:result}catch(error){notify(error.message);return null}
 }
 function returnFocus(origin,fallback='#compose-entry'){
  if(origin?.isConnected){origin.focus({preventScroll:true});return}
  const id=origin?.dataset?.id,act=origin?.dataset?.act
  const match=[...document.querySelectorAll('[data-act]')].find(e=>e.dataset.act===act&&e.dataset.id===id&&e.getClientRects().length)
  const dest=match||$(fallback),visible=dest?.getClientRects().length&&!dest.closest('[hidden]')
  ;(visible?dest:$('#compose-entry'))?.focus({preventScroll:true})
 }
 function closeAction(focus=true){if(!$('#action-dialog').open)return;$('#action-dialog').close();dialogState=null;if(focus)returnFocus(dialogReturn)}
 function showAction(type,p={},rememberOrigin=true){
  if(rememberOrigin)dialogReturn=document.activeElement
  if($('#action-dialog').open)$('#action-dialog').close()
  dialogState={type,...p};$('#dialog-content').innerHTML=R.dialog(type,d,d.ui,p);$('#action-dialog').showModal()
  ;$('#action-dialog textarea, #action-dialog select, #action-dialog [data-act=close-action]')?.focus({preventScroll:true})
 }
 function closeDetail(){if($('#detail').open)$('#detail').close();else{d.ui.inspector[d.ui.view]=false;render();save()}returnFocus(detailReturn,'#detail-toggle')}
 function openDetail(origin=document.activeElement){detailReturn=origin;if(isNarrow()){if(!$('#detail').open)$('#detail').showModal();$('#detail .inspect-head button')?.focus({preventScroll:true})}else{d.ui.inspector[d.ui.view]=true;render();save()}}
 function select(id,origin,edit=false){
  d.ui.selected=id;d.ui.editing=edit?id:null;detailReturn=origin
  if(edit&&!d.drafts.edit[id]){const n=d.notes.find(n=>n.id===id);d.drafts.edit[id]={title:n.title,body:n.body}}
  if(!isNarrow())d.ui.inspector[d.ui.view]=true
  render();save();openDetail(origin)
  if(edit)$('#edit-title')?.focus({preventScroll:true})
 }
 function filter(value,tag=''){d.ui.filter=value;d.ui.tag=tag;d.ui.positions[d.ui.view]=[0,0];d.ui.editing=null;render(true);save();if($('#directory').open){$('#directory').close();$('#directory-entry').focus({preventScroll:true})}}
 function capture(form){
  const content=new FormData(form).get('content'),tag=dialogState?.type==='compose'?(dialogState.tag||''):d.ui.tag
  try{
   if(!String(content).trim())throw Error('先写下一点想法，再记录。')
   const n=commit(next=>{const n=M.capture(next,content,tag);next.ui.selected=n.id;next.ui.filter='all';next.ui.query='';next.ui.tag=tag;next.ui.positions[next.ui.view]=[0,0];next.ui.group=n.tags.find(t=>['场景','人物','对白'].includes(t))||(n.tags.length?'其他标签':'未标记');return n},'已记录灵感')
   if(!n)return
   closeAction(false);$('#capture')?.focus({preventScroll:true})
  }catch(e){const error=form.querySelector('.form-error');error.hidden=false;error.textContent=e.message}
 }
 function move(id,group,direction){
  const inGroup=M.groups(rows()).find(g=>g.id===group)?.notes||rows(),index=inGroup.findIndex(n=>n.id===id),other=inGroup[index+direction]
  if(!other){notify(direction<0?'已经是本组第一条。':'已经是本组最后一条。');return}
  commit(next=>{if(direction<0)M.move(next,id,other.id);else{const p=next.order.indexOf(other.id),after=next.order[p+1];M.move(next,id,after)}next.ui.sort='manual'},'已调整片段顺序');closeAction()
 }
 document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return
  const {act,id,value,tag,kind,target,group}=el.dataset
  if(act==='select'&&getSelection()?.toString())return
  remember()
  switch(act){
   case 'view':if(d.ui.view!==value){d.ui.view=value;if(d.ui.editing)d.ui.inspector[value]=true;render(true);save()}break
   case 'filter':filter(value);break
   case 'tag-filter':filter('all',d.ui.tag===tag?'':tag);break
   case 'clear':d.ui.query='';filter('all');$('#search').focus({preventScroll:true});break
   case 'more-tags':d.ui.moreTags=!d.ui.moreTags;render();save();break
   case 'group':d.ui.group=value;d.ui.positions.board=[0,0];render(true);save();document.querySelector('.mobile-groups button[aria-pressed=true]')?.focus({preventScroll:true});break
   case 'compose':showAction('compose',{tag:el.hasAttribute('data-tag')?tag:d.ui.tag});break
   case 'select':select(id,el);break
   case 'edit':closeAction(false);select(id,el,true);break
   case 'menu':showAction('menu',{id,group});break
   case 'delete':commit(next=>M.remove(next,id),'已移入回收站');closeAction(false);if($('#detail').open)closeDetail();break
   case 'restore':commit(next=>M.restore(next,id),'已恢复灵感');closeAction(false);if($('#detail').open)closeDetail();break
   case 'untag':commit(next=>M.untag(next,id,tag),'已移除标签');break
   case 'link':showAction('link',{id});break
   case 'unlink':commit(next=>M.unlink(next,id,target),'已移除关联');break
   case 'preview':showAction('preview',{target});break
   case 'convert':showAction('convert',{id,kind});break
   case 'move-prev':move(id,group,-1);break
   case 'move-next':move(id,group,1);break
   case 'confirm-drop':commit(next=>{M.tag(next,id,tag);next.ui.sort='manual'},'已添加标签，原标签保留');closeAction();break
   case 'undo':{const old=history.pop();if(!old)break;old.ui={...d.ui,selected:old.ui.selected};d=old;save();render(true);notify('已撤销上一步。');break}
   case 'close-action':closeAction();break
   case 'close-detail':closeDetail();break
   case 'toggle-inspector':d.ui.inspector[d.ui.view]=!d.ui.inspector[d.ui.view];detailReturn=el;render();save();break
   case 'directory':$('#directory').showModal();$('#directory .nav-row')?.focus({preventScroll:true});break
   case 'close-directory':$('#directory').close();$('#directory-entry').focus({preventScroll:true});break
   case 'shortcuts':showAction('shortcuts');break
   case 'focus-search':$('#search').focus();break
   case 'retry':retry();break
   case 'pin':d.ui.autoHide=!d.ui.autoHide;revealed=false;bars();save();if(d.ui.autoHide)$('#reveal-bar').focus();break
  }
 })
 document.addEventListener('submit',e=>{
  const form=e.target;if(!form.dataset.form)return;e.preventDefault();if(editingText)return;remember()
  const fd=new FormData(form),id=form.dataset.id
  if(['capture','compose'].includes(form.dataset.form)){capture(form);return}
  if(form.dataset.form==='edit'){
   if(!String(fd.get('title')).trim()){const err=form.querySelector('.form-error');err.hidden=false;err.textContent='请保留一个标题。';return}
   commit(next=>{M.edit(next,id,fd.get('title'),fd.get('body'));next.ui.editing=null},'已保存修改');return
  }
  if(form.dataset.form==='tag'){const val=String(fd.get('tag'));const ok=commit(next=>M.tag(next,id,val),'已添加标签');if(ok)$('#tag-input')?.focus({preventScroll:true});return}
  if(form.dataset.form==='link'){commit(next=>M.link(next,id,fd.get('target')),'已添加关联');closeAction();return}
  if(form.dataset.form==='convert'){
   const t=commit(next=>M.convert(next,id,form.dataset.kind,fd.get('path')),'已创建'+(form.dataset.kind==='正文'?'章节':'设定'))
   if(t)showAction('preview',{target:t.id},false)
  }
 })
 document.addEventListener('input',e=>{
  const el=e.target
  if(el.id==='search'){remember();d.ui.query=el.value;d.ui.positions[d.ui.view]=[0,0];render();$('#search').focus({preventScroll:true});later()}
  else if(['capture','compose-text'].includes(el.id)){d.drafts.quick=el.value;later()}
  else if(el.closest('[data-form=edit]')){const form=el.closest('form');d.drafts.edit[form.dataset.id]={title:form.elements.title.value,body:form.elements.body.value};$('#draft-status').textContent='有未提交修改';later()}
 })
 $('#sort').addEventListener('change',e=>{remember();d.ui.sort=e.target.value;render(true);save()})
 document.addEventListener('compositionstart',()=>editingText=true)
 document.addEventListener('compositionend',()=>editingText=false)
 document.addEventListener('keydown',e=>{
  if(editingText||e.isComposing)return
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();closeAction(false);if($('#detail').open)$('#detail').close();if($('#directory').open)$('#directory').close();$('#search').focus();return}
  if(e.key==='Escape'&&e.target.id==='search'&&d.ui.query){d.ui.query='';render();save();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&['capture','compose-text'].includes(e.target.id)){e.preventDefault();e.target.closest('form').requestSubmit();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&e.target.closest('[data-form=edit]')){e.preventDefault();e.target.closest('form').requestSubmit();return}
  if(e.altKey&&['1','2'].includes(e.key)&&!document.querySelector('dialog[open]')){e.preventDefault();$('#'+(e.key==='1'?'journal':'board')+'-tab').click();return}
  if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const view=e.key==='Home'?'journal':e.key==='End'?'board':d.ui.view==='board'?'journal':'board';$('#'+view+'-tab').click();$('#'+view+'-tab').focus();return}
  if(e.target.matches('article[data-act=select]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click()}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.matches('input,textarea')&&!e.target.isContentEditable&&history.length){e.preventDefault();const old=history.pop();old.ui=d.ui;d=old;render(true);save();notify('已撤销上一步。')}
 })
 for(const [id,close] of [['action-dialog',closeAction],['detail',closeDetail],['directory',()=>{$('#directory').close();$('#directory-entry').focus({preventScroll:true})}]]){
  $('#'+id).addEventListener('cancel',e=>{e.preventDefault();close()})
  $('#'+id).addEventListener('click',e=>{if(e.target===$('#'+id))close()})
 }
 $('#reveal-bar').addEventListener('click',()=>{revealed=true;bars();$('#pin-entry').focus()})
 $('#reveal-bar').addEventListener('mouseenter',()=>{revealed=true;bars()})
 $('#topbar').addEventListener('mouseleave',()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(d.ui.autoHide&&!$('#topbar').contains(document.activeElement)){revealed=false;bars()}},300)})
 document.addEventListener('dragstart',e=>{const handle=e.target.closest('.drag-handle');if(!handle)return;const card=handle.closest('.note');drag={id:handle.dataset.id,group:card.dataset.group};e.dataTransfer.setData('text/plain',drag.id);e.dataTransfer.effectAllowed='move';card.classList.add('dragging')})
 document.addEventListener('dragover',e=>{const group=e.target.closest('.board-column');if(!drag||!group||d.ui.filter==='trash')return;e.preventDefault();document.querySelectorAll('.drag-over').forEach(e=>e.classList.remove('drag-over'));group.classList.add('drag-over')})
 document.addEventListener('drop',e=>{
  const group=e.target.closest('.board-column');if(!drag||!group)return;e.preventDefault();remember();const {id}=drag,dest=group.dataset.group,target=e.target.closest('.note')?.dataset.id
  if(['其他标签','未标记'].includes(dest)&&dest!==drag.group)notify('此分组不会自动移除原标签，请在片段详情里整理。')
  else if(dest!==drag.group&&!d.notes.find(n=>n.id===id).tags.includes(dest))showAction('drop',{id,group:dest})
  else commit(next=>{M.move(next,id,target);next.ui.sort='manual'},'已调整片段顺序')
  drag=null;document.querySelectorAll('.drag-over,.dragging').forEach(e=>e.classList.remove('drag-over','dragging'))
 })
 document.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.drag-over,.dragging').forEach(e=>e.classList.remove('drag-over','dragging'))})
 let lastWidth=innerWidth
 window.addEventListener('resize',()=>{
  if(innerWidth===lastWidth)return
  lastWidth=innerWidth;remember()
  const active=document.activeElement,id=active?.id,from=active?.selectionStart,to=active?.selectionEnd,narrow=isNarrow(),wasOpen=$('#detail').open
  if(!narrow&&wasOpen){d.ui.inspector[d.ui.view]=true;$('#detail').close()}
  render()
  if(narrow&&d.ui.editing)openDetail(detailReturn)
  const field=id?document.getElementById(id):null
  if(field?.getClientRects().length){field.focus({preventScroll:true});if(from!=null)field.setSelectionRange?.(from,to)}
 })
 window.addEventListener('pagehide',()=>{remember();save()})
 $('#view-host').addEventListener('scroll',()=>{remember();later()},{passive:true})
 document.addEventListener('scroll',e=>{if(e.target.matches?.('.board-columns')){remember();later()}},true)
 render()
 window.IdeaApp={get state(){return d},get pending(){return !!storageError},key:KEY,save,render,reset(){d=M.initial(IdeaSeed);history.length=0;readError=false;storageError='';save();render()}}
})();
