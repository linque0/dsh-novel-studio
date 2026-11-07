import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!path.startsWith(resolve(root)+sep))throw Error('outside');
 res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(path));
}catch{res.writeHead(404);res.end('Not found')}});
server.listen(Number(process.env.LORE_PREVIEW_PORT||9136),'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+server.address().port+'/index.html'));
