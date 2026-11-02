/* UI 侧 RPC：iframe 里的界面用它与作品库对话（不碰 DSH 内部 API）。 */
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const failure = (code, message) => ({ ok: false, error: { code, message } });

export function createRpcHandler({ library, version = '0.0.0', prefix = '/api/novelstudio/rpc' } = {}) {
  const handlers = {
    'library.status': async () => ({ ok: true, value: await library.status() }),
    'library.snapshot': async () => ({ ok: true, value: await library.snapshot() }),
    'works.list': async () => ({ ok: true, value: { items: await library.works() } }),
    'sync.pull': async (args) => ({ ok: true, value: await library.pull(Number(args.after) || 0) }),
    'sync.submit': async (args) => {
      const result = await library.submit(args.ops || [], { requestId: args.requestId, actor: args.actor || { kind: 'human' } });
      return { ok: true, value: result };
    },
    'plugin.info': async () => ({ ok: true, value: { version, library: library.dir } }),
  };

  return async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (request.method !== 'POST') return json(failure('METHOD', '仅支持 POST'), 405);
    if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      return json(failure('CONTENT_TYPE', 'content-type 必须是 application/json'), 415);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(failure('BAD_BODY', '请求体不是合法 JSON'), 400);
    }
    const action = String(payload?.action || '');
    const handler = handlers[action];
    if (!handler) return json(failure('UNKNOWN_ACTION', '未知操作：' + action), 404);
    try {
      return json(await handler(payload?.args || {}));
    } catch (error) {
      return json(failure(error?.code || 'ERROR', error?.message || String(error)), 200);
    }
  };
}
