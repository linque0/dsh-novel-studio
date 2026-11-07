import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWritingStats, chapterWordChange, createStatsLoader } from '../app/src/services/writing-stats-core.js'

const r = (workId, id, extra={}) => ({workId,id,...extra})
const fixture = () => ({
  works: [{id:'a',title:'同名'}, {id:'b',title:'同名'}, {id:'gone',deletedAt:1}],
  volumes:[r('a','v',{title:'第一卷'}),r('a','gone-v',{deletedAt:1})],
  chapters:[r('a','c',{volumeId:'v',wordCount:100,status:'done'}),r('a','u',{volumeId:'gone-v',wordCount:20}),r('b','d',{wordCount:50,status:'revise'}),r('a','trash',{wordCount:600,deletedAt:1}),r('gone','x',{wordCount:1000})],
  olnodes:[r('a','box',{kind:'container'}),r('a','sub',{kind:'container',parentId:'box'}),r('a','e',{kind:'event',parentId:'sub',status:'done'}),r('a','free',{kind:'event',status:'writing'}),r('a','note',{kind:'note',status:'done'})],
  mubu:[r('a','root',{text:'设定根'}),r('a','kid',{parentId:'root',tags:['地点','地点']}),r('a','del',{deletedAt:1}),r('b','other')],
  characters:[r('a','h',{role:'主角/导师'}),r('a','j',{role:''}),r('a','gone-c',{deletedAt:1}),r('b','k',{role:'配角'})],
  relations:[r('a','rel',{fromId:'h',toId:'j'}),r('a','deadrel',{fromId:'j',toId:'gone-c'})],
  lorelinks:[r('a','link',{fromKind:'mubu',fromId:'root',toKind:'character',toId:'h'}),r('a','lost',{fromKind:'mubu',fromId:'del',toKind:'mubu',toId:'root'})],
  snippets:[r('a','s',{content:'甲',tags:['灵感','灵感','伏笔'],createdAt:2}),r('a','t',{createdAt:1}),r('a','old',{deletedAt:1})],
  wordlog:[r('a','l1',{date:'2026-11-07',delta:-7}),r('a','l2',{date:'2026-11-06',delta:4}),r('a','l3',{date:'2026-11-06',delta:-4}),r('b','l4',{date:'2026-11-07',delta:10}),r('gone','l5',{date:'2026-11-07',delta:999})]
})
const snapshot=(data=fixture(),workId=null,days=7)=>buildWritingStats(data,{workId,days,today:'2026-11-07'})

test('scope by ID, not title; inventory excludes trash; days do not alter inventory',()=>{
  const all=snapshot(), one=snapshot(fixture(),'a',30)
  assert.equal(all.totalWords,170); assert.equal(all.chapterCount,3)
  assert.deepEqual(all.works.map(x=>[x.id,x.words]),[['a',120],['b',50]])
  assert.equal(one.totalWords,120); assert.equal(one.chapterCount,2)
  assert.equal(one.todayNet,-7); assert.equal(one.activeDays,2)
  assert.equal(one.daily.length,30); assert.equal(one.daily.at(-2).net,0)
  assert.equal(all.todayNet,3); assert.equal(all.daily.at(0).date,'2026-11-01')
  assert.equal(snapshot(fixture(),'gone').totalWords,0)
})
test('module summaries use live rows, stable group identities and valid endpoints',()=>{
  const s=snapshot(fixture(),'a')
  assert.deepEqual(s.chapters.volumes.map(x=>[x.label,x.value]),[['第一卷',100],['未分卷',20]])
  assert.equal(s.outline.events,2)
  assert.deepEqual(s.outline.groups.map(x=>[x.id,x.done,x.total]),[['box',1,1],['sub',1,1],['unassigned',0,1]])
  assert.equal(s.lore.branches[0].value,2); assert.equal(s.lore.tagged,1); assert.equal(s.lore.relationships,1)
  assert.equal(s.characters.roles.find(x=>x.label==='主角').value,1)
  assert.equal(s.characters.relationships,1); assert.equal(s.characters.isolated,0)
  assert.equal(s.snippets.total,2); assert.equal(s.snippets.tagged,1); assert.equal(s.snippets.tags.find(x=>x.label==='灵感').value,1)
})
test('no inventory/history fabricated for empty or old libraries',()=>{
  assert.equal(snapshot({}).totalWords,0);assert.equal(snapshot({}).hasHistory,false)
  const old=fixture();old.wordlog=[]
  assert.equal(snapshot(old).hasHistory,false);assert.equal(snapshot(old).totalWords,170)
})
test('transaction uses committed count, ignores deletions/restores and unchanged retries',()=>{
  const a=r('a','c',{wordCount:100}), b={...a,wordCount:75}
  assert.equal(chapterWordChange(a,b),-25);assert.equal(chapterWordChange(b,b),0)
  assert.equal(chapterWordChange(a,{...a,deletedAt:1}),0)
  assert.equal(chapterWordChange({...a,deletedAt:1},a),0)
  assert.equal(chapterWordChange(null,a),100)
})
test('a stale scope read cannot overwrite a newer scope or report a stale error',async()=>{
  let resolveA, rejectB
  const loader=createStatsLoader(id=>id==='a'?new Promise(r=>resolveA=r):id==='b'?new Promise((_,r)=>rejectB=r):Promise.resolve({id}))
  const a=loader.read('a'), b=loader.read('b'), c=await loader.read(null)
  resolveA({id:'a'});rejectB(new Error('stale'))
  assert.deepEqual(c,{value:{id:null}})
  assert.equal(await a,null);assert.equal(await b,null)
})
test('formal prose remains accurate after a library writer changes content but leaves a stale cached count',()=>{
  const data=fixture()
  data.chapters[0]={...data.chapters[0],content:'<p>更 新</p>',fmt:'html',wordCount:100}
  assert.equal(snapshot(data,'a').totalWords,22)
  assert.equal(chapterWordChange(data.chapters[0],{...data.chapters[0],content:'<p>改</p>',wordCount:1}),-1)
})
test('rolling back an application can explicitly drop its queued memory intent', async()=>{
  const {mergeMemoryIntent}=await import('../app/src/services/ai/memory-queue-core.js')
  const pending={memoryIntent:{applicationId:'failed'}}
  assert.equal(mergeMemoryIntent(pending,{memoryIntent:null}).memoryIntent,null)
  assert.deepEqual(mergeMemoryIntent(pending,{}).memoryIntent,pending.memoryIntent)
})
