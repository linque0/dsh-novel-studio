/* 宿主契约预检：用一个"挑剔的宿主"跑一遍真正的 apply()。
 * 目的：把"注册期抛错 → effect 全回收 → 所有路由 404"这类事故挡在重启之前。
 * 规则来源：读 dsh-client-connection / dsh-app-boot / dsh-tools 源码核实的那几条。
 *
 * 2026-11：静态产物改走 webServer 前缀路由（重建产物无需重启），所以这里跑三种组合：
 *   1) 只有 connection（无 webServer 的组合）→ 逐文件精确路由，条数必须等于产物文件数 + shim；
 *   2) connection + webServer → 恰好 1 条前缀路由，且不再逐文件注册 app 产物；
 *   3) 同一条前缀已被占用（等价于重复 apply）→ 回落精确路由，apply 仍然不抛错。
 *
 * 2026-11（0.2.8）：补三条"会被静默杀掉"的契约，它们都不产生报错，只让插件凭空消失：
 *   4) Config 必须是同步 Standard Schema —— cordis 4 读 Config['~standard'].validate，
 *      拿到 Promise 或假 schema 就直接抛错，apply 永不执行；
 *   5) 工具 parameters 必须是宿主认的 JSON Schema 子集 —— 降级成别的格式模型能收到畸形 schema；
 *   6) 清单兼容 —— dsh-app-boot 的版本门把不满足 engines/peer 的 bundle 静默塞进 skippedBundles。
 */
import { readdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, Config } from '../src/index.js';

/* 静态路由是"逐个产物文件注册"的，期望条数必须从产物目录现算：
 * 写死阈值会在精简产物后变成假红（删皮肤那轮就从 176 掉到 129）。 */
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/app');
const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const APP_PREFIX = '/api/novelstudio/app';
const HEALTH = '/api/novelstudio/health';
const RPC = '/api/novelstudio/rpc';
/* 宿主运行版本：优先环境变量，否则从桌面版 asar 里读 dsh/package.json。 */
const ASAR_PATH = process.env.DSH_ASAR_PATH || 'F:\\deepseek harness 桌面版\\resources\\app.asar';
function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(resolve(dir, entry.name)) : 1;
  }
  return total;
}

const SEGMENT = /^[A-Za-z0-9_$.-]+$/;
const BODY_MODES = new Set(['buffered', 'streaming']);
/* 宿主 0.2.2-rc.1 的真实关键字表，逐字照抄
 * app.asar!dsh/node_modules/@deepseek-ai/dsh-tools/lib/shared-DTdn5dXO.js:48-63
 * （CONSTRAINT_KEYWORDS + ANNOTATION_KEYWORDS）：多一个会被宿主判 UNSUPPORTED_SCHEMA，
 * 少一个又会让这条回归项放过畸形 schema，两个方向都必须是宿主那一份。 */
const SCHEMA_KEYS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
const ANNOTATION_KEYS = new Set(['description', 'title', 'default', 'examples']);

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

/* 递归校验 JSON Schema 节点：宿主只投影白名单关键字，出现别的关键字说明这份 schema
 * 不是按宿主契约写的（典型来源：中间被降级/转换过一次）。 */
function assertSchema(node, where) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(where + ' 必须是 schema 对象');
  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATION_KEYS.has(key)) continue;
    if (!SCHEMA_KEYS.has(key)) throw new Error(where + ' 含宿主不支持的 schema 关键字 ' + key);
    if (key === 'type' && typeof value !== 'string') throw new Error(where + '.type 必须是字符串');
    if (key === 'properties') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(where + '.properties 必须是对象');
      for (const [name, child] of Object.entries(value)) assertSchema(child, where + '.properties.' + name);
    }
    if (key === 'items') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(where + '.items 必须是对象');
      assertSchema(value, where + '.items');
    }
    if (key === 'oneOf') {
      if (!Array.isArray(value) || !value.length) throw new Error(where + '.oneOf 必须是非空数组');
      value.forEach((child, index) => assertSchema(child, where + '.oneOf[' + index + ']'));
    }
    if (key === 'required' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
      throw new Error(where + '.required 必须是字符串数组');
    }
    if (key === 'enum' && !Array.isArray(value)) throw new Error(where + '.enum 必须是数组');
    if (key === 'additionalProperties' && typeof value !== 'boolean') assertSchema(value, where + '.additionalProperties');
    /* const 是字面量，不递归。 */
  }
}

function assertToolSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('工具栏 spec 必须是对象');
  if (typeof spec.name !== 'string' || !spec.name.trim()) throw new Error('工具缺少 name');
  if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error('工具缺少 description：' + spec.name);
  const parameters = spec.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('工具缺少 parameters 对象：' + spec.name);
  if (parameters.type !== 'object') throw new Error(spec.name + '.parameters 根节点必须是 type: object');
  if (!parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
    throw new Error(spec.name + '.parameters.properties 必须是对象');
  }
  assertSchema(parameters, spec.name + '.parameters');
  if (!spec.output || typeof spec.output !== 'object') throw new Error(spec.name + ' 缺少 output 对象');
  assertSchema(spec.output.schema, spec.name + '.output.schema');
  if (typeof spec.output.render !== 'function') throw new Error(spec.name + ' 缺少 output.render');
  if (typeof spec.execute !== 'function') throw new Error(spec.name + ' 缺少 execute');
}

function assertSkill(skill) {
  if (typeof skill.name !== 'string' || !skill.name) throw new Error('技能缺少 name');
  if (typeof skill.description !== 'string' || !skill.description) throw new Error('技能缺少 description：' + skill.name);
  if (typeof skill.content !== 'string' || !skill.content.trim()) throw new Error('技能缺少 content：' + skill.name);
}

/* 一次 apply：sink 收集注册结果与告警，宿主侧异常统一记在 failure 上。 */
async function run({ webServer } = {}) {
  const sink = { routes: [], tools: 0, specs: [], skills: [], warns: [], failure: null };
  const ctx = {
    logger: { info: () => {}, warn: (message) => sink.warns.push(String(message)), error: () => {} },
    connection: {
      fetch: { register: (route) => { assertRoute(route); sink.routes.push(route); return () => {}; } },
      /* 与宿主同名同签名：前缀路由的鉴权闸门靠它，返回 401/403 才算拒绝。 */
      requestRejection: () => undefined
    },
    tools: { register: (spec) => { assertToolSpec(spec); sink.specs.push(spec); sink.tools += 1; } },
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

/* ---- 契约 A：Config 必须是同步 Standard Schema（cordis 4 在 apply 之前就校验它） ---- */
function validateConfig(raw) {
  const validate = Config && Config['~standard'] && Config['~standard'].validate;
  if (typeof validate !== 'function') throw new Error('Config 缺少 ~standard.validate');
  return validate(raw);
}
try {
  const empty = validateConfig({});
  check('Config 是 Standard Schema（~standard.validate 可调用）', true);
  check('Config.validate 同步返回（不是 Promise）', !!empty && typeof empty.then !== 'function', empty && typeof empty.then);
  check('Config.validate({}) 两个字段都落到空串默认值',
    empty && empty.value && empty.value.libraryDir === '' && empty.value.appRoot === '',
    JSON.stringify(empty && empty.value));
  const filled = validateConfig({ libraryDir: '/x' });
  check('Config.validate({libraryDir}) 原样返回字符串', filled && filled.value && filled.value.libraryDir === '/x', JSON.stringify(filled && filled.value));
  const bad = validateConfig({ libraryDir: 5 });
  check('Config.validate 非法输入返回 issues 且不返回 value', !!bad && Array.isArray(bad.issues) && bad.issues.length > 0 && !('value' in bad),
    JSON.stringify(bad));
} catch (error) {
  check('Config 是 Standard Schema（~standard.validate 可调用）', false, error?.message || String(error));
}

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

/* 参数必须是"工具自己那份 JSON Schema"原样下发：嵌套 items/properties 一旦被拍平，
 * 模型看到的就是残缺 schema（studio_review.findings 是唯一有嵌套的结构，拿它当探针）。 */
const reviewSpec = exact.specs.find((spec) => spec.name === 'studio_review');
const findings = reviewSpec && reviewSpec.parameters && reviewSpec.parameters.properties && reviewSpec.parameters.properties.findings;
check('工具参数保留嵌套结构（未被降级成扁平属性图）',
  !!findings && findings.type === 'array' && !!findings.items && !!findings.items.properties && !!findings.items.properties.problem
    && Array.isArray(findings.items.required) && findings.items.required.includes('quote'),
  JSON.stringify(findings));

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

/* ---- 契约 B：清单兼容（复刻 dsh-app-boot 的 unmetRequirements + evaluatePluginCompatibility） ----
 * 版本门不满足时宿主不报错，只把 bundle 塞进 skippedBundles —— 插件服务端永不加载，
 * 于是这次修复必须让"0.2.2-rc.1 判定兼容"成为常驻回归项。 */
const DSH_PEER = /^@deepseek-ai\/dsh(?:-[a-z0-9._-]+)?$/;

function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] || 0), patch: Number(match[3] || 0), pre: match[4] ? match[4].split('.') : [] };
}

