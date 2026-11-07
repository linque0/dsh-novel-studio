import test from 'node:test'
import assert from 'node:assert/strict'
import '../fixtures.js'
import '../model.js'
const M=globalThis.StudioModel, D=globalThis.StudioDemo
test('calendar and exact daily totals preserve negative, zero activity and missing data',()=>{
  const r=M.timeline('fog',D.end,7)
  assert.equal(r.length,7); assert.equal(r.at(-1).date,D.end)
  assert.ok(r.some(x=>x.net<0))
  assert.ok(r.some(x=>x.net===0&&x.active))
  assert.ok(r.some(x=>x.net===0&&!x.active))
  assert.equal(r.at(-1).cumulative,r.reduce((s,x)=>s+x.net,0))
})
test('timeline scope and subrange use inclusive boundaries without leaking another work',()=>{
  const r=M.timeline('fog',D.end,30,['2026-11-02','2026-11-05'])
  assert.equal(r.length,4)
  assert.ok(r.flatMap(d=>d.logs).every(row=>row.work==='fog'))
  assert.equal(M.timeline('empty',D.end,30).every(d=>!d.active),true)
})
test('chapter, volume and status facts reconcile; changing period does not change inventory',()=>{
  const a=M.chapters('fog','f1','revise')
  assert.ok(a.length); assert.ok(a.every(c=>c.volume==='f1'&&c.status==='revise'))
  const b=M.inventory('fog')
  assert.equal(b.words,b.chapters.reduce((n,c)=>n+c.words,0))
  assert.equal(M.volumes('fog').reduce((n,v)=>n+v.words,0),b.words)
})
test('portfolio tracks use one date and signed scale; compare survives work drill-down',()=>{
  const s=M.entry('all')
  const p=M.portfolio(s.pair,D.end,30)
  assert.deepEqual(p.rows[0].days.map(d=>d.date),p.rows[1].days.map(d=>d.date))
  assert.ok(p.min<0&&p.max>0)
  const next=M.transition(s,{type:'drill',work:'night'})
  const back=M.transition(next,{type:'back'})
  assert.equal(back.work,'all'); assert.deepEqual(back.pair,s.pair);assert.equal(back.period,s.period)
})
test('record list includes only explicit dated evidence; relation endpoints exist',()=>{
  const rows=M.records('fog','2026-11-01','2026-11-07')
  assert.ok(rows.some(r=>r.kind==='版本'))
  assert.ok(rows.every(r=>r.date>='2026-11-01'&&r.date<='2026-11-07'))
  assert.ok(D.relations.every(r=>D.people.some(p=>p.id===r.from)&&D.people.some(p=>p.id===r.to)))
})

