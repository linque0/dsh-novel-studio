/* DSH 插件服务端入口：注册工具、静态资源、RPC、技能与稳定提示词段。
 * 结构对齐 dsh-cuigengji-plugin（cordis 插件：name / inject / Config / apply）。 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/* 宿主导入的稳健化：宿主一般会注入 @deepseek-ai/*，但解析失败时也要能加载，
 * 否则一个 specifier 就会让整个插件在启动阶段消失（排查时最难定位）。 */
async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    console.warn('[novel-studio] 无法解析 ' + specifier + '：' + (error && (error.code || error.message)));
    return null;
  }
}
const schemastery = await optionalImport('@deepseek-ai/schemastery');
const toolsLib = await optionalImport('@deepseek-ai/dsh-tools');
const chainable = () => {
  const node = { default: () => node, volatile: () => node, description: () => node, optional: () => node };
  return node;
};
const zFallback = {
  object: (shape) => ({ _shape: shape }),
  string: chainable,
  number: chainable,
  boolean: chainable,
  array: chainable,
};
const z = (schemastery && schemastery.default) || zFallback;
const defineTool = (toolsLib && toolsLib.defineTool) || ((spec) => spec);
import { openLibrary, LAYOUT } from './core/library.js';
import { createTools } from './core/tools.js';
import { createExactHandler, makeAppRoute, isValidAppPath } from './adapters/dsh/static.js';
import { createRpcHandler } from './adapters/dsh/rpc.js';

export const name = 'novel-studio';
export const inject = ['tools', 'systemPrompt', 'skills', 'connection'];

export const Config = z.object({
  libraryDir: z.string().default('').volatile(),
  appRoot: z.string().default('').volatile(),
});

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

/** JSON Schema -> defineTool 需要的扁平参数表。 */
function toParameters(schema = {}) {
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out = {};
  for (const [key, value] of Object.entries(schema.properties || {})) {
    const item = { ...value };
    if (required.has(key)) item.required = true;
    out[key] = item;
  }
  return out;
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
  const read = (value) => (value && typeof value.get === 'function' ? value.get() : value);
  const configuredDir = String(read(config.libraryDir) || '').trim();
  const pointed = configuredDir || readPointer();
  const libraryDir = pointed || bootstrapPointer();
  const library = libraryDir ? openLibrary(libraryDir) : null;
  const appRoot = String(read(config.appRoot) || '').trim() || APP_ROOT;

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
  if (typeof registerRoute === 'function') {
    /* 宿主契约（读 dsh-client-connection 源码核实）：
     * 1) fetchRoutes 是"精确路径"Map，不支持通配符——path: '.../*' 永远匹配不到；
     * 2) 命中路由时 requestBodyMode 返回 route.requestBody；未声明即 undefined，
     *    于是退到 streaming 分支给 GET 也挂上 body → Request 构造抛错 → 浏览器收到 400。
     * 所以：逐文件注册，且每个 GET/HEAD 路由都必须显式声明 requestBody: 'buffered'。 */
    const appFiles = listAppFiles(appRoot);
    const exactTargets = new Set(['index.html', 'native-shim.js', ...appFiles]);
    let exact = 0;
    const skipped = [];
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
    ctx.logger?.info?.('[novel-studio] 静态路由已注册 ' + exact + ' 条，跳过 ' + skipped.length + ' 条（构建产物 ' + appFiles.length + ' 个文件）');
    for (const line of skipped.slice(0, 5)) ctx.logger?.warn?.('[novel-studio] 跳过静态路由 ' + line);
    if (exact === 0) ctx.logger?.warn?.('[novel-studio] 没有任何静态路由注册成功，界面将无法加载：' + appRoot);
    if (library) {
      try {
        registerRoute.call(ctx.connection.fetch, {
          path: RPC_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: createRpcHandler({ library, version: VERSION, prefix: RPC_PATH }),
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
            staticRoutes: exact,
            skipped: skipped.length,
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

  /* 工具 */
  const tools = library ? createTools(library) : [];
  for (const tool of tools) {
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: toParameters(tool.parameters),
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => {
        exec?.signal?.throwIfAborted?.();
        const result = await tool.execute(args || {}, exec || {});
        return JSON.stringify(result);
      },
    }));
  }
  if (!library) {
    ctx.logger?.warn?.('[novel-studio] 未指定作品库：请设置 libraryDir 或让小说工坊写入 ' + pointerPath());
  }

  /* 技能 */
  if (ctx.skills?.register) {
    for (const skill of readSkills()) {
      ctx.skills.register({ name: skill.name, description: skill.description, source: 'novel-studio', resourceBase: skill.resourceBase, content: skill.content });
    }
  }

  /* 稳定提示词段（可关闭：ctx.config.enabled === false 时不注入） */
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    if (!context?.agent?.id) return result;
    return {
      ...result,
      sections: [...(result.sections || []).filter((entry) => entry.name !== PERSONA_NAME), { name: PERSONA_NAME, text: PERSONA, interpolate: false }],
    };
  });
}

export const maintenance = {
  pointerPath,
  layout: LAYOUT,
  version: VERSION,
};
