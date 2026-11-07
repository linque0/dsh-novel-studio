import test from 'node:test'
import assert from 'node:assert/strict'
import { lorePath, validLoreMove, resolveLoreFocus, captureLoreNodes, createLoreHistory, checkpointLore, stepLoreHistory, referenceTargets, incomingReferences } from '../app/src/services/lore-core.js'

const nodes=()=>[
 {id:'root',workId:'w',parentId:null,text:'地理',sortOrder:0},
 {id:'a',workId:'w',parentId:'root',text:'灯塔',html:'<b>灯塔</b>',tags:['地点'],heading:2,kind:'place',sortOrder:0},
 {id:'b',workId:'w',parentId:'a',text:'灯室',sortOrder:0},
 {id:'other',workId:'x',parentId:null,text:'其他作品',sortOrder:0}
]
test('tree paths, root promotion and cycle/work isolation',()=>{
 const ns=nodes();assert.deepEqual(lorePath(ns,'b').map(n=>n.id),['root','a','b']);assert.equal(validLoreMove(ns,'root','b','w'),false);assert.equal(validLoreMove(ns,'a','other','w'),false);assert.equal(validLoreMove(ns,'b','root','w'),true)
 ns[1].parentId=null;assert.deepEqual(lorePath(ns,'b').map(n=>n.id),['a','b'])
})
test('deleted focus falls back to the nearest live ancestor, then all',()=>{
 const ns=nodes();ns[2].deletedAt=1;assert.equal(resolveLoreFocus(ns,'b',['root','a','b'],'w'),'a');ns[1].deletedAt=1;assert.equal(resolveLoreFocus(ns,'b',['root','a','b'],'w'),'root');ns[0].deletedAt=1;assert.equal(resolveLoreFocus(ns,'b',['root','a','b'],'w'),null)
})
test('history preserves complete metadata, coalesces typing and isolates future',()=>{
 const ns=nodes(),h=createLoreHistory();checkpointLore(h,ns,{group:'text:a',at:100});ns[1].text='灯塔修订';checkpointLore(h,ns,{group:'text:a',at:200});ns[1].text+='中';assert.equal(h.past.length,1)
 let restored=stepLoreHistory(h,ns,'undo');assert.deepEqual(restored.nodes[1],nodes()[1]);assert.equal(h.future.length,1);restored=stepLoreHistory(h,restored.nodes,'redo');assert.equal(restored.nodes[1].text,'灯塔修订中')
 checkpointLore(h,ns,{at:400});assert.equal(h.future.length,0);assert.equal(captureLoreNodes(ns)[1].heading,2)
})
test('structural actions retain only the last 60 undo states',()=>{const ns=nodes(),h=createLoreHistory();for(let i=0;i<70;i++){checkpointLore(h,ns,{at:i});ns[1].text=String(i)}assert.equal(h.past.length,60)})
test('ID references survive rename, distinguish homonyms and deduplicate occurrences',()=>{
 const targets=[{kind:'mubu',id:'a',title:'新灯塔'},{kind:'mubu',id:'z',title:'新灯塔'}],s={kind:'mubu',id:'source',text:'提到旧灯塔',html:'<span data-dl-target="mubu:a" data-dl-title="旧灯塔">旧灯塔</span> <span data-dl-target="mubu:a">别名</span>'};
 assert.deepEqual(referenceTargets(s,targets).map(t=>t.id),['a']);assert.equal(incomingReferences([s],{kind:'mubu',id:'a'},targets).length,1);assert.equal(incomingReferences([s],{kind:'mubu',id:'z'},targets).length,0)
})
test('legacy tokens resolve uniquely without binding ambiguous titles',()=>{
 const s={kind:'snippet',id:'s',text:'[[灯塔|旧塔]]'},one=[{kind:'mubu',id:'a',title:'灯塔'}];assert.equal(referenceTargets(s,one).length,1);assert.equal(referenceTargets(s,[...one,{kind:'mubu',id:'b',title:'灯塔'}]).length,0);assert.equal(referenceTargets({html:'<span data-dl-target="mubu:deleted" data-dl-title="灯塔">灯塔</span>'},one)[0].id,'deleted')
})
test('JSON backup retains headings, tags, custom metadata and ID markup',()=>{const ns=nodes();ns[1].custom={x:1};ns[1].html='<span data-dl-target="mubu:b">灯室</span>';assert.deepEqual(JSON.parse(JSON.stringify(captureLoreNodes(ns))),ns)})
test('explicit link labels cannot create a legacy edge to a homonym',()=>{assert.deepEqual(referenceTargets({html:'<span data-dl-target="mubu:deleted">[[塔]]</span>'},[{kind:'mubu',id:'replacement',title:'塔'}]).map(n=>n.id),['deleted'])})
