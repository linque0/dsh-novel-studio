/* 静态资源托管：把小说工坊 dist 通过 DSH 的 fetch 路由提供给 iframe。
 * 两种注册方式：前缀路由（宿主支持通配时）+ 精确路由（不支持通配时的兜底）。 */
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const LONG_CACHE = /-[A-Za-z0-9_]{8,}\.(js|css|woff2?|png|jpe?g|webp|svg)$/;

/* —— 宿主契约（读 dsh-client-connection 源码核实）——
 * fetch 路由是精确路径 Map；段名必须匹配 /^[A-Za-z0-9_$.-]+$/；
 * 未声明 requestBody 时宿主按 streaming 处理，GET 会因此抛错。
 * 把契约固化成常量与构造函数，避免重犯，也让冒烟可断言。 */
export const APP_ROUTE_METHODS = Object.freeze(['GET', 'HEAD']);
export const APP_ROUTE_BODY_MODE = 'buffered';
export const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/;

export function isValidAppPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/api/')) return false;
  const segments = pathname.slice('/api/'.length).split('/');
  return segments.length > 0 && segments.every((s) => s !== '' && s !== '.' && s !== '..' && ENDPOINT_SEGMENT.test(s));
}

export function makeAppRoute({ path, handler, methods = APP_ROUTE_METHODS }) {
  if (!isValidAppPath(path)) throw new Error('connection: invalid exact Fetch route ' + JSON.stringify(path));
  return { path, methods: [...methods], requestBody: APP_ROUTE_BODY_MODE, fetch: handler };
}

/** index.html 注入桥：保证 window.native 先于 app bundle 存在。 */
export function injectShim(html, shimSrc) {
  if (!shimSrc || html.includes(shimSrc)) return html;
  const tag = '<script src="' + shimSrc + '"></script>';
  const head = html.match(/<head[^>]*>/i);
  if (head && typeof head.index === 'number') {
    const at = head.index + head[0].length;
    return html.slice(0, at) + '\n    ' + tag + html.slice(at);
  }
  const close = html.indexOf('</head>');
  if (close >= 0) return html.slice(0, close) + '  ' + tag + '\n  ' + html.slice(close);
  return tag + html;
}

function unsafePath(relative) {
  if (!relative) return true;
  if (relative.includes('\0') || relative.includes('\\') || relative.startsWith('/')) return true;
  return relative.split('/').includes('..');
}

export async function respondFile({ root, relative, request, shimSrc = null, shimPath = null }) {
  const base = resolve(root || '.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const rel = relative || 'index.html';
  if (unsafePath(rel)) return new Response('bad path', { status: 400 });

  const wantsShim = shimPath && (rel === 'native-shim.js' || rel === './native-shim.js');
  const target = wantsShim ? resolve(shimPath) : resolve(base, rel);
  if (!wantsShim && target !== base && !target.startsWith(base + sep)) return new Response('forbidden', { status: 403 });

  let info;
  try {
    info = await stat(target);
  } catch {
    return new Response('not found', { status: 404 });
  }
  let file = target;
  if (info.isDirectory()) {
    file = resolve(target, 'index.html');
    try {
      info = await stat(file);
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  const etag = 'W/"' + Number(info.size).toString(16) + '-' + Math.floor(info.mtimeMs).toString(16) + '"';
  const headers = { etag, 'cache-control': LONG_CACHE.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'content-type': type } });

  let body = await readFile(file);
  if (type.startsWith('text/html')) body = Buffer.from(injectShim(body.toString('utf8'), shimSrc), 'utf8');
  return new Response(body, { status: 200, headers: { ...headers, 'content-type': type, 'content-length': String(body.length) } });
}

export function createStaticHandler({ root, prefix = '/api/novelstudio/app/', shimSrc = './native-shim.js', shimPath = null } = {}) {
  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(prefix)) return new Response('not found', { status: 404 });
    let relative = '';
    try {
      relative = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return new Response('bad path', { status: 400 });
    }
    if (!relative || relative === '/') relative = 'index.html';
    return respondFile({ root, relative, request, shimSrc, shimPath });
  };
}

