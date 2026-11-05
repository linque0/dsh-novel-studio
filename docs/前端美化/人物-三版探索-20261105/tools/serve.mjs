import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.PORT||57910),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'}
createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(pathname==='/'?'/style-explorer.html':pathname));if(!file.startsWith(resolve(root)+sep))throw Error('outside');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file))}catch{res.writeHead(404);res.end('Not found')}}).listen(port,'127.0.0.1',()=>console.log(`Character prototypes: http://127.0.0.1:${port}/style-explorer.html`))
