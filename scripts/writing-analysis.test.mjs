import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWritingAnalysis, snapshotPreview } from '../app/src/services/writing-analysis-data.js'
import { createWritingAnalysisModel } from '../app/src/services/writing-analysis-model.js'
const source={
 works:[{id:'a',title:'同名'},{id:'b',title:'同名'}],
 volumes:[{id:'v',workId:'a',title:'第一卷'}],
 chapters:[{id:'c',workId:'a',volumeId:'v',content:'正文',status:'revise',fmt:'text'},{id:'u',workId:'a',wordCount:9},{id:'c',workId:'b',wordCount:20},{id:'trash',workId:'a',deletedAt:1}],
 wordlog:[{id:'l1',workId:'a',chapterId:'c',date:'2026-11-03',delta:182},{id:'l2',workId:'a',chapterId:'c',date:'2026-11-03',delta:-182},{id:'l3',workId:'a',chapterId:'c',date:'2026-11-04',delta:-273},{id:'old',workId:'a',chapterId:'trash',date:'2026-11-07',delta:13}],
 revisions:[{id:'r',entityId:'c',entityType:'chapter',workId:'a',createdAt:new Date(2026,10,3,12).getTime()}],
 mubu:[{workId:'a',id:'root',text:'根'},{workId:'a',id:'kid',parentId:'root',text:'子'}],
 olnodes:[{workId:'a',id:'box',kind:'container',title:'幕'},{workId:'a',id:'event',kind:'event',parentId:'box',status:'done'}]
}
test('source rows keep scoped IDs, current counts and unknown historical origins',()=>{
 const d=buildWritingAnalysis(source,{today:'2026-11-07'}),m=createWritingAnalysisModel(d)
 assert.equal(d.chapters.length,3)
 assert.notEqual(d.chapters[0].id,d.chapters[2].id)
 assert.equal(m.inventory('a').words,11)
 assert.equal(m.timeline('a',d.end,7).at(-1).net,13)
 assert.equal(d.logs.find(r=>r.id==='old').chapter,null)
 assert.equal(m.volumes('a').at(-1).title,'未分卷')
 assert.equal(d.lore[0].nodes.length,1)
 assert.equal(d.outline[0].events.length,1)
})
test('chapter days separate zero activity, negative and missing; snapshots use actual dates',()=>{
 const d=buildWritingAnalysis(source,{today:'2026-11-07'}),m=createWritingAnalysisModel(d)
 const row=m.chapterCalendar('a','all','all',7).rows[0]
 assert.deepEqual(row.days.slice(2,5).map(x=>[x.net,x.logs.length,x.versions.length]),[[0,2,1],[-273,1,0],[0,0,0]])
 assert.ok(!('content' in d.versions[0]))
 assert.equal(d.versions[0].chapter,row.chapter.id)
 const scoped=createWritingAnalysisModel(buildWritingAnalysis(source,{today:'2026-11-07',workId:'b'}))
 assert.equal(scoped.inventory('b').words,20)
 assert.equal(scoped.timeline('b','2026-11-07',7).filter(x=>x.logs.length).length,0)
})
test('compare and history navigation retain windows and metadata',()=>{
 const d=buildWritingAnalysis(source,{today:'2026-11-07'}),m=createWritingAnalysisModel(d)
 const start={...m.entry('all'),pair:['a','b'],period:90}
 assert.deepEqual(m.transition(m.transition(start,{type:'drill',work:'a'}),{type:'back'}),start)
 const chapter=d.chapters[0]
 const next=m.transition(start,{type:'chapter-link',id:chapter.id,date:'2026-11-03'})
 assert.equal(next.chart,'revision')
 assert.equal(next.detail.date,'2026-11-03')
 assert.equal(next.work,'a')
})
test('large chapter calendars only allocate the requested visible page',()=>{
 const big={works:[{id:'big',title:'长篇'}],chapters:Array.from({length:1500},(_,i)=>({id:'c'+i,workId:'big',wordCount:i,sortOrder:i}))}
 const d=buildWritingAnalysis(big,{today:'2026-11-07'}),m=createWritingAnalysisModel(d),selection=new Set(d.chapters.slice(40,80).map(c=>c.id))
 const matrix=m.chapterCalendar('big','all','all',90,null,selection)
 assert.equal(matrix.rows.length,40);assert.equal(matrix.dates.length,90)
 assert.equal(matrix.rows[0].chapter.rawId,'c40')
})
test('snapshots interpret their own recorded format and support legacy HTML independently of current chapters',()=>{
 const known=snapshotPreview('<p>旧稿</p>','html')
 assert.equal(known.plain,'旧稿');assert.equal(known.words,2);assert.equal(known.legacy,false)
 const old=snapshotPreview('<p>旧稿</p>',null)
 assert.equal(old.plain,'旧稿');assert.equal(old.words,2);assert.equal(old.legacy,true)
 assert.equal(snapshotPreview('<p>这是正文里的字面标签</p>','text').plain,'<p>这是正文里的字面标签</p>')
 assert.ok(!snapshotPreview('<p>正文<script>危险脚本</script></p>','html').plain.includes('危险脚本'))
 assert.ok(snapshotPreview('<p>第一段</p><p>第二段<br>尾声</p>','html').plain.includes('\n'))
})

