import test from 'node:test'
import assert from 'node:assert/strict'
import '../fixtures.js'
import '../model.js'
const D=globalThis.StudioDemo,M=globalThis.StudioModel

test('entry context decides which overview opens',()=>{
  assert.equal(M.entry('fog').mode,'journey')
  assert.equal(M.entry('fog').work,'fog')
  assert.equal(M.entry('all').mode,'compare')
})
test('comparison snapshot survives drilling into a work and changing its date range',()=>{
  const first={...M.entry('all'),pair:['fog','north'],period:90}
  const next=M.transition(first,{type:'drill',work:'north'})
  assert.equal(next.mode,'journey')
  assert.equal(next.work,'north')
  assert.equal(next.period,90)
  assert.deepEqual(M.transition(M.transition(next,{type:'period',period:7}),{type:'back'}),first)
})
test('date and revise shortcuts choose a specific destination without retaining stale filters',()=>{
  let state={...M.entry('all'),range:['2026-10-11','2026-10-15']}
  state=M.transition(state,{type:'day-link',date:D.end})
  assert.deepEqual(state.detail,{kind:'date',date:D.end,work:'all'})
  assert.equal(state.mode,'journey')
  assert.equal(state.range,null)
  state=M.transition(M.entry('fog'),{type:'revise-link'})
  assert.equal(state.tab,'manuscript')
  assert.equal(state.status,'revise')
  assert.equal(state.volume,'all')
})
test('unassigned chapters are a separate group and reconcile with overall inventory',()=>{
  const all=M.volumes('fog')
  const unassigned=all.find(row=>row.id==='unassigned')
  assert.ok(unassigned.count>0)
  assert.equal(M.chapters('fog','unassigned').length,unassigned.count)
  assert.equal(M.total(all,r=>r.words),M.inventory('fog').words)
})
test('jumping to a chapter opens its actual scope, grouping and detail',()=>{
  const state=M.transition(M.entry('all'),{type:'chapter-link',id:'f2-2'})
  assert.equal(state.tab,'manuscript')
  assert.equal(state.work,'fog')
  assert.equal(state.volume,'f2')
  assert.equal(state.detail.id,'f2-2')
})
