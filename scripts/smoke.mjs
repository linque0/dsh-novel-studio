/* 冒烟：不依赖 DSH 宿主，直接验证核心库、静态托管、RPC、只读工具。 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '../src/core/library.js';
import { createTools } from '../src/core/tools.js';
import { createStaticHandler, createExactHandler, respondFile, makeAppRoute, isValidAppPath, APP_ROUTE_BODY_MODE, APP_ROUTE_METHODS } from '../src/adapters/dsh/static.js';
import { createRpcHandler } from '../src/adapters/dsh/rpc.js';

let passed = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failures.push(name + (detail ? ' -> ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' -> ' + detail : ''));
  }
}

const workRow = { id: 'w1', title: '测试作品', description: '', updatedAt: '2026-01-01T00:00:00.000Z' };
const volumeRow = { id: 'v1', workId: 'w1', title: '第一卷', sortOrder: 0 };
const chapterRow = { id: 'c1', workId: 'w1', volumeId: 'v1', title: '第一章', content: '<p>' + '甲'.repeat(50) + '</p>', sortOrder: 0 };
const chapterRow2 = { id: 'c2', workId: 'w1', volumeId: 'v1', title: '第二章', content: '<p>' + '乙'.repeat(30) + '</p>', sortOrder: 1 };

const root = await mkdtemp(join(tmpdir(), 'ns-lib-'));
const library = openLibrary(root);

const status0 = await library.status();
ok('库初始化前 ready=false', status0.ready === false);

const init = await library.init();
ok('init 建立索引', init.layout === 1 && init.seq === 0);

const created = await library.submit([
  { table: 'works', id: 'w1', kind: 'put', baseRevision: 0, row: workRow },
  { table: 'volumes', id: 'v1', kind: 'put', baseRevision: 0, row: volumeRow },
  { table: 'chapters', id: 'c1', kind: 'put', baseRevision: 0, row: chapterRow },
], { requestId: 'r1', actor: { kind: 'human' } });
ok('提交成功且 seq=1', created.ok === true && created.seq === 1, JSON.stringify(created));

const replay = await library.submit([
  { table: 'works', id: 'w1', kind: 'put', baseRevision: 0, row: workRow },
], { requestId: 'r1' });
ok('同 requestId 幂等重放', replay.ok === true && replay.replayed === true && replay.seq === created.seq);

const conflict = await library.submit([
  { table: 'works', id: 'w1', kind: 'put', baseRevision: 0, row: { ...workRow, title: '改错了' } },
], { requestId: 'r2' });
ok('陈旧 baseRevision 冲突', conflict.ok === false && conflict.conflict.currentRevision === 1, JSON.stringify(conflict));

const updated = await library.submit([
  { table: 'chapters', id: 'c1', kind: 'put', baseRevision: 1, row: { ...chapterRow, title: '第一章（改）' } },
  { table: 'chapters', id: 'c2', kind: 'put', baseRevision: 0, row: chapterRow2 },
], { requestId: 'r3' });
ok('正常更新与新建', updated.ok === true && updated.seq === 2, JSON.stringify(updated));

const pulled = await library.pull(0);
ok('pull 汇总两次日志', pulled.seq === 2 && pulled.ops.length === 5, 'ops=' + pulled.ops.length);

const incremental = await library.pull(1);
ok('pull 增量只返回 seq>1', incremental.ops.length === 2, 'ops=' + incremental.ops.length);

const snapshot = await library.snapshot();
ok('snapshot 形状与备份兼容', snapshot.data.works.length === 1 && snapshot.data.chapters.length === 2 && snapshot.layout === 1);
ok('snapshot 带每实体 revision（hydrate/冲突重放要用）', snapshot.revisions && snapshot.revisions['chapters:c1'] === 2, JSON.stringify(snapshot.revisions || {}));

const secret = await library.submit([
  { table: 'appconfig', id: 'k1', kind: 'put', baseRevision: 0, row: { id: 'k1', key: 'ai.cred.deepseek', value: 'sk-should-not-persist' } },
], { requestId: 'r4' });
const dumpAfter = await library.snapshot();
ok('密钥类 appconfig 不入库', dumpAfter.data.appconfig.every((row) => !String(row.key || '').startsWith('ai.cred')));

const tools = createTools(library);
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const listWorks = await byName.studio_works.execute({ op: 'list' });
ok('studio_works 列出作品', listWorks.total === 1 && listWorks.items[0].title === '测试作品', JSON.stringify(listWorks).slice(0, 200));

const openWork = await byName.studio_works.execute({ op: 'open', workId: 'w1' });
ok('studio_works 打开返回目录', openWork.totalChapters === 2 && openWork.volumes.length === 1, JSON.stringify(openWork).slice(0, 200));

const outline = await byName.studio_outline.execute({ workId: 'w1', limit: 1 });
ok('studio_outline 分页', outline.items.length === 1 && outline.nextCursor === 1, JSON.stringify(outline));

const read = await byName.studio_read.execute({ kind: 'chapter', id: 'c1', maxChars: 200 });
ok('studio_read 去标签后返回正文', read.text.indexOf('<') < 0 && read.totalChars === 50 && read.truncated === false, JSON.stringify(read).slice(0, 200));

const pagedRead = await byName.studio_read.execute({ kind: 'chapter', id: 'c1', cursor: 0, maxChars: 200 });
ok('studio_read 游标', pagedRead.cursor === 0 && pagedRead.text.length === 50);

/* ---------- 静态托管 ---------- */
const appRoot = await mkdtemp(join(tmpdir(), 'ns-app-'));
await mkdir(join(appRoot, 'assets'), { recursive: true });
await writeFile(join(appRoot, 'index.html'), '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>', 'utf8');
await writeFile(join(appRoot, 'assets', 'app-abc12345.js'), 'console.log(1)', 'utf8');
const shimPath = join(appRoot, 'shim-source.js');
await writeFile(shimPath, 'window.__NS_SHIM__=1;', 'utf8');
const serve = createStaticHandler({ root: appRoot, shimSrc: './native-shim.js', shimPath });

