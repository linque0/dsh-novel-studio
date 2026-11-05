// Copy the approved draft's visual vocabulary into the outline-only production scope.
// Layout/interaction adaptations are explicit below; original draft files stay unchanged.
import { readFile,writeFile } from 'node:fs/promises'
import postcss from '../app/node_modules/postcss/lib/postcss.mjs'
const reference=await readFile('docs/前端美化/大纲-三版探索-20261104/b-workbench.html','utf8')
const base=reference.match(/<style>([\s\S]*?)<\/style>/)[1]
const root=postcss.parse(base)
const scope="html body[data-skin='dsh'] .outline-strict.outline-strict.outline-strict.outline-strict"
root.walkAtRules('font-face',r=>r.remove())
root.walkRules(rule=>{
  if(rule.parent.type==='atrule'&&/keyframes/.test(rule.parent.name))return
  const selectors=rule.selectors.filter(s=>!s.includes('.screen')&&!/^(html|body|:root)$/.test(s)&&!/[.]([abc])-/.test(s)&&!s.includes('[data-design'))
  if(!selectors.length){rule.remove();return}
  rule.selectors=selectors.map(s=>scope+' '+s.replaceAll('.topbar','.outline-topbar'))
})
let css='/* Visual values copied from approved B draft. Regenerate: node scripts/build-outline-style.mjs. */\n'+root.toString().replaceAll('./assets/event.webp','../../src/assets/outline-paper/event.webp').replaceAll('./assets/note.webp','../../src/assets/outline-paper/note.webp').replaceAll('./assets/cite.webp','../../src/assets/outline-paper/cite.webp').replaceAll('./assets/anchor.webp','../../src/assets/outline-paper/anchor.webp')
css+='\n'+(await readFile('app/plugin/dsh/outline-layout.css','utf8')).replaceAll('.outline-strict.outline-strict','.outline-strict.outline-strict.outline-strict.outline-strict')
await writeFile('app/plugin/dsh/outline-fusion.css',css)
console.log('Approved draft tokens and component styles scoped to outline; layout adaptations appended.')
