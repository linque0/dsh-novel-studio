import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {build} from '../../../../app/node_modules/esbuild/lib/main.js'
const root=fileURLToPath(new URL('../',import.meta.url))
const data=JSON.parse(await readFile(join(root,'content.json'),'utf8'))
await writeFile(join(root,'content.mjs'),'export default '+JSON.stringify(data,null,2)+'\n')
await build({entryPoints:[join(root,'app.mjs')],bundle:true,format:'iife',outfile:join(root,'prototype.js'),logLevel:'info'})
for(const [v,file,title] of [['A','a-dossier.html','人物卷宗'],['B','b-cast.html','群像卡册'],['C','c-relationships.html','关系剧场']]){
 await writeFile(join(root,file),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 小说工坊</title><link rel="icon" href="data:,"><link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="studio.css"></head><body data-variant="${v}"><div class="backdrop" aria-hidden="true"><canvas id="flow-canvas"></canvas></div><header class="topbar" id="topbar"></header><div class="mobile-tools" id="mobile-tools"></div><div class="workspace" id="workspace"></div><button class="scrim" data-act="close-drawer" aria-label="关闭人物名录" tabindex="-1"></button><dialog id="dialog" aria-labelledby="dialog-title"></dialog><div class="toast" id="toast" role="status" aria-live="polite" hidden></div><input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><script src="prototype.js"></script></body></html>`)
}
console.log('Built three independent character prototypes.')