const indexResponse = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/index.html'));
const indexBody = await indexResponse.text();
ok('静态：index.html 200', indexResponse.status === 200);
ok('静态：content-type 正确', String(indexResponse.headers.get('content-type')).startsWith('text/html'));
const shimAt = indexBody.indexOf('native-shim.js');
const headClose = indexBody.indexOf('</head>');
ok('静态：shim 注入在 <head> 内且早于 body 解析', shimAt > 0 && headClose > shimAt);
const etag = indexResponse.headers.get('etag');
const notModified = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/index.html', { headers: { 'if-none-match': etag } }));
ok('静态：ETag 命中 304', notModified.status === 304);
const shimResponse = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/native-shim.js'));
ok('静态：shim 可从路由取到', shimResponse.status === 200 && (await shimResponse.text()).includes('__NS_SHIM__'));
const jsResponse = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/assets/app-abc12345.js'));
ok('静态：带 hash 的资源长缓存', jsResponse.headers.get('cache-control').includes('immutable'));
const traversal = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/%2e%2e%2fsecret.txt'));
ok('静态：阻止目录穿越', traversal.status === 403 || traversal.status === 400, 'status=' + traversal.status);
const missing = await serve(new Request('http://127.0.0.1:1/api/novelstudio/app/nope.js'));
ok('静态：缺失文件 404', missing.status === 404);

const exact = createExactHandler({ root: appRoot, relative: 'index.html', shimSrc: './native-shim.js', shimPath });
const exactResponse = await exact(new Request('http://127.0.0.1:1/api/novelstudio/app/index.html'));
const exactBody = await exactResponse.text();
ok('精确路由：index.html 200 且注入 shim', exactResponse.status === 200 && exactBody.includes('native-shim.js'));

const exactJs = createExactHandler({ root: appRoot, relative: 'assets/app-abc12345.js' });
const exactJsResponse = await exactJs(new Request('http://127.0.0.1:1/api/novelstudio/app/assets/app-abc12345.js'));
ok('精确路由：资源 200', exactJsResponse.status === 200 && String(exactJsResponse.headers.get('content-type')).startsWith('text/javascript'));

const traversal2 = await respondFile({ root: appRoot, relative: '../../etc/passwd', request: new Request('http://x/y') });
ok('respondFile：拒绝相对越界', traversal2.status === 400 || traversal2.status === 403, 'status=' + traversal2.status);

