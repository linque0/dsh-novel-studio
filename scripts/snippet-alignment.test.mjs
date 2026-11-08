import {test} from 'node:test'
import assert from 'node:assert/strict'
import {stableTagOrder,noteCounts,boardGroups,normalizeSnipState,UNTAGGED_GROUP} from '../app/src/components/snippets/snippet-model.js'
import {createSnippetPersistence} from '../app/src/services/snippet-persistence.js'
import {createSnippetHistory,fingerprint} from '../app/src/services/snippet-history.js'
import {projectBook} from '../app/src/services/project/normalize.js'
import {projectGraph} from '../app/src/services/project/graph.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openLibrary} from '../src/core/library.js'

test('stable tag order survives count changes and separates the untagged lane',()=>{
 const rows=[{id:'a',tags:['场景','雾港'],links:[],createdAt:20},{id:'b',tags:['人物','未标记'],links:[],createdAt:10},{id:'c',tags:[],links:[],createdAt:5}]
 const order=stableTagOrder(rows,[]);assert.deepEqual(order,['场景','雾港','人物','未标记'])
 rows.push({id:'d',tags:['人物','新标签'],links:[],createdAt:30})
 assert.deepEqual(stableTagOrder(rows,order),[...order,'新标签'])
 assert.deepEqual(noteCounts(rows,order).tags.map(t=>t.tag),[...order,'新标签'])
 const groups=boardGroups(rows,order);assert.equal(new Set(groups.map(g=>g.id)).size,groups.length);assert.equal(groups.at(-1).id,UNTAGGED_GROUP)
 rows[2].deletedAt=1;assert.equal(boardGroups(rows,order,true).flatMap(g=>g.notes).length,1)
 assert.deepEqual(normalizeSnipState({scroll:{journal:20,board:4}}).scroll,{journal:{top:20,left:0},board:{top:4,left:0}})
 assert.equal(normalizeSnipState({selected:'chapter-like-id'}).selected,'chapter-like-id')
 const temporary=rows.map(n=>({...n,tags:n.tags.filter(t=>t!=='雾港')}))
 assert.deepEqual(stableTagOrder(temporary,order),[...order,'新标签'])
 assert.ok(!noteCounts(temporary,order).tags.some(t=>t.tag==='雾港'))
})

