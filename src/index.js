/* DSH 插件服务端入口：注册工具、静态资源、RPC、技能与稳定提示词段。
 * 结构对齐 dsh-cuigengji-plugin（cordis 插件：name / inject / Config / apply）。
 * 本文件不 import 任何 @deepseek-ai/* 包：插件目录没有 node_modules，
 * 任何一次解析失败都会在启动阶段把整个插件抹掉（2026-11 真实事故）。 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openLibrary, LAYOUT } from './core/library.js';
import { createTools } from './core/tools.js';
import { createExactHandler, createPrefixNodeHandler, makeAppRoute, isValidAppPath } from './adapters/dsh/static.js';
import { createRpcHandler } from './adapters/dsh/rpc.js';

export const name = 'novel-studio';
export const inject = ['tools', 'systemPrompt', 'skills', 'connection'];

/* cordis 4 的 resolveConfig 直接取 runtime.Config['~standard'].validate(...)，
 * 并且拒绝异步结果（返回值带 then 就按 Promise 处理）。宿主侧没有 schemastery 可用，
 * 所以这里自带一份同步 Standard Schema：非法输入返回 issues，合法输入返回 value。 */
const stringField = (fallback) => ({
  '~standard': {
    version: 1,
    vendor: 'novel-studio',
    validate: (value) => (value === undefined || value === null
      ? { value: fallback }
      : typeof value === 'string'
        ? { value }
        : { issues: [{ message: '该项必须是字符串', path: [] }] }),
  },
});

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'novel-studio',
    validate: (raw) => {
      const source = raw && typeof raw === 'object' ? raw : {};
      const value = {};
      const issues = [];
      for (const [key, field] of Object.entries({ libraryDir: stringField(''), appRoot: stringField('') })) {
        const result = field['~standard'].validate(source[key]);
        if (result.issues) issues.push(...result.issues.map((issue) => ({ ...issue, path: [key] })));
        else value[key] = result.value;
      }
      return issues.length ? { issues } : { value };
    },
  },
};

const APP_PREFIX = '/api/novelstudio/app/';
const RPC_PATH = '/api/novelstudio/rpc';
const HEALTH_PATH = '/api/novelstudio/health';
const PERSONA_NAME = 'novel-studio:persona';
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/* 稳定 persona：不含时间戳/版本号/作品名，保证多轮之间字节一致（命中前缀缓存）。 */
const PERSONA = [
  '你是小说工坊的创作助手，和作者在同一份作品库上工作。',
  '作品库里有正文、目录、人物、设定与规划；它们都以工具返回的当前版本为准，不要凭记忆复述。',
  '读正文先看目录与字数，再按游标分页读取；不要假装读过未读取的章节。',
  '规划是意图，正文是事实；作者设定是创作约束，不能当作已发生的剧情。',
  '写操作只能通过提案工具产出候选，由作者在界面里确认后才落库；不要声称已写入、已保存或已发表。',
  '讨论提案不等于作者采用；未确认的设想不得写进既定事实。',
  '当前作品由 studio_works 打开或由工具参数指定；不同会话各自独立，不替别的会话切书。',
  '工具分工：studio_works/studio_outline/studio_read/studio_search 只读；studio_preset 读作者预设；',
  'studio_review 提交可核对的审稿意见，studio_recheck 复核原问题（必须全覆盖）；',
  'studio_propose 出候选，作者确认后 studio_apply 落库，studio_undo 回退。',
].join('\n');

const APP_ROOT = fileURLToPath(new URL('../assets/app/', import.meta.url));
const SHIM_PATH = fileURLToPath(new URL('./client/iframe-shim.js', import.meta.url));
const SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));

function pointerPath() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || homedir() : join(homedir(), '.local', 'share');
  return join(base, 'novel-studio', 'library.json');
}

function readPointer() {
  try {
    const raw = JSON.parse(readFileSync(pointerPath(), 'utf8'));
    return typeof raw?.path === 'string' ? raw.path : '';
  } catch {
    return '';
  }
}

