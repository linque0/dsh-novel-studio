import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {build} from '../../../../app/node_modules/esbuild/lib/main.js'
const root=fileURLToPath(new URL('../',import.meta.url)),data=JSON.parse(await readFile(join(root,'content.json'),'utf8'))
await writeFile(join(root,'content.mjs'),'export default '+JSON.stringify(data,null,2)+'\n')
await build({entryPoints:[join(root,'app.mjs')],bundle:true,format:'iife',outfile:join(root,'prototype.js'),logLevel:'info'})