export function createExactHandler({ root, relative, shimSrc = './native-shim.js', shimPath = null } = {}) {
  return async function handle(request) {
    return respondFile({ root, relative, request, shimSrc, shimPath });
  };
}

/**
 * 前缀路由的 node:http 处理器：把整个目录挂在一个前缀下，**每次请求现读磁盘**。
 *
 * 为什么要它：宿主的 fetch 路由表是"pathname → 路由"的精确 Map，插件在 apply 时按文件名
 * 逐条注册；而 index.html 每次都是从磁盘现读的 —— 于是重建产物后 index.html 立刻指向新的
 * 哈希资源，那些文件名在启动时并不存在，路由表里没有 → 404 → 面板白屏，点「重新载入」也没用。
 * 前缀路由把"路由表"与"文件内容"解耦，重建后无需重启进程。
 *
 * webServer 前缀路由按最长前缀匹配（宿主 dsh-host-webserver 的 match()），比 connection 的
 * '/api' 共享前缀更长，所以 /api/novelstudio/app/** 会落到这里。
 *
 * @param root - 产物根目录（绝对路径）。
 * @param prefix - URL 前缀，带不带结尾斜杠都行。
 * @param shimSrc - index.html 里注入的桥脚本相对地址。
 * @param shimPath - native-shim.js 的真实文件位置。
 * @param gate - 鉴权闸门：(request) => 403|401|undefined，同步或异步均可。
 * @param log - 宿主 logger（可选）。
 */
export function createPrefixNodeHandler({ root, prefix = '/api/novelstudio/app/', shimSrc = null, shimPath = null, gate = null, log = null } = {}) {
  const bare = String(prefix || '/').replace(/\/+$/, '');
  const relativeOf = (pathname) => {
    if (pathname === bare) return '';
    if (pathname.startsWith(bare + '/')) return pathname.slice(bare.length + 1);
    return null;
  };

  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let relative = '';
    try {
      const pathname = new URL(req.url || '/', 'http://novelstudio.invalid').pathname;
      const tail = relativeOf(pathname);
      if (tail === null) {
        res.writeHead(404);
        res.end();
        return;
      }
      relative = decodeURIComponent(tail);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    /* 只搬闸门真正要看的头，不整包透传（node 的头里可能有数组值，构造 Headers 会抛）。 */
    const headers = new Headers();
    const raw = req.headers || {};
    for (const name of ['host', 'cookie', 'if-none-match']) {
      if (typeof raw[name] === 'string') headers.set(name, raw[name]);
    }
    const url = 'http://' + (typeof raw.host === 'string' ? raw.host : '127.0.0.1') + (req.url || '/');

    if (typeof gate === 'function') {
      let rejection;
      try {
        rejection = await gate(new Request(url, { method: req.method, headers }));
      } catch (error) {
        /* 闸门自己炸掉不该把面板打死：它与 RPC 的鉴权同源，异常时记日志放行静态资源。 */
        log?.warn?.('[novel-studio] 静态鉴权闸门异常：' + (error?.message || error));
      }
      if (rejection === 401 || rejection === 403) {
        res.writeHead(rejection);
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
    }

    try {
      const response = await respondFile({
        root,
        relative: relative || 'index.html',
        request: new Request(url, { method: req.method, headers }),
        shimSrc,
        shimPath,
      });
      const outHeaders = {};
      response.headers.forEach((value, name) => { outHeaders[name] = value; });
      const body = response.body === null ? null : Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, outHeaders);
      res.end(body && req.method !== 'HEAD' ? body : undefined);
    } catch (error) {
      log?.warn?.('[novel-studio] 静态产物读取失败 ' + relative + '：' + (error?.message || error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}
