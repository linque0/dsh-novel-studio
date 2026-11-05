/* 宿主契约预检：用一个"挑剔的宿主"跑一遍真正的 apply()。
 * 目的：把"注册期抛错 → effect 全回收 → 所有路由 404"这类事故挡在重启之前。
 * 规则来源：读 dsh-client-connection / defineTool 用法核实的那几条。
 *
 * 2026-11：静态产物改走 webServer 前缀路由（重建产物无需重启），所以这里跑三种组合：
 *   1) 只有 connection（无 webServer 的组合）→ 逐文件精确路由，条数必须等于产物文件数 + shim；
 *   2) connection + webServer → 恰好 1 条前缀路由，且不再逐文件注册 app 产物；
 *   3) 同一条前缀已被占用（等价于重复 apply）→ 回落精确路由，apply 仍然不抛错。
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, toParameters } from '../src/index.js';

/* 静态路由是"逐个产物文件注册"的，期望条数必须从产物目录现算：
 * 写死阈值会在精简产物后变成假红（删皮肤那轮就从 176 掉到 129）。 */
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/app');
const APP_PREFIX = '/api/novelstudio/app';
const HEALTH = '/api/novelstudio/health';
const RPC = '/api/novelstudio/rpc';
function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(resolve(dir, entry.name)) : 1;
  }
  return total;
}

const SEGMENT = /^[A-Za-z0-9_$.-]+$/;
const BODY_MODES = new Set(['buffered', 'streaming']);
const PARAM_KEYS = new Set(['type', 'enum', 'description', 'required', 'default']);

const problems = [];

function assertRoute(route) {
  if (!route || typeof route !== 'object') throw new Error('route 必须是对象');
  const { path, methods, requestBody, fetch } = route;
  if (typeof path !== 'string' || !path.startsWith('/api/')) throw new Error('route.path 必须在 /api/ 下：' + path);
  if (path.slice('/api/'.length).split('/').some((s) => !s || s === '.' || s === '..' || !SEGMENT.test(s))) {
    throw new Error('route.path 段名不合法（不允许通配与非 ASCII）：' + path);
  }
  if (!Array.isArray(methods) || !methods.length) throw new Error('route.methods 不能为空：' + path);
  if (!BODY_MODES.has(requestBody)) throw new Error('route.requestBody 必须是 buffered/streaming：' + path);
  if (typeof fetch !== 'function') throw new Error('route.fetch 必须是函数：' + path);
}

/* webServer 存根按宿主语义实现：重复 (kind, path) 抛错、返回 disposer。 */
function makeWebServer() {
  const routes = [];
  return {
    routes,
    register(route) {
      if (!route || route.kind !== 'prefix') throw new Error('webServer: 存根只认 prefix 路由');
      if (typeof route.path !== 'string' || !route.path) throw new Error('webServer: path 不能为空');
      if (typeof route.handler !== 'function') throw new Error('webServer: handler 必须是函数');
      if (routes.some((item) => item.path === route.path)) throw new Error('webserver: duplicate prefix route "' + route.path + '"');
      routes.push(route);
      return () => {
        const at = routes.indexOf(route);
        if (at >= 0) routes.splice(at, 1);
      };
    }
  };
}

function assertToolSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('defineTool 需要对象');
  if (typeof spec.name !== 'string' || !spec.name.trim()) throw new Error('工具缺少 name');
  if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error('工具缺少 description：' + spec.name);
  if (!spec.parameters || typeof spec.parameters !== 'object') throw new Error('工具缺少 parameters：' + spec.name);
  for (const [key, value] of Object.entries(spec.parameters)) {
    if (!value || typeof value !== 'object') throw new Error(spec.name + '.' + key + ' 参数定义必须是对象');
    for (const field of Object.keys(value)) {
      if (!PARAM_KEYS.has(field)) throw new Error(spec.name + '.' + key + ' 含未知字段 ' + field + '（宿主可能校验失败）');
    }
    if (typeof value.type !== 'string') throw new Error(spec.name + '.' + key + ' 缺少 type');
    if (value.enum !== undefined && !Array.isArray(value.enum)) throw new Error(spec.name + '.' + key + ' 的 enum 必须是数组');
  }
  if (!spec.output || typeof spec.output.render !== 'function') throw new Error(spec.name + ' 缺少 output.render');
  if (typeof spec.execute !== 'function') throw new Error(spec.name + ' 缺少 execute');
}

function assertSkill(skill) {
  if (typeof skill.name !== 'string' || !skill.name) throw new Error('技能缺少 name');
  if (typeof skill.description !== 'string' || !skill.description) throw new Error('技能缺少 description：' + skill.name);
  if (typeof skill.content !== 'string' || !skill.content.trim()) throw new Error('技能缺少 content：' + skill.name);
}

/* 一次 apply：sink 收集注册结果与告警，宿主侧异常统一记在 failure 上。 */
async function run({ webServer } = {}) {
  const sink = { routes: [], tools: 0, skills: [], warns: [], failure: null };
  const ctx = {
    logger: { info: () => {}, warn: (message) => sink.warns.push(String(message)), error: () => {} },
    connection: {
      fetch: { register: (route) => { assertRoute(route); sink.routes.push(route); return () => {}; } },
      /* 与宿主同名同签名：前缀路由的鉴权闸门靠它，返回 401/403 才算拒绝。 */
      requestRejection: () => undefined
    },
    tools: { register: (spec) => { assertToolSpec(spec); sink.tools += 1; } },
    skills: { register: (skill) => { assertSkill(skill); sink.skills.push(skill.name); } },
    on: () => {},
    effect: (fn) => { fn(); },
    /* 宿主用 ctx.get('webServer') 取可选服务（cordis 的 get 缺服务时返回 undefined，不抛）。 */
    get: (name) => (webServer && name === 'webServer' ? webServer : undefined)
  };
  if (webServer) ctx.webServer = webServer;
  try {
    await apply(ctx, {});
  } catch (error) {
    sink.failure = error;
  }
  return sink;
}

