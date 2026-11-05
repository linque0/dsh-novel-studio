/* UI 侧 RPC：界面（DSH 右栏原生面板与完整界面 iframe）用它与作品库对话（不碰 DSH 内部 API）。 */
import { createView } from '../../core/view.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const failure = (code, message) => ({ ok: false, error: { code, message } });

/* 参数/状态问题一律走这两个入口：界面只认 code，不解析中文提示。 */
const coded = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/* tools：宿主注册的同一批工具实现（按名字索引），留给界面后续直接复用，避免再抄一套读写逻辑。 */
export function createRpcHandler({ library, version = '0.0.0', prefix = '/api/novelstudio/rpc', tools = {} } = {}) {
  /* 作品库拿不到时不构造视图：新 action 统一回 LIBRARY_UNAVAILABLE，而不是崩在解引用上。 */
  const view = library ? createView(library) : null;
  const viaView = (run) => async (args) => {
    if (!view) throw coded('LIBRARY_UNAVAILABLE', '作品库不可用');
    return { ok: true, value: await run(view, args || {}) };
  };

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

    /* 界面数据层（书架 / 新建 / 打开 / 单章）：只读组装在 core/view.js，这里只做转发与错误码映射。 */
    'shelf.list': viaView((v) => v.shelf()),
    'work.create': viaView((v, args) => v.createWork(args)),
    'work.open': viaView((v, args) => v.openWork(args)),
    'chapter.get': viaView((v, args) => v.chapter(args)),

    /* 从桌面版导出的备份 JSON 导入作品库（插件版不需要迁移 Dexie，库就是权威源） */
    'library.import': async (args) => {
      const dump = args?.dump || (typeof args?.text === 'string' ? JSON.parse(args.text) : null);
      if (!dump || typeof dump !== 'object' || !dump.data) return { ok: false, error: { code: 'INVALID_DUMP', message: '备份内容不是合法 JSON 或缺少 data 字段' } };
      const result = await library.importDump(dump, { force: args?.force === true });
      return { ok: true, value: result };
    },

    'library.verify': async () => {
      const index = await library.index();
      const problems = [];
      for (const id of Object.keys(index.works || {})) {
        const row = await library.readEntity('works', id);
        if (!row) problems.push('索引里的作品找不到实体文件：' + id);
      }
      const dump = await library.snapshot();
      return {
        ok: true,
        value: {
          dir: library.dir,
          seq: index.seq || 0,
          works: Object.keys(index.works || {}).length,
          tables: Object.fromEntries(Object.entries(dump.data).map(([table, rows]) => [table, rows.length])),
          problems,
        },
      };
    },
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
