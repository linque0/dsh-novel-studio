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