function defaultLibraryDir() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || homedir() : join(homedir(), '.local', 'share');
  return join(base, 'novel-studio', 'library');
}

/** 首次运行：没有配置也没有指针时，建一个默认作品库并写下共享指针。 */
function bootstrapPointer() {
  const dir = defaultLibraryDir();
  try {
    mkdirSync(join(dir, 'entities'), { recursive: true });
    writeFileSync(pointerPath(), JSON.stringify({ path: dir, layout: LAYOUT, at: new Date().toISOString() }, null, 2), 'utf8');
    return dir;
  } catch {
    return '';
  }
}

/** 列出构建产物里的相对路径（有界），用于"精确路由"兜底。 */
function listAppFiles(root, limit = 600) {
  const out = [];
  const walk = (dir, prefix, depth) => {
    if (out.length >= limit || depth > 4) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), relative, depth + 1);
      else if (entry.isFile()) out.push(relative);
    }
  };
  walk(root, '', 0);
  return out;
}

/** 读一次构建产物：index.html 里引用的 `./assets/...` 逐个落盘核对。
 * 面板的健康探针用它显示"当前服务的是哪一次构建、有没有缺文件"，白屏时能一眼定位。 */
function inspectBuild(root) {
  const indexFile = join(root, 'index.html');
  try {
    const text = readFileSync(indexFile, 'utf8');
    const refs = [...new Set(Array.from(text.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g), (m) => m[1]))];
    return {
      index: 'index.html',
      at: Math.round(statSync(indexFile).mtimeMs),
      files: refs.length,
      missing: refs.filter((relative) => !existsSync(join(root, relative))),
    };
  } catch (error) {
    return { index: 'index.html', at: null, files: 0, missing: [], error: String(error?.message || error) };
  }
}