/* semver 的语义子集：>= > <= < = ^ ~ * 与预发布比较（宿主用 includePrerelease 判区间）。
 * 不引第三方包 —— 契约脚本必须能在没有任何依赖的插件目录里跑。 */
function compareParsed(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const left = a.pre[index];
    const right = b.pre[index];
    if (right === undefined) return 1;
    if (left === undefined) return -1;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
    } else if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

function comparatorTests(token) {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(token);
  if (!match) return [];
  const operator = match[1] || '=';
  const raw = match[2].trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'x') return [() => true];
  const base = parseVersion(raw);
  if (!base) return [() => false];
  const bump = (major, minor, patch) => ({ major, minor, patch, pre: [] });
  switch (operator) {
    case '>=': return [(version) => compareParsed(version, base) >= 0];
    case '>': return [(version) => compareParsed(version, base) > 0];
    case '<=': return [(version) => compareParsed(version, base) <= 0];
    case '<': return [(version) => compareParsed(version, base) < 0];
    case '^': {
      const upper = base.major > 0 ? bump(base.major + 1, 0, 0)
        : base.minor > 0 ? bump(0, base.minor + 1, 0)
          : bump(0, 0, base.patch + 1);
      return [(version) => compareParsed(version, base) >= 0 && compareParsed(version, upper) < 0];
    }
    case '~': {
      const upper = bump(base.major, base.minor + 1, 0);
      return [(version) => compareParsed(version, base) >= 0 && compareParsed(version, upper) < 0];
    }
    default: return [(version) => compareParsed(version, base) === 0];
  }
}

function satisfies(version, range) {
  const parsed = typeof version === 'string' ? parseVersion(version) : version;
  if (!parsed || typeof range !== 'string') return false;
  const sets = range.split('||').map((part) => part.trim()).filter(Boolean);
  if (!sets.length) return false;
  return sets.some((set) => {
    const tokens = set.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    const tests = tokens.flatMap(comparatorTests);
    return tests.every((test) => test(parsed));
  });
}

/* 宿主规则：manifest 有 engines.dsh 就只看它、完全忽略 peers；
 * 没有时才逐个校验 @deepseek-ai/dsh 与 @deepseek-ai/dsh-* 的 peerDependencies
 *（cordis / schemastery 不是 dsh peer，不参与判定）。 */
function unmetRequirements(manifest, runtimeVersion) {
  const unmet = {};
  const engineRange = typeof manifest?.engines?.dsh === 'string' ? manifest.engines.dsh.trim() : '';
  if (engineRange) {
    if (!satisfies(runtimeVersion, engineRange)) unmet['engines.dsh'] = engineRange;
    return unmet;
  }
  for (const [name, range] of Object.entries(manifest?.peerDependencies || {})) {
    if (!DSH_PEER.test(name)) continue;
    if (typeof range !== 'string' || !satisfies(runtimeVersion, range)) unmet[name] = range;
  }
  return unmet;
}

/* asar 是"pickle 头 + JSON 目录 + 数据区"：offset 4 是头部总长，offset 12 是 JSON 实际长度，
 * 数据区起点 = 8 + 头部总长；文件条目的 offset 相对数据区、沿路径累加。 */
