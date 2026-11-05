/* 本地复现台：用插件自己的静态路由 + RPC 把小说工坊跑起来，再用 Electron 隐窗口抓真实报错与截图。
 *   node scripts/preview.mjs                启动→9s 后打印控制台/页面状态/截图→退出
 *   node scripts/preview.mjs --serve        只起服务（手动在浏览器看）
 *   node scripts/preview.mjs --probe=x.js   用 .tmp/x.js 当页面探针（可驱动界面再截图）
 *   NS_SIZE=1100x800                        指定窗口尺寸（默认 1500x950）
 */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createStaticHandler } from '../src/adapters/dsh/static.js';
import { createRpcHandler } from '../src/adapters/dsh/rpc.js';
import { openLibrary } from '../src/core/library.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, '../assets/app');
const SHIM = resolve(here, '../src/client/iframe-shim.js');
const PREFIX = '/api/novelstudio/app/';
const ELECTRON = resolve(here, '../../novel-studio/node_modules/electron/dist/electron.exe');
const serveOnly = process.argv.includes('--serve');
const PORT = Number(process.env.NS_PORT || 18688);
const [WIN_W, WIN_H] = (process.env.NS_SIZE || '1500x950').split('x').map(Number);
const SHOT = process.env.NS_SHOT || resolve(here, '../.tmp/preview.png');

const library = openLibrary(process.env.NS_LIBRARY || join(homedir(), 'AppData', 'Local', 'novel-studio', 'library'));
await library.init();
const staticHandler = createStaticHandler({ root: APP_ROOT, prefix: PREFIX, shimSrc: './native-shim.js', shimPath: SHIM });
const rpcHandler = createRpcHandler({ library, version: 'preview' });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let response;
    if (url.pathname.startsWith(PREFIX)) {
      response = await staticHandler(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers }));
    } else if (url.pathname === '/api/novelstudio/rpc') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      response = await rpcHandler(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) }));
    } else if (url.pathname === '/api/novelstudio/health') {
      response = new Response(JSON.stringify({ ok: true, library: await library.status() }), { headers: { 'content-type': 'application/json' } });
    } else {
      response = new Response('not found', { status: 404 });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('preview error: ' + (error?.message || error));
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const APP_URL = 'http://127.0.0.1:' + PORT + PREFIX + 'index.html';
console.log('服务已起：' + APP_URL);
console.log('作品库：' + library.dir + '（' + (await library.status()).works + ' 部）');

if (serveOnly) {
  console.log('--serve：保持运行，Ctrl+C 结束');
} else {
  mkdirSync(dirname(SHOT), { recursive: true });
  const mainFile = resolve(here, '../../novel-studio/.preview-main.cjs');
  /* 页面内探针单独成文件，避免在生成的主进程脚本里拼引号 */
  const probeFile = resolve(here, '../.tmp/preview-probe.js');
  const probeArg = process.argv.find((arg) => arg.startsWith('--probe='));
  if (probeArg) {
    const custom = resolve(here, '../.tmp', probeArg.slice('--probe='.length));
    writeFileSync(probeFile, readFileSync(custom, 'utf8'), 'utf8');
    console.log('页面探针：' + custom);
  } else
  writeFileSync(probeFile, [
    '(async () => {',
    '  const db = window.__ns && window.__ns.db;',
    '  const works = db ? await db.works.count() : -1;',
    '  const app = document.getElementById(\'app\');',
    '  return { works, htmlLength: document.body.innerHTML.length, appChildren: app ? app.children.length : -1 };',
    '})()',
  ].join('\n'), 'utf8');
  const mainSource = [
    "const { app, BrowserWindow } = require('electron');",
    'const fs = require("node:fs");',
    'const target = process.argv[process.argv.length - 1];',
    'app.whenReady().then(async () => {',
    '  const win = new BrowserWindow({ show: false, width: ' + WIN_W + ', height: ' + WIN_H + ' });',
    '  /* 隐藏窗口不合成新帧，截图会滞后一步；以全透明窗口显示，既不干扰桌面也能抓到当前画面。 */',
    '  win.setOpacity(0.01);',
    '  try { win.showInactive(); } catch {}',
    '  const logs = [];',
    '  win.webContents.on("console-message", (_e, level, message, line, source) => {',
    '    logs.push("[" + level + "] " + message + (source ? " (" + source.split("/").pop() + ":" + line + ")" : ""));',
    '  });',
    '  win.webContents.on("render-process-gone", (_e, d) => logs.push("[gone] " + JSON.stringify(d)));',
    '  win.webContents.on("did-fail-load", (_e, c, desc) => logs.push("[fail-load] " + c + " " + desc));',
    '  await win.loadURL(target);',
    '  await new Promise((r) => setTimeout(r, 9000));',
    '  let probe = {};',
    '  try {',
    '    probe = await win.webContents.executeJavaScript(fs.readFileSync(process.env.NS_PROBE, "utf8"));',
    '  } catch (error) { probe = { probeError: String(error) }; }',
    '  console.log("=== 控制台 ===");',
    '  logs.slice(-40).forEach((line) => console.log(line));',
    '  console.log("=== 页面状态 ===");',
    '  console.log(JSON.stringify(probe, null, 2));',
    '  try {',
    '    win.webContents.invalidate();',
    '    await new Promise((r) => setTimeout(r, 350));',
    '    await win.capturePage();',
    '    await new Promise((r) => setTimeout(r, 500));',
    '    const image = await win.capturePage();',
    '    fs.writeFileSync(process.env.NS_SHOT || "preview.png", image.toPNG());',
    '    console.log("截图已存");',
    '  } catch (error) { console.log("截图失败：" + (error && error.message)); }',
    '  app.quit();',
    '});',
  ].join('\n');
  writeFileSync(mainFile, mainSource, 'utf8');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, [mainFile, APP_URL], { stdio: 'inherit', env: { ...env, NS_SHOT: SHOT, NS_PROBE: probeFile } });
  await new Promise((r) => child.on('exit', r));
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' });
  } catch { /* ignore */ }
  rmSync(mainFile, { force: true });
  server.close();
}