function readSkills() {
  if (!existsSync(SKILLS_ROOT)) return [];
  const rows = [];
  for (const entry of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(SKILLS_ROOT, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const meta = {};
    if (match) {
      for (const line of match[1].split(/\r?\n/)) {
        const at = line.indexOf(':');
        if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
    }
    rows.push({
      name: meta.name || entry.name,
      description: meta.description || entry.name,
      content: match ? raw.slice(match[0].length).trim() : raw.trim(),
      resourceBase: { kind: 'directory', path: join(SKILLS_ROOT, entry.name) },
    });
  }
  return rows;
}

export async function apply(ctx, config = {}) {
  const configuredDir = String(config.libraryDir || '').trim();
  const pointed = configuredDir || readPointer();
  const libraryDir = pointed || bootstrapPointer();
  const library = libraryDir ? openLibrary(libraryDir) : null;
  const appRoot = String(config.appRoot || '').trim() || APP_ROOT;

  /* 工具（RPC 也要按名字拿到同一批实现，所以在注册路由之前就建好） */
  const tools = library ? createTools(library) : [];

  if (library) {
    try {
      await library.init();
      ctx.logger?.info?.('[novel-studio] 作品库：' + library.dir);
    } catch (error) {
      ctx.logger?.warn?.('[novel-studio] 作品库不可用：' + (error?.message || error));
    }
  }

  /* 静态资源 + RPC：给 iframe 里的界面用 */
  const registerRoute = ctx.connection?.fetch?.register;
  /* webServer 服务：可选依赖，用 ctx.get 取（cordis 的 get 不抛，缺了返回 undefined），
     这样 headless/SDK 组合少了这个服务也不会让整包 apply 消失。 */
  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer;
  let routeMode = 'none';
  let exact = 0;
  const skipped = [];
  if (typeof registerRoute === 'function') {
    /* 首选 webServer 前缀路由：路由表与文件内容解耦。
     * 逐文件精确注册的代价是"文件名集合冻结在启动那一刻"，而 index.html 每次都是现读磁盘的，
     * 于是重建 assets/app 后它立刻指向新的哈希资源 —— 那些路径没注册 → 404 → 面板白屏，
     * 点「重新载入」也没用（2026-11 真实事故）。前缀路由按请求实时读盘，重建后无需重启。 */
    const prefixPath = APP_PREFIX.replace(/\/+$/, '');
    const canPrefix = !!webServer && typeof webServer.register === 'function';
    const gateReady = typeof ctx.connection?.requestRejection === 'function';
    if (canPrefix && !gateReady) ctx.logger?.warn?.('[novel-studio] 宿主没有 connection.requestRejection：静态前缀路由不做鉴权闸门');
    if (canPrefix) {
      try {
        const register = () => webServer.register({
          kind: 'prefix',
          path: prefixPath,
          handler: createPrefixNodeHandler({
            root: appRoot,
            prefix: APP_PREFIX,
            shimSrc: './native-shim.js',
            shimPath: SHIM_PATH,
            /* 与精确路由内部 admit() 同源：返回 401/403 就照抄，undefined 才放行。 */
            gate: gateReady ? (request) => ctx.connection.requestRejection(request) : null,
            log: ctx.logger,
          }),
        });
        /* register 返回 disposer，交给 effect 收集，插件卸载时自动摘掉路由。 */
        if (typeof ctx.effect === 'function') ctx.effect(register, 'novel-studio: static prefix route');
        else register();
        routeMode = 'prefix';
        ctx.logger?.info?.('[novel-studio] 静态产物走前缀路由 ' + prefixPath + '（重建 assets/app 无需重启）');
      } catch (error) {
        ctx.logger?.warn?.('[novel-studio] 前缀路由注册失败，回落逐文件精确路由：' + (error?.message || error));
      }
    }
    if (routeMode !== 'prefix') {
      /* 兜底：宿主没有 webServer。契约（读 dsh-client-connection 源码核实）：
       * 1) fetchRoutes 是"精确路径"Map，不支持通配符——path: '.../*' 永远匹配不到；
       * 2) 命中路由时 requestBodyMode 返回 route.requestBody；未声明即 undefined，
       *    于是退到 streaming 分支给 GET 也挂上 body → Request 构造抛错 → 浏览器收到 400。
       * 所以：逐文件注册，且每个 GET/HEAD 路由都必须显式声明 requestBody: 'buffered'。 */
      const appFiles = listAppFiles(appRoot);
      const exactTargets = new Set(['index.html', 'native-shim.js', ...appFiles]);
      for (const relative of exactTargets) {
        const path = APP_PREFIX + relative;
        try {
          if (!isValidAppPath(path)) throw new Error('路径段不合法');
          registerRoute.call(ctx.connection.fetch, makeAppRoute({
            path,
            handler: createExactHandler({ root: appRoot, relative, shimSrc: './native-shim.js', shimPath: SHIM_PATH }),
          }));
          exact += 1;
        } catch (error) {
          skipped.push(relative + ' → ' + (error?.message || error));
        }
      }
      routeMode = 'exact';
      ctx.logger?.info?.('[novel-studio] 静态路由已逐文件注册 ' + exact + ' 条，跳过 ' + skipped.length + ' 条（构建产物 ' + appFiles.length + ' 个文件）');
      for (const line of skipped.slice(0, 5)) ctx.logger?.warn?.('[novel-studio] 跳过静态路由 ' + line);
      if (exact === 0) ctx.logger?.warn?.('[novel-studio] 没有任何静态路由注册成功，界面将无法加载：' + appRoot);
    }
    if (library) {
      try {
        registerRoute.call(ctx.connection.fetch, {
          path: RPC_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: createRpcHandler({
            library,
            version: VERSION,
            prefix: RPC_PATH,
            tools: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
          }),
        });
        ctx.logger?.info?.('[novel-studio] RPC 路由已注册 ' + RPC_PATH);
      } catch (error) {
        ctx.logger?.warn?.('[novel-studio] RPC 路由注册失败：' + (error?.message || error));
      }
    }

    /* 健康探针：界面用它判断"宿主到插件"这条链路是否通 */
    try {
      registerRoute.call(ctx.connection.fetch, makeAppRoute({
        path: HEALTH_PATH,
        methods: ['GET'],
        handler: async () => {
          let libraryStatus = null;
          try {
            libraryStatus = library ? await library.status() : null;
          } catch (error) {
            libraryStatus = { ready: false, error: String(error?.message || error) };
          }
          const body = {
            ok: true,
            version: VERSION,
            /* prefix = 重建产物无需重启；exact = 文件名集合冻结在启动那一刻，需重启才能换产物。 */
            routeMode,
            staticRoutes: exact,
            skipped: skipped.length,
            build: inspectBuild(appRoot),
            rpc: library ? RPC_PATH : null,
            tools: tools.map((tool) => tool.name),
            skills: readSkills().map((skill) => skill.name),
            library: libraryStatus,
          };
          return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
        },
      }));
      ctx.logger?.info?.('[novel-studio] health 探针已注册 ' + HEALTH_PATH);
    } catch (error) {
      ctx.logger?.warn?.('[novel-studio] health 探针注册失败：' + (error?.message || error));
    }
  } else {
    ctx.logger?.warn?.('[novel-studio] 宿主未提供 connection.fetch.register，界面与 RPC 不可用');
  }

  /* 工具注册：src/core/tools.js 里的 parameters 本来就是宿主接受的 JSON Schema，
   * 直接下发（经 defineTool 作者格式再转换会把嵌套 items/additionalProperties 丢掉）。
   * register 返回 disposer，交给 effect 收集，插件卸载时自动摘掉工具。 */
  const failedTools = [];
  for (const tool of tools) {
    try {
      const register = () => ctx.tools.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (args, exec) => {
          exec?.signal?.throwIfAborted?.();
          return JSON.stringify(await tool.execute(args || {}, exec || {}));
        },
      });
      if (typeof ctx.effect === 'function') ctx.effect(register, 'novel-studio: tool ' + tool.name);
      else register();
    } catch (error) {
      failedTools.push(tool.name + ' → ' + (error?.message || error));
      ctx.logger?.warn?.('[novel-studio] 工具注册失败 ' + tool.name + '：' + (error?.message || error));
    }
  }
  if (failedTools.length) ctx.logger?.warn?.('[novel-studio] 共 ' + failedTools.length + ' 个工具未注册');
  if (!library) {
    ctx.logger?.warn?.('[novel-studio] 未指定作品库：请设置 libraryDir 或让小说工坊写入 ' + pointerPath());
  }

  /* 技能 */
  if (ctx.skills?.register) {
    for (const skill of readSkills()) {
      try {
        ctx.skills.register({ name: skill.name, description: skill.description, source: 'novel-studio', resourceBase: skill.resourceBase, content: skill.content });
      } catch (error) {
        ctx.logger?.warn?.('[novel-studio] 技能注册失败 ' + skill.name + '：' + (error?.message || error));
      }
    }
  }

  /* 稳定提示词段（可关闭：ctx.config.enabled === false 时不注入） */
  try {
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    if (!context?.agent?.id) return result;
    return {
      ...result,
        sections: [...(result.sections || []).filter((entry) => entry.name !== PERSONA_NAME), { name: PERSONA_NAME, text: PERSONA, interpolate: false }],
      };
    });
  } catch (error) {
    ctx.logger?.warn?.('[novel-studio] 提示词钩子注册失败：' + (error?.message || error));
  }

  ctx.logger?.info?.('[novel-studio] 装载完成：' + (tools.length - failedTools.length) + ' 个工具 / ' + readSkills().length + ' 个技能 / v' + VERSION);
}

export const maintenance = {
  pointerPath,
  layout: LAYOUT,
  version: VERSION,
};
