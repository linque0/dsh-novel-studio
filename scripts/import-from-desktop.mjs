/* 从软件版小说工坊读出作品并导入插件作品库。
 * 做法：以 CDP 启动桌面版（默认 profile = 作者真实数据），在渲染进程里用 Dexie 直接 dump，
 * 再写进插件作品库（%LOCALAPPDATA%\novel-studio\library）。
 *
 * 用法：
 *   node scripts/import-from-desktop.mjs            # 启动→dump→导入→关闭
 *   node scripts/import-from-desktop.mjs --keep     # 不关闭桌面版
 *   node scripts/import-from-desktop.mjs --port=9333
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLibrary } from '../src/core/library.js';

const here = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(here, '../../novel-studio');
const OUT_DIR = resolve(here, '../.tmp');
const OUT_FILE = join(OUT_DIR, 'desktop-dump.json');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const portArg = args.find((item) => item.startsWith('--port='));
const PORT = Number(portArg ? portArg.split('=')[1] : 9222);

const DUMP_EXPRESSION = `(async () => {
  const db = window.__ns && window.__ns.db;
  if (!db) return { error: 'window.__ns.db 不存在（页面还没就绪？）' };
  const tables = db.tables.map((t) => t.name);
  const data = {};
  for (const name of tables) {
    try { data[name] = await db.table(name).toArray(); } catch (error) { data[name] = []; }
  }
  if (Array.isArray(data.assets)) {
    data.assets = await Promise.all(data.assets.map(async (asset) => {
      const { blob, ...meta } = asset;
      if (!blob) return meta;
      try {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        return Object.assign(meta, { dataUrl: 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary) });
      } catch (error) {
        return meta;
      }
    }));
  }
  if (Array.isArray(data.aikbvec)) {
    data.aikbvec = data.aikbvec.map((row) => {
      const { vec, ...rest } = row;
      let list = [];
      try { list = Array.from(new Float32Array(vec)); } catch (error) { list = []; }
      return Object.assign(rest, { vec: list });
    });
  }
  return { version: 1, exportedAt: new Date().toISOString(), data };
})()`;

async function waitForTarget(timeoutMs = 45000) {
  const started = Date.now();
  for (;;) {
    try {
      const list = await fetch('http://127.0.0.1:' + PORT + '/json/list').then((res) => res.json());
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) throw new Error('等待桌面版调试端口超时（' + PORT + '）');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function evaluate(page, expression, tries = 20) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const send = (method, params) => new Promise((res, rej) => {
    const id = nextId++;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rej(new Error(JSON.stringify(message.error)));
      else res(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable', {});
  try {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      const value = result?.result?.value;
      if (value && !value.error && value.data) return value;
      if (value && value.error) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error('渲染进程没能给出数据（可能页面未就绪或不是小说工坊）');
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}

async function main() {
  if (!existsSync(join(DESKTOP, 'package.json'))) throw new Error('找不到桌面版目录：' + DESKTOP);
  mkdirSync(OUT_DIR, { recursive: true });

  let child = null;
  let reused = false;
  try {
    await fetch('http://127.0.0.1:' + PORT + '/json/list');
    reused = true;
    console.log('复用已开启调试端口的桌面版（' + PORT + '）');
  } catch {
    const electron = join(DESKTOP, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    console.log('启动桌面版（默认 profile，只读 dump）…');
    child = spawn(electron, ['.', '--remote-debugging-port=' + PORT], { cwd: DESKTOP, stdio: 'ignore', shell: process.platform === 'win32' });
  }

  try {
    const page = await waitForTarget();
    console.log('目标页面：' + (page.title || page.url));
    const dump = await evaluate(page, DUMP_EXPRESSION);
    writeFileSync(OUT_FILE, JSON.stringify(dump), 'utf8');
    const counts = Object.fromEntries(Object.entries(dump.data).map(([table, rows]) => [table, rows.length]).filter(([, n]) => n));
    console.log('已 dump：' + JSON.stringify(counts));
    if (!(dump.data.works || []).length) throw new Error('桌面版里没有作品（works=0），检查是不是用了别的 profile');

    const library = openLibrary(process.env.NS_LIBRARY || join(process.env.LOCALAPPDATA || '', 'novel-studio', 'library'));
    await library.init();
    const result = await library.importDump(dump, { force: true });
    const works = await library.works();
    console.log('导入完成：' + result.imported + ' 行 → ' + library.dir);
    console.log('作品库现有 ' + works.length + ' 部：' + works.map((w) => w.title || w.id).join(' / '));
    console.log('dump 备份留在 ' + OUT_FILE);
  } finally {
    if (child && !keep) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill();
      } catch { /* ignore */ }
      console.log('已关闭桌面版');
    } else if (keep) {
      console.log('桌面版保持打开（--keep）');
    }
    if (reused) console.log('提示：复用的是你自己开着的桌面版，未关闭它');
  }
}

main().catch((error) => {
  console.error('导入失败：' + (error?.message || error));
  process.exit(1);
});
