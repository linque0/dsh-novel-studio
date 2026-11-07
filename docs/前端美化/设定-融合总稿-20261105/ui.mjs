import {outlineGlyphs} from './icons.mjs'
export const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)]
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const extra={folder:'<path d="M3 6h7l2 3h9v11H3z"/>',place:'<path d="M12 22s8-8 8-13A8 8 0 0 0 4 9c0 5 8 13 8 13Z"/><circle cx="12" cy="9" r="2.5"/>',faction:'<path d="M4 21V5l8-3 8 3v16M8 21v-6h8v6M8 7h1m6 0h1M8 11h1m6 0h1"/>',rule:'<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 11l3 3 5-6"/>',history:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',object:'<path d="m3 7 9-5 9 5v11l-9 4-9-4zm0 0 9 5 9-5M12 12v10"/>',belief:'<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',entry:'<path d="M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',undo:'<path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/>',redo:'<path d="m16 3 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 16h10l1-16M10 10v8m4-8v8"/>',grip:'<path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"/>',filter:'<path d="M3 5h18M6 12h12M9 19h6"/>'}
export const icon=(name,size=16)=>`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[name]||outlineGlyphs[name]||extra.entry}</svg>`
export const button=(text,act,cls='',id='',glyph='')=>`<button type="button" class="btn ${cls}" data-act="${act}" data-id="${esc(id)}">${glyph?icon(glyph,14):''}${esc(text)}</button>`
export const ib=(label,act,id='',glyph='more')=>`<button type="button" class="icon-button" aria-label="${esc(label)}" title="${esc(label)}" data-act="${act}" data-id="${esc(id)}">${icon(glyph,15)}</button>`
export function cleanHtml(html){
 const t=document.createElement('template');t.innerHTML=html||'';
 const walk=node=>{
  if(node.nodeType===3)return esc(node.textContent);if(node.nodeType!==1)return '';
  if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName))return '';
  const inner=[...node.childNodes].map(walk).join('');
  if(node.tagName==='A'&&/^[a-zA-Z0-9_-]+$/.test(node.getAttribute('data-link-id')||'')){
   const id=node.getAttribute('data-link-id');return `<a class="wiki-link" data-link-id="${id}" href="#node=${id}" contenteditable="false">${inner}</a>`;
  }
  if(node.tagName==='BR')return '<br>';
  if(['B','STRONG','I','EM','U','S'].includes(node.tagName))return `<${node.tagName.toLowerCase()}>${inner}</${node.tagName.toLowerCase()}>`;
  if(node.tagName==='SPAN'){const style=['color','background-color','font-weight','font-style','text-decoration'].map(k=>node.style.getPropertyValue(k)?k+':'+node.style.getPropertyValue(k):'').filter(Boolean).join(';');return style?`<span style="${esc(style)}">${inner}</span>`:inner}
  return inner+(['DIV','P'].includes(node.tagName)?'<br>':'');
 };return [...t.content.childNodes].map(walk).join('');
}
export const markup=n=>n?.html?cleanHtml(n.html):esc(n?.text||'').replace(/\n/g,'<br>')
export function caretOffset(el){const s=getSelection();if(!s?.rangeCount||!el.contains(s.anchorNode))return 0;const r=s.getRangeAt(0).cloneRange();r.selectNodeContents(el);r.setEnd(s.anchorNode,s.anchorOffset);return r.toString().length}
export function setCaret(el,offset){if(!el)return;el.focus({preventScroll:true});const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,remaining=Math.max(0,offset),last;while(n=w.nextNode()){last=n;if(remaining<=n.textContent.length){const r=document.createRange();r.setStart(n,remaining);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);return}remaining-=n.textContent.length}const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r)}