/* ---------- RPC ---------- */
const rpc = createRpcHandler({ library, version: '0.1.0' });
const post = (body) => rpc(new Request('http://127.0.0.1:1/api/novelstudio/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const statusCall = await (await post({ action: 'library.status' })).json();
ok('RPC library.status', statusCall.ok === true && statusCall.value.ready === true && statusCall.value.works === 1);

const pullCall = await (await post({ action: 'sync.pull', args: { after: 0 } })).json();
ok('RPC sync.pull', pullCall.ok === true && pullCall.value.seq === 3, 'seq=' + (pullCall.value && pullCall.value.seq));

const badType = await rpc(new Request('http://127.0.0.1:1/api/novelstudio/rpc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }));
ok('RPC 拒绝错误 content-type', badType.status === 415);

const unknown = await (await post({ action: 'nope.nope' })).json();
ok('RPC 未知操作报错', unknown.ok === false && unknown.error.code === 'UNKNOWN_ACTION');

const submitCall = await (await post({ action: 'sync.submit', args: { requestId: 'rpc-1', ops: [{ table: 'chapters', id: 'c1', kind: 'put', baseRevision: 2, row: { ...chapterRow, title: '第一章（RPC 改）' } }] } })).json();
ok('RPC sync.submit 走同一套 CAS', submitCall.ok === true && submitCall.value.ok === true, JSON.stringify(submitCall).slice(0, 200));

/* ---------- 导入 dump ---------- */
const root2 = await mkdtemp(join(tmpdir(), 'ns-lib2-'));
const library2 = openLibrary(root2);
await library2.init();
const imported = await library2.importDump(await library.snapshot());
ok('importDump 副库导入', imported.ok === true && imported.imported === 4, JSON.stringify(imported));
const works2 = await library2.works();
ok('importDump 后书目一致', works2.length === 1 && works2[0].id === 'w1');
const again = await library2.importDump(await library.snapshot()).catch((error) => ({ ok: false, code: error.code }));
ok('重复导入需 force', again.ok === false && again.code === 'NOT_EMPTY', JSON.stringify(again));

/* ---------- 写路径：提案 → 应用 → 回退 ---------- */
const labRoot = await mkdtemp(join(tmpdir(), 'ns-lab-'));
const lab = openLibrary(labRoot);
await lab.init();
await lab.submit([
  { table: 'works', id: 'w9', kind: 'put', baseRevision: 0, row: { id: 'w9', title: '实验室' } },
  { table: 'chapters', id: 'c9', kind: 'put', baseRevision: 0, row: { id: 'c9', workId: 'w9', title: '第九章', content: '甲句。乙句。' } },
], { requestId: 'lab-1' });

const labTools = Object.fromEntries(createTools(lab).map((tool) => [tool.name, tool]));
ok('工具总数 10', Object.keys(labTools).length === 10, Object.keys(labTools).join(','));

const proposal = await labTools.studio_propose.execute({ workId: 'w9', kind: 'chapter.append', targetId: 'c9', text: '丙句。' });
ok('提案产出且不落库', !!proposal.proposalId && (await lab.readEntity('chapters', 'c9')).row.content === '甲句。乙句。');

const noConfirm = await labTools.studio_apply.execute({ proposalId: proposal.proposalId });
ok('未确认不能落库', noConfirm.code === 'NEED_CONFIRM');

const applied = await labTools.studio_apply.execute({ proposalId: proposal.proposalId, confirm: true });
ok('确认后落库', applied.ok === true && applied.revision === 2, JSON.stringify(applied));
ok('正文已追加', (await lab.readEntity('chapters', 'c9')).row.content === '甲句。乙句。丙句。');

const reapply = await labTools.studio_apply.execute({ proposalId: proposal.proposalId, confirm: true });
ok('重复应用被拒', reapply.code === 'ALREADY_APPLIED');

const undone = await labTools.studio_undo.execute({ proposalId: proposal.proposalId, confirm: true });
ok('回退恢复原文', undone.ok === true && (await lab.readEntity('chapters', 'c9')).row.content === '甲句。乙句。');

/* ---------- 审稿与复核契约 ---------- */
const review = await labTools.studio_review.execute({
  chapterId: 'c9',
  findings: [
    { problem: '重复用句', quote: '乙句。', severity: 'warning' },
    { problem: '引文不存在', quote: '这句话不在正文里' },
  ],
});
ok('审稿：可定位与不可定位分开报', review.total === 2 && review.locatable === 1 && review.items[1].locatable === false, JSON.stringify(review.items.map((i) => i.locatable)));

const incomplete = await labTools.studio_recheck.execute({ reviewId: review.reviewId, revisedText: '甲句。乙句改写。', items: [{ id: review.items[0].id, status: 'resolved', quote: '乙句改写。' }] });
ok('复核漏项被拒', incomplete.code === 'INCOMPLETE' && String(incomplete.problems).includes('漏复核'));

const covered = await labTools.studio_recheck.execute({
  reviewId: review.reviewId,
  revisedText: '甲句。乙句改写。',
  items: review.items.map((item) => ({ id: item.id, status: 'resolved', quote: item.id === review.items[0].id ? '乙句改写。' : '甲句。' })),
});
ok('复核覆盖全部原问题', covered.total === 2, JSON.stringify(covered));

const downgraded = await labTools.studio_recheck.execute({
  reviewId: review.reviewId,
  revisedText: '完全不同的正文。',
  items: review.items.map((item) => ({ id: item.id, status: 'resolved', quote: '甲句。' })),
});
ok('定位失败自动降级 unresolved', downgraded.downgraded >= 1 && downgraded.resolved === 0, JSON.stringify(downgraded));

const searched = await labTools.studio_search.execute({ query: '乙句', limit: 5 });
ok('检索命中正文', searched.total >= 1, JSON.stringify(searched).slice(0, 120));

const presets = await labTools.studio_preset.execute({});
ok('预设列表可读（空库 0 条）', presets.total === 0);

await rm(labRoot, { recursive: true, force: true });

/* ---------- 宿主 fetch 契约（踩过的坑固化成断言） ---------- */
ok('契约：GET 必须声明 buffered 体模式', APP_ROUTE_BODY_MODE === 'buffered', APP_ROUTE_BODY_MODE);
ok('契约：方法与催更姬一致（GET/HEAD）', APP_ROUTE_METHODS.length === 2 && APP_ROUTE_METHODS[0] === 'GET');

const route = makeAppRoute({ path: '/api/novelstudio/app/index.html', handler: async () => new Response('x') });
ok('契约：makeAppRoute 自动补齐 requestBody', route.requestBody === 'buffered' && Array.isArray(route.methods) && typeof route.fetch === 'function');

let threw = false;
try {
  makeAppRoute({ path: '/api/novelstudio/app/*', handler: async () => new Response('x') });
} catch {
  threw = true;
}
ok('契约：通配路径在注册期就被拒（这正是上次 400 的根因）', threw);

ok('契约：合法路径通过', isValidAppPath('/api/novelstudio/app/index.html') === true);
ok('契约：缺少 /api 前缀被拒', isValidAppPath('novelstudio/app/index.html') === false);
ok('契约：非 ASCII 段名被拒', isValidAppPath('/api/novelstudio/app/中文.js') === false);
ok('契约：点段被拒', isValidAppPath('/api/novelstudio/app/../x.js') === false);

const assetRoot = new URL('../assets/app/', import.meta.url);
let assetFiles = [];
try {
  const walk = async (dir, prefix) => {
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(new URL(entry.name + '/', dir), rel);
      else assetFiles.push(rel);
    }
  };
  await walk(assetRoot, '');
} catch {
  assetFiles = [];
}
const illegal = assetFiles.filter((rel) => !isValidAppPath('/api/novelstudio/app/' + rel));
ok('契约：构建产物全部可注册', assetFiles.length > 0 && illegal.length === 0, assetFiles.length + ' 个文件，非法 ' + illegal.length + '：' + illegal.slice(0, 3).join(','));

await rm(root, { recursive: true, force: true });
await rm(root2, { recursive: true, force: true });
await rm(appRoot, { recursive: true, force: true });

console.log('');
console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  for (const item of failures) console.log('  - ' + item);
  process.exit(1);
}