function readAsarFile(asarPath, innerPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const raw = Buffer.alloc(jsonLength);
    readSync(fd, raw, 0, jsonLength, 16);
    const text = raw.toString('utf8');
    const header = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1));
    let node = header;
    let offset = 0;
    for (const part of innerPath.split('/')) {
      node = node?.files?.[part];
      if (!node) throw new Error('asar 里没有 ' + innerPath);
      offset += Number(node.offset || 0);
    }
    const size = Number(node.size || 0);
    const body = Buffer.alloc(size);
    readSync(fd, body, 0, size, 8 + headerSize + offset);
    return body.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function resolveRuntimeVersion() {
  const fromEnv = String(process.env.DSH_RUNTIME_VERSION || '').trim();
  if (fromEnv) return { version: fromEnv, source: 'DSH_RUNTIME_VERSION' };
  try {
    const version = JSON.parse(readAsarFile(ASAR_PATH, 'dsh/package.json')).version;
    if (typeof version === 'string' && version.trim()) return { version: version.trim(), source: ASAR_PATH + '!dsh/package.json' };
    return { version: '', error: 'asar 里的 dsh/package.json 没有 version' };
  } catch (error) {
    return { version: '', error: (error?.code || '') + (error?.code ? ': ' : '') + (error?.message || String(error)) };
  }
}

check('本地 semver 自检（区间边界 + 预发布）',
  satisfies('0.2.2-rc.1', '>=0.2.2-rc.1 <0.3.0')
  && !satisfies('0.3.0', '>=0.2.2-rc.1 <0.3.0')
  && !satisfies('0.2.1-rc.5', '>=0.2.2-rc.1 <0.3.0')
  && satisfies('4.1.0', '>=4.0.5 <5')
  && satisfies('3.18.5', '>=3.18.5 <4')
  && !satisfies('0.2.2-rc.1', '0.2.1-rc.5'),
  '区间比较器自身有问题，下面的清单断言就不可信');

check('清单声明 engines.dsh（宿主有它就不再管 peerDependencies）',
  typeof MANIFEST.engines?.dsh === 'string' && MANIFEST.engines.dsh.trim().length > 0,
  JSON.stringify(MANIFEST.engines));
check('peerDependencies 全是区间而不是精确版本',
  Object.values(MANIFEST.peerDependencies || {}).every((range) => typeof range === 'string' && /[<>=^~*]/.test(range) && /\s/.test(range)),
  JSON.stringify(MANIFEST.peerDependencies));

/* 本轮事故的直接回归项：dsh-tools 曾写死 0.2.1-rc.5，0.2.2-rc.1 上整包被静默跳过。 */
const pinnedVerdict = unmetRequirements(MANIFEST, '0.2.2-rc.1');
check('清单兼容回归：0.2.2-rc.1 判定兼容（事故直接回归项）', Object.keys(pinnedVerdict).length === 0, JSON.stringify(pinnedVerdict));
const legacyVerdict = unmetRequirements({ peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-rc.5', '@deepseek-ai/dsh': '>=0.2.1-rc.5 <0.3.0' } }, '0.2.2-rc.1');
check('判定器自检：写死版本的老清单确实会被判不兼容', Object.keys(legacyVerdict).includes('@deepseek-ai/dsh-tools'), JSON.stringify(legacyVerdict));

const runtime = resolveRuntimeVersion();
if (!runtime.version) {
  /* SKIP 不等于通过：拿不到运行版本就没有判定依据，必须让人看见原因。 */
  console.log('SKIP 清单兼容：拿不到 dsh 运行版本（' + runtime.error + '）；可设 DSH_RUNTIME_VERSION 或 DSH_ASAR_PATH 后重跑');
} else {
  const liveVerdict = unmetRequirements(MANIFEST, runtime.version);
  check('清单兼容：当前运行版本 ' + runtime.version + ' 满足 engines/peers（来源 ' + runtime.source + '）',
    Object.keys(liveVerdict).length === 0, JSON.stringify(liveVerdict));
  check('清单兼容：0.3.0 判定不兼容（区间上界真的生效）', Object.keys(unmetRequirements(MANIFEST, '0.3.0')).length > 0, '上界可能写错，更新后仍在加载但风险不受控');
}

console.log('');
console.log((problems.length ? '契约预检失败 ' + problems.length + ' 项' : '契约预检通过') + '：工具 ' + exact.tools + ' / 技能 ' + exact.skills.length + ' / 路由 ' + exact.routes.length + '（精确）+ 1（前缀）');
if (problems.length) {
  problems.forEach((item) => console.log('  - ' + item));
  process.exit(1);
}
