import test from 'node:test'
import assert from 'node:assert/strict'
import '../fixtures.js'
import '../model.js'
const M=StudioModel,D=StudioDemo
test('unfiltered chapter reference has a common axis and correct median',()=>{
  const score=M.chapterStructure('fog','f2','revise')
  assert.equal(score.median,5060)
  assert.equal(score.max,7000)
  assert.deepEqual(score.groups.flatMap(g=>g.rows.map(c=>c.id)),['f2-2'])
  assert.equal(M.chapterStructure('fog','f2','all').median,score.median)
  assert.equal(M.chapterStructure('fog','all','all').groups.at(-1).id,'unassigned')
})
test('the chapter calendar separates zero, negative, missing and actual snapshots',()=>{
  const c=M.chapterCalendar('fog','f2','revise',7)
  const row=c.rows[0]
  assert.equal(row.chapter.id,'f2-2')
  const [zero,negative,missing]=row.days.slice(2,5)
  assert.deepEqual([zero.date,zero.net,zero.logs.length,zero.versions.length,zero.active],['2026-11-03',0,2,1,true])
  assert.deepEqual([negative.net,negative.logs.length,negative.versions.length],[-273,1,1])
  assert.deepEqual([missing.net,missing.logs.length,missing.versions.length],[0,0,0])
  assert.equal(M.chapterCalendar('empty','all','all',90).rows.length,0)
})
test('history link opens the selected day and widens an incompatible custom window',()=>{
  const state={...M.entry('all'),period:7,range:['2026-11-06',D.end]}
  const next=M.transition(state,{type:'chapter-link',id:'f2-2',date:'2026-11-03'})
  assert.equal(next.chart,'revision')
  assert.equal(next.detail.date,'2026-11-03')
  assert.equal(next.volume,'f2')
  assert.equal(next.range,null)
  assert.equal(M.transition(next,{type:'revise-link'}).chart,'structure')
})
test('date window and status filters do not alter current chapter length',()=>{
  const chapter=M.chapters('fog','f2','revise')[0]
  for(const period of [7,30,90]){
    const {dates,rows}=M.chapterCalendar('fog','f2','revise',period)
    assert.equal(dates.length,period)
    assert.equal(rows[0].chapter.words,chapter.words)
  }
})