test('durable commands never become retryable when a view notification fails',async()=>{
 let writes=0
 const h=createSnippetHistory({apply:async()=>{writes++},committed:()=>{throw Error('view closed')}})
 const result=await h.execute('a',async()=>({changes:[{table:'snippets',id:'x',before:null,after:{id:'x',content:'新内容'}}]}))
 assert.equal(result.ok,true);assert.equal(h.get('a').pending,null);await h.retry('a');assert.equal(writes,1)
})
test('draft/state writes capture work identity, retry and do not overwrite dirty input with late reads',async()=>{
 const db=new Map(),deferred=[],writes=[];let fail=true
 const p=createSnippetPersistence({read:key=>new Promise(resolve=>deferred.push({key,resolve})),write:async(key,value)=>{if(fail)throw Error('quota');db.set(key,structuredClone(value));writes.push(key)}})
 const a=p.activate('a');p.patchDrafts('a',{quick:'A未完成'});const b=p.activate('b');p.patchDrafts('b',{quick:'B未完成'})
 for(const req of deferred)req.resolve(req.key.includes('draft')?{quick:'旧输入',edit:{old:{title:'旧草稿',body:'仍需保留'}}}:{view:'journal'})
 await Promise.all([a,b]);assert.equal(p.active,'b');assert.equal(p.get('a').drafts.quick,'A未完成');assert.equal(p.get('b').drafts.quick,'B未完成');assert.ok(p.get('a').drafts.edit.old)
 assert.equal(await p.flushAll(),false);assert.equal(p.get('a').status.pending,true)
 fail=false;assert.equal(await p.flushAll(),true);assert.equal(db.get('snipdraft:a').quick,'A未完成');assert.equal(db.get('snipdraft:b').quick,'B未完成');assert.ok(writes.includes('snipdraft:a'))
 p.dispose()
})
test('failed reads block overwrite and a retry merges unsaved draft fields',async()=>{
 let failed=true;const writes=[]
 const p=createSnippetPersistence({read:async key=>{if(failed)throw Error('read');return key.includes('draft')?{quick:'旧输入',edit:{old:{title:'原草稿',body:'原内容'}}}:{}},write:async(...args)=>writes.push(args)})
 await p.activate('a');p.patchDrafts('a',{quick:'新输入'});assert.equal(await p.flushAll(),false);assert.equal(writes.length,0)
 failed=false;await p.retry('a');assert.equal(p.get('a').drafts.quick,'新输入');assert.ok(p.get('a').drafts.edit.old);assert.equal(p.get('a').status.pending,false);p.dispose()
})
test('40 step work histories retry prepared commands once, undo softly and reject external conflicts',async()=>{
 const db=new Map();let fail=false
 const h=createSnippetHistory({apply:async(workId,changes)=>{if(fail)throw Error('save');for(const c of changes){const old=db.get(workId+c.id)||null;if(fingerprint(old)!==fingerprint(c.before)){const e=Error('conflict');e.code='CONFLICT';throw e}}for(const c of changes)db.set(workId+c.id,structuredClone(c.after))}})
 fail=true;let prepares=0
 assert.equal((await h.execute('a',()=>{prepares++;return {changes:[{table:'snippets',id:'1',before:null,after:{id:'1',content:'甲'}}]}})).ok,false)
 fail=false;assert.equal((await h.retry('a')).ok,true);assert.equal(prepares,1);assert.equal(h.get('a').past.length,1)
 assert.equal((await h.step('a','undo')).ok,true);assert.ok(db.get('a1').deletedAt);assert.equal((await h.step('a','redo')).ok,true);assert.equal(db.get('a1').content,'甲')
 db.set('a1',{id:'1',content:'外部修改'});assert.equal((await h.step('a','undo')).conflict,true);assert.equal(db.get('a1').content,'外部修改');assert.equal(h.get('a').past.length,0)
 for(let i=0;i<43;i++)await h.execute('b',()=>({changes:[{table:'snippets',id:String(i),before:null,after:{id:String(i),content:'乙'}}]}))
 assert.equal(h.get('b').past.length,40);assert.equal(h.get('a').past.length,0)
})
test('manual ID links reach source projection and project graph alongside legacy links',()=>{
 const bundle={work:{id:'w',title:'书'},chapters:[{id:'c',workId:'w',title:'迟到的钟声',content:'正文',createdAt:1}],snippets:[{id:'s',workId:'w',content:'海上的门',links:[{kind:'chapter',id:'c'}]}]}
 const {docs}=projectBook(bundle),snippet=docs.find(d=>d.sourceType==='snippet'),chapter=docs.find(d=>d.sourceType==='chapter')
 assert.ok(snippet.plainText.includes('迟到的钟声'))
 assert.ok(projectGraph(bundle,docs).edges.some(e=>e.fromId===snippet.id&&e.toId===chapter.id&&e.kind==='inspiration-link'))
 bundle.snippets[0].aiLinks=[{type:'chapter',id:'c'}]
 assert.equal(projectGraph(bundle,projectBook(bundle).docs).edges.filter(e=>e.kind==='inspiration-link').length,1)
})

test('existing backup shape and plugin library roundtrip retain IDs, body, tags, links and UI state',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ns-snippet-roundtrip-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 const note={id:'s',workId:'w',content:'首行标题\n\n保留正文 [[chapter:c]]',tags:['未标记','长标签'],links:[{kind:'chapter',id:'c'},{kind:'mubu',id:'n'}],aiLinks:[{type:'character',id:'p'}],sortOrder:73,createdAt:1,updatedAt:2,deletedAt:null}
 const state=normalizeSnipState({selected:'s',tagOrder:['长标签','未标记'],view:'board',scroll:{board:{top:12,left:300}}})
 const data={works:[{id:'w',title:'同名作品'}],chapters:[{id:'c',workId:'w',title:'正文',content:'真实章节'}],mubu:[{id:'n',workId:'w',text:'节点',parentId:null}],characters:[{id:'p',workId:'w',name:'人物'}],snippets:[note],appconfig:[{id:'snipstate:w',key:'snipstate:w',value:state}]}
 const lib=openLibrary(dir);await lib.importDump(JSON.parse(JSON.stringify({version:1,data})))
 const saved=await lib.snapshot();assert.deepEqual(saved.data.snippets,[note]);assert.deepEqual(saved.data.appconfig[0].value,state)
 const bundle={work:saved.data.works[0],...Object.fromEntries(Object.entries(saved.data).filter(([k])=>k!=='works'))}
 const projected=projectBook(bundle),edges=projectGraph(bundle,projected.docs).edges.filter(e=>e.kind==='inspiration-link')
 assert.equal(edges.length,3);assert.ok(projected.docs.find(d=>d.sourceType==='snippet').plainText.includes('真实章节')===false)
 assert.ok(projected.docs.find(d=>d.sourceType==='snippet').plainText.includes('正文'))
})