const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '  —— ' + detail));
  if (!ok) problems.push(name + ' ' + detail);
};

const expectedRoutes = countFiles(APP_DIR) + 1; /* +1 = native-shim.js */
const appPaths = (routes) => routes.filter((route) => route.path.startsWith(APP_PREFIX + '/'));

/* ---- 组合 1：没有 webServer（headless / SDK），逐文件精确路由 ---- */
const exact = await run({});
check('apply 不抛错（抛错会让整包 effect 回收 → 全路由 404）', !exact.failure, exact.failure && (exact.failure.message || String(exact.failure)));
check('精确模式：apply 期间没有告警', exact.warns.length === 0, exact.warns.join(' | '));
check('10 个工具全部通过宿主校验', exact.tools === 10, '注册 ' + exact.tools + ' 个');
check('6 个技能全部通过校验', exact.skills.length === 6, exact.skills.join(','));
check('静态路由覆盖全部构建产物 + shim（' + expectedRoutes + ' 条）', appPaths(exact.routes).length === expectedRoutes, 'app=' + appPaths(exact.routes).length + ' 期望=' + expectedRoutes);
check('health 路由存在', exact.routes.some((route) => route.path === HEALTH));
check('rpc 路由存在', exact.routes.some((route) => route.path === RPC));

/* ---- 组合 2：有 webServer，走前缀路由（重建产物无需重启的关键） ---- */
const webServer = makeWebServer();
const prefix = await run({ webServer });
check('前缀模式：apply 不抛错', !prefix.failure, prefix.failure && (prefix.failure.message || String(prefix.failure)));
check('前缀模式：apply 期间没有告警', prefix.warns.length === 0, prefix.warns.join(' | '));
check('前缀路由恰好 1 条', webServer.routes.length === 1, '注册 ' + webServer.routes.length + ' 条');
const prefixRoute = webServer.routes[0];
check('前缀路由 path = ' + APP_PREFIX, !!prefixRoute && prefixRoute.path === APP_PREFIX, prefixRoute ? prefixRoute.path : '(无)');
check('前缀路由带 handler', !!prefixRoute && typeof prefixRoute.handler === 'function', String(prefixRoute && typeof prefixRoute.handler));
check('前缀模式不再逐文件注册产物', appPaths(prefix.routes).length === 0, 'app=' + appPaths(prefix.routes).length);
check('前缀模式仍注册 RPC 与 health', prefix.routes.some((route) => route.path === RPC) && prefix.routes.some((route) => route.path === HEALTH),
  prefix.routes.map((route) => route.path).join(','));
check('前缀模式仍注册 10 个工具', prefix.tools === 10, '注册 ' + prefix.tools + ' 个');

/* ---- 组合 3：前缀已被占（重复 apply 的等价情形）→ 必须回落精确路由而不是炸掉 ---- */
const duplicate = await run({ webServer });
check('前缀被占时 apply 不抛错', !duplicate.failure, duplicate.failure && (duplicate.failure.message || String(duplicate.failure)));
check('前缀被占时回落精确路由', appPaths(duplicate.routes).length === expectedRoutes, 'app=' + appPaths(duplicate.routes).length + ' 期望=' + expectedRoutes);
check('回落时留一条告警', duplicate.warns.some((line) => line.includes('前缀路由注册失败')), duplicate.warns.join(' | '));

/* ---- health 探针的实际响应：面板顶栏靠它显示「热路由 / 产物时间 / 资源缺失」 ---- */
async function readHealth(routes) {
  const route = routes.find((item) => item.path === HEALTH);
  if (!route) return null;
  try {
    return await (await route.fetch(new Request('http://127.0.0.1:1' + HEALTH))).json();
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}
const exactHealth = await readHealth(exact.routes);
check('health 报 routeMode=exact（无 webServer 时）', !!exactHealth && exactHealth.routeMode === 'exact', JSON.stringify(exactHealth && exactHealth.routeMode));
check('health 报构建产物且 index 引用的文件都在盘上', !!exactHealth && !!exactHealth.build && Array.isArray(exactHealth.build.missing) && exactHealth.build.missing.length === 0,
  exactHealth && exactHealth.build ? 'files=' + exactHealth.build.files + ' missing=' + JSON.stringify(exactHealth.build.missing).slice(0, 120) : '(无 build)');
const prefixHealth = await readHealth(prefix.routes);
check('health 报 routeMode=prefix（有 webServer 时）', !!prefixHealth && prefixHealth.routeMode === 'prefix', JSON.stringify(prefixHealth && prefixHealth.routeMode));

const nested = toParameters({ properties: { findings: { type: 'array', items: { type: 'object' }, additionalProperties: false, description: 'x' } }, required: ['findings'] });
check('toParameters 丢弃嵌套 items/additionalProperties', Object.keys(nested.findings).sort().join(',') === 'description,required,type', JSON.stringify(nested.findings));

console.log('');
console.log((problems.length ? '契约预检失败 ' + problems.length + ' 项' : '契约预检通过') + '：工具 ' + exact.tools + ' / 技能 ' + exact.skills.length + ' / 路由 ' + exact.routes.length + '（精确）+ 1（前缀）');
if (problems.length) {
  problems.forEach((item) => console.log('  - ' + item));
  process.exit(1);
}
