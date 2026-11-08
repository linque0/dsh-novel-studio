import assert from 'node:assert/strict'
import {test} from 'node:test'
import '../fixtures.js'
import '../model.js'
import '../render.js'
const M=globalThis.IdeaModel,fresh=()=>M.initial(globalThis.IdeaSeed)
test('shared records: query, tags, trash, missing tags and real links',()=>{
 const d=fresh();assert.equal(M.visible(d,{}).length,12);assert.equal(M.visible(d,{filter:'untagged'}).length,2);assert.equal(M.visible(d,{filter:'linked'}).length,3)
 assert.equal(M.visible(d,{query:'旧港钟楼'}).length,1);assert.equal(M.visible(d,{tag:'场景'}).length,4)
 M.remove(d,'i01');assert.equal(M.visible(d,{}).length,11);assert.equal(M.visible(d,{filter:'trash'})[0].id,'i01');M.restore(d,'i01');assert.equal(M.visible(d,{}).length,12)
})
test('capture, edit and tags keep ID, first-line title and existing links',()=>{
 const d=fresh(),n=M.capture(d,'  海上的门\n\n门只在退潮时打开。  ','雾港');assert.equal(n.title,'海上的门');assert.equal(n.body,'门只在退潮时打开。');assert.deepEqual(n.tags,['雾港'])
 assert.throws(()=>M.capture(d,'  '));M.edit(d,'i01','新的钟声','仍然来自海底。');assert.equal(d.notes.find(n=>n.id==='i01').links.length,2)
 M.tag(d,'i01',' 场景 ');assert.equal(d.notes.find(n=>n.id==='i01').tags.filter(x=>x==='场景').length,1);M.untag(d,'i01','场景');assert.equal(d.notes.find(n=>n.id==='i01').tags.includes('场景'),false)
})
test('board membership never hides leftovers or creates duplicate entities',()=>{
 const d=fresh(),groups=M.groups(M.visible(d,{})),ids=new Set(groups.flatMap(g=>g.notes.map(n=>n.id)));assert.equal(ids.size,12)
 assert.equal(groups.find(g=>g.id==='未标记').notes.length,2);M.tag(d,'i01','人物');assert.equal(d.notes.length,12);assert.equal(M.groups(M.visible(d,{})).find(g=>g.id==='人物').notes.length,4)
})
test('conversion creates an inspectable target, keeps original and uses ID links',()=>{
 const d=fresh(),before=d.notes[0].body,t=M.convert(d,'i01','正文','第一卷');assert.ok(d.targets.some(r=>r.id===t.id));assert.equal(t.body,before);assert.equal(d.notes[0].body,before);assert.equal(d.notes[0].links.at(-1).id,t.id)
 M.link(d,'i01',t.id);assert.equal(d.notes[0].links.filter(r=>r.id===t.id).length,1)
})
test('manual order, persisted drafts and duplicate titles remain independent',()=>{
 const d=fresh(),a=M.capture(d,'相同标题\n一'),b=M.capture(d,'相同标题\n二');assert.notEqual(a.id,b.id);M.move(d,b.id,a.id);assert.ok(d.order.indexOf(b.id)<d.order.indexOf(a.id))
 d.drafts.quick='没有写完';d.drafts.edit.i01={title:'修改中',body:'未提交'};const restored=M.hydrate(JSON.parse(JSON.stringify(d)));assert.equal(restored.drafts.edit.i01.body,'未提交');assert.equal(restored.drafts.quick,'没有写完')
})
test('empty trash entries remain readable without offering disabled editing',()=>{
 const d=fresh(),n=M.capture(d,'只有标题');M.remove(d,n.id);d.ui.filter='trash';d.ui.selected=n.id
 const html=IdeaRender.main(d,d.ui);assert.ok(html.includes('还没有正文。'));assert.equal(html.includes('点编辑继续写'),false);assert.equal(html.includes('data-act="edit"'),false)
})
