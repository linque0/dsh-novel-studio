import test from 'node:test'
import assert from 'node:assert/strict'
import { outlineLayout, normalizeOutlineWidth, initialExpandedContainers } from '../app/src/components/outline/outline-layout.js'

test('desktop defaults and extreme widths reserve at least 480px for the canvas',()=>{
  const base=outlineLayout({width:1440,leftOpen:true,rightOpen:true})
  assert.equal(base.left,220);assert.equal(base.right,318);assert.ok(base.canvas>=480)
  for(const width of [1100,1180,1280,1440,1920])for(const leftWidth of [180,220,420])for(const rightWidth of [260,320,480]){
    const layout=outlineLayout({width,leftOpen:true,rightOpen:true,leftWidth,rightWidth})
    assert.ok(layout.canvas>=480,JSON.stringify(layout));assert.ok(layout.left>=180);assert.ok(layout.right>=260)
  }
})
test('collapsed rails return space without changing requested widths',()=>{
  const prefs={width:1280,leftWidth:400,rightWidth:460,leftOpen:true,rightOpen:true}
  const dock=outlineLayout(prefs),leftClosed=outlineLayout({...prefs,leftOpen:false}),bothClosed=outlineLayout({...prefs,leftOpen:false,rightOpen:false})
  assert.ok(leftClosed.canvas>dock.canvas);assert.ok(bothClosed.canvas>leftClosed.canvas)
  assert.equal(prefs.leftWidth,400);assert.equal(prefs.rightWidth,460)
})
test('narrow mode never allocates docked sidebars and starts at the actual workspace breakpoint',()=>{
  for(const width of [380,760,1099]){const layout=outlineLayout({width,leftOpen:true,rightOpen:true});assert.equal(layout.narrow,true);assert.equal(layout.left,0);assert.equal(layout.right,0);assert.ok(layout.canvas>0)}
  assert.equal(outlineLayout({width:1100}).narrow,false)
})
test('preferences reject invalid values and clamp each side independently',()=>{
  for(const bad of [undefined,null,'',NaN,Infinity,'bad']){assert.equal(normalizeOutlineWidth('left',bad),220);assert.equal(normalizeOutlineWidth('right',bad),318)}
  assert.equal(normalizeOutlineWidth('left',700),420);assert.equal(normalizeOutlineWidth('left',1),180)
  assert.equal(normalizeOutlineWidth('right',700),480);assert.equal(normalizeOutlineWidth('right',1),260)
})
test('only missing expansion preferences default to first-level containers',()=>{
  const nodes=[{id:'a',kind:'container'},{id:'b',kind:'container',parentId:'a'},{id:'c',kind:'container',parentId:'b'},{id:'e',kind:'event'}]
  assert.deepEqual(initialExpandedContainers(nodes,undefined),['a'])
  assert.deepEqual(initialExpandedContainers(nodes,[]),[])
  assert.deepEqual(initialExpandedContainers(nodes,['b','deleted','e']),['b'])
})

test('approved B draft geometry at 1440px',()=>{const l=outlineLayout({width:1440,leftOpen:true,rightOpen:true});assert.equal(l.left,220);assert.equal(l.right,318);assert.equal(l.canvas,814)})
