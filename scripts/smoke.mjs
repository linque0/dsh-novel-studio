/* 冒烟：不依赖 DSH 宿主，直接验证核心库、静态托管、RPC、只读工具。 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '../src/core/library.js';
import { createTools } from '../src/core/tools.js';
import { createStaticHandler, createExactHandler, createPrefixNodeHandler, respondFile, makeAppRoute, isValidAppPath, APP_ROUTE_BODY_MODE, APP_ROUTE_METHODS } from '../src/adapters/dsh/static.js';
import { createRpcHandler } from '../src/adapters/dsh/rpc.js';
import { sanitizeHtml, formatUpdatedAt } from '../src/core/format.js';
import { createView } from '../src/core/view.js';

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

/* ---------- 前缀路由（热更新）：路由表不再随文件名冻结在启动那一刻 ---------- */
{
  const prefixRoot = await mkdtemp(join(tmpdir(), 'ns-prefix-'));
  await mkdir(join(prefixRoot, 'assets'), { recursive: true });
  await writeFile(join(prefixRoot, 'index.html'), '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>', 'utf8');
  await writeFile(join(prefixRoot, 'assets', 'style-old00000.css'), 'body{}', 'utf8');
  const shim = join(prefixRoot, 'shim-source.js');
  await writeFile(shim, 'window.__NS_SHIM__=1;', 'utf8');

  /* 闸门用 cookie 当信号：处理器只透传 host/cookie/if-none-match 三个头。 */
  let gated = 0;
  const server = createServer(createPrefixNodeHandler({
    root: prefixRoot,
    prefix: '/api/novelstudio/app/',
    shimSrc: './native-shim.js',
    shimPath: shim,
    gate: (request) => {
      gated += 1;
      return request.headers.get('cookie') === 'ns-deny' ? 401 : undefined;
    },
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const appUrl = (path) => origin + '/api/novelstudio/app/' + path;

  const hotIndex = await fetch(appUrl('index.html'));
  const hotIndexText = await hotIndex.text();
  ok('前缀路由：index.html 200 且注入 shim', hotIndex.status === 200 && hotIndexText.includes('native-shim.js'), 'status=' + hotIndex.status);

  /* 本次白屏事故的回归判据：服务器启动之后才出现的文件，也必须能取到。 */
  await writeFile(join(prefixRoot, 'assets', 'style-fresh9999.css'), 'body{color:red}', 'utf8');
  const hotNew = await fetch(appUrl('assets/style-fresh9999.css'));
  ok('前缀路由：启动后新增的产物文件仍 200（重建产物无需重启）', hotNew.status === 200 && (await hotNew.text()).includes('color:red'), 'status=' + hotNew.status);

  const hotMissing = await fetch(appUrl('assets/nope.css'));
  ok('前缀路由：缺失文件 404', hotMissing.status === 404, 'status=' + hotMissing.status);
  const hotTraversal = await fetch(appUrl('%2e%2e%2fsecret.txt'));
  ok('前缀路由：阻止目录穿越', hotTraversal.status === 400 || hotTraversal.status === 403, 'status=' + hotTraversal.status);
  const hotPost = await fetch(appUrl('index.html'), { method: 'POST' });
  ok('前缀路由：非 GET/HEAD 405', hotPost.status === 405, 'status=' + hotPost.status);
  const hotDenied = await fetch(appUrl('index.html'), { headers: { cookie: 'ns-deny' } });
  ok('前缀路由：鉴权闸门 401 直通', hotDenied.status === 401 && gated > 0, 'status=' + hotDenied.status + ' gated=' + gated);
  const hot304 = await fetch(appUrl('index.html'), { headers: { 'if-none-match': hotIndex.headers.get('etag') } });
  ok('前缀路由：ETag 命中 304', hot304.status === 304, 'status=' + hot304.status);

  await new Promise((resolve) => server.close(resolve));
  await rm(prefixRoot, { recursive: true, force: true });
}

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

/* ---------- 备份导入（插件版唯一的"上数据"入口） ---------- */
const labRpc = createRpcHandler({ library: lab, version: 'test' });
const importCall = await (await labRpc(new Request('http://x/api/novelstudio/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'library.import', args: { force: true, dump: { version: 1, data: { works: [{ id: 'w10', title: '导入进来的书' }], chapters: [{ id: 'c10', workId: 'w10', title: '第一章', content: '导入正文' }] } } } }),
}))).json();
ok('RPC library.import 可写入作品库', importCall.ok === true && importCall.value.ok === true && importCall.value.imported === 2, JSON.stringify(importCall).slice(0, 200));
const afterImport = await lab.works();
ok('导入后书目增加', afterImport.length === 2, 'works=' + afterImport.length);
const verifyCall = await (await labRpc(new Request('http://x/api/novelstudio/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'library.verify' }) }))).json();
ok('RPC library.verify 报告一致', verifyCall.ok === true && verifyCall.value.problems.length === 0, JSON.stringify(verifyCall.value && verifyCall.value.problems));

/* ---------- 界面数据层：format / view / RPC ---------- */
const viewRoot = await mkdtemp(join(tmpdir(), 'ns-view-'));
const viewLib = openLibrary(viewRoot);
await viewLib.init();
const workFixture = (id, title, updatedAt, status = '') => ({ id, title, author: '', genre: '', status, intro: '', createdAt: 1, updatedAt, deletedAt: null });
await viewLib.submit([
  { table: 'works', id: 'vW1', kind: 'put', baseRevision: 0, row: workFixture('vW1', '甲作', 1700000000000, '连载中') },
  { table: 'works', id: 'vW2', kind: 'put', baseRevision: 0, row: workFixture('vW2', '乙作', '2026-02-01T00:00:00.000Z') },
  { table: 'works', id: 'vW3', kind: 'put', baseRevision: 0, row: workFixture('vW3', '丙作', 1600000000000) },
  { table: 'works', id: 'vW4', kind: 'put', baseRevision: 0, row: workFixture('vW4', '丁作', 1500000000000) },
  { table: 'volumes', id: 'vV1', kind: 'put', baseRevision: 0, row: { id: 'vV1', workId: 'vW1', title: '第一卷', sortOrder: 0 } },
  { table: 'volumes', id: 'vV2', kind: 'put', baseRevision: 0, row: { id: 'vV2', workId: 'vW1', title: '第二卷', sortOrder: 1 } },
  { table: 'chapters', id: 'vC1', kind: 'put', baseRevision: 0, row: { id: 'vC1', workId: 'vW1', volumeId: 'vV1', title: '一', content: '<p>' + '甲'.repeat(10) + '</p>', sortOrder: 0, status: 'draft', updatedAt: 1 } },
  { table: 'chapters', id: 'vC2', kind: 'put', baseRevision: 0, row: { id: 'vC2', workId: 'vW1', volumeId: 'vV2', title: '二', content: '<p>乙</p>', sortOrder: 0 } },
  { table: 'chapters', id: 'vC3', kind: 'put', baseRevision: 0, row: { id: 'vC3', workId: 'vW1', volumeId: '', title: '三', content: '<p>丙</p>', sortOrder: 0 } },
  { table: 'chapters', id: 'vC4', kind: 'put', baseRevision: 0, row: { id: 'vC4', workId: 'vW1', volumeId: 'vVgone', title: '四', content: '<p>丁</p>', sortOrder: 0 } },
  { table: 'chapters', id: 'vC5', kind: 'put', baseRevision: 0, row: { id: 'vC5', workId: 'vW1', volumeId: 'vV1', title: '已删', content: '<p>删</p>', sortOrder: 9, deletedAt: 1700000000001 } },
  { table: 'chapters', id: 'vC6', kind: 'put', baseRevision: 0, row: { id: 'vC6', workId: 'vW3', volumeId: '', title: '丙一', content: '<p onclick="x()">甲</p><script>bad()</script><b onclick="y()">粗</b>', sortOrder: 0 } },
  { table: 'chapters', id: 'vC7', kind: 'put', baseRevision: 0, row: { id: 'vC7', workId: 'vW4', volumeId: '', title: '丁一', content: '<p>' + 'x'.repeat(200050) + '</p>', sortOrder: 0 } },
  { table: 'outlines', id: 'vO1', kind: 'put', baseRevision: 0, row: { id: 'vO1', workId: 'vW1', level: 'master', refId: 'vW1', content: '主线：甲' } },
  { table: 'outlines', id: 'vO2', kind: 'put', baseRevision: 0, row: { id: 'vO2', workId: 'vW1', level: 'master', refId: 'vW1', content: '副线：乙' } },
  { table: 'outlines', id: 'vO3', kind: 'put', baseRevision: 0, row: { id: 'vO3', workId: 'vW1', level: 'chapter', refId: 'vC1', content: '本章：相遇' } },
], { requestId: 'view-1', actor: { kind: 'human' } });

const viewRpc = createRpcHandler({ library: viewLib, version: 'test' });
const viewPost = async (action, args) => (await viewRpc(new Request('http://x/api/novelstudio/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args }) }))).json();

const shelfCall = await viewPost('shelf.list');
const shelfWork = (id) => ((shelfCall.value && shelfCall.value.works) || []).find((w) => w.id === id) || {};
const shelfW1 = shelfWork('vW1');
const shelfW2 = shelfWork('vW2');
const shelfIds = shelfCall.ok ? shelfCall.value.works.map((w) => w.id).join(',') : String(shelfCall.error && shelfCall.error.code);
ok('shelf.list 按 updatedAt 倒序（毫秒/ISO 混排）且统计未删除章数与字数',
  shelfCall.ok === true && shelfIds === 'vW2,vW1,vW3,vW4' && shelfCall.value.total === 4
  && shelfW1.chapters === 4 && shelfW1.chars === 13 && shelfW1.status === '连载中'
  && shelfW2.chapters === 0 && shelfW2.chars === 0,
  JSON.stringify({ ids: shelfIds, w1: [shelfW1.chapters, shelfW1.chars, shelfW1.status], w2: [shelfW2.chapters, shelfW2.chars] }));

const openedCall = await viewPost('work.open', { workId: 'vW1' });
const opened = openedCall.value || {};
const openedChapters = opened.chapters || [];
ok('work.open 卷分组：无卷/坏卷的章排最后且 volumeId 归一 null',
  openedCall.ok === true
  && (opened.volumes || []).map((v) => v.id).join(',') === 'vV1,vV2'
  && openedChapters.map((c) => c.id).join(',') === 'vC1,vC2,vC3,vC4'
  && openedChapters[2].volumeId === null && openedChapters[3].volumeId === null && openedChapters[0].volumeId === 'vV1'
  && openedChapters[0].chars === 10 && opened.volumes[0].sortOrder === 0,
  openedChapters.map((c) => c.id + ':' + c.volumeId).join(' '));

ok('work.open 返回 masterOutline（多条换行）', opened.masterOutline === '主线：甲\n副线：乙', JSON.stringify(opened.masterOutline));

const sanitizeCall = await viewPost('chapter.get', { chapterId: 'vC6' });
const sanitizeValue = sanitizeCall.value || {};
ok('chapter.get 返回 revision 与净化后的 HTML（script 连内容剔除、onclick 剥离、白名单保留）',
  sanitizeCall.ok === true && sanitizeValue.revision === 1
  && String(sanitizeValue.html).indexOf('<script') < 0 && String(sanitizeValue.html).indexOf('bad()') < 0
  && String(sanitizeValue.html).indexOf('onclick') < 0 && String(sanitizeValue.html).includes('<b>粗</b>'),
  JSON.stringify(sanitizeValue.html).slice(0, 120));

const bigCall = await viewPost('chapter.get', { chapterId: 'vC7' });
ok('chapter.get 超 20 万字符截断并标记 truncated',
  bigCall.ok === true && bigCall.value.truncated === true && bigCall.value.html.length === 200000 && bigCall.value.html.slice(-1) === '…',
  'len=' + (bigCall.value ? bigCall.value.html.length : 'n/a') + ' truncated=' + (bigCall.value && bigCall.value.truncated));

const createdCall = await viewPost('work.create', { title: '  新书名  ' });
const createdId = createdCall.value && createdCall.value.work && createdCall.value.work.id;
const shelfAfter = (await viewPost('shelf.list')).value || {};
const createdEntry = (shelfAfter.works || []).find((w) => w.id === createdId) || {};
ok('work.create 后能在 shelf.list 读到（标题去空白）',
  createdCall.ok === true && createdCall.value.work.title === '新书名' && createdCall.value.work.author === ''
  && shelfAfter.total === 5 && createdEntry.title === '新书名' && createdEntry.chapters === 0,
  JSON.stringify({ id: createdId, entry: createdEntry.title, total: shelfAfter.total }));

/* 行内软删的作品不上架（真实库里确实存在这种 works 行），顺手造一个 40 万字符的长章验证截断。 */
await viewLib.submit([
  { table: 'works', id: 'vW5', kind: 'put', baseRevision: 0, row: { id: 'vW5', title: '已删书架', author: '', genre: '', status: '', intro: '', createdAt: 1, updatedAt: 1700000005000, deletedAt: 1700000000002 } },
  { table: 'chapters', id: 'vC8', kind: 'put', baseRevision: 0, row: { id: 'vC8', workId: 'vW4', volumeId: '', title: '长章', content: '<p>甲</p>'.repeat(50000), sortOrder: 1 } },
], { requestId: 'view-2', actor: { kind: 'human' } });
const shelfFinal = (await viewPost('shelf.list')).value || {};
const finalIds = (shelfFinal.works || []).map((w) => w.id);
ok('shelf.list 跳过行内软删的作品', shelfFinal.total === 5 && !finalIds.includes('vW5') && finalIds.includes('vW4'), finalIds.join(','));

const boundaryCall = await viewPost('chapter.get', { chapterId: 'vC8' });
const boundaryHtml = String((boundaryCall.value && boundaryCall.value.html) ?? '');
const openTags = (boundaryHtml.match(/<p>/g) || []).length;
const closeTags = (boundaryHtml.match(/<\/p>/g) || []).length;
ok('chapter.get 截断回退到标签边界（不留半截标签）',
  boundaryCall.ok === true && boundaryCall.value.truncated === true
  && boundaryHtml.endsWith('…') && boundaryHtml.length <= 200000
  && !boundaryHtml.endsWith('<p') && !boundaryHtml.endsWith('</p') && openTags === closeTags,
  'len=' + boundaryHtml.length + ' p=' + openTags + '/' + closeTags + ' tail=' + JSON.stringify(boundaryHtml.slice(-6)));

const badTitleCall = await viewPost('work.create', { title: '   ' });
const missingChapterCall = await viewPost('chapter.get', { chapterId: 'nope' });
const missingWorkCall = await viewPost('work.open', { workId: 'nope' });
const errorCodes = [badTitleCall.error && badTitleCall.error.code, missingChapterCall.error && missingChapterCall.error.code, missingWorkCall.error && missingWorkCall.error.code];
ok('参数/缺失映射为 INVALID_INPUT 与 NOT_FOUND', errorCodes.join(',') === 'INVALID_INPUT,NOT_FOUND,NOT_FOUND', errorCodes.join(','));

const emptyLib = openLibrary(join(viewRoot, 'empty'));
await emptyLib.init();
const emptyShelf = await createView(emptyLib).shelf();
ok('空库 shelf 返回空数组', Array.isArray(emptyShelf.works) && emptyShelf.works.length === 0 && emptyShelf.total === 0, JSON.stringify(emptyShelf));

const nullRpc = createRpcHandler({ library: null, version: 'test' });
const nullCodes = [];
for (const action of ['shelf.list', 'work.create', 'work.open', 'chapter.get']) {
  const response = await nullRpc(new Request('http://x/api/novelstudio/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args: { workId: 'x', chapterId: 'x', title: 'x' } }) }));
  const body = await response.json();
  nullCodes.push(body.error && body.error.code);
}
ok('library 为 null 时四个新 action 都返回 LIBRARY_UNAVAILABLE', nullCodes.length === 4 && nullCodes.every((code) => code === 'LIBRARY_UNAVAILABLE'), nullCodes.join(','));

const stripped = sanitizeHtml('<script>bad()</script><style>.a{color:red}</style><p>a < b</p><template><p>藏</p></template>');
ok('format.sanitizeHtml 丢弃危险容器内容并转义裸 <', stripped === '<p>a &lt; b</p>', JSON.stringify(stripped));

const unclosed = sanitizeHtml('<p>正文</p><style>p{color:red}');
ok('format.sanitizeHtml 丢弃未闭合的危险容器（截断残尾）', unclosed === '<p>正文</p>', JSON.stringify(unclosed));

const trimmed = sanitizeHtml('<p></p><p>甲</p><p></p><p></p><p>乙</p><p></p>');
ok('format.sanitizeHtml 折叠连续空段落并剪掉首尾空段落', trimmed === '<p>甲</p><p></p><p>乙</p>', JSON.stringify(trimmed));

const day = 86400000;
const dayLabels = [
  formatUpdatedAt(Date.now()),
  formatUpdatedAt(Date.now() - day),
  formatUpdatedAt(Date.now() - 3 * day),
  formatUpdatedAt(Date.now() - 12 * day),
  formatUpdatedAt(Date.now() - 40 * day),
  formatUpdatedAt(new Date(Date.now() - 2 * day).toISOString()),
  formatUpdatedAt('不是时间'),
  formatUpdatedAt(null),
];
ok('format.formatUpdatedAt 分档与无效输入', dayLabels.join('|') === '今天|昨天|3 天前|上周|上月|2 天前||', JSON.stringify(dayLabels));

await rm(viewRoot, { recursive: true, force: true });

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
