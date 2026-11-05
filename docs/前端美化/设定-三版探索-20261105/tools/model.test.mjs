import test from 'node:test'
import assert from 'node:assert/strict'
import {LoreModel} from '../model.mjs'
const fixture={nodes:[{id:'s',isSet:true,title:'地理地点',parentId:null,tags:[]},{id:'a',title:'雾港灯塔',body:'凌晨三点亮灯。',parentId:'s',tags:['地点']},{id:'b',title:'灯室',parentId:'a',tags:[]},{id:'c',title:'旧港',parentId:'s',tags:[]},{id:'p',title:'林照',kind:'person',parentId:null,tags:[]}],relations:[{id:'r',from:'a',to:'p',label:'驻守'}]}
const make=()=>new LoreModel(fixture)
test('content and tags search include ancestor context',()=>{const m=make();assert.deepEqual(m.path('b').map(n=>n.id),['s','a','b']);assert.equal(m.search('地点').length,1);assert.equal(m.search('凌晨')[0].id,'a')})
test('bound edits do not write to the new selection',()=>{const m=make();m.selected='c';m.update('a',{title:'修改后的灯塔'});assert.equal(m.node('a').title,'修改后的灯塔');assert.equal(m.node('c').title,'旧港')})
test('nested moves reject cycles and preserve relations',()=>{const m=make();assert.equal(m.move('a','b'),false);assert.equal(m.move('a','a'),false);assert.equal(m.move('b','c'),true);assert.equal(m.node('b').parentId,'c');assert.equal(m.data.relations.length,1);m.undo();assert.equal(m.node('b').parentId,'a');m.redo();assert.equal(m.node('b').parentId,'c')})
test('deleting a subtree removes links; undo restores both',()=>{const m=make();m.remove('a');assert.equal(m.node('b'),undefined);assert.equal(m.data.relations.length,0);m.undo();assert.equal(m.node('b').parentId,'a');assert.equal(m.data.relations.length,1)})
test('relation endpoints are real and duplicate relations are rejected',()=>{const m=make();assert.equal(m.addRelation('a','a','关联'),false);assert.equal(m.addRelation('a','missing','关联'),false);assert.equal(m.addRelation('a','p','驻守'),false);assert.ok(m.addRelation('c','p','认识'));assert.equal(m.links('p').length,2)})
test('new sibling and indent preserve stable node identity',()=>{const m=make();const n=m.add('s',{title:'潮汐钟'});assert.equal(m.node(n.id).parentId,'s');assert.ok(m.indent('c'));assert.equal(m.node('c').parentId,'a');assert.ok(m.outdent('c'));assert.equal(m.node('c').parentId,'s')})

test('Enter sibling insertion is immediately after its source',()=>{const m=make();const row=m.add('s',{title:'新设定'},'a');assert.deepEqual(m.children('s').map(n=>n.id),['a',row.id,'c'])})
