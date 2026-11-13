/* verify:app —— 前端产物（assets/app）的最小可复现验收。
 *
 * 背景：app/ 是从桌面仓库 fork 出来的独立前端工程，build:app 把产物直接写进
 * assets/app，插件静态中间件（src/adapters/dsh/static.js）再以 /api/novelstudio/app/
 * 前缀挂载。构建成功不代表界面正确 —— 这里用真 Chrome 把产物当宿主页面跑一遍，
 * 机器判据守住 DSH 皮肤的关键外观契约：
 *   顶栏高 44|52|64（按宽度档）/ 书架卡片与流动底画布 / 正文行宽<=36em / 工具栏 34 /
 *   浅色大块背景=0 / 可见「恍然梦」=0 / scrollWidth<=clientWidth / 顶栏不压舞台 /
 *   封面文字互不遮挡（书名/拉丁/题材状态/脚注四块两两不相交，见 keyAssert 的 shelf 分支）
 *
 * 书架种子刻意排了三本书：竖排书名、横排含拉丁（用户实测的压字样本）、横排长书名 ——
 * 封面文字的三条判据分别靠它们才走得到。
 *
 * 浅色按可见面积判而非逐元素数：设计稿自带白胶囊与白色主按钮，逐元素会把它误判成
 * 整块浅底；整页浅底又必须照旧判负，只有面积能同时满足这两条。
 *
 * chapters 场景进入作品的点击按设计稿语义降级：.ls-primary（继续写作，emit open）→
 * .ls-card（有的实现把点击也绑到打开）→ 桌面皮肤仍在时的 .os-book-open。卡片点击
 * 本身只换聚焦，顺序反了就会卡在书架上永远等不到编辑区。
 *
 * 依赖：只有 Node 内置模块 + 本机 Chrome（CDP over --remote-debugging-port）。
 *      不联网、不 npm install、不读 app/ 源码。
 *
 * 用法：npm run verify:app
 * 产物：截图与独立 Chrome profile 落在 .tmp-verify-app/（.gitignore 的 .tmp-* 已覆盖）。
 */
import { loreFreeProbe, loreReloadProbe } from './lore-free-probe.mjs'
import { writingStatsProbe } from './writing-stats-probe.mjs'
import { snippetsProbe } from './snippets-probe.mjs'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const APP_DIR = process.env.NS_VERIFY_APP_DIR ? resolve(REPO,process.env.NS_VERIFY_APP_DIR) : join(REPO, 'assets', 'app')
if (!APP_DIR.startsWith(REPO + '\\') && !APP_DIR.startsWith(REPO + '/')) throw new Error('验收构建必须位于本仓库内')
const OUT_DIR = resolve(REPO, process.env.NS_VERIFY_OUT || '.tmp-verify-app')
if (!OUT_DIR.startsWith(REPO + '\\') && !OUT_DIR.startsWith(REPO + '/')) throw new Error('验收输出必须位于本仓库内')
const PROFILE_DIR = join(OUT_DIR, 'chrome-profile-' + process.pid)
const PREFIX = '/api/novelstudio/app/'
const VH = 860
/* 三档宽度各跑一遍：窄栏不降级只换尺寸，44/52/64 三个顶栏档位都要有实测证据。 */
const RUNS = [
  { module: 'shelf', width: 380 },
  { module: 'shelf', width: 760 },
  { module: 'shelf', width: 1280 },
  { module: 'chapters', width: 544 },
  { module: 'chapters', width: 380 },
  { module: 'chapters', width: 695 },
  { module: 'chapters', width: 760 },
  { module: 'chapters', width: 1000 },
  { module: 'chapters', width: 1280 },
  /* 2026-11-05：书架那层流动底铺到其余功能页，每页同样跑 380/760/1280 三档 ——
     判据与正文页同源（画布铺满 / 后端自证 / 玻璃可透底 / 正文对比度 / 浅色大块=0 / 不横向溢出）。 */
  { module: 'outline', width: 1280 },
  { module: 'outline', width: 760 },
  { module: 'outline', width: 380 },
  /* 1440 档只为一张「新建作品 → 六个默认集」的真机图，同时把宽档断言的宽度覆盖从 1280 扩到 1440。 */
  { module: 'lore', width: 1440 },
  { module: 'lore', width: 1280 },
  /* 2026-11-06 第三轮：窄档补 1000 档 —— 窄档 pill 闭环与集头宽度都要求 1000/760/380 各一条。 */
  { module: 'lore', width: 1000 },
  { module: 'lore', width: 760 },
  { module: 'lore', width: 380 },
  /* 2026-11-05 人物融合总稿：宽档补 1440（设计稿 report.json 的主档）、窄档补 1000（单列 +
     48px 工具条 + 名录抽屉的中间档），1280/760/380 三档保留。 */
  { module: 'characters', width: 1440 },
  { module: 'characters', width: 1280 },
  { module: 'characters', width: 1000 },
  { module: 'characters', width: 760 },
  { module: 'characters', width: 380 },
  { module: 'snippets', width: 1440 },
  { module: 'snippets', width: 1280 },
  { module: 'snippets', width: 864 },
  { module: 'snippets', width: 760 },
  { module: 'snippets', width: 380 },
  /* 拆窗面板是另一条壳层（PanelHost：没有 .app-topbar、不经书架），主机 iframe 覆盖不到：
     单独指一条 ?panel=outline:<种子作品 id>，宽度取面板窗口真机值 760。 */
  { module: 'panel-outline', width: 760 },
  /* 2026-11-06 设置融合总稿：设置工作区走的是 ui.view='settings' 这条就地视图（不经 workbench），
     宽档补 1440（设计稿主档），窄档 1280/1000/760/380 四档守抽屉与手机预览。
     数据页的「真实下载 / 喂备份文件 / 第二个窗口」这类重活只在 1440 跑一遍（见 settingsProbe 的 gate），
     其余档只跑结构、外观与窄档专属判据。 */
  { module: 'settings', width: 1440 },
  { module: 'settings', width: 1280 },
  { module: 'settings', width: 1000 },
  { module: 'settings', width: 864 },
  { module: 'settings', width: 760 },
  { module: 'settings', width: 380 },
  /* 面板窗口里的设置（?panel=settings:app:）：PanelHost 的 settings 分支没有 .panel-topbar，
     就绪标志改成 .settings-shell 出现——与主窗口共用同一个外壳组件。 */
  { module: 'panel-settings', width: 760 },
  /* 恢复链路单独一个场景：它会真的把库冲掉（reload + 替换全表），不能和别的判据共用一个场景。 */
  { module: 'settings-restore', width: 1280 }
]
const CHROME = process.env.NS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEADLINE_MS = 150000
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
}

/* 父页面：注入暗色 --dsw-* 令牌 + data-ds-dark-theme，把产物放进精确尺寸的 iframe，
 * 用应用自己的 IndexedDB 契约种一条作品，然后按模块测量，把结果写进
 * window.__NS_VERIFY_RESULT 交给 Node 侧轮询（不依赖额外网络回传通道）。 */
const HARNESS = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>ns-verify-app</title>
<style>html,body{margin:0;overflow:hidden;background:#151517}</style>
</head><body data-ds-dark-theme>
<script>
'use strict';
var PREFIX = '/api/novelstudio/app';
var VH = 860;
var MAP = {
  '--ns-bg': '--dsw-alias-bg-base',
  '--ns-layer-1': '--dsw-alias-bg-layer-1',
  '--ns-layer-2': '--dsw-alias-bg-layer-2',
  '--ns-layer-3': '--dsw-alias-bg-layer-3',
  '--ns-border-1': '--dsw-alias-border-l1',
  '--ns-border-2': '--dsw-alias-border-l2',
  '--ns-border-3': '--dsw-alias-border-l3',
  '--ns-label-1': '--dsw-alias-label-primary',
  '--ns-label-2': '--dsw-alias-label-secondary',
  '--ns-caption': '--dsw-alias-label-caption',
  '--ns-error': '--dsw-alias-state-error-primary',
  '--ns-warn': '--dsw-alias-state-warn-primary',
  '--ns-accent': '--dsw-alias-state-business-primary',
  '--ns-radius-sm': '--dsw-alias-radius-sm',
  '--ns-radius-md': '--dsw-alias-radius-md',
  '--ns-radius-lg': '--dsw-alias-radius-lg'
};
var DSW = {
  '--dsw-alias-bg-base': '#151517', '--dsw-alias-bg-layer-1': '#232324', '--dsw-alias-bg-layer-2': '#2c2c2e', '--dsw-alias-bg-layer-3': '#333336',
  '--dsw-alias-border-l1': 'rgba(255,255,255,0.06)', '--dsw-alias-border-l2': 'rgba(255,255,255,0.12)', '--dsw-alias-border-l3': 'rgba(255,255,255,0.16)',
  '--dsw-alias-label-primary': '#f9fafb', '--dsw-alias-label-secondary': '#cfd3d6', '--dsw-alias-label-caption': '#81858c',
  '--dsw-alias-state-error-primary': '#f25a5a', '--dsw-alias-state-warn-primary': '#f59e0b', '--dsw-alias-state-business-primary': '#7aaaff',
  '--dsw-alias-radius-sm': '8px', '--dsw-alias-radius-md': '12px', '--dsw-alias-radius-lg': '16px'
};
var EXTRA = {
  '--ns-label-3': '#a3a7ad', '--ns-hover': 'rgba(255,255,255,0.06)', '--ns-active': 'rgba(255,255,255,0.10)',
  '--ns-scroll-width': '10px', '--ns-scroll-thumb-hover': 'rgba(255,255,255,.32)'
};

function applyHostTokens() {
  var b = document.body;
  b.setAttribute('data-ds-dark-theme', '');
  b.style.background = '#151517';
  Object.keys(DSW).forEach(function (k) { b.style.setProperty(k, DSW[k]); });
}
function shim(frame) {
  try {
    var root = frame.contentDocument && frame.contentDocument.documentElement;
    if (!root) return;
    var host = getComputedStyle(document.body);
    Object.keys(MAP).forEach(function (ns) {
      var v = (host.getPropertyValue(MAP[ns]) || '').trim();
      if (v) root.style.setProperty(ns, v);
    });
    Object.keys(EXTRA).forEach(function (k) { root.style.setProperty(k, EXTRA[k]); });
    if (root.dataset.nsDark !== '1') root.dataset.nsDark = '1';
  } catch (err) { /* iframe 尚未同源可访问 */ }
}

/* ---- 种子：应用作品库的 IndexedDB 契约（works / chapters 两个 store） ---- */
/* 三条书名样本，少一条就有一条封面分支永远走不到：
   w1 竖排（5 字全 CJK，设计稿主路径）/ w2 横排（含拉丁字母 A，用户实测的遮挡样本）
   / w3 横排 + 长书名档（11 字 > 8 字阈值）。updatedAt 递减保证 w1 仍是聚焦卡，
   正文场景靠 .ls-primary 打开的就是它。 */
var WORKS = [
  { id: 'w1', title: '雾港纪年', author: '沈砚', genre: '悬疑', status: '连载', kind: 'novel', intro: '雾从港口漫上来。', totalWords: 4210, chapterCount: 3 },
  { id: 'w2', title: '画布验证书A', author: '', genre: '其他', status: '构思', kind: 'novel', intro: '', totalWords: 0, chapterCount: 3 },
  { id: 'w3', title: '雾港纪年之外的第七夜', author: '沈砚', genre: '悬疑', status: '搁置', kind: 'novel', intro: '', totalWords: 0, chapterCount: 3 }
]
  .map(function (w, i) { w.updatedAt = Date.now() - i * 86400000; w.deletedAt = null; w.createdAt = w.updatedAt; return w; });
var CHAPTERS = [];
WORKS.forEach(function (w) {
  for (var i = 0; i < 3; i++) {
    var body = '第 ' + (i + 1) + ' 章的草稿。雾从港口漫上来，灯在雾里只剩一圈毛边，像有人把整座城扣进了一只旧玻璃杯。';
    /* 第 1 章刻意用长标题：章节名「溢出时才滚动播放」的断言要靠它才走得到真溢出那条路。 */
    var cTitle = i === 0 ? '第一章 · 初雪的钟声从港口漫上来' : '第 ' + (i + 1) + ' 章';
    CHAPTERS.push({ id: w.id + '-c' + i, workId: w.id, volumeId: null, title: cTitle, content: body, wordCount: body.length, sortOrder: i * 1000, createdAt: w.createdAt, updatedAt: w.updatedAt - i * 1000, deletedAt: null });
  }
});
/* 灵感种子：与设计稿 docs/前端美化/灵感-融合总稿-20261107/data.json 同一组内容（标题=content 首行）。
   必须走应用自己的 store 灌（同 seedMubu：raw 建表会被 Dexie v1→v12 升级清空）。
   关联只指向本 HARNESS 真有的章节（w1-c0 / w2-c0），不制造「目标已不可用」。 */
var SNIPPETS = [
  { content: '退潮时，钟声从海底传来\\n\\n港口的人都说，旧钟楼已经沉了三十年。\\n\\n可每逢大潮退去，守夜人还是会听见十三下钟声。', tags: ['场景', '雾港', '伏笔'], links: [{ kind: 'chapter', id: 'w1-c0' }] },
  { content: '修表的人害怕整点\\n\\n他能修好这座城里每一只走慢的表，却总在整点前的最后一分钟，关上铺门。', tags: ['人物', '秘密'], links: [] },
  { content: '「你不是来送信的。」\\n\\n「你不是来送信的。」\\n「那我来做什么？」\\n「你只是想知道，还有没有人记得你的名字。」', tags: ['对白', '来信'], links: [] },
  { content: '没有名字的车票\\n\\n车票的正面没有目的地。\\n翻过来，每张票背面都有一个名字。', tags: ['场景', '车站'], links: [{ kind: 'chapter', id: 'w2-c0' }] },
  { content: '他从不拆信\\n\\n每逢周四，他都收到一封相同的信。\\n他从不拆开，只把信寄回昨天。', tags: ['人物', '来信'], links: [] },
  { content: '「海会把人送回来吗？」\\n\\n「海会把人送回来吗？」\\n「会的。」\\n「那为什么你还一直等？」', tags: ['对白', '离别'], links: [] },
  { content: '雨停在第七级台阶\\n\\n整条长街都湿了，只有通往旧书店的第七级台阶是干的。', tags: ['场景', '雨夜'], links: [] },
  { content: '一场没有掌声的告别\\n\\n她排练过很多遍，真正离开的时候，却只对门口的猫说了一声再见。', tags: ['人物', '离别'], links: [] },
  { content: '「你把灯留给谁？」\\n\\n「你把灯留给谁？」\\n「留给那些找不到门的人。」', tags: ['对白', '雾港'], links: [] },
  { content: '第二把钥匙\\n\\n失物招领处有两把完全相同的钥匙。\\n\\n第一把的主人三年前已经来领过。', tags: [], links: [] },
  { content: '等下一班潮汐\\n\\n一个关于错过的桥段：他们总在相同的码头，等不同的船。', tags: ['场景', '雾港'], links: [] },
  { content: '那本没写完的航海日志\\n\\n最后一页被撕去了。\\n留下来的压痕上，反复写着同一个日期。', tags: [], links: [] }
];

function deleteDb(name) {
  return new Promise(function (res) {
    var r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = function () { res(); };
    setTimeout(res, 800);
  });
}
function seedDb(name) {
  return new Promise(function (res, rej) {
    var req = indexedDB.open(name, 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('works')) {
        var s = db.createObjectStore('works', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt'); s.createIndex('deletedAt', 'deletedAt');
      }
      if (!db.objectStoreNames.contains('chapters')) {
        var c = db.createObjectStore('chapters', { keyPath: 'id' });
        c.createIndex('workId', 'workId'); c.createIndex('volumeId', 'volumeId');
        c.createIndex('[workId+deletedAt]', ['workId', 'deletedAt']); c.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onerror = function () { rej(req.error); };
    req.onsuccess = function () {
      var db = req.result;
      var tx = db.transaction(['works', 'chapters'], 'readwrite');
      WORKS.forEach(function (w) { tx.objectStore('works').put(w); });
      CHAPTERS.forEach(function (c) { tx.objectStore('chapters').put(c); });
      tx.oncomplete = function () { db.close(); res(name); };
      tx.onerror = function () { rej(tx.error); };
    };
  });
}

/* ---- 量具（不引正则，避免转义歧义） ---- */
function px(v) { return Math.round(parseFloat(v) * 10) / 10; }
function rgbOf(s) {
  var str = String(s || '');
  var open = str.indexOf('('), close = str.indexOf(')');
  if (open < 0 || close < open) return null;
  if (str.slice(0, open).indexOf('rgb') !== 0) return null;
  var parts = str.slice(open + 1, close).split(',');
  if (parts.length < 3) return null;
  var p = parts.map(function (x) { return parseFloat(x); });
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lightScan(root, win) {
  var count = 0, samples = [];
  if (!root) return { count: 0, samples: samples };
  var vw = win.innerWidth || 1, vh = win.innerHeight || 1, varea = vw * vh;
  Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
    /* 裁到视口再算面积：滚出屏幕的部分不该算成「可见的浅底」。 */
    var r = el.getBoundingClientRect();
    var aw = Math.min(r.right, vw) - Math.max(r.left, 0);
    var ah = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (!(aw > 0 && ah > 0)) return;
    var area = aw * ah;
    /* 8% 是分界线：白胶囊/主按钮不超过 2% 视口，整块浅底远超 8%。 */
    if (area <= varea * 0.08) return;
    var c = rgbOf(win.getComputedStyle(el).backgroundColor);
    if (!c || c.a <= 0.5) return;
    var lum = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
    if (lum > 0.8) {
      count++;
      if (samples.length < 3) {
        var cls = (typeof el.className === 'string' && el.className) ? el.className.slice(0, 34) : el.tagName.toLowerCase();
        samples.push(cls + ' | ' + win.getComputedStyle(el).backgroundColor + ' | ' + Math.round(area / varea * 1000) / 10 + '%');
      }
    }
  });
  return { count: count, samples: samples };
}
function dreamCount(doc, win) {
  var n = 0, tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null), t;
  while ((t = tw.nextNode())) {
    if ((t.nodeValue || '').indexOf('恍然梦') < 0) continue;
    var host = t.parentElement;
    if (!host || !host.getClientRects().length) continue;
    var cs = win.getComputedStyle(host);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    n++;
  }
  return n;
}

function finish(out) {
  window.__NS_VERIFY_RESULT = out;
  document.title = 'NSVERIFY ' + (out.ok ? 'PASS' : 'FAIL');
}

/* ---- 判据 ---- */
/* 与设计决策的三档宽度一致：窄栏不降级，只换顶栏高度。 */
function topbarBase(w) { return w <= 559 ? 44 : w <= 899 ? 56 : w <= 1099 ? 72 : 84; }

function keyAssert(module, frame, width) {
  var doc = frame.contentDocument, win = frame.contentWindow, items = [], ev = {};
  function need(name, ok, e) { items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  if (module === 'shelf') {
    var shelf = doc.querySelector('.latent-shelf');
    var cards = doc.querySelectorAll('.latent-shelf .ls-card');
    ev.cards = cards.length;
    need('书架卡片数>0', cards.length > 0, shelf ? cards.length : '未找到 .latent-shelf，命中 ' + cards.length);
    var bd = doc.querySelector('.latent-shelf canvas.ls-backdrop');
    ev.backdrop = !!bd;
    need('ls-backdrop 画布存在', !!bd, bd ? 'ok' : (shelf ? '未找到 canvas.ls-backdrop' : '未找到 .latent-shelf'));
    var stName = '__nsLatentStats 后端与像素';
    if (typeof win.__nsLatentStats !== 'function') {
      need(stName, false, '__nsLatentStats 缺失');
    } else {
      var st = null, stErr = '';
      try { st = win.__nsLatentStats(); } catch (e) { stErr = String(e && e.message || e); }
      var bk = st && st.backend ? String(st.backend) : '';
      var p0 = st && st.pixels && st.pixels.length ? Number(st.pixels[0]) : -1;
      ev.stats = { backend: bk, pixels0: p0 };
      need(stName, (bk === 'gpu' || bk === 'cpu') && p0 > 0, stErr ? '调用抛错: ' + stErr : 'backend=' + (bk || '(空)') + ' pixels[0]=' + p0);
    }

    /* ---- 封面文字几何：四块绝对定位文字两两不相交、都在玻璃内、书名不被裁 ----
       横排书名（.is-wide）与左侧竖排拉丁（.ls-glyph-latin）共用 left:16 时，
       书名×拉丁 会在这里被量出来 —— 这就是「封面压字」的机器判据，别删。 */
    var glyphHit = [], glyphOut = [], glyphCut = [];
    var PARTS = [['题材状态', '.ls-glyph-top'], ['书名', '.ls-glyph-title'], ['拉丁', '.ls-glyph-latin'], ['脚注', '.ls-glyph-foot']];
    Array.prototype.forEach.call(cards, function (card) {
      var glass = card.querySelector('.ls-glass');
      if (!glass) return;
      var g = glass.getBoundingClientRect();
      if (!(g.width > 1 && g.height > 1)) return;
      var id = card.getAttribute('data-work-id') || '?';
      var boxes = [];
      PARTS.forEach(function (part) {
        var el = card.querySelector(part[1]);
        if (!el) return;
        var r = el.getBoundingClientRect();
        boxes.push({ name: part[0], r: r });
        /* 0.5px 容差：设备像素舍入不算真溢出。 */
        if (r.left < g.left - 0.5 || r.right > g.right + 0.5 || r.top < g.top - 0.5 || r.bottom > g.bottom + 0.5) {
          if (glyphOut.length < 4) glyphOut.push(id + '/' + part[0] + ' 出玻璃 x' + Math.round(r.left) + ' y' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
      });
      for (var i = 0; i < boxes.length; i++) {
        for (var j = i + 1; j < boxes.length; j++) {
          var a = boxes[i].r, b = boxes[j].r;
          var ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          var oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 0.5 && oy > 0.5 && glyphHit.length < 4) glyphHit.push(id + ' ' + boxes[i].name + '×' + boxes[j].name + ' 叠 ' + Math.round(ox) + 'x' + Math.round(oy) + 'px');
        }
      }
      var title = card.querySelector('.ls-glyph-title');
      if (title && glyphCut.length < 4) {
        /* 横排按高、竖排按宽判溢出：writing-mode 决定行内方向，scroll* 是两个不同的轴。 */
        var isWide = String(title.className).indexOf('is-wide') >= 0;
        var over = isWide ? title.scrollHeight - title.clientHeight : title.scrollWidth - title.clientWidth;
        if (over > 1) glyphCut.push(id + ' 书名被裁 ' + (isWide ? 'scrollHeight+' : 'scrollWidth+') + over + 'px');
      }
    });
    need('封面文字互不遮挡', glyphHit.length === 0, glyphHit.length ? glyphHit.join(' | ') : '四块文字两两不相交（' + cards.length + ' 卡）');
    need('封面文字不出玻璃', glyphOut.length === 0, glyphOut.length ? glyphOut.join(' | ') : 'ok');
    need('书名不被裁切', glyphCut.length === 0, glyphCut.length ? glyphCut.join(' | ') : 'ok');
  } else if (module === 'chapters') {
    var tp = doc.querySelector('.rich-host .rich-inner .tiptap') || doc.querySelector('.tiptap');
    var cs = tp ? win.getComputedStyle(tp) : null;
    var em = cs ? parseFloat(cs.fontSize) : 0;
    var w = tp ? px(tp.getBoundingClientRect().width) : -1;
    /* 【口径变更：36em → 44em，本脚本里唯一一处被放宽的断言，别顺手放宽别的】
       用户明确要求「正文左右不用留空，完全利用整块空间，因为 DSH 界面空间较小」；
       皮肤侧把宽屏稿纸上限提到 44em（44×17.5px≈770px≈45 汉字/行），仍在中文长文可读区间。 */
    var lim = px(44 * em);
    ev.tiptap = { w: w, fontSize: em, limit44em: lim, maxWidth: cs ? cs.maxWidth : null };
    need('正文行宽<=44em', w > 0 && w <= lim + 0.5, w + ' <= ' + lim);
    var tb = doc.querySelector('.editor-toolbar');
    var th = tb ? px(tb.getBoundingClientRect().height) : -1;
    ev.toolbar = th;
    need('工具栏 34', Math.abs(th - 34) <= 0.5, th);

    /* ---- 正文新皮肤（伏案静水）落地取证：只追加，不动上面任何既有判据 ---- */
    /* 1) 底噪画布：以 .latent-studio 祖先为准，缺它时退到裸 canvas.st-backdrop 并在证据里写明。 */
    var back = doc.querySelector('.latent-studio canvas.st-backdrop');
    var backSel = '.latent-studio canvas.st-backdrop';
    if (!back) { back = doc.querySelector('canvas.st-backdrop'); backSel = 'canvas.st-backdrop（缺 .latent-studio 祖先）'; }
    ev.backdrop = back ? backSel : null;
    need('st-backdrop 画布存在', !!back, back ? backSel : '未找到 .latent-studio canvas.st-backdrop，也未找到 canvas.st-backdrop');

    /* 2) 后端自证：2026-11-05 起正文页背板也换成共用 flow 引擎，backend 只有 gpu|cpu 两个合法值；
          gpu 必须 pixels[0]>0（cpu 兜底是逐像素位图，pixels 允许为空）。'css' 仍容忍 ——
          它是旧 studio-gl 的兜底位图，留着只为不让历史遗留一上来就判红，不再作为目标口径。 */
    var stName = '__nsStudioBackdrop 后端与像素';
    var stFn = typeof win.__nsStudioBackdrop === 'function' ? win.__nsStudioBackdrop
      : (typeof win.__nsStudioStats === 'function' ? win.__nsStudioStats : null);
    if (!stFn) {
      need(stName, false, '__nsStudioBackdrop 缺失');
    } else {
      var stv = null, stErr = '';
      try { stv = stFn(); } catch (e) { stErr = String(e && e.message || e); }
      var bk = stv && stv.backend ? String(stv.backend) : '';
      var p0 = stv && stv.pixels && stv.pixels.length ? Number(stv.pixels[0]) : -1;
      var via = stFn === win.__nsStudioBackdrop ? '__nsStudioBackdrop' : '__nsStudioStats';
      ev.stats = { backend: bk, pixels0: p0, via: via };
      need(stName, (bk === 'gpu' || bk === 'cpu' || bk === 'css') && (bk !== 'gpu' || p0 > 0),
        stErr ? '调用抛错: ' + stErr : 'backend=' + (bk || '(空)') + ' pixels[0]=' + p0 + ' via=' + via + '（接受 gpu|cpu，css 仅容忍）');
    }

    /* 3) 【2026-11 作废：侧栏 252/168/0 的宽度判据】用户要求章节栏改成和批注栏一样的浮层抽屉、省空间，
       它不再占列宽，252/168 这两个数字已无意义。改为判「默认收起」：页面就绪的那一刻 .side-panel 不该渲染
       （dirVisible/sidePanelOpen 默认关的正常结果），且左缘展开轨 .ol-side-rail 在。
       默认态由 ticks 在「打开目录栏供面板内断言测量」之前记进 SIDE_DEFAULT，所以这里读的是真默认态。
       下面仍保留 sp 查询，供后续「抽屉打开态」之外的几何判断用。 */
    var sp = doc.querySelector('.workbench-shell #writing-directory.side-panel')
      || doc.querySelector('.workbench-shell .side-panel')
      || doc.querySelector('.side-panel');
    var railEl = doc.querySelector('.ol-side-rail');
    var defPanel = (SIDE_DEFAULT && typeof SIDE_DEFAULT.panel === 'boolean') ? SIDE_DEFAULT.panel : !!sp;
    var defRail = (SIDE_DEFAULT && typeof SIDE_DEFAULT.rail === 'boolean') ? SIDE_DEFAULT.rail : !!railEl;
    ev.sideDefault = { panelPresentAtDefault: defPanel, railAtDefault: defRail, panelNow: !!sp, railNow: !!railEl };
    need('章节栏默认收起', defPanel === false && defRail === true,
      '默认态 .side-panel 存在=' + defPanel + '（要求 false）默认态 .ol-side-rail 存在=' + defRail + '（要求 true）视口=' + width);

    /* 4) 对比度：.rich-host 计算背景色（半透明就逐级向上合成，全透明兜底 #151517）对 .tiptap 前景色，
       前景自带 alpha 时同样先与背景合成，再按 WCAG 相对亮度算比值。 */
    /* color-mix() 的计算值落到 color(srgb r g b / a)，分量是 0~1 浮点。不认这种写法，
       comp() 就会把半透明稿纸当成「无背景」一路退到 #151517 兜底，对比度便成了假绿。 */
    function col(s) {
      var c0 = rgbOf(s);
      if (c0) return c0;
      var str = String(s || ''), open = str.indexOf('('), close = str.lastIndexOf(')');
      if (open < 0 || close < open) return null;
      var head = str.slice(0, open).toLowerCase();
      var isColorFn = head.indexOf('color') === 0;
      if (!isColorFn && head.indexOf('rgb') !== 0) return null;
      var body = str.slice(open + 1, close).split('/');
      var nums = body[0].split(',').join(' ').split(' ').filter(function (x) { return x !== ''; }).map(parseFloat);
      if (isColorFn) nums = nums.slice(1);   /* 丢掉颜色空间名 srgb */
      if (nums.length < 3) return null;
      var al = body.length > 1 ? parseFloat(body[1]) : (nums.length > 3 ? nums[3] : 1);
      var unit = isColorFn ? 255 : 1;
      return { r: nums[0] * unit, g: nums[1] * unit, b: nums[2] * unit, a: isNaN(al) ? 1 : al };
    }
    function comp(el) {
      var stack = [], node = el, guard = 0, fallback = false;
      while (node && guard++ < 12) {
        var c = col(win.getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
        node = node.parentElement;
      }
      if (!stack.length || stack[stack.length - 1].a < 0.999) { stack.push({ r: 21, g: 21, b: 23, a: 1 }); fallback = true; }
      var out = stack[stack.length - 1];
      for (var i = stack.length - 2; i >= 0; i--) {
        var t = stack[i];
        out = { r: t.r * t.a + out.r * (1 - t.a), g: t.g * t.a + out.g * (1 - t.a), b: t.b * t.a + out.b * (1 - t.a), a: 1 };
      }
      return { rgb: out, fallback: fallback };
    }
    function lum(c) {
      function ch(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    }
    var rh = doc.querySelector('.rich-host');
    var ratio = -1, cEv = '';
    if (!rh) {
      cEv = '未找到 .rich-host';
    } else if (!tp) {
      cEv = '未找到 .tiptap';
    } else {
      var bgc = comp(rh), fgc = col(win.getComputedStyle(tp).color);
      if (!fgc) {
        cEv = '.tiptap color 解析失败: ' + win.getComputedStyle(tp).color;
      } else {
        var fg = fgc.a < 1
          ? { r: fgc.r * fgc.a + bgc.rgb.r * (1 - fgc.a), g: fgc.g * fgc.a + bgc.rgb.g * (1 - fgc.a), b: fgc.b * fgc.a + bgc.rgb.b * (1 - fgc.a), a: 1 }
          : fgc;
        var l1 = lum(bgc.rgb), l2 = lum(fg);
        ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
        cEv = ratio + ':1  bg=rgb(' + Math.round(bgc.rgb.r) + ',' + Math.round(bgc.rgb.g) + ',' + Math.round(bgc.rgb.b) + ')'
          + (bgc.fallback ? '(半透明，兜底 #151517)' : '') + '  fg=' + win.getComputedStyle(tp).color;
      }
      ev.contrast = { ratio: ratio, bg: bgc.rgb, fallback: bgc.fallback, fg: win.getComputedStyle(tp).color };
    }
    need('正文对比度>=7', ratio >= 7, cEv);

    /* 5) 窄档工具栏裁切（2026-11 改判）：主行现在固定 12 项，380 档本来就该横滑，右缘另有 mask 淡出。
       这条的本意是「不许硬裁掉半个字形」，不是「不许溢出」，所以判据改为：
       overflow-x ∈ {auto,scroll,hidden} 且工具栏上确实有 mask（mask-image / -webkit-mask-image 非 none）→ PASS；
       只有 overflow-x 仍是 visible 且 scrollWidth > clientWidth 时才是真裁（判红）。 */
    var tbCs = tb ? win.getComputedStyle(tb) : null, ox = tbCs ? String(tbCs.overflowX) : '';
    var swTb = tb ? tb.scrollWidth : -1, cwTb = tb ? tb.clientWidth : -1;
    var maskV = tbCs ? String(tbCs.maskImage || tbCs.webkitMaskImage || 'none') : 'none';
    var hasMask = !!maskV && maskV !== 'none';
    ev.toolbarOverflow = { overflowX: ox, scrollWidth: swTb, clientWidth: cwTb, mask: maskV.slice(0, 48) };
    if (width <= 560) {
      var oxOK = (ox === 'auto' || ox === 'scroll' || ox === 'hidden');
      var realCut = (ox === 'visible' || ox === '') && swTb > cwTb + 1;
      need('工具栏不溢出且声明裁切', !!tb && oxOK && hasMask && !realCut,
        tb ? ('overflow-x=' + ox + ' scrollW=' + swTb + ' clientW=' + cwTb + ' mask=' + maskV.slice(0, 48)
          + '（要求 overflow-x∈{auto,scroll,hidden} 且有 mask；overflow-x=visible 且溢出才算真裁）') : '未找到 .editor-toolbar');
    }

    /* 6) 背板必须铺满视口：只判 getBoundingClientRect，不判属性尺寸 —— 缺 CSS 约束时
       <canvas> 会按 width/height 属性参与布局，元素仍有 layout，光看存在性抓不到空屏。
       上下界都要有：本皮肤的实现就是 inset:0 + width/height:100%，滚动视差那种「故意放大
       canvas」不在本皮肤设计内；将来真要放大，该放大的是绘制分辨率(canvas.width/height 属性)
       而不是 CSS 盒子，两者分开之后这条断言照样成立。 */
    var cv = doc.querySelector('.latent-studio canvas.st-backdrop');
    var cr = cv ? cv.getBoundingClientRect() : null;
    var okCover = !!cr
      && cr.width  >= win.innerWidth  * 0.9 && cr.width  <= win.innerWidth  * 1.5
      && cr.height >= win.innerHeight * 0.6 && cr.height <= win.innerHeight * 1.5
      && Math.abs(cr.top) <= 4 && Math.abs(cr.left) <= 4;
    ev.backdropRect = cr ? { w: Math.round(cr.width), h: Math.round(cr.height), top: Math.round(cr.top), left: Math.round(cr.left) } : null;
    var cvWhy = '';
    if (!cr) {
      cvWhy = '未找到 canvas.st-backdrop';
    } else {
      var overW = cr.width > win.innerWidth * 1.5, overH = cr.height > win.innerHeight * 1.5;
      var underW = cr.width < win.innerWidth * 0.9, underH = cr.height < win.innerHeight * 0.6;
      var off = Math.abs(cr.top) > 4 || Math.abs(cr.left) > 4;
      cvWhy = (overW || overH ? '盒子被属性尺寸撑开' : underW || underH ? '压根没铺满' : off ? '没贴住左上角' : 'ok');
      cvWhy += ': w=' + Math.round(cr.width) + ' h=' + Math.round(cr.height) + ' 视口=' + win.innerWidth + 'x' + win.innerHeight
        + ' top=' + Math.round(cr.top) + ' left=' + Math.round(cr.left);
    }
    need('背板铺满视口', okCover, cvWhy);

    /* 7) 整页没被顶出视口：顶栏贴顶 0..8，正文首行仍在视口内且不是被压扁的 0 高。
       这是「整页空屏」的直接反证 —— 背板按属性尺寸排版会把内容整体推下去。 */
    var barEl = doc.querySelector('.app-topbar');
    var tr = barEl ? barEl.getBoundingClientRect() : null;
    var pr = tp ? tp.getBoundingClientRect() : null;
    ev.inViewport = { topbarTop: tr ? Math.round(tr.top) : null, paperTop: pr ? Math.round(pr.top) : null, paperHeight: pr ? Math.round(pr.height) : null, vh: win.innerHeight };
    need('内容在视口内',
      !!tr && tr.top >= -1 && tr.top <= 8 && !!pr && pr.top < win.innerHeight * 0.9 && pr.height > 40,
      tr ? ('topbar.top=' + Math.round(tr.top) + ' paper.top=' + (pr ? Math.round(pr.top) : 'n/a') + ' paper.h=' + (pr ? Math.round(pr.height) : 'n/a') + ' 视口高=' + win.innerHeight)
        : '未找到 .app-topbar');

    /* 8) 默认态判据：<1180 时 ui.rightPanelOpen 默认 true，皮肤若把批注栏做成脱流常驻覆盖层，
       打开页面就被它盖住正文。这条必须在任何开关被改动之前读 —— keyAssert 是同步首跑，此刻还是默认态
       （695 档的「批注栏可开可关」会主动去点开关，抓不到这个问题）。 */
    if (width < 1180) {
      var rpEl = doc.querySelector('.right-panel[aria-label="批注与资料"]') || doc.querySelector('.right-panel');
      var rpRect = rpEl ? rpEl.getBoundingClientRect() : null;
      var rpCs = rpEl ? win.getComputedStyle(rpEl) : null;
      var rpVis = !!rpRect && rpRect.width > 0 && rpRect.height > 0 && rpCs.display !== 'none' && rpCs.visibility !== 'hidden';
      ev.notesDefault = { present: !!rpEl, visible: rpVis, w: rpRect ? Math.round(rpRect.width) : 0, offsetParentNull: rpEl ? rpEl.offsetParent === null : null, vw: win.innerWidth };
      need('批注栏默认不遮挡正文', !rpVis,
        '可见=' + rpVis + '（元素存在=' + !!rpEl + ' rect.w=' + (rpRect ? Math.round(rpRect.width) : 'n/a')
        + ' display=' + (rpCs ? rpCs.display : 'n/a') + ' offsetParent 为空=' + (rpEl ? rpEl.offsetParent === null : 'n/a') + '）视口宽=' + win.innerWidth);
    }

    /* 9) 正文列够宽的量化下界：全档位都成立，阈值按档位走 —— 这就是用户抱怨「一行只剩十个字」的量化形式。
       档位：<=560 至少 280；560-1179 至少 360（真机 695 修前约 330，会在这里红）；>=1180 至少 440。 */
    var colW = tp ? Math.round(tp.getBoundingClientRect().width) : -1;
    var colMin = width >= 1180 ? 440 : width <= 560 ? 280 : 360;
    var colTier = width >= 1180 ? '>=1180' : width <= 560 ? '<=560' : '560-1179';
    ev.paperWidth = colW; ev.paperMin = colMin;
    need('正文列够宽', colW >= colMin, '实际=' + colW + ' 阈值>=' + colMin + ' 档位=' + colTier);

    /* 设计稿的 center-pane 只负责排版，玻璃只属于侧面板。高光伪元素会盖在
       标题、工具栏和稿纸上；单测稿纸自身的色值/尺寸发现不了这次回归。 */
    var writingCenter = Array.from(doc.querySelectorAll('.workbench-shell .center-pane'))
      .find(function (el) { return el.getBoundingClientRect().width > 0 && el.querySelector('.editor-wrap'); });
    var centerStyle = writingCenter ? win.getComputedStyle(writingCenter) : null;
    var centerAfter = writingCenter ? win.getComputedStyle(writingCenter, '::after') : null;
    var centerColor = centerStyle ? rgbOf(centerStyle.backgroundColor) : null;
    need('写作容器不铺玻璃底', !!centerColor && centerColor.a === 0
      && centerStyle.backgroundImage === 'none' && centerStyle.boxShadow === 'none'
      && centerStyle.backdropFilter === 'none',
      centerStyle ? [centerStyle.backgroundColor, centerStyle.backgroundImage, centerStyle.boxShadow, centerStyle.backdropFilter].join(' | ') : '缺少正文容器');
    need('写作容器无覆盖高光', !!centerAfter && (centerAfter.content === 'none' || centerAfter.display === 'none'),
      centerAfter ? 'content=' + centerAfter.content + ' background=' + centerAfter.backgroundImage : '缺少正文容器');
    var paperSurface = writingCenter && writingCenter.querySelector('.rich-host');
    var expectedPaper = doc.createElement('div');
    /* D7：稿纸让到 46% 之后叠层从 .55/.72 收到 .30/.42（latent-studio.css 稿纸一节）。
       仍用「赋值-读取」比字符串：浏览器自己序列化两侧，0.3/0.42 的写法差异不参与比较。 */
    expectedPaper.style.backgroundImage = 'linear-gradient(150deg, rgba(24,27,33,.30), rgba(12,14,18,.42))';
    need('稿纸材质与设计稿一致', !!paperSurface
      && win.getComputedStyle(paperSurface).backgroundImage === expectedPaper.style.backgroundImage,
      paperSurface ? win.getComputedStyle(paperSurface).backgroundImage : '缺少稿纸');

    /* 工具栏可见项与设计稿一致：只数 .editor-toolbar 里可见（offsetParent 非空）的 [data-act]。
       需要模板删按钮 + 皮肤隐藏清单两路都落地才绿；多余项按「必须不包含」清单单独列。 */
    if (width === 695 || width === 1280) {
      var wantActs = ['undo', 'redo', 'bold', 'italic', 'underline', 'strike', 'paragraph', 'h1', 'h2', 'h3', 'more-features', 'send'];
      var banActs = ['font-size', 'color', 'highlight', 'link', 'bookmark'];
      var actNodes = tb ? tb.querySelectorAll('[data-act]') : [];
      var actSeen = {}, actVisible = [];
      for (var ai2 = 0; ai2 < actNodes.length; ai2++) {
        var actKey = String(actNodes[ai2].getAttribute('data-act') || '');
        if (!actKey || actSeen[actKey]) continue;
        if (actNodes[ai2].offsetParent === null) continue;
        actSeen[actKey] = 1; actVisible.push(actKey);
      }
      var actMissing = [], actForbidden = [];
      for (var wi2 = 0; wi2 < wantActs.length; wi2++) if (!actSeen[wantActs[wi2]]) actMissing.push(wantActs[wi2]);
      for (var bi2 = 0; bi2 < banActs.length; bi2++) if (actSeen[banActs[bi2]]) actForbidden.push(banActs[bi2]);
      ev.toolbarActs = { visible: actVisible, missing: actMissing, forbidden: actForbidden };
      need('工具栏可见项与设计稿一致', actMissing.length === 0 && actForbidden.length === 0,
        '可见=[' + actVisible.join(',') + '] 缺失=[' + actMissing.join(',') + '] 不该出现=[' + actForbidden.join(',') + ']');
    }

    /* 10) 正文吃掉留白（2026-11 改判为分档）：章节栏脱流后 .center-pane 变成整幅宽，稿纸仍受
        --ls-col(44em=770px) 的可读性上限约束 —— 那是有意为之，不是「留白没吃掉」。
        故按档给比例：<=560 至少 0.85；560-1179 至少 0.78；>=1180 跳过（该档稿纸=min(44em,center)，
        比例天生偏低，判它只会逼人去破坏行宽上限）。
        0.78 的算式依据（阈值不能定在数学上不可达的数）：1000 档 center≈974、稿纸=min(44em,center)=770
        ⇒ 上限比例 770/974 = 0.791；阈值取 0.78 的含义是「除 44em 可读性上限造成的留白之外，不允许再有额外空隙」。
        把阈值抬到 0.8 会要求行宽上限提到 46em 以上，而 44em 是本轮明确认下的可读性上限（改它等于第二次放宽
        「正文行宽<=44em」），所以这里降阈值而不是抬上限。 */
    var fillMin = width >= 1180 ? -1 : width <= 560 ? 0.85 : 0.78;
    /* Workbench 有两个 .center-pane：modulePopped 的占位（默认 display:none，宽 0）和真正在用的那个。
       querySelector 抓到的是前者，所以必须按「有宽度」挑可见的那个，否则量出来永远是 0。 */
    var centerAll = doc.querySelectorAll('.center-pane');
    var centerEl = null;
    for (var ci = 0; ci < centerAll.length; ci++) {
      if (centerAll[ci].getBoundingClientRect().width > 0) { centerEl = centerAll[ci]; break; }
    }
    var centerRect = centerEl ? centerEl.getBoundingClientRect() : null;
    var paperRect = rh ? rh.getBoundingClientRect() : null;
    var fillRatio = (centerRect && centerRect.width > 0 && paperRect) ? paperRect.width / centerRect.width : -1;
    var fillRounded = Math.round(fillRatio * 1000) / 1000;
    if (fillMin < 0) {
      ev.paperFill = { paper: paperRect ? Math.round(paperRect.width) : null, center: centerRect ? Math.round(centerRect.width) : null, ratio: fillRounded, skipped: '>=1180' };
      need('正文吃掉留白', true, '跳过：>=1180 稿纸=min(44em,center)，44em 是刻意的可读性上限；实际比例=' + fillRounded
        + ' paper=' + (paperRect ? Math.round(paperRect.width) : 'n/a') + ' center=' + (centerRect ? Math.round(centerRect.width) : 'n/a'));
    } else if (!centerRect) {
      ev.paperFill = { paper: paperRect ? Math.round(paperRect.width) : null, center: '未找到可见', candidates: centerAll.length };
      need('正文吃掉留白', true, '跳过：未找到可见 .center-pane（候选 ' + centerAll.length + ' 个，宽度全为 0）paper='
        + (paperRect ? Math.round(paperRect.width) : 'n/a') + ' 视口=' + width);
    } else {
      ev.paperFill = { paper: Math.round(paperRect.width), center: Math.round(centerRect.width), ratio: fillRounded, min: fillMin };
      need('正文吃掉留白', fillRatio >= fillMin,
        '实际比例=' + fillRounded + ' 阈值>=' + fillMin + ' 档位=' + (width <= 560 ? '<=560' : '560-1179')
        + ' paper=' + Math.round(paperRect.width) + ' center=' + Math.round(centerRect.width) + ' 视口=' + width);
    }

    /* 10.5) 版心必须真的是 44em：承诺的 770px 曾被稿纸内边距扣成 658（2026-11 五改前的实测）。
       面板装得下就要求 42~44.6em；稿纸被面板卡住（paper 已经顶满 center）时只守上界。 */
    var tpM = doc.querySelector('.rich-host .tiptap') || doc.querySelector('.tiptap');
    var textEm = tpM ? tpM.getBoundingClientRect().width / 17.5 : -1;
    var paperWm = paperRect ? paperRect.width : -1;
    var centerWm = centerRect ? centerRect.width : -1;
    /* 版心承诺：min(44em, 稿纸宽 − 2×内边距)。面板装不下 44em 时由这条上限接管。 */
    var padL = rh ? parseFloat(win.getComputedStyle(rh).paddingLeft) || 0 : 0;
    var availEm = (paperWm - 2 * padL) / 17.5;
    var wantEm = Math.min(44, availEm);
    var textEmRounded = Math.round(textEm * 10) / 10;
    var wantRounded = Math.round(wantEm * 10) / 10;
    ev.paperMeasure = { textEm: textEmRounded, want: wantRounded, paper: Math.round(paperWm), center: Math.round(centerWm), pad: Math.round(padL) };
    need('版心回归 44em',
      textEm > 0 && textEm <= 44.6 && textEm >= wantEm - 1,
      '版心=' + textEmRounded + 'em，应为 ' + wantRounded + 'em（= min(44, 稿纸 ' + Math.round(paperWm) + ' − 2×' + Math.round(padL) + ') ，面板 ' + Math.round(centerWm) + '）');

    /* 11) 胶囊不压正文（2026-11 四改口径）：胶囊是竖列、落进卡片左右页边 —— 压卡片内距是设计，压文字不行。
        比较对象因此换成正文文字盒（.tiptap）与章名（.title-input），零相交即通过。 */
    var tp2 = doc.querySelector('.rich-host .tiptap') || doc.querySelector('.tiptap');
    var tpBox = tp2 ? tp2.getBoundingClientRect() : null;
    var titleEl2 = doc.querySelector('.editor-head .title-input');
    var tr2 = titleEl2 ? titleEl2.getBoundingClientRect() : null;
    /* +1px 容差：只看"真的压上去"，贴边不算 */
    var boxHit = function (a, b) {
      if (!a || !b) return false;
      return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
    };
    [['左', '.ol-side-rail'], ['右', '.rp-rail']].forEach(function (pair) {
      var el = doc.querySelector(pair[1]);
      var r = el ? el.getBoundingClientRect() : null;
      var hit = boxHit(r, tpBox) || boxHit(r, tr2);
      var cs = el ? win.getComputedStyle(el) : null;
      var txt = el ? el.querySelector('.rail-text, .rp-rail-text') : null;
      var txtCs = txt ? win.getComputedStyle(txt) : null;
      var txtMode = txtCs ? String(txtCs.writingMode) : '';
      var animName = txtCs ? String(txtCs.animationName) : '';
      ev['capsule' + (pair[0] === '左' ? 'Left' : 'Right')] = r
        ? { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), position: cs.position, textMode: txtMode, animation: animName }
        : '未渲染';
      need('胶囊不压正文（' + pair[0] + '）', !r || !hit,
        r ? (pair[0] + '胶囊 x' + Math.round(r.left) + ' y' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
          + ' 正文文字 left=' + (tpBox ? Math.round(tpBox.left) : 'n/a') + ' 章名 left=' + (tr2 ? Math.round(tr2.left) : 'n/a') + ' 相交=' + hit)
          : '跳过：' + pair[1] + ' 未渲染');
      if (r) {
        /* 形态判据：脱流 + 竖列（宽<=28、高<=120、内部文字竖排） */
        need('胶囊是脱流竖列胶囊（' + pair[0] + '）',
          cs.position === 'absolute' && r.width <= 28 && r.height <= 120 && txtMode.indexOf('vertical') === 0,
          'position=' + cs.position + ' 尺寸=' + Math.round(r.width) + 'x' + Math.round(r.height) + ' 文字 writing-mode=' + txtMode
            + '（要求 absolute / 宽<=28 / 高<=120 / 竖排）');
        need('胶囊有呼吸微光（' + pair[0] + '）',
          animName.indexOf('ls-capsule-breath') >= 0 && txtCs.animationPlayState !== 'paused',
          'animation=' + (animName || '(空)') + ' playState=' + (txtCs ? txtCs.animationPlayState : 'n/a'));
      }
    });

    /* 11.5) 顶部让位带已释放：章头贴回顶栏下沿（原来给胶囊留的 34/30px 已还给正文） */
    var headTopEl = doc.querySelector('.editor-head');
    var headMt = headTopEl ? Math.round(parseFloat(win.getComputedStyle(headTopEl).marginTop) * 10) / 10 : -1;
    ev.headTopBand = { marginTop: headMt };
    need('顶部让位带已释放', headMt >= 0 && headMt <= 8, '章头 margin-top=' + headMt + 'px（要求<=8，原为 34/30）');

    /* 12.5) 正文左缘：标题 / 工具栏 / 稿纸必须同一条左线，且都不贴视口边。
       用户两次反馈「正文左侧完全顶着边框」——根源是 ≤899 档 --ls-gutter 被归零换取正文宽度，
       head/toolbar/paper 一起贴到 x=0（首字还会被裁）。这里把"留白"与"三块对齐"都量住。 */
    var headEl3 = doc.querySelector('.editor-head');
    var tbEl3 = doc.querySelector('.editor-toolbar');
    var paperEl3 = rh;
    var lefts3 = [headEl3, tbEl3, paperEl3].filter(Boolean).map(function (el) { return Math.round(el.getBoundingClientRect().left); });
    var minL3 = lefts3.length ? Math.min.apply(null, lefts3) : -1;
    var maxL3 = lefts3.length ? Math.max.apply(null, lefts3) : -1;
    ev.paperLeft = {
      head: headEl3 ? Math.round(headEl3.getBoundingClientRect().left) : null,
      toolbar: tbEl3 ? Math.round(tbEl3.getBoundingClientRect().left) : null,
      paper: paperEl3 ? Math.round(paperEl3.getBoundingClientRect().left) : null
    };
    need('正文左缘留白且三块对齐',
      lefts3.length === 3 && minL3 >= 8 && (maxL3 - minL3) <= 2,
      'head=' + ev.paperLeft.head + ' toolbar=' + ev.paperLeft.toolbar + ' paper=' + ev.paperLeft.paper
        + '（要求三块相差<=2，且最小值>=8）');

    /* 13) 两种收起方式对齐（2026-11 改判）：「.side-foot 必须不可见」那半作废 ——
       .side-foot 现在是「＋ 新建章 / 新建卷」的家（ChapterTree.vue:321-323），必须可见；
       可见性改由「新建章/卷在底部」正向判。本条只留「章节栏收起键 与 批注栏 .rp-fold 同尺寸（各差 <=2px）」。
       ≥1180 两栏常驻，.rp-fold 必须量得到；<1180 批注栏默认关闭是另一条断言的要求，此处只记录不比尺寸。 */
    var headAny = doc.querySelector('.side-panel .side-head') || doc.querySelector('.side-head');
    var footEl = doc.querySelector('.side-panel .side-foot') || doc.querySelector('.side-foot');
    var footCs = footEl ? win.getComputedStyle(footEl) : null;
    var footVis = !!footEl && footCs.display !== 'none' && footEl.getBoundingClientRect().height > 0;
    var sideFold = doc.querySelector('.side-panel .side-fold') || doc.querySelector('.side-head .side-fold')
      || doc.querySelector('.side-head [aria-label*="收起章节栏"]') || doc.querySelector('[aria-label*="收起章节栏"]');
    var rpFold = doc.querySelector('.rp-fold');
    var sfRect = sideFold ? sideFold.getBoundingClientRect() : null;
    var rfRect = rpFold ? rpFold.getBoundingClientRect() : null;
    var sizeOk, sizeEv;
    if (!sfRect) { sizeOk = false; sizeEv = '未找到章节栏收起键'; }
    else if (!rfRect) { sizeOk = width < 1180; sizeEv = '批注栏收起键未渲染（' + (width < 1180 ? '该档批注栏默认关闭，跳过比尺寸' : '≥1180 必须量得到') + '）'; }
    else { sizeOk = Math.abs(sfRect.width - rfRect.width) <= 2 && Math.abs(sfRect.height - rfRect.height) <= 2;
      sizeEv = '章节键=' + Math.round(sfRect.width) + 'x' + Math.round(sfRect.height) + ' 批注键=' + Math.round(rfRect.width) + 'x' + Math.round(rfRect.height) + '（各差<=2）'; }
    ev.collapse = {
      footPresent: !!footEl, footVisible: footVis, sideFold: sfRect ? Math.round(sfRect.width) + 'x' + Math.round(sfRect.height) : null,
      rpFold: rfRect ? Math.round(rfRect.width) + 'x' + Math.round(rfRect.height) : null
    };
    /* 章节栏没渲染出来就无从比尺寸（默认收起时就是这样），此时跳过不判负。 */
    if (!headAny) {
      ev.collapse = { headPresent: false, footPresent: !!footEl, footVisible: footVis };
      need('两种收起方式对齐', true, '跳过：章节栏未渲染（抽屉态）side-foot 可见=' + footVis + '（存在=' + !!footEl + '）');
    } else {
      need('两种收起方式对齐', sizeOk,
        'side-foot 可见=' + footVis + '（存在=' + !!footEl + '；它现在是新建按钮栏，可见性不再是判据）' + sizeEv);
    }

    /* 12) 695 专用（DSH 右侧面板真机宽度，夹在 380 与 760 之间最容易夹出挤压）：其他档位整块跳过。 */
    if (width === 695) {
      var okWrap = !!tb && tb.scrollHeight <= tb.clientHeight + 1;
      ev.toolbarWrap = { scrollHeight: tb ? tb.scrollHeight : -1, clientHeight: tb ? tb.clientHeight : -1, scrollWidth: swTb, clientWidth: cwTb };
      need('工具栏不换行', okWrap, tb ? ('scrollHeight=' + tb.scrollHeight + ' <= clientHeight=' + tb.clientHeight + '+1；scrollW=' + swTb + ' clientW=' + cwTb)
        : '未找到 .editor-toolbar');

      /* 章节栏顶条在窄档被压成单行可横滑工具条，首按钮容易因负 margin / 负偏移被裁掉左半。 */
      var headEl = doc.querySelector('.side-panel .side-head') || doc.querySelector('.side-head');
      var firstBtn = headEl ? headEl.querySelector('button') : null;
      var br = firstBtn ? firstBtn.getBoundingClientRect() : null;
      var pnlLeft = sp ? sp.getBoundingClientRect().left : 0;
      ev.sideHead = { buttonLeft: br ? Math.round(br.left) : null, panelLeft: sp ? Math.round(pnlLeft) : null, buttonW: br ? Math.round(br.width) : null };
      need('章节栏首按钮完整可见', !!br && !!sp && br.left >= pnlLeft + 2 && br.width >= 20,
        br ? ('button.left=' + Math.round(br.left) + ' panel.left=' + Math.round(pnlLeft) + ' button.w=' + Math.round(br.width))
          : (headEl ? '未找到 .side-head 里的 button' : '未找到 .side-head'));

      /* 章节名滚动播放：hover 态动画不稳定可测，改判可测等价物 —— 单行不折 + 用 clip 而非省略号 + 确实溢出，
         且样式表里真的注册了 st-marquee 关键帧（名字对不上就等于没做动效）。 */
      var maEl = doc.querySelector('[data-kind="chapter"]') || doc.querySelector('.n-tree-node-content__text');
      var maCs = maEl ? win.getComputedStyle(maEl) : null;
      var maWs = maCs ? String(maCs.whiteSpace) : '';
      var maTo = maCs ? String(maCs.textOverflow) : '';
      /* [data-kind] 那个 span 是行内的，scrollWidth/clientWidth 恒为 0；溢出必须量裁剪盒那一层。 */
      var maBox = null, maBoxTag = '无';
      if (maEl) {
        var c1 = maEl.closest ? maEl.closest('.n-tree-node-content__text') : null;
        var c2 = maEl.closest ? maEl.closest('.n-tree-node-content') : null;
        var maCands = [[c1, '__text'], [c2, '__content'], [maEl, 'self']];
        for (var mi = 0; mi < maCands.length; mi++) {
          if (maCands[mi][0] && maCands[mi][0].clientWidth > 0) { maBox = maCands[mi][0]; maBoxTag = maCands[mi][1]; break; }
        }
      }
      var maOver = !!maBox && maBox.scrollWidth > maBox.clientWidth;
      var hasKf = (function () {
        function walk(list) {
          for (var i = 0; i < list.length; i++) {
            var rl = list[i];
            try {
              if (rl.name && String(rl.name).indexOf('st-marquee') >= 0) return true;
              if (rl.cssRules && rl.cssRules.length && rl.name === undefined && walk(rl.cssRules)) return true;
            } catch (e) { /* 不可读规则跳过 */ }
          }
          return false;
        }
        var sheets = doc.styleSheets || [];
        for (var s = 0; s < sheets.length; s++) {
          try { if (walk(sheets[s].cssRules)) return true; } catch (e2) { /* 跨域样式表跳过 */ }
        }
        return false;
      })();
      ev.chapterMarquee = {
        whiteSpace: maWs, textOverflow: maTo, box: maBoxTag,
        scrollWidth: maBox ? maBox.scrollWidth : -1, clientWidth: maBox ? maBox.clientWidth : -1,
        overflow: maOver, keyframes: hasKf
      };
      if (!maEl) {
        need('章节名滚动播放', false, '未找到 [data-kind=chapter] / .n-tree-node-content__text');
      } else if (maBox && !maOver) {
        /* 标题本来就没超出裁剪盒时，「滚动播放」根本不会触发 —— 判跳过，不判负（种子标题短就会这样）。 */
        need('章节名滚动播放', true, '跳过：标题未溢出（种子标题较短）盒子=' + maBoxTag
          + ' scrollW=' + maBox.scrollWidth + ' clientW=' + maBox.clientWidth
          + ' white-space=' + maWs + ' text-overflow=' + maTo + ' st-marquee 关键帧=' + hasKf);
      } else {
        need('章节名滚动播放', maWs === 'nowrap' && maTo === 'clip' && hasKf && (!maBox || maOver),
          'white-space=' + maWs + ' text-overflow=' + maTo + ' 盒子=' + maBoxTag
          + ' scrollW=' + (maBox ? maBox.scrollWidth : 'n/a') + ' clientW=' + (maBox ? maBox.clientWidth : 'n/a')
          + (maBox ? '（溢出=' + maOver + '）' : '（裁剪盒宽 0，跳过溢出子条件）') + ' st-marquee 关键帧=' + hasKf);
      }

      var nodeText = doc.querySelector('.n-tree-node-content__text') || doc.querySelector('.n-tree-node-content');
      var cnt = doc.querySelector('.chapter-count');
      var ntw = nodeText ? String(win.getComputedStyle(nodeText).whiteSpace) : '';
      var ctw = cnt ? String(win.getComputedStyle(cnt).whiteSpace) : '';
      ev.chapterRows = { nodeWhiteSpace: ntw, countWhiteSpace: ctw, matched: nodeText ? 'node' : null };
      need('章节行不折行', !!nodeText && !!cnt && ntw === 'nowrap' && ctw === 'nowrap',
        nodeText ? ('章节行 white-space=' + ntw + '；.chapter-count white-space=' + ctw + (cnt ? '' : '（未找到 .chapter-count）'))
          : '未找到 .n-tree-node-content__text / .n-tree-node-content');

      /* 章节行左对齐：NTree 的层级缩进把章名推到栏左缘右侧 29-45px，用户要求贴左（<=16）。
         .side-panel 在抽屉态不渲染，此时跳过而不是判负。 */
      if (!sp) {
        ev.chapterIndent = { panel: '未渲染' };
        need('章节行左对齐', true, '跳过：.side-panel 未渲染（抽屉态）');
      } else {
        var firstChap = doc.querySelector('.side-panel [data-kind="chapter"]') || doc.querySelector('[data-kind="chapter"]');
        var ncRect = firstChap ? firstChap.getBoundingClientRect() : null;
        var panelRect = sp.getBoundingClientRect();
        var indent = ncRect ? Math.round(ncRect.left - panelRect.left) : -1;
        ev.chapterIndent = { nameLeft: ncRect ? Math.round(ncRect.left) : null, panelLeft: Math.round(panelRect.left), diff: indent };
        need('章节行左对齐', !!ncRect && indent <= 16,
          ncRect ? ('名字 left=' + Math.round(ncRect.left) + ' 栏 left=' + Math.round(panelRect.left) + ' 差=' + indent + '（要求<=16）')
            : '未找到 [data-kind=chapter]');
      }

      /* 章节名自动滚动（不靠悬停）：长标题节点必须挂 .is-marquee，计算样式 animationName=st-marquee 且没被 paused；
         短标题节点不该带这个类（否则全栏都在滚）。没有溢出节点时跳过。 */
      var chapAll = doc.querySelectorAll('[data-kind="chapter"]');
      var longEl = null, shortEl = null;
      for (var ni = 0; ni < chapAll.length; ni++) {
        var nd = chapAll[ni];
        var bx = nd.closest ? (nd.closest('.n-tree-node-content__text') || nd.closest('.n-tree-node-content')) : null;
        var boxUse = (bx && bx.clientWidth > 0) ? bx : nd;
        var over = boxUse.scrollWidth > boxUse.clientWidth;
        if (over && !longEl) longEl = nd;
        if (!over && !shortEl) shortEl = nd;
      }
      if (!longEl) {
        ev.chapterMarqueeAuto = { long: '无溢出节点' };
        need('章节名自动滚动', true, '跳过：没有溢出的章标题（种子标题都较短）');
      } else {
        var lcs = win.getComputedStyle(longEl);
        var hasMq = !!(longEl.classList && longEl.classList.contains('is-marquee'));
        var anm = String(lcs.animationName || '');
        var aps = String(lcs.animationPlayState || '');
        var shortHas = shortEl && shortEl.classList ? shortEl.classList.contains('is-marquee') : null;
        ev.chapterMarqueeAuto = { hasClass: hasMq, animationName: anm, playState: aps, shortHasClass: shortHas };
        need('章节名自动滚动', hasMq && anm === 'st-marquee' && aps !== 'paused' && shortHas !== true,
          '长标题 .is-marquee=' + hasMq + ' animationName=' + (anm || '(空)') + ' animationPlayState=' + (aps || '(空)')
          + '；短标题 hasClass=' + (shortEl ? shortHas : '无短标题'));
      }

      /* 新建章/卷在底部：.side-foot 里两颗按钮文案分别含「新建章」「新建卷」，且都在 .side-list 下方。 */
      var footBox = doc.querySelector('.side-panel .side-foot') || doc.querySelector('.side-foot');
      var listBox = doc.querySelector('.side-panel .side-list') || doc.querySelector('.side-list');
      var fbtns = footBox ? footBox.querySelectorAll('button') : [];
      var newChapBtn = null, newVolBtn = null;
      for (var bi = 0; bi < fbtns.length; bi++) {
        var btx = String(fbtns[bi].textContent || '');
        if (btx.indexOf('新建章') >= 0 && !newChapBtn) newChapBtn = fbtns[bi];
        if (btx.indexOf('新建卷') >= 0 && !newVolBtn) newVolBtn = fbtns[bi];
      }
      var listTop = listBox ? Math.round(listBox.getBoundingClientRect().top) : null;
      var chapTop = newChapBtn ? Math.round(newChapBtn.getBoundingClientRect().top) : null;
      var volTop = newVolBtn ? Math.round(newVolBtn.getBoundingClientRect().top) : null;
      ev.sideFootButtons = {
        count: fbtns.length, newChapter: newChapBtn ? String(newChapBtn.textContent || '').trim().slice(0, 12) : null,
        newVolume: newVolBtn ? String(newVolBtn.textContent || '').trim().slice(0, 12) : null,
        listTop: listTop, chapTop: chapTop, volTop: volTop
      };
      need('新建章/卷在底部', !!newChapBtn && !!newVolBtn && listTop !== null && chapTop > listTop && volTop > listTop,
        footBox ? ('共 ' + fbtns.length + ' 颗：' + (newChapBtn ? '「' + String(newChapBtn.textContent || '').trim().slice(0, 12) + '」top=' + chapTop : '无「新建章」')
          + '；' + (newVolBtn ? '「' + String(newVolBtn.textContent || '').trim().slice(0, 12) + '」top=' + volTop : '无「新建卷」')
          + '；.side-list top=' + (listTop === null ? '未找到' : listTop))
          : '未找到 .side-foot');
    }

    /* 写作顶部版式（695 / 1280 / 380 都测；380 用来验窄档是否换了字体口径）：.editor-head 里的英文头、短横线、进度轨、字数右端对齐。
       设计《正文·伏案静水》的头部是 .ed-latin / .ed-rule / .ed-goal(进度轨 + 「字数 / 目标 字」)：
       原 .ed-hairline 与底部 .ed-head-foot 已按设计稿合并进 .ed-goal（见 latent-studio.css §8.5）。 */
    if (width === 695 || width === 1280 || width === 544 || width === 380) {
      var headBox = doc.querySelector('.editor-head');
      var headR = headBox ? headBox.getBoundingClientRect() : null;
      var latin = doc.querySelector('.editor-head .ed-latin') || doc.querySelector('.ed-latin');
      var rule = doc.querySelector('.editor-head .ed-rule') || doc.querySelector('.ed-rule');
      var track = doc.querySelector('.editor-head .ed-goal .goal-track') || doc.querySelector('.goal-track');
      var goalEl = doc.querySelector('.editor-head .ed-goal') || doc.querySelector('.ed-goal');
      var goalText = doc.querySelector('.editor-head .ed-goal .goal-text') || doc.querySelector('.goal-text');
      var footBar = doc.querySelector('.editor-foot');
      var latinText = latin ? String(latin.textContent || '').trim() : '';
      ev.edHead = { latin: latin ? latinText : null, ruleW: rule ? Math.round(rule.getBoundingClientRect().width) : null, trackW: track ? Math.round(track.getBoundingClientRect().width) : null };
      need('顶部版式 ed-latin', !!latin && /^CHAPTER/i.test(latinText), latin ? ('textContent=' + latinText) : '未找到 .ed-latin');
      need('顶部版式 ed-rule', !!rule && Math.abs(rule.getBoundingClientRect().width - 42) <= 4,
        rule ? ('width=' + Math.round(rule.getBoundingClientRect().width) + '（要求 42±4）') : '未找到 .ed-rule');
      need('顶部版式 goal-track', !!track && track.getBoundingClientRect().width >= 120,
        track ? ('width=' + Math.round(track.getBoundingClientRect().width) + '（要求>=120）') : '未找到 .ed-goal .goal-track');
      /* 设计稿头部没有底部字数条：它已并入 .ed-goal，这里守住「不许回来」。 */
      need('底部字数条已移除', !footBar, footBar ? '仍存在 .editor-foot' : '无 .editor-foot');
      need('工具栏主行按设计不挤入状态历史', !doc.querySelector('.editor-toolbar > .editor-bar-status'),
        '主行状态历史组=' + !!doc.querySelector('.editor-toolbar > .editor-bar-status'));
      if (width >= 544) {
        var sendButton = doc.querySelector('.editor-toolbar [data-act="send"]');
        var sendRect = sendButton && sendButton.getBoundingClientRect();
        var toolbarRect = tb && tb.getBoundingClientRect();
        need('发送入口完整可见', !!sendRect && !!toolbarRect && sendRect.left >= toolbarRect.left
          && sendRect.right <= toolbarRect.right + 1,
          sendRect ? '发送右缘=' + Math.round(sendRect.right) + ' 工具栏右缘=' + Math.round(toolbarRect.right) : '缺少发送入口');
      }
      /* 字数那串：设计稿把「N / M 字」放在 .ed-goal 的最右端（进度轨 flex:1 把它顶到右缘），
         量它右端与 .editor-head 右端的距离；缺 .goal-text 时退回 .ed-goal 自身。 */
      var wcEl = goalText || goalEl;
      var wcR = wcEl ? wcEl.getBoundingClientRect() : null;
      var rightGap = (wcR && headR) ? Math.round(headR.right - wcR.right) : -1;
      ev.edHeadFoot = { found: !!wcEl, text: wcEl ? String(wcEl.textContent || '').trim().slice(0, 24) : null, rightGap: rightGap };
      /* 字体探针（1280，只记录不判红）：设计稿正文是宋体，这里要把「实际生效的 font-family」与
         「所有命中 .tiptap 且声明 font-family 的规则」一起交出去，避免再靠读 CSS 猜哪条赢。 */
      if (width === 1280 || width === 760 || width === 695 || width === 544 || width === 380) {
        var tpEl = doc.querySelector('.rich-host .rich-inner .tiptap') || doc.querySelector('.tiptap');
        var tpCs = tpEl ? win.getComputedStyle(tpEl) : null;
        var famRules = [];
        try {
          var sheets = doc.styleSheets;
          for (var si = 0; si < sheets.length; si++) {
            var list = null;
            try { list = sheets[si].cssRules; } catch (e0) { continue; }
            for (var ri = 0; ri < list.length; ri++) {
              var rr = list[ri];
              if (!rr || !rr.selectorText || !rr.style) continue;
              var fv = rr.style.getPropertyValue('font-family');
              if (!fv) continue;
              var parts = rr.selectorText.split(',');
              for (var pi = 0; pi < parts.length; pi++) {
                var sel = parts[pi].trim();
                var hit = false;
                try { hit = !!tpEl && tpEl.matches(sel); } catch (e1) { hit = false; }
                if (hit) famRules.push(sel + ' => ' + fv + (rr.style.getPropertyPriority('font-family') ? ' !important' : ''));
              }
            }
          }
        } catch (e2) { famRules.push('扫描失败: ' + e2.message); }
        var barEl = doc.querySelector('.editor-toolbar .editor-bar-status');
        var barKids = [];
        if (barEl) {
          var bk = barEl.children;
          for (var bi = 0; bi < bk.length; bi++) barKids.push(String(bk[bi].className || bk[bi].tagName).slice(0, 22) + ':' + Math.round(bk[bi].getBoundingClientRect().width));
        }
        ev.fontProbe = {
          family: tpCs ? tpCs.fontFamily : null,
          size: tpCs ? tpCs.fontSize : null,
          lh: tpCs ? tpCs.lineHeight : null,
          inline: tpEl ? (tpEl.getAttribute('style') || '') : null,
          matched: famRules,
          bar: barEl ? { w: Math.round(barEl.getBoundingClientRect().width), kids: barKids } : null
        };
      }
      need('顶部版式 字数右对齐', !!wcR && !!headR && rightGap <= 12,
        wcR && headR ? ('字数 right=' + Math.round(wcR.right) + ' editor-head right=' + Math.round(headR.right) + ' 差=' + rightGap + '（要求<=12）')
          : (goalEl ? '未找到 .editor-head' : '未找到 .ed-goal'));
    }

    /* 稿纸是暗牌（D7 之后＝「暗 + 透」，三条缺一不可，缺一必黑底浮亮板或薄到字飘）：
       a. alpha ∈ (0, 0.6]：流动底要透上来，但不许薄到压不住底；
       b. 最坏底合成：纯白（背板推到最亮那一帧）→ 稿纸墨色按 alpha 叠上 → 再逐个叠它的渐变色标
          （D7 的 30%/42% 暗层，暗层越薄越亮，取最亮者），合成后的 WCAG 相对亮度 < 0.2；
       c. backdrop-filter 含 >=20px 的 blur：26px 磨砂把字和底隔开。
       真实背板还有 vignette/grain 压着，纯白因此是严格的上界（这条是收紧不是放宽）。 */
    if (width === 695 || width === 1000 || width === 1280) {
      var paperBg = rh ? String(win.getComputedStyle(rh).backgroundColor) : '';
      var paperCs = rh ? win.getComputedStyle(rh) : null;
      var paperCol = rh ? col(paperBg) : null;
      var paperBf = paperCs ? String(paperCs.backdropFilter || paperCs.webkitBackdropFilter || 'none') : 'none';
      var paperBlurAt = paperBf.indexOf('blur(');
      var paperBlurPx = paperBlurAt >= 0 ? parseFloat(paperBf.slice(paperBlurAt + 5)) : -1;
      var paperLum = -1, paperLumWorst = -1, paperStops = [];
      if (paperCol) {
        paperLum = Math.round(lum(paperCol) * 1000) / 1000;
        var paperBase = {
          r: paperCol.r * paperCol.a + 255 * (1 - paperCol.a),
          g: paperCol.g * paperCol.a + 255 * (1 - paperCol.a),
          b: paperCol.b * paperCol.a + 255 * (1 - paperCol.a), a: 1
        };
        paperLumWorst = -1;
        var paperPaint = paperCs ? String(paperCs.backgroundImage || 'none') : 'none';
        var paperTokens = ['rgba(', 'rgb(', 'color('], paperFrom = 0;
        while (paperFrom < paperPaint.length) {
          var paperAt = -1;
          for (var pti = 0; pti < paperTokens.length; pti++) {
            var hitAt = paperPaint.indexOf(paperTokens[pti], paperFrom);
            if (hitAt >= 0 && (paperAt < 0 || hitAt < paperAt)) paperAt = hitAt;
          }
          if (paperAt < 0) break;
          var endAt = paperPaint.indexOf(')', paperAt);
          if (endAt < 0) break;
          var paperStop = col(paperPaint.slice(paperAt, endAt + 1));
          if (paperStop) {
            paperStops.push(Math.round(paperStop.a * 1000) / 1000);
            /* 渐变的亮端最危险：暗层越薄，字越接近浮在亮底上，所以取各色标结果里最亮的那个 */
            var stopLum = lum({
              r: paperStop.r * paperStop.a + paperBase.r * (1 - paperStop.a),
              g: paperStop.g * paperStop.a + paperBase.g * (1 - paperStop.a),
              b: paperStop.b * paperStop.a + paperBase.b * (1 - paperStop.a), a: 1
            });
            if (stopLum > paperLumWorst) paperLumWorst = stopLum;
          }
          paperFrom = endAt + 1;
        }
        /* 拿不到渐变色标时退回「稿纸墨色直接压在纯白上」这条更严的线 */
        if (paperLumWorst < 0) paperLumWorst = lum(paperBase);
        paperLumWorst = Math.round(paperLumWorst * 1000) / 1000;
      }
      ev.paperTone = {
        backgroundColor: paperBg || null, alpha: paperCol ? paperCol.a : null, lum: paperLum,
        lumOverWhite: paperLumWorst, gradientAlphaStops: paperStops, backdropFilter: paperBf
      };
      need('稿纸是暗牌', !!paperCol && paperCol.a > 0 && paperCol.a <= 0.6
        && paperLumWorst >= 0 && paperLumWorst < 0.2 && paperBlurPx >= 20,
        rh ? ('backgroundColor=' + paperBg + ' alpha=' + (paperCol ? paperCol.a : 'n/a') + '（要求 (0, 0.6]）'
          + ' 合成纯白最坏底后亮度=' + paperLumWorst + '（要求 <0.2；渐变暗层 alpha=[' + paperStops.join(',') + ']）'
          + ' backdrop-filter=' + paperBf + '（要求 blur>=20px，实测 ' + paperBlurPx + 'px）')
          : '未找到 .rich-host');
    }

    /* 章节名不得压住字数：自动滚动只该在裁剪盒里平移，不能盖到右端的 .chapter-count 上。
       逐行量裁剪盒右端与字数左端，取最差的一行出证据；没有 .chapter-count 的行跳过，不判负。 */
    if (width === 695 || width === 1280) {
      if (!sp) {
        ev.rowOverlap = { panel: '未渲染' };
        need('章节名不压字数', true, '跳过：.side-panel 未渲染（抽屉态）');
      } else {
        var rows = doc.querySelectorAll('[data-kind="chapter"]');
        var worstDiff = -999, worst = null, judged = 0, skipped = 0;
        for (var ri = 0; ri < rows.length; ri++) {
          var rowBox = rows[ri].closest ? (rows[ri].closest('.n-tree-node-content__text') || rows[ri].closest('.n-tree-node-content')) : null;
          if (!rowBox) continue;
          var rowWrap = rowBox.closest ? (rowBox.closest('.n-tree-node-content') || rowBox.parentElement) : rowBox.parentElement;
          var cntEl = rowWrap ? rowWrap.querySelector('.chapter-count') : null;
          if (!cntEl) { skipped++; continue; }
          var tbRect = rowBox.getBoundingClientRect(), ctRect = cntEl.getBoundingClientRect();
          var diff = Math.round(tbRect.right - ctRect.left);
          judged++;
          if (diff > worstDiff) {
            worstDiff = diff;
            worst = { textRight: Math.round(tbRect.right), countLeft: Math.round(ctRect.left), diff: diff };
          }
        }
        ev.rowOverlap = { rows: rows.length, judged: judged, skippedNoCount: skipped, worst: worst };
        if (!judged) {
          need('章节名不压字数', true, '跳过：没有带 .chapter-count 的章行');
        } else {
          need('章节名不压字数', worstDiff <= 1,
            '文本 right=' + worst.textRight + ' 字数 left=' + worst.countLeft + ' 差=' + worstDiff + '（要求<=1，判了 ' + judged + ' 行）');
        }
      }
    }
  } else if (module === 'settings' || module === 'settings-restore' || module === 'panel-settings') {
    /* ---- 设置工作区（2026-11-06 融合总稿 + T3 第 3 轮）：也坐在共享流动底上 ----
       SettingsWorkspace 自己挂 .st-backdrop-wrap > canvas.st-backdrop（与 Workbench / PanelHost 的背板
       逐字同构，三层 .st-layer dots/vignette/grain 照抄），引擎由 mountFlowBackdrop 驱动，取证钩子
       __nsSettingsBackdrop 形状也一致。原来这里写的是「设置页没有背板」，本轮翻转成三条硬判据：
       画布在、盒子与缓冲区都 >0 且盒子≈视口、后端只认 gpu|cpu。
       外壳铺满视口与皮肤落在隐现（dsh）照旧；精确 inset 与逐项版式由 settingsProbe 与 compare-settings.mjs 守。 */
    var sShell = doc.querySelector('.settings-shell');
    var sRect = sShell ? sShell.getBoundingClientRect() : null;
    ev.flowShell = sShell ? { sel: '.settings-shell', box: sRect ? { w: Math.round(sRect.width), h: Math.round(sRect.height) } : null } : '未找到 .settings-shell';
    need('设置外壳铺满视口', !!sRect && sRect.width >= win.innerWidth * 0.8 && sRect.height >= win.innerHeight * 0.7,
      sRect ? ('w=' + Math.round(sRect.width) + ' h=' + Math.round(sRect.height) + ' 视口=' + win.innerWidth + 'x' + win.innerHeight
        + '（要求宽 >=80% 视口、高 >=70%：外壳 inset 顶 108|166|158 会吃掉一条边）')
        : '未找到 .settings-shell');
    var sSkin = String(doc.body.getAttribute('data-skin') || '');
    need('设置页皮肤为隐现(dsh)', sSkin === 'dsh', 'body[data-skin]=' + (sSkin || '(空)') + '（期望 dsh：settings-fusion.css 全部规则的前缀）');
    var sWrap = doc.querySelector('.st-backdrop-wrap');
    var sCv = doc.querySelector('.st-backdrop-wrap > canvas.st-backdrop');
    var sLayers = doc.querySelectorAll('.st-backdrop-wrap .st-layer');
    var sCvRect = sCv ? sCv.getBoundingClientRect() : null;
    ev.settingsBackdrop = {
      wrap: !!sWrap, canvas: !!sCv, layers: sLayers.length,
      box: sCvRect ? { w: Math.round(sCvRect.width), h: Math.round(sCvRect.height) } : null,
      buffer: sCv ? { w: sCv.width, h: sCv.height } : null
    };
    need('设置页流动背板画布存在', !!sWrap && !!sCv && sLayers.length === 3,
      '实测 .st-backdrop-wrap=' + !!sWrap + '；.st-backdrop-wrap > canvas.st-backdrop=' + !!sCv + '；.st-layer=' + sLayers.length
        + '（期望 true / true / 3 = dots·vignette·grain）');
    need('设置页流动背板铺满视口', !!sCvRect && sCvRect.width > 0 && sCvRect.height > 0 && sCv.width > 0 && sCv.height > 0
      && Math.abs(sCvRect.width - win.innerWidth) <= 2 && Math.abs(sCvRect.height - win.innerHeight) <= 2,
      sCvRect ? ('实测 canvas 盒 ' + Math.round(sCvRect.width) + 'x' + Math.round(sCvRect.height) + '（视口 '
        + win.innerWidth + 'x' + win.innerHeight + '）、缓冲区 ' + sCv.width + 'x' + sCv.height + '（期望 盒≈视口 ±2 且缓冲区 >0）')
        : '未找到 canvas.st-backdrop');
    var sStatsFn = typeof win.__nsSettingsBackdrop === 'function' ? win.__nsSettingsBackdrop : null;
    if (!sStatsFn) {
      need('设置页背板后端与像素', false, '__nsSettingsBackdrop 缺失（设置页背板没挂或已卸载）');
    } else {
      var sStats = null, sStatsErr = '';
      try { sStats = sStatsFn(); } catch (eS) { sStatsErr = String(eS && eS.message || eS); }
      var sBackend = sStats && sStats.backend ? String(sStats.backend) : '';
      var sPx = sStats && sStats.pixels && sStats.pixels.length ? Number(sStats.pixels[0]) : -1;
      ev.settingsBackdropStats = { backend: sBackend, pixels0: sPx, renderer: sStats ? String(sStats.renderer || '') : '', scale: sStats ? sStats.scale : null };
      need('设置页背板后端与像素', (sBackend === 'gpu' || sBackend === 'cpu'),
        sStatsErr ? ('调用抛错: ' + sStatsErr)
          : ('backend=' + (sBackend || '(空)') + ' pixels[0]=' + sPx + ' renderer=' + String(sStats && sStats.renderer || '').slice(0, 40)
            + ' scale=' + (sStats ? sStats.scale : '?') + '（期望 gpu|cpu；形状与 __nsFlowBackdrop 一致）'));
    }
  } else {
    /* ---- 流动底铺满其余功能界面（大纲 / 设定 / 人物 / 灵感 + 拆窗面板，2026-11-05） ----
       这些页面没有 .latent-studio 祖先（它只挂在正文页），所以外壳一律按类名选：
       判据要考的是「画布在不在、铺没铺满」，不是「祖先类名对不对」。 */
    var fIsPanel = module.indexOf('panel-') === 0;
    var fShellSel = fIsPanel ? '.panel-host' : '.workbench-shell';
    var fShell = doc.querySelector(fShellSel);
    var fCvSel = fShellSel + ' canvas.st-backdrop';
    ev.flowShell = fShell ? {
      sel: fShellSel,
      dataFlow: fShell.getAttribute('data-flow'),
      module: fShell.getAttribute('data-module'),
      wrap: !!doc.querySelector(fShellSel + ' .st-backdrop-wrap'),
      layers: doc.querySelectorAll(fShellSel + ' .st-backdrop-wrap .st-layer').length
    } : '未找到 ' + fShellSel;

    /* a) 画布铺满视口：与正文页同一套上下界，只量几何不判属性尺寸 ——
       缺 CSS 约束时 <canvas> 会按属性尺寸参与布局，元素仍在、画面却是空屏。 */
    var fCv = doc.querySelector(fCvSel);
    var fRect = fCv ? fCv.getBoundingClientRect() : null;
    ev.flowRect = fRect ? { w: Math.round(fRect.width), h: Math.round(fRect.height), top: Math.round(fRect.top), left: Math.round(fRect.left) } : null;
    need('流动底铺满视口', !!fRect
      && fRect.width >= win.innerWidth * 0.9 && fRect.width <= win.innerWidth * 1.5
      && fRect.height >= win.innerHeight * 0.6 && fRect.height <= win.innerHeight * 1.5
      && Math.abs(fRect.top) <= 4 && Math.abs(fRect.left) <= 4,
      fRect ? ('w=' + Math.round(fRect.width) + ' h=' + Math.round(fRect.height) + ' 视口=' + win.innerWidth + 'x' + win.innerHeight
        + ' top=' + Math.round(fRect.top) + ' left=' + Math.round(fRect.left) + '（要求宽 0.9~1.5、高 0.6~1.5 视口，且左上角贴 0±4）')
        : ('未找到 ' + fCvSel));

    /* b) 后端自证：接受 gpu|cpu；gpu 必须真出像素（cpu 兜底是逐像素位图，pixels 允许为空）。 */
    var fStatsFn = typeof win.__nsFlowBackdrop === 'function' ? win.__nsFlowBackdrop
      : (typeof win.__nsStudioBackdrop === 'function' ? win.__nsStudioBackdrop : null);
    if (!fStatsFn) {
      need('流动底后端与像素', false, '__nsFlowBackdrop 与 __nsStudioBackdrop 都缺失');
    } else {
      var fStats = null, fStatsErr = '';
      try { fStats = fStatsFn(); } catch (e1) { fStatsErr = String(e1 && e1.message || e1); }
      var fBackend = fStats && fStats.backend ? String(fStats.backend) : '';
      var fPx0 = fStats && fStats.pixels && fStats.pixels.length ? Number(fStats.pixels[0]) : -1;
      var fVia = fStatsFn === win.__nsFlowBackdrop ? '__nsFlowBackdrop' : '__nsStudioBackdrop';
      ev.flowStats = { backend: fBackend, pixels0: fPx0, renderer: fStats ? String(fStats.renderer || '') : '', via: fVia };
      need('流动底后端与像素', (fBackend === 'gpu' || fBackend === 'cpu') && (fBackend !== 'gpu' || fPx0 > 0),
        fStatsErr ? '调用抛错: ' + fStatsErr
          : 'backend=' + (fBackend || '(空)') + ' pixels[0]=' + fPx0 + ' via=' + fVia + '（接受 gpu|cpu；gpu 要求 pixels[0]>0）');
    }

    /* c) 玻璃能透底：侧栏/批注栏 62%、主区 52%，判「计算背景色 alpha<=0.75 且 backdrop-filter 含 blur」。
       alpha 大了等于把实底铺回来，没有 blur 则流动底糊成一块灰板，两条缺一不可。
       color-mix() 的计算值序列化成 color(srgb … / a)，正文页那套 col/comp 只认 rgb()，
       所以这里自带一套解析与合成，不去动正文页的既有实现。
       大纲的 .oc-node 纸卡按设计保持现状，不被本条（也不被任何一条新判据）判。 */
    function fColor(v) {
      var s = String(v || '').trim();
      var low = s.toLowerCase();
      if (!low || low === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      var open = s.indexOf('('), close = s.lastIndexOf(')');
      if (open < 0 || close < open) return null;
      var head = low.slice(0, open);
      var body = s.slice(open + 1, close);
      var isColorFn = head.indexOf('color') === 0;
      var hasSlash = body.indexOf('/') >= 0;
      var alphaText = '';
      if (hasSlash) {
        var at = body.indexOf('/');
        alphaText = body.slice(at + 1);
        body = body.slice(0, at);
      }
      var toks = body.split(',').join(' ').split(' ').filter(function (t) { return t !== ''; });
      if (isColorFn) toks.shift();                                   /* 丢掉颜色空间名（srgb） */
      else if (!hasSlash && toks.length >= 4) alphaText = toks.pop(); /* 旧式 rgba(r,g,b,a) */
      if (toks.length < 3) return null;
      var nums = [parseFloat(toks[0]), parseFloat(toks[1]), parseFloat(toks[2])];
      if (isNaN(nums[0]) || isNaN(nums[1]) || isNaN(nums[2])) return null;
      var unit = isColorFn ? 255 : 1;                                /* color(srgb) 的分量是 0~1 */
      var a = alphaText ? parseFloat(alphaText) : 1;
      return { r: nums[0] * unit, g: nums[1] * unit, b: nums[2] * unit, a: isNaN(a) ? 1 : a };
    }
    function fBgAt(el) {
      var stack = [], node = el, guard = 0;
      while (node && guard++ < 12) {
        var c = fColor(win.getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
        node = node.parentElement;
      }
      /* 链路全透明时兜底宿主底 #151517（HARNESS 里 --dsw-alias-bg-base 同值） */
      if (!stack.length || stack[stack.length - 1].a < 0.999) stack.push({ r: 21, g: 21, b: 23, a: 1 });
      var out = stack[stack.length - 1];
      for (var fbi = stack.length - 2; fbi >= 0; fbi--) {
        var t = stack[fbi];
        out = { r: t.r * t.a + out.r * (1 - t.a), g: t.g * t.a + out.g * (1 - t.a), b: t.b * t.a + out.b * (1 - t.a), a: 1 };
      }
      return out;
    }
    function fRelLum(c) {
      function chan(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
    }
    /* 设定改成面板矩阵后主区不再是 .center-pane：Workbench.vue:466 用 LoreWorkspace 顶掉了 :467
       的 .center-pane，页面上只剩 :458 那个 0 宽的口袋锁面板。故 lore 场景把「主区」指向
       .lore-pane[data-pane=main]，判据与阈值不变，其它模块仍走 .center-pane。 */
    /* 2026-11-05 人物工作区同样是面板矩阵：.center-pane 在人物页整块不渲染（Workbench.vue:464 被
       CharactersWorkspace 顶掉），主区改指 .char-pane[data-pane=main]，判据与阈值一个字不动。 */
    var fMainSel = module === 'lore' ? '.lore-pane[data-pane="main"]'
      : module === 'characters' ? '.char-pane[data-pane="main"]'
      : module === 'snippets' ? '.snip-main' : '.center-pane';
    var fGlassTargets = doc.querySelector('.ow-workspace') ? [['侧栏', '.ow-left'], ['主区', '.ow-main']]
      : module === 'snippets' ? [] : [['侧栏', '.side-panel'], ['主区', fMainSel]];
    /* 灵感页的外壳透明（流动底直接透上来），玻璃在片段卡上：按设计稿的 0.8~0.99 + blur 正向判一次。 */
    if (module === 'snippets') {
      var snipCard = doc.querySelector(fShellSel + ' .snip-note') || doc.querySelector('.snip-note');
      var snipCs = snipCard ? win.getComputedStyle(snipCard) : null;
      var snipCol = snipCs ? fColor(snipCs.backgroundColor) : null;
      var snipA = snipCol ? Math.round(snipCol.a * 1000) / 1000 : -1;
      var snipBf = snipCs ? String(snipCs.backdropFilter || snipCs.webkitBackdropFilter || 'none') : 'none';
      ev.flowGlass = { card: snipCs ? { backgroundColor: snipCs.backgroundColor, alpha: snipA, backdropFilter: snipBf } : '未渲染' };
      need('灵感卡片是暗紫玻璃（半透明+模糊）', !!snipCs && snipA >= 0.8 && snipA <= 0.99 && snipBf.indexOf('blur(') >= 0,
        snipCs ? 'background-color=' + snipCs.backgroundColor + ' alpha=' + snipA + '（要求 0.8~0.99）backdrop-filter=' + snipBf
          : '未找到 .snip-note（该档没有卡片：检查 HARNESS 的灵感种子）');
      var snipShell = doc.querySelector(fShellSel + ' .snip-shell') || doc.querySelector('.snip-shell');
      var snipShellCs = snipShell ? win.getComputedStyle(snipShell) : null;
      var snipShellCol = snipShellCs ? fColor(snipShellCs.backgroundColor) : null;
      var snipShellA = snipShellCol ? Math.round(snipShellCol.a * 1000) / 1000 : -1;
      need('灵感外壳不铺实底（流动底透上来）', !!snipShell && snipShellA <= 0.8,
        snipShell ? 'background-color=' + snipShellCs.backgroundColor + ' alpha=' + snipShellA + '（要求<=0.8）' : '未找到 .snip-shell');
    }
    var fGlassEv = {};
    for (var fgi = 0; fgi < fGlassTargets.length; fgi++) {
      var fGLabel = fGlassTargets[fgi][0];
      var fGSel = fShellSel + ' ' + fGlassTargets[fgi][1];
      var fGEls = doc.querySelectorAll(fGSel);
      var fGEl = null;
      for (var fgj = 0; fgj < fGEls.length; fgj++) {
        if (fGEls[fgj].getBoundingClientRect().width > 0) { fGEl = fGEls[fgj]; break; }
      }
      if (!fGEl) {
        /* 抽屉态没有这一栏就无从量玻璃：跳过不判负（与正文页抽屉态同一口径），证据里写明原因。 */
        fGlassEv[fGLabel] = '未渲染';
        need('玻璃可透底（' + fGLabel + '）', true, '跳过：' + fGSel + ' 未渲染（候选 ' + fGEls.length + ' 个，宽度全为 0）');
        continue;
      }
      var fGCs = win.getComputedStyle(fGEl);
      var fGCol = fColor(fGCs.backgroundColor);
      var fGAlpha = fGCol ? Math.round(fGCol.a * 1000) / 1000 : -1;
      var fGBf = String(fGCs.backdropFilter || fGCs.webkitBackdropFilter || 'none');
      var fGBlur = fGBf.indexOf('blur(') >= 0;
      fGlassEv[fGLabel] = { backgroundColor: fGCs.backgroundColor, alpha: fGAlpha, backdropFilter: fGBf };
      need('玻璃可透底（' + fGLabel + '）', fGAlpha >= 0 && fGAlpha <= 0.75 && fGBlur,
        'background-color=' + fGCs.backgroundColor + ' alpha=' + fGAlpha + '（要求<=0.75，流动底才透得上来）'
          + ' backdrop-filter=' + fGBf + '（要求含 blur）');
    }
    ev.flowGlass = fGlassEv;

    /* c2) 主区内容面不许自己铺实底：玻璃只算一层，若模块里还有一块不透明地面压在里面，
        .center-pane 的 alpha 仍然是 0.52（判据 c 照样绿），而屏幕上看到的是平板 ——
        outline 的 .outline-text-body（dsh.css:1640 的 --ns-bg）就是这么被漏掉的。
       这里按「该模块面积最大的那块内容面」判一次，宁可指定选择器，也不去猜祖先链。 */
    var fContentSel = {
      outline: ['.outline-text-body', '.oc-canvas-surface', '.oc-canvas'],
      lore: ['.ob-editor'],
      /* 2026-11-05 人物工作区换成面板矩阵：.character-surface 随旧组件一起删了，
         主区改指 .char-pane[data-pane=main]（皮肤层 characters-fusion.css 给它 rgb(33 27 44 / .55)）。
         判据与阈值一个字不动，只换选择器。 */
      characters: ['.char-pane[data-pane=main]'],
      snippets: ['.snippet-surface']
    }[String(fShell.getAttribute('data-module') || '')] || null;
    if (fContentSel) {
      var fBiggest = null, fBiggestArea = 0;
      for (var fci = 0; fci < fContentSel.length; fci++) {
        var fCands = doc.querySelectorAll(fShellSel + ' ' + fContentSel[fci]);
        for (var fcj = 0; fcj < fCands.length; fcj++) {
          var fCr = fCands[fcj].getBoundingClientRect();
          var area = fCr.width * fCr.height;
          if (area > fBiggestArea) { fBiggestArea = area; fBiggest = fCands[fcj]; }
        }
      }
      if (!fBiggest) {
        need('主区内容面不吃实底', true, '跳过：' + fContentSel.join(' / ') + ' 均未渲染');
      } else {
        var fCCs = win.getComputedStyle(fBiggest);
        var fCCol = fColor(fCCs.backgroundColor);
        var fCAlpha = fCCol ? Math.round(fCCol.a * 1000) / 1000 : -1;
        ev.flowContent = { sel: String(fBiggest.className || ''), backgroundColor: fCCs.backgroundColor, alpha: fCAlpha, area: Math.round(fBiggestArea) };
        need('主区内容面不吃实底', fCAlpha >= 0 && fCAlpha <= 0.8,
          '元素=' + String(fBiggest.className || '').slice(0, 40) + ' background-color=' + fCCs.backgroundColor
            + ' alpha=' + fCAlpha + '（要求<=0.8：内容面自己铺实底会把流动底整块挡住）面积=' + Math.round(fBiggestArea));
      }
    }

    /* e) 正文对比度：玻璃透出的是会动的底，正文色落在最亮处也必须仍 >= 4.5:1。
       取样 = 正文区（可见的 .center-pane）逐级向上合成的背景；前景取该区的计算色，
       解析不出时按契约色 #f4efe6（本条要守的是「字读得清」，不是某一条色值字符串）。 */
    var fTextEl = null;
    var fTextCands = doc.querySelectorAll(fShellSel + ' ' + fMainSel);
    for (var fti = 0; fti < fTextCands.length; fti++) {
      if (fTextCands[fti].getBoundingClientRect().width > 0) { fTextEl = fTextCands[fti]; break; }
    }
    if (!fTextEl) {
      need('正文对比度>=4.5', false, '未找到可见的 ' + fShellSel + ' ' + fMainSel + '（候选 ' + fTextCands.length + ' 个，宽度全为 0）');
    } else {
      var fBg = fBgAt(fTextEl);
      var fFgColorText = String(win.getComputedStyle(fTextEl).color);
      var fFgRaw = fColor(fFgColorText);
      var fFg = fFgRaw || { r: 244, g: 239, b: 230, a: 1 };
      if (fFg.a < 1) fFg = { r: fFg.r * fFg.a + fBg.r * (1 - fFg.a), g: fFg.g * fFg.a + fBg.g * (1 - fFg.a), b: fFg.b * fFg.a + fBg.b * (1 - fFg.a), a: 1 };
      var fL1 = fRelLum(fBg), fL2 = fRelLum(fFg);
      var fRatio = Math.round(((Math.max(fL1, fL2) + 0.05) / (Math.min(fL1, fL2) + 0.05)) * 100) / 100;
      ev.flowContrast = {
        ratio: fRatio,
        bg: { r: Math.round(fBg.r), g: Math.round(fBg.g), b: Math.round(fBg.b) },
        fg: fFgRaw ? fFgColorText : '#f4efe6（计算色解析失败，按契约色）'
      };
      need('正文对比度>=4.5', fRatio >= 4.5,
        fRatio + ':1  bg=rgb(' + Math.round(fBg.r) + ',' + Math.round(fBg.g) + ',' + Math.round(fBg.b) + ')  fg=' + ev.flowContrast.fg);
    }

    /* d) 「浅色大块背景(>8%视口)=0」与「scrollWidth<=clientWidth」在 measure() 里对非书架场景一律生效，
       新增场景天然覆盖，此处不再另写一份。 */
  }
  /* ===== 设定 · 条目编写（整棵森林 / 玻璃直写 / 层级标题，2026-11-05 改造） =====
     判据只认"看得见的形态"：多集共存、层级字号分级、集头吸顶、工具条不吃底。
     逐条细节见 docs/前端美化/设定-融合总稿-20261105/ 的 A 视图。 */
  if (module === 'lore') {
    var lH1 = doc.querySelector('.lore-h1');
    var lEditor = doc.querySelector('.ob-editor');
    var lSets = doc.querySelectorAll('.lore-set-head');
    var lRows = doc.querySelectorAll('.ob-row');
    ev.lore = {
      h1: lH1 ? lH1.textContent.trim() : null,
      sets: lSets.length,
      rows: lRows.length,
      setNames: Array.prototype.map.call(lSets, function (x) { return (x.querySelector('.ls-name') || {}).textContent || ''; })
    };
    /* 【口径变更 2026-11-06：设定改成面板矩阵】默认 scope='set' 只渲染当前设定集，
       单集不画组头 —— 默认态「集头数」必须是 0。多集共存改在 loreMatrixProbe 里
       点 .lore-scope 切到 all 再数（那时每个集各一个 .lore-set-head）。 */
    need('设定默认单集不画组头', lSets.length === 0, '默认集头 ' + lSets.length + ' 个（scope=set 时要求 0）');
    var lApp = doc.querySelector('#app');
    var lPinia = lApp && lApp.__vue_app__ ? lApp.__vue_app__.config.globalProperties.$pinia : null;
    var lWs = lPinia ? lPinia._s.get('work') : null;
    ev.lore.debug = lWs ? { workId: lWs.work && lWs.work.id, mubu: lWs.mubu ? lWs.mubu.length : -1, roots: lWs.mubuRoots ? lWs.mubuRoots().length : -1, setId: lWs.mubuSetId, loaded: lWs.loaded } : 'no work store';
    need('设定树渲染条目行', lRows.length >= 6, '行 ' + lRows.length + ' 个 debug=' + JSON.stringify(ev.lore.debug));
    need('设定标题为当前层级名', !!lH1 && lH1.textContent.trim() === '地理与场所',
      lH1 ? ('h1=' + lH1.textContent.trim() + ' 期望=地理与场所') : '未找到 .lore-h1');
    need('设定页不再有写死的副标题', !doc.querySelector('.module-heading'),
      doc.querySelector('.module-heading') ? '仍存在 .module-heading' : 'ok');
    function lFsOf(sel) { var el = doc.querySelector(sel); return el ? parseFloat(win.getComputedStyle(el).fontSize) : -1; }
    var lF0 = lFsOf('.ob-row[data-depth="0"] .ob-text');
    var lF1 = lFsOf('.ob-row[data-depth="1"] .ob-text');
    var lF2 = lFsOf('.ob-row[data-depth="2"] .ob-text');
    ev.lore.fonts = [lF0, lF1, lF2];
    need('设定层级字号分级', lF0 > lF1 && lF1 >= lF2 && lF2 > 0, 'depth0=' + lF0 + ' depth1=' + lF1 + ' depth2=' + lF2);
    if (lEditor) {
      var lCs = win.getComputedStyle(lEditor);
      need('设定编辑区可滚动', lCs.overflowY === 'auto' || lCs.overflowY === 'scroll', 'overflow-y=' + lCs.overflowY);
    } else {
      need('设定编辑区可滚动', false, '未找到 .ob-editor');
    }
    /* 「集头吸顶对齐滚动口」依赖集头，而默认 scope=set 一个集头都不渲染：
       挪到 loreMatrixProbe 里先点 .lore-scope 切 all 再量，量完切回 set。 */
    var lTb = doc.querySelector('.ob-toolbar');
    if (lTb) {
      var lTbCol = rgbOf(win.getComputedStyle(lTb).backgroundColor);
      ev.lore.toolbarBg = win.getComputedStyle(lTb).backgroundColor;
      need('设定工具条不铺实底', !lTbCol || lTbCol.a <= 0.8, 'background=' + ev.lore.toolbarBg);
      need('设定工具条无边框', win.getComputedStyle(lTb).borderTopWidth === '0px' && win.getComputedStyle(lTb).borderLeftWidth === '0px',
        'border-top=' + win.getComputedStyle(lTb).borderTopWidth + ' border-left=' + win.getComputedStyle(lTb).borderLeftWidth);
    } else {
      need('设定工具条不铺实底', false, '未找到 .ob-toolbar');
      need('设定工具条无边框', false, '未找到 .ob-toolbar');
    }
    /* 三视图外壳（设计稿：同一工作区切换，不再有全屏详情页） */
    var lSwitch = doc.querySelectorAll('.lore-switch button');
    var lLabels = Array.prototype.map.call(lSwitch, function (x) { return x.textContent.trim(); }).join('/');
    ev.lore.switchItems = lLabels;
    need('设定三视图切换器', lSwitch.length === 3 && lLabels === '节点大纲/阅读视图/视觉导图',
      '切换项=' + lSwitch.length + ' → ' + lLabels);
    need('设定默认进入条目编写', !!doc.querySelector('.lore-switch button.on') && doc.querySelector('.lore-switch button.on').textContent.trim() === '节点大纲',
      '当前=' + (doc.querySelector('.lore-switch button.on') || {}).textContent);
    need('设定不再有全屏详情页', !doc.querySelector('.ldt-page'),
      doc.querySelector('.ldt-page') ? '仍存在 .ldt-page（fixed 全屏层）' : 'ok');
    /* 页头住进 main pane（设计稿 fusion-head）：A 有概要行；B/C 的 h1 与「无概要行」
       在 loreMatrixProbe 里切视图后判。 */
    var lMeta = doc.querySelector('.lore-pane[data-pane="main"] > .lore-head .lore-meta');
    need('设定页头 A 有概要行', !!lMeta, lMeta ? '「' + String(lMeta.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) + '」' : '未找到 .lore-head .lore-meta');
    need('设定页头住在 main pane', !!doc.querySelector('.lore-pane[data-pane="main"] > .lore-head'),
      doc.querySelector('.lore-pane[data-pane="main"] > .lore-head') ? 'ok' : '页头不在 .lore-pane[data-pane=main] 内');
    need('设定 A 视图不出同级条目列', !doc.querySelector('.lore-pane[data-pane="list"]') && !doc.querySelector('.lore-pane[data-pane="detail"]'),
      'list 列=' + !!doc.querySelector('.lore-pane[data-pane="list"]') + ' detail 列=' + !!doc.querySelector('.lore-pane[data-pane="detail"]') + '（A 只该有 nav + main）');
  }
  /* 拆窗面板没有 .app-topbar（它自带 .panel-topbar）：44/52/64 三档与右簇是主窗口契约，
     面板窗口不适用，只记证据不判负。 */
  if (module.indexOf('panel-') === 0) {
    var fPanelBar = doc.querySelector('.panel-host .panel-topbar');
    ev.panelTopbar = fPanelBar
      ? { present: true, h: Math.round(fPanelBar.getBoundingClientRect().height) }
      : { present: false, why: '未找到 .panel-host .panel-topbar' };
    return { items: items, evidence: ev };
  }
  var bar = doc.querySelector('.app-topbar');
  var strictOutline = !!doc.querySelector('.outline-topbar');
  var base = strictOutline ? 84 : topbarBase(width);
  var h = bar ? px(bar.getBoundingClientRect().height) : -1;
  ev.topbar = h;
  need('顶栏高 ' + base, h > 0 && Math.abs(h - base) <= 0.5, h + ' @' + width);

  /* 14) 顶栏右簇：宽档不该再有重复的 ⋯（模块在导航里、动作在右簇里），窄档必须留着它当唯一出口；
      锁定键（.app-topbar-pin）每个界面都要有：≥560 在顶栏内成圆钮，≤559 收进 ⋯ 菜单。 */
  var moreWrap = bar ? bar.querySelector('.app-topbar-more-wrap') : null;
  var moreRect = moreWrap ? moreWrap.getBoundingClientRect() : null;
  var moreVis = !!moreRect && moreRect.width > 0 && win.getComputedStyle(moreWrap).display !== 'none';
  var pinEl = bar ? bar.querySelector('.app-topbar-pin') : null;
  var pinRect = pinEl ? pinEl.getBoundingClientRect() : null;
  var pinVis = !!pinRect && pinRect.width > 0;
  var barRect = bar ? bar.getBoundingClientRect() : null;
  var pinInside = !!(pinRect && barRect) && pinRect.top >= barRect.top - 1 && pinRect.bottom <= barRect.bottom + 1
    && pinRect.left >= barRect.left - 1 && pinRect.right <= barRect.right + 1;
  ev.topbarCluster = {
    width: width,
    more: moreVis,
    pin: pinVis ? Math.round(pinRect.width) + 'x' + Math.round(pinRect.height) : '未渲染',
    pinInside: pinInside
  };
  /* 大纲那套是独立的 .outline-topbar（strictOutline 场景），不适用设计稿 AppTopbar 的四条 */
  if (!strictOutline) {
  /* 2026-11-05 顶栏按设计稿：六项模块导航（设置移出）＋ 右簇 ✓已保存 / 搜索 / 设置 / 锁定 圆钮 */
  var tnav = doc.querySelectorAll('.app-topbar .app-topnav [data-nav]');
  var tnavBox = doc.querySelector('.app-topbar .app-topnav');
  var tnavVis = !!tnavBox && tnavBox.getClientRects().length > 0;
  ev.topnav = { count: tnav.length, visible: tnavVis, hasSettingsItem: !!doc.querySelector('.app-topbar .app-topnav [data-nav="settings"]') };
  need('顶栏六项模块导航', tnav.length === 6 && !ev.topnav.hasSettingsItem,
    '导航项=' + tnav.length + ' 含设置=' + ev.topnav.hasSettingsItem);
  need('顶栏导航随宽度显隐', width <= 559 ? !tnavVis : tnavVis, 'visible=' + tnavVis + ' @' + width);
  var tRound = doc.querySelectorAll('.app-topbar .app-topbar-cluster .app-topbar-round');
  ev.topbarRounds = tRound.length;
  need('顶栏搜索与设置圆钮', tRound.length >= 2 && !!doc.querySelector('.app-topbar .app-topbar-settings') && !!doc.querySelector('.app-topbar .app-topbar-search-toggle'),
    '圆钮=' + tRound.length + ' settings=' + !!doc.querySelector('.app-topbar .app-topbar-settings'));
  var tSaveText = doc.querySelector('.app-topbar .app-topbar-save-text');
  need('顶栏保存文案', !!tSaveText && tSaveText.textContent.trim().length > 0,
    tSaveText ? ('文案=' + tSaveText.textContent.trim()) : '未找到 .app-topbar-save-text');

  }
  if (strictOutline) {
    need('大纲稿六项导航与设置入口', bar.querySelectorAll('.nav [data-nav]').length === 6 && !!bar.querySelector('[aria-label="设置"]'), '六项导航；锁定及拆窗收进设置菜单');
  } else if (width <= 559) {
    need('窄档保留 ⋯ 扩展', moreVis, '…宽=' + (moreRect ? Math.round(moreRect.width) : 'n/a') + ' display=' + (moreWrap ? win.getComputedStyle(moreWrap).display : 'n/a'));
    need('窄档锁定键收进 ⋯（顶栏不另占位）', !pinVis, pinVis ? '顶栏里仍渲染了锁定键 ' + ev.topbarCluster.pin : 'ok');
  } else {
    need('宽档不再有 ⋯ 扩展', !moreVis, moreVis ? '…仍在（宽=' + Math.round(moreRect.width) + '）' : 'ok');
    need('顶栏有锁定键且落在栏内', pinVis && pinInside && pinRect.height >= 24,
      'pin=' + ev.topbarCluster.pin + ' inside=' + pinInside + ' bar.top/bottom=' + (barRect ? Math.round(barRect.top) + '/' + Math.round(barRect.bottom) : 'n/a'));
  }

  if (module === 'shelf') {
    /* 书架满屏流动底压在顶栏下沿之后开始，否则顶栏要么被封面穿过、要么盖住第一行卡片。 */
    var stage = doc.querySelector('.latent-shelf .ls-stage');
    if (!bar || !stage) {
      need('顶栏不遮内容', false, bar ? '未找到 .latent-shelf .ls-stage' : '未找到 .app-topbar');
    } else {
      var bb = px(bar.getBoundingClientRect().bottom), stTop = px(stage.getBoundingClientRect().top);
      ev.topbarBottom = bb; ev.stageTop = stTop;
      need('顶栏不遮内容', bb <= stTop + 0.5, 'topbar.bottom=' + bb + ' stage.top=' + stTop);
    }
    /* 筛选药丸不得压住聚焦卡：窄档卡片比行高还高，卡顶会溢出到药丸底下（2026-11 用户报的那一处）。 */
    var pillEl = doc.querySelector('.latent-shelf .ls-filter-wrap');
    var focusEl = doc.querySelector('.latent-shelf .ls-card.is-focus');
    if (pillEl && focusEl) {
      var pRect = pillEl.getBoundingClientRect();
      var cRect = focusEl.getBoundingClientRect();
      var gapPill = Math.round(cRect.top - pRect.bottom);
      ev.shelfPill = { pillBottom: Math.round(pRect.bottom), cardTop: Math.round(cRect.top), gap: gapPill };
      need('书架筛选药丸不压卡片', gapPill >= 2, '药丸 bottom=' + Math.round(pRect.bottom) + ' 卡顶=' + Math.round(cRect.top) + ' 间隙=' + gapPill + 'px（要求>=2）');
    } else {
      need('书架筛选药丸不压卡片', true, '跳过：未找到药丸或聚焦卡');
    }
  }
  return { items: items, evidence: ev };
}
${writingStatsProbe.toString()}
${snippetsProbe.toString()}
${loreFreeProbe.toString()}
${loreReloadProbe.toString()}
${settingsProbe.toString()}
${settingsRestoreProbe.toString()}
function measure(module, frame, width) {
  var doc = frame.contentDocument, win = frame.contentWindow;
  var root = module === 'shelf'
    ? (doc.querySelector('.latent-shelf') || doc.querySelector('#app') || doc.body)
    : module.indexOf('panel-') === 0
      ? (doc.querySelector('.panel-host') || doc.querySelector('#app') || doc.body)
      : (doc.querySelector('.workbench-shell') || doc.querySelector('#app') || doc.body);
  var ls = lightScan(root, win);
  var sw = doc.documentElement.scrollWidth, cw = doc.documentElement.clientWidth;
  var dream = dreamCount(doc, win);
  var a = keyAssert(module, frame, width);
  var items = a.items.concat([
    { name: '浅色大块背景(>8%视口)=0', pass: ls.count === 0, ev: String(ls.count) + (ls.samples.length ? ' :: ' + ls.samples.join(' | ') : '') },
    { name: '可见「恍然梦」=0', pass: dream === 0, ev: String(dream) },
    { name: 'scrollWidth<=clientWidth', pass: sw <= cw, ev: sw + ' <= ' + cw }
  ]);
  var out = {
    module: module,
    innerWidth: win.innerWidth,
    scrollWidth: sw,
    clientWidth: cw,
    lightElements: ls.count,
    dreamVisible: dream,
    items: items,
    evidence: a.evidence,
    ok: items.every(function (i) { return i.pass; })
  };
  /* 设定面板矩阵：列宽 / 收起 / 抽屉都要点完再看，故与正文场景一样走一拍异步探针。 */
  if (module === 'lore') {
    return loreMatrixProbe(frame, out, width).then(async function (o) {
      await loreFreeProbe(frame, o, width);
      await loreReloadProbe(frame, o, width);
      o.ok = o.items.every(function (i) { return i.pass; });
      return o;
    });
  }
  /* 灵感（2026-11 融合总稿）：手札/拼板切换、记录、检索、详情编辑与草稿、标签、关联、
     转为章节、回收站与撤销、窄档抽屉——都要点完再看，故与设定/人物一样走异步探针。 */
  if (module === 'snippets') {
    return snippetsProbe(frame, out, width).then(function (o) {
      o.ok = o.items.every(function (i) { return i.pass; });
      return o;
    }, function (e) {
      /* 探针自身抛错不能变成「页面没就绪」的静默超时：落一条失败证据再收尾。 */
      out.items.push({ name: '灵感行为探针执行', pass: false, ev: String((e && e.stack) || e).slice(0, 400) });
      out.ok = false;
      return out;
    });
  }
  /* 人物面板矩阵（roster | 16 | main | 16 | context）：三列几何 / 页头 / 名录 / 卷宗 / 编辑态 /
     右列 / 剧场 / 收起细轨 / 窄档单列全都要点完再判，与设定一样走一拍异步探针。 */
  if (module === 'characters') {
    return charMatrixProbe(frame, out, width).then(function (o) {
      o.ok = o.items.every(function (i) { return i.pass; });
      return o;
    });
  }
  /* 设置工作区（2026-11-06 融合总稿）：分类切换 / 检索定位 / 真实下载与喂文件 / 窄档抽屉与手机预览
     全都要点完再看，与设定、人物一样走一拍异步探针。恢复链路会真的 reload 并冲库，单独一个探针。 */
  if (module === 'settings' || module === 'panel-settings') {
    return writingStatsProbe(frame, out, width, module).then(() => settingsProbe(frame, out, width)).then(function (o) {
      o.ok = o.items.every(function (i) { return i.pass; });
      return o;
    });
  }
  if (module === 'settings-restore') {
    return settingsRestoreProbe(frame, out, width).then(function (o) {
      o.ok = o.items.every(function (i) { return i.pass; });
      return o;
    });
  }
  /* 沉浸模式要等 Vue 在微任务里重渲染之后才读得到隐藏后的布局，故只有正文场景多一拍。 */
  if (['shelf','outline','panel-outline'].includes(module) && [380,760,1280].includes(width)) {
    return writingStatsProbe(frame,out,width,module).then(() => { out.ok = out.items.every(i=>i.pass); return out; });
  }
  if (module !== 'chapters') return out;
  return focusProbe(frame, out).then(function () {
    return (width === 695 || width === 1280) ? ctxMenuProbe(frame, out, width) : null;
  }).then(function () {
    return width === 695 ? panelProbe(frame, out) : null;
  }).then(function () {
    return [695, 760, 1000].indexOf(width) >= 0 ? nestedPopoverProbe(frame, out) : null;
  }).then(function () {
    return drawerProbe(frame, out, width);
  }).then(async function () {
    if (width === 1280) await writingStatsProbe(frame,out,width,module);
    out.ok = out.items.every(function (i) { return i.pass; });
    return out;
  });
}

/* ---- 场景 ---- */
/* 章节栏默认收起后，「默认态」和「面板内断言要的面板打开态」只能各测一次：
   ticks 在页面就绪后先把默认态记在这里，再把目录栏打开供面板内断言测量；
   drawerProbe 收尾时按这里复原，避免截图里留着一个开着的抽屉。 */
var SIDE_DEFAULT = null;
function pinia(frame) {
  try { return frame.contentDocument.querySelector('#app').__vue_app__.config.globalProperties.$pinia; } catch (e) { return null; }
}
function workStore(frame) {
  var p = pinia(frame);
  return p ? p._s.get('work') : null;
}
function uiStore(frame) {
  var p = pinia(frame);
  return p ? p._s.get('ui') : null;
}
/* 沉浸模式的唯一判据是 ui.focusMode：宿主没有 ?mode=focus 这种 URL 开关，改状态才是真路径。
   置位后 Vue 在微任务里才 patch，所以先把「之前」的节点抓在手里，下一拍再判它是否还看得见。 */
function focusProbe(frame, out) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var name = '沉浸模式:工具栏与批注栏不可见';
  var ui = uiStore(frame);
  if (!ui) {
    out.items.push({ name: name, pass: false, ev: 'ui store 缺失（pinia._s.get("ui") 为空）' });
    return Promise.resolve();
  }
  var tb = doc.querySelector('.editor-toolbar');
  var notes = doc.querySelector('.right-panel[aria-label="批注与资料"]') || doc.querySelector('.right-panel')
    || doc.querySelector('[aria-label="批注与资料"]') || doc.querySelector('.rp-panel');
  var hadNotes = !!notes;
  try { ui.focusMode = true; } catch (e) {
    out.items.push({ name: name, pass: false, ev: 'ui.focusMode 置位失败: ' + String(e && e.message || e) });
    return Promise.resolve();
  }
  return new Promise(function (res) {
    setTimeout(function () {
      try {
        function vis(el) {
          if (!el) return false;
          var r = el.getBoundingClientRect(), cs = win.getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
        }
        var tv = vis(tb), nv = vis(notes);
        ev.focus = { focusMode: !!ui.focusMode, toolbarVisible: tv, notesVisible: nv, notesWasMounted: hadNotes };
        out.items.push({
          name: name, pass: !tv && !nv,
          ev: 'toolbar 可见=' + tv + '；批注栏 可见=' + nv + (hadNotes ? '' : '（前态就没挂载，等同不可见）')
        });
      } catch (e) {
        out.items.push({ name: name, pass: false, ev: '读取焦点态布局抛错: ' + String(e && e.message || e) });
      } finally {
        try { ui.focusMode = false; } catch (e2) { /* 恢复失败不影响判据 */ }
        res();
      }
    }, 320);
  });
}
/* 695 档批注栏开合：走真机点路径（.rp-rail 展开、.rp-fold 收起）；宿主若没有收起键，
   退到 ui.setPref('rightPanelOpen', ...)，并在证据的「路径」里写明用了哪条。 */
function panelProbe(frame, out) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var name = '批注栏可开可关';
  var ui = uiStore(frame);
  if (!ui) {
    out.items.push({ name: name, pass: false, ev: 'ui store 缺失（pinia._s.get("ui") 为空）' });
    return Promise.resolve();
  }
  function panel() {
    return doc.querySelector('.right-panel[aria-label="批注与资料"]') || doc.querySelector('.right-panel');
  }
  function vis(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect(), cs = win.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  var prev = !!ui.rightPanelOpen;
  var st = { closedAtStart: false, rail: false, opened: false, closedAgain: false, path: 'click', err: '' };
  return wait(40).then(function () {
    try {
      if (ui.rightPanelOpen) {
        var f0 = doc.querySelector('.rp-fold');
        if (f0) f0.click(); else { ui.setPref('rightPanelOpen', false); st.path = 'setPref'; }
      }
    } catch (e) { st.err = String(e && e.message || e); }
    return wait(180);
  }).then(function () {
    st.closedAtStart = !vis(panel());
    var rail = doc.querySelector('.rp-rail');
    st.rail = !!rail;
    try {
      if (rail) rail.click(); else { ui.setPref('rightPanelOpen', true); st.path = 'setPref'; }
    } catch (e2) { st.err = String(e2 && e2.message || e2); }
    return wait(200);
  }).then(function () {
    st.opened = vis(panel());
    try {
      var fold = doc.querySelector('.right-panel .rp-fold') || doc.querySelector('.rp-fold');
      if (fold) fold.click(); else { ui.setPref('rightPanelOpen', false); st.path = 'setPref'; }
    } catch (e3) { st.err = String(e3 && e3.message || e3); }
    return wait(200);
  }).then(function () {
    st.closedAgain = !vis(panel());
    try { ui.setPref('rightPanelOpen', prev); } catch (e4) { /* 恢复失败不影响判据 */ }
    ev.panel = st;
    out.items.push({
      name: name, pass: st.closedAtStart && st.opened && st.closedAgain,
      ev: '关闭态不可见=' + st.closedAtStart + '；点 .rp-rail（轨存在=' + st.rail + '）后可见=' + st.opened
        + '；点 .rp-fold 后不可见=' + st.closedAgain + '；路径=' + st.path + (st.err ? '；异常=' + st.err : '')
    });
    return null;
  });
}
/* 章节栏是浮层：打开前后 .rich-host 宽度变化 <=2px（证明它压在正文上、不占列宽），且 .side-panel 必须是 absolute。
   走真机点路径（.ol-side-rail 展开 / .side-fold 收起），没有对应按钮时退到 ui.setPref('sidePanelOpen', ...)；
   无论成败最后都把目录栏恢复到进入时的开合状态，避免影响后续断言与截图。 */
/* 右键菜单探针（695 / 1280）：用户报「菜单透明导致字重叠」「有些太长了」。
   在正文上派发一次 contextmenu，量底色 alpha、总高与最长条目，然后关掉菜单。 */
function ctxMenuProbe(frame, out, width) {
  var doc = frame.contentDocument, win = frame.contentWindow;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var host = doc.querySelector('.rich-host');
  if (!host) {
    out.items.push({ name: '右键菜单不透明', pass: false, ev: '未找到 .rich-host' });
    return Promise.resolve(null);
  }
  var rect = host.getBoundingClientRect();
  var x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
  try {
    host.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: win }));
  } catch (err) { /* 派发失败在下面按"未渲染"判负 */ }
  return wait(180).then(function () {
    var menu = doc.querySelector('.ctx-menu');
    if (!menu) {
      out.items.push({ name: '右键菜单不透明', pass: false, ev: 'contextmenu 之后没有渲染 .ctx-menu' });
      return null;
    }
    var cs = win.getComputedStyle(menu);
    var bg = String(cs.backgroundColor || '');
    var alpha = 1;
    var m = bg.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(',').map(function (s) { return parseFloat(s); });
      if (parts.length >= 4 && !isNaN(parts[3])) alpha = parts[3];
    }
    var r = menu.getBoundingClientRect();
    var labels = Array.prototype.map.call(menu.querySelectorAll('.ctx-item > span:first-child'), function (el) {
      return String(el.textContent || '').trim();
    });
    var longest = labels.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
    out.evidence.ctxMenu = {
      width: width, bg: bg, alpha: alpha, h: Math.round(r.height), vh: win.innerHeight,
      scrollH: menu.scrollHeight, clientH: menu.clientHeight, longest: longest, count: labels.length
    };
    out.items.push({ name: '右键菜单不透明', pass: alpha >= 0.9, ev: 'background=' + bg + ' alpha=' + alpha + '（要求>=0.9）' });
    out.items.push({
      name: '右键菜单不超视口',
      pass: r.height <= win.innerHeight - 20 && menu.scrollHeight <= menu.clientHeight + 1,
      ev: 'h=' + Math.round(r.height) + ' 视口=' + win.innerHeight + ' scrollH=' + menu.scrollHeight + ' clientH=' + menu.clientHeight
    });
    out.items.push({
      name: '右键菜单文案不冗长', pass: !!longest && longest.length <= 6,
      ev: '最长条目「' + longest + '」' + longest.length + ' 字（要求<=6）；共 ' + labels.length + ' 项'
    });
    try { doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e2) { /* ignore */ }
    try { if (doc.querySelector('.ctx-menu')) doc.body.click(); } catch (e3) { /* ignore */ }
    return wait(120);
  });
}
function drawerProbe(frame, out, width) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var name = '章节栏是浮层且不占列宽';
  var ui = uiStore(frame);
  if (!ui) {
    out.items.push({ name: name, pass: false, ev: 'ui store 缺失（pinia._s.get("ui") 为空）' });
    return Promise.resolve();
  }
  function panelEl() {
    return doc.querySelector('.workbench-shell #writing-directory.side-panel') || doc.querySelector('.side-panel');
  }
  function richEl() { return doc.querySelector('.rich-host'); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var prev = !!ui.sidePanelOpen;
  var st = { path: 'click', err: '', before: null, after: null, position: '', rail: false };
  return wait(40).then(function () {
    try {
      if (ui.sidePanelOpen) {
        var fold = doc.querySelector('.side-panel .side-fold') || doc.querySelector('[aria-label*="收起章节栏"]');
        if (fold) fold.click(); else { ui.setPref('sidePanelOpen', false); st.path = 'setPref'; }
      }
    } catch (e) { st.err = String(e && e.message || e); }
    return wait(200);
  }).then(function () {
    var r0 = richEl();
    st.before = r0 ? Math.round(r0.getBoundingClientRect().width) : null;
    var rail = doc.querySelector('.ol-side-rail');
    st.rail = !!rail;
    try {
      if (rail) rail.click(); else { ui.setPref('sidePanelOpen', true); st.path = 'setPref'; }
    } catch (e2) { st.err = String(e2 && e2.message || e2); }
    return wait(220);
  }).then(function () {
    var r1 = richEl();
    st.after = r1 ? Math.round(r1.getBoundingClientRect().width) : null;
    var pnl = panelEl();
    st.position = pnl ? String(win.getComputedStyle(pnl).position) : '未渲染';
    /* 判据方向（2026-11 修正）：开栏时细轨让出的车道被收回，正文应当变宽而不是被挤窄。
       原写法 |后-前|<=2 把「变宽」也判成失败，方向写反了；现为「打开后 >= 打开前 - 2」。 */
    var delta = (st.before !== null && st.after !== null) ? (st.after - st.before) : -999;
    ev.drawer = { position: st.position, before: st.before, after: st.after, delta: delta, rail: st.rail, path: st.path };
    /* 断言只在 695/1000/1280 出项（原授权口径）；380/760 也走这个探测，只是为了在收尾时把目录栏复原。 */
    var emit = (width === 695 || width === 1000 || width === 1280);
    if (emit) out.items.push({
      name: name, pass: st.position === 'absolute' && st.before !== null && st.after !== null && delta >= -2,
      ev: 'position=' + st.position + ' 打开前宽=' + st.before + ' 打开后宽=' + st.after
        + ' 打开后相对打开前=' + (delta > 0 ? '+' : '') + delta + 'px（不得为负超过 2）展开轨存在=' + st.rail
        + ' 路径=' + st.path + (st.err ? ' 异常=' + st.err : '')
    });
    /* 浮层抽屉得有抽屉该有的宽度：宿主行内 style 仍按「列」给 168px 时，抽屉会挤成一团 ——
       这条在「已打开」的状态下量，现有其它断言看不到它（没人量过抽屉宽）。380 档不判（86vw 上限，
       下界要另算），只覆盖 695。 */
    if (width === 695) {
      var drawW = pnl ? Math.round(pnl.getBoundingClientRect().width) : -1;
      ev.drawerWidth = { width: drawW, vw: win.innerWidth };
      out.items.push({
        name: '抽屉宽度', pass: drawW >= 240 && drawW <= 300,
        ev: '抽屉宽=' + drawW + ' 视口宽=' + win.innerWidth + '（要求 240..300）'
      });
    }
    /* 章节栏顶排只剩 ⋯ 与收起键：上移/下移/改名/删除这四个操作已收进 ⋯ 菜单（模板删按钮那一路），
       顶排若还留着它们就是没收干净。依赖模板与皮肤同时落地，真机首跑红是预期的。 */
    if (width === 695) {
      var headTop = doc.querySelector('.side-panel .side-head') || doc.querySelector('.side-head');
      var headBtns = headTop ? headTop.querySelectorAll('button') : [];
      var headTexts = [], headBad = [];
      for (var hi2 = 0; hi2 < headBtns.length; hi2++) {
        var htx = String(headBtns[hi2].textContent || '').trim();
        headTexts.push(htx);
        if (/上移|下移|改名|删除/.test(htx)) headBad.push(htx);
      }
      var moreEl2 = doc.querySelector('.side-panel .side-more') || doc.querySelector('.side-more');
      var foldEl2 = doc.querySelector('.side-panel .side-fold') || doc.querySelector('.side-head .side-fold')
        || doc.querySelector('.side-head [aria-label*="收起章节栏"]') || doc.querySelector('[aria-label*="收起章节栏"]');
      ev.sideHeadTop = { buttons: headTexts, forbidden: headBad, more: !!moreEl2, fold: !!foldEl2 };
      out.items.push({
        name: '章节栏顶排只剩 ⋯ 与收起键', pass: headBad.length === 0 && !!moreEl2 && !!foldEl2,
        ev: '含上移/下移/改名/删除=' + headBad.length + ' 颗' + (headBad.length ? '[' + headBad.join('|') + ']' : '')
          + '；.side-more 存在=' + !!moreEl2 + '；收起键存在=' + !!foldEl2 + '；顶排按钮=[' + headTexts.join('|') + ']'
      });

      /* 章目栏字号阶梯（"书的目录页"靠字阶与留白，不靠加粗）：caps 10 / 卷 10 / 章 13 / 计数 10，
         章行字重 <=550（全行 600 会把 13px 的无衬线压得发闷，这是毛边感的来源）。 */
      var fsOf = function (el) { return el ? Math.round(parseFloat(win.getComputedStyle(el).fontSize) * 10) / 10 : -1; };
      var fwOf = function (el) { return el ? parseFloat(win.getComputedStyle(el).fontWeight) : -1; };
      var volEl = doc.querySelector('.side-panel [data-kind="volume"]');
      var chapEl = doc.querySelector('.side-panel [data-kind="chapter"]');
      var cntEl = doc.querySelector('.side-panel .chapter-count');
      var volFs = fsOf(volEl), chapFs = fsOf(chapEl), cntFs = fsOf(cntEl), chapFw = fwOf(chapEl);
      ev.sideType = { volume: volFs, chapter: chapFs, count: cntFs, chapterWeight: chapFw };
      out.items.push({
        name: '章目字号阶梯', pass: Math.abs(volFs - 10) <= 1 && Math.abs(chapFs - 13) <= 1 && Math.abs(cntFs - 10) <= 1 && chapFw <= 550,
        ev: '卷=' + volFs + ' 章=' + chapFs + ' 计数=' + cntFs + ' 章行字重=' + chapFw
          + '（要求 卷/计数 10±1、章 13±1、字重<=550）'
      });
      /* 报头（册 / 章 目 / N 章 · M 字）已删：章数字数每行自带、标题被收起态胶囊取代，留着是重复占高 */
      var masthead = doc.querySelector('.side-panel .ct-masthead, .side-panel .ct-cap, .side-panel .ct-meta');
      ev.sideMasthead = { present: !!masthead };
      out.items.push({ name: '章节栏报头已删除', pass: !masthead, ev: masthead ? '仍存在：' + String(masthead.className) : 'ok' });
      /* 报头与过滤框都在：过滤框是本章节栏新增的检索入口，缺了就是模板没跟上 */
      var searchEl = doc.querySelector('.side-panel .ct-search input');
      ev.sideSearch = { present: !!searchEl };
      out.items.push({ name: '章目过滤框存在', pass: !!searchEl, ev: searchEl ? 'ok' : '未找到 .side-panel .ct-search input' });
    }
    /* 695 档在这里插一张「目录栏已打开」的快照：此刻浮层与 .side-foot 的新建药丸都在。
       本页把请求写到 __NS_SHOT 并等 Node 拍完置 __NS_SHOT_OK，然后才走下面的复原 —— 顺序不能反，
       否则 Node 拿到的一定是复原后的样子。 */
    /* 章目过滤真机走一遍：填关键字 -> 行数必须下降 -> 清空 -> 行数复原。
       清空放在截图之前，别让「目录栏已打开」那张快照拍成过滤态。 */
    var filterGate = (width === 695) ? (function () {
      var input = doc.querySelector('.side-panel .ct-search input');
      var rowsOf = function () { return doc.querySelectorAll('.side-panel [data-kind="chapter"]').length; };
      if (!input) return Promise.resolve({ error: '未找到 .ct-search input' });
      var before = rowsOf();
      input.value = '第 2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return wait(140).then(function () {
        var filtered = rowsOf();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return wait(140).then(function () { return { before: before, filtered: filtered, restored: rowsOf() }; });
      });
    })().then(function (result) {
      return (result && !result.error) ? closePopovers(doc, 2).then(function (n) { return { n: n, filter: result }; })
        : Promise.resolve({ n: null, filter: result });
    }).then(function (pack) {
      var filter = pack && pack.filter || {};
      ev.sideFilter = filter;
      out.items.push({
        name: '章目过滤可用', pass: !filter.error && filter.filtered < filter.before && filter.restored === filter.before,
        ev: filter.error ? filter.error : ('过滤前 ' + filter.before + ' 行 → 过滤后 ' + filter.filtered + ' 行 → 清空后 ' + filter.restored + ' 行')
      });
      if (pack && pack.n !== null && pack.n !== undefined) {
        /* 快照前保险：弹层探针万一没收干净，这里再点掉一次，别让弹层盖住抽屉的观感（不产生断言项）。 */
        ev.popoverCleanupBeforeShot = { clicks: pack.n, leftVisible: popoverVisibleCount(doc) };
      }
      return null;
    }) : Promise.resolve(null);
    var shotGate = (width === 695) ? filterGate.then(function () {
      return requestShot('chapters-695-drawer');
    }) : Promise.resolve(null);
    return shotGate.then(function () {
      /* 收尾恢复到「页面默认」而不是进入时的值：ticks 为了量面板内断言会先把目录栏打开，
         若按进入值恢复，截图里目录栏会一直开着。SIDE_DEFAULT 由 ticks 在打开前记下。 */
      var restoreTo = (SIDE_DEFAULT && typeof SIDE_DEFAULT.panel === 'boolean') ? SIDE_DEFAULT.panel : prev;
      try { ui.setPref('sidePanelOpen', restoreTo); } catch (e3) { /* 恢复失败不影响判据 */ }
      return null;
    });
  });
}
/* ===== 设定 · 面板矩阵探针（2026-11-06 改造后的终版真机路径） =====
   设计稿 docs/前端美化/设定-融合总稿-20261105/：nav | 16 | [list | 16] main [16 | detail]，
   三列各自可收起成 40px 细轨，列宽可拖拽 / 双击复位 / 键盘调宽并落 appconfig；
   ≤1099 时 nav 变抽屉（.lore-scrim + data-drawer）、list/detail 与 main 按 data-screen 两屏互斥。
   宽档（1280 这一个场景）逐列点；窄档（760 / 380）只判「不渲染三列 + 抽屉 + 两屏」。
   收尾把视图/范围/三列宽度复原成「默认写视图 + 全展开」，免得截图继承探针态。 */
async function loreMatrixProbe(frame, out, width) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var NAV = '.lore-pane[data-pane="nav"]';
  var LIST = '.lore-pane[data-pane="list"]';
  var DETAIL = '.lore-pane[data-pane="detail"]';
  var MAIN = '.lore-pane[data-pane="main"]';
  var DIV = '.lore-divider[data-size="nav"]';
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function need(name, ok, e) { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  function px2(v) { return Math.round(parseFloat(v) * 10) / 10; }
  function q(sel) { return doc.querySelector(sel); }
  function vis(n) { if (!n) return false; var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function wOf(sel) { var n = q(sel); return n && vis(n) ? px2(n.getBoundingClientRect().width) : -1; }
  function txt(sel) { var n = q(sel); return n ? String(n.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function click(x) { if (x === '.lore-scope') x = ui.loreScope === 'all' ? '.lore-nav-node.category' : '.all-scope'; var n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
  function visibleCount(sel) { var n = 0; Array.prototype.forEach.call(doc.querySelectorAll(sel), function (x) { if (vis(x)) n++; }); return n; }

  /* ===== 第三轮新增探针（2026-11-06）：集头宽度稳定 / 滚动条两态 / 单击改名 =====
     这三个函数在宽窄两档都调：集头（.mubu-set-head）与写区（.write-surface）的几何是同一套
     --lore-pad-x 变量算出来的，五档（1440/1280/1000/760/380）都要量一遍才叫「稳定」。 */
  function rectOf(n) { if (!n) return null; var r = n.getBoundingClientRect(); return { l: px2(r.left), r: px2(r.right), t: px2(r.top), w: px2(r.width), h: px2(r.height) }; }
  /* 造「无滚动条」态：只留第一个集头，其余写区内容用一条临时 <style> 藏起来。
     为什么不改节点的 inline style：.ob-row 带 :style="{'--depth':…}" 由 Vue 管，下一次渲染会把 display 冲掉；
     临时样式表不参与 diff，测完立刻移除。 */
  function noScrollOn() {
    var keep = q('.ob-editor .mubu-set-head');
    if (!keep) return null;
    keep.classList.add('__ns_keep_head');
    var s = doc.createElement('style');
    s.id = '__ns_noscroll';
    s.textContent = '.ob-editor .ob-row{display:none!important}'
      + '.ob-editor .mubu-set-head:not(.__ns_keep_head){display:none!important}';
    (doc.head || doc.documentElement).appendChild(s);
    return keep;
  }
  function noScrollOff() {
    var s = doc.getElementById('__ns_noscroll');
    if (s && s.parentNode) s.parentNode.removeChild(s);
    Array.prototype.forEach.call(doc.querySelectorAll('.__ns_keep_head'), function (n) { n.classList.remove('__ns_keep_head'); });
  }
  /* all 范围才会每集渲染一个 .mubu-set-head（set 范围按设计不渲染集头）。 */
  async function writeAllScope() {
    if (ui.loreView !== 'write') { ui.setLoreView('write'); await wait(520); }
    if (ui.loreScope !== 'all') { await ui.setPref('loreScope', 'all'); await wait(560); }
    await wait(140);
  }
  async function setHeadProbe(tag) {
    await writeAllScope();
    var surf = rectOf(q('.write-surface'));
    var heads = Array.prototype.filter.call(doc.querySelectorAll('.mubu-set-head'), function (h) { return h.getBoundingClientRect().width > 0; });
    if (!surf || !heads.length) {
      need('设定集头横贯写区', false, '未找到 .write-surface / 可见 .mubu-set-head（write 视图 + all 范围下应渲染）；视口=' + tag);
      need('设定集头宽度不随滚动条变', false, '同上：没有集头可量；视口=' + tag);
      return;
    }
    var hb = rectOf(heads[0]);
    var leftIn = px2(hb.l - surf.l), rightIn = px2(surf.r - hb.r);
    var ed = q('.ob-editor');
    var withBar = { headW: hb.w, clientW: ed ? ed.clientWidth : -1, scrollH: ed ? ed.scrollHeight : -1, clientH: ed ? ed.clientHeight : -1 };
    var gutter = ed ? win.getComputedStyle(ed).scrollbarGutter : '(未找到 .ob-editor)';
    /* 判据按「集头横贯写区」写：.mubu-set-head 用 margin: 0 calc(-1*var(--lore-pad-x)) 抵消 .ob-editor 的横向内距，
       所以它故意比 .write-surface 每边宽出 pad-x（1440 = 34px）—— 左右内缩本身不是 0，而是「对称且等于滚动口宽」。
       旧实现把 -34/-20/-14 写死在两层里，一旦某层变量改了就只扩一边，集头会歪；差 ≤1 就是在守这件事。 */
    var edW0 = ed ? ed.clientWidth : -1;
    need('设定集头横贯写区', Math.abs(leftIn - rightIn) <= 1 && edW0 > 0 && Math.abs(hb.w - edW0) <= 1,
      '集头 left=' + hb.l + ' / 写区 left=' + surf.l + ' → 左内缩 ' + leftIn + '；集头 right=' + hb.r + ' / 写区 right=' + surf.r
        + ' → 右内缩 ' + rightIn + '（左右差 ' + px2(leftIn - rightIn) + '，要求 ≤1）；集头宽 ' + hb.w
        + ' / 写区宽 ' + surf.w + ' / 滚动口宽 ' + edW0 + '（要求集头宽 = 滚动口宽 ±1，即每边外扩 pad-x）视口=' + tag);
    var keep = noScrollOn();
    await wait(240);
    var hb2 = keep && keep.getBoundingClientRect ? rectOf(keep) : null;
    var ed2 = q('.ob-editor');
    var noBar = { headW: hb2 ? hb2.w : -1, clientW: ed2 ? ed2.clientWidth : -1, scrollH: ed2 ? ed2.scrollHeight : -1, clientH: ed2 ? ed2.clientHeight : -1 };
    noScrollOff();
    await wait(180);
    ev.loreSetHead = ev.loreSetHead || {};
    ev.loreSetHead[tag] = { surf: surf, head: hb, leftIn: leftIn, rightIn: rightIn, gutter: gutter, withBar: withBar, noBar: noBar };
    need('设定集头宽度不随滚动条变', !!hb2 && Math.abs(noBar.headW - withBar.headW) <= 1,
      '有滚动条：集头宽 ' + withBar.headW + 'px，滚动口 clientWidth ' + withBar.clientW
        + '（scrollHeight ' + withBar.scrollH + ' / clientHeight ' + withBar.clientH + '）'
        + ' → 无滚动条：集头宽 ' + noBar.headW + 'px，clientWidth ' + noBar.clientW
        + '（scrollHeight ' + noBar.scrollH + '）；宽度差 ' + px2(noBar.headW - withBar.headW) + 'px（要求 ≤1）'
        + '；scrollbar-gutter=' + gutter);
  }
  /* 单击集名 → 输入框聚焦并全选 → 回车提交 → 再改名成空串回车（不得写库） → 还原原名。 */
  async function renameProbe() {
    await writeAllScope();
    var nameEl = q('.mubu-set-head .ls-name'), oldName = nameEl ? nameEl.textContent.trim() : '';
    var root = wk.mubuRoots()[0], beforeChildren = wk.mubuChildren(root.id).map(function(n){ return n.id; });
    click(nameEl); await wait(220);
    var inp = q('.lore-head .lore-h1[contenteditable=true]');
    need('集头单击进入根节点', !!inp && ui.loreRootId === root.id && ui.loreScope === 'set', '根节点聚焦与名称编辑共用页头');
    if (!inp) return;
    inp.focus(); inp.textContent = oldName + '改'; inp.dispatchEvent(new win.Event('input', { bubbles: true }));
    inp.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(220);
    need('根标题回车保存并新建子节点', wk.mubu.find(function(n){return n.id===root.id;}).text === oldName + '改' && wk.mubuChildren(root.id).length === beforeChildren.length + 1, 'Enter 不切换成另一套编辑器');
    var added = wk.mubuChildren(root.id).filter(function(n){return beforeChildren.indexOf(n.id)<0;});
    added.forEach(function(n){wk.mubuRemove(n.id);});
    inp = q('.lore-head .lore-h1'); inp.focus(); inp.textContent = ''; inp.dispatchEvent(new win.Event('input', { bubbles:true }));
    need('空标题仍保留节点身份', wk.mubu.find(function(n){return n.id===root.id;}).text === '' && ui.loreRootId === root.id, '自由节点允许暂时没有文字');
    inp.blur(); wk.mubuSetText(root.id, oldName, null); await wait(120); await writeAllScope();
  }
  /* 落库证据：ui.setPref 把开合状态写进 appconfig 表（key 就是 'loreNavClosed'）。
     这里直接读 IndexedDB —— 不 reload：reload 会把这个场景的页面语境整个换掉
     （真正的 reload 复验放在 scripts/compare-lore.mjs 里单独做）。 */
  function readPref(key) {
    return new Promise(function (res) {
      var done = false;
      function fin(v) { if (!done) { done = true; res(v); } }
      function openNamed(name) {
        var rq = win.indexedDB.open(name);
        rq.onerror = function () { fin('打开 ' + name + ' 失败'); };
        rq.onsuccess = function () {
          var db = rq.result;
          var has = Array.prototype.slice.call(db.objectStoreNames || []).indexOf('appconfig') >= 0;
          if (!has) { db.close(); return fin('无 appconfig 表'); }
          try {
            var tx = db.transaction('appconfig', 'readonly');
            var get = tx.objectStore('appconfig').get(key);
            get.onsuccess = function () { var row = get.result; try { db.close(); } catch (e) { /* ignore */ } fin(row ? row.value : '(无此行)'); };
            get.onerror = function () { try { db.close(); } catch (e) { /* ignore */ } fin('读 appconfig 失败'); };
          } catch (e) { try { db.close(); } catch (e2) { /* ignore */ } fin('事务失败: ' + String(e && e.message || e)); }
        };
      }
      try {
        var dl = win.indexedDB.databases ? win.indexedDB.databases() : null;
        if (!dl) return fin('indexedDB.databases() 不可用');
        dl.then(function (list) {
          var hit = (list || []).filter(function (d) { return /novel-studio/.test(String(d && d.name || '')); });
          if (!hit.length) return fin('未找到 novel-studio 库');
          openNamed(hit[0].name);
        }).catch(function (e) { fin('databases() 失败: ' + String(e && e.message || e)); });
      } catch (e) { fin('IndexedDB 不可用: ' + String(e && e.message || e)); }
    });
  }
  function pressKey(key, shift) {
    var el = q(DIV);
    if (!el) return false;
    try { el.focus(); } catch (e) { /* ignore */ }
    el.dispatchEvent(new win.KeyboardEvent('keydown', { key: key, shiftKey: !!shift, bubbles: true, cancelable: true }));
    return true;
  }
  var st = {};
  var wk = workStore(frame), ui = uiStore(frame);
  var setCount = wk ? wk.mubuRoots().length : -1;
  var root0 = wk && wk.currentMubuRoot ? wk.currentMubuRoot() : null;
  var setName = root0 ? String(root0.text || '') : '';

  /* 先归一化：上一轮若留下收起/非 A 视图，别让它变成这一轮的假红。 */
  try {
    if (ui) {
      if (ui.loreNavClosed) await ui.setPref('loreNavClosed', false);
      if (ui.loreListClosed) await ui.setPref('loreListClosed', false);
      if (ui.loreDetailClosed) await ui.setPref('loreDetailClosed', false);
      if (ui.loreNavWidth !== 220) await ui.setPref('loreNavWidth', 220);
      if (ui.loreListWidth !== 300) await ui.setPref('loreListWidth', 300);
      if (ui.loreDetailWidth !== 348) await ui.setPref('loreDetailWidth', 348);
      if (ui.loreScope !== 'set') await ui.setPref('loreScope', 'set');
      if (ui.loreView !== 'write') ui.setLoreView('write');
    }
  } catch (e0) { st.normalizeErr = String(e0 && e0.message || e0); }
  await wait(320);

  async function view(id) {
    click('.lore-switch button[data-lore-view="' + id + '"]');
    await wait(340);
  }

  if (width >= 1100) {
    /* ---- 有效留白（量元素位置，不量 computed padding）----
       导航卡左沿离视口左边应为 28（= .lore-shell 的 padding-left），上沿离顶栏底应为 24。
       为什么要量位置：2026-11-06 出现过「themes.css 的 .lore-shell padding 与 dsh.css 的
       .wb-body/.panel-body padding 叠成两层」（有效 56/48 vs 设计 28/24），而只看 .lore-shell 的
       computed padding（宽档 24/28/30）永远是绿的 —— 内缩发生在外面那一层。修法是 dsh.css:2159-2165
       只留 gap:0、留白只归 .lore-shell；第三条断言就是防它被再加回来。 */
    /* 第三轮（2026-11-06）：窄档移动栏 .lore-mobile-bar 整条已从 app 删除，DOM 里不再有
       .lore-mobile-bar / .lore-mobile-btn / .lore-mobile-title，这里随之撤掉「宽档不渲染移动栏」。
       宽档要守的换成「回列表 pill 不渲染」——那颗 pill 只住在窄档的 .lore-detail-return 里
       （v-if="listBack" ← :list-back="narrow"），断言并入下面的 B 段。 */
    var navBox0 = q(NAV) ? q(NAV).getBoundingClientRect() : null;
    var barEl = q('.app-topbar');
    var barBottom0 = barEl ? px2(barEl.getBoundingClientRect().bottom) : -1;
    var shellEl0 = q('.lore-shell');
    var shellCs0 = shellEl0 ? win.getComputedStyle(shellEl0) : null;
    var outerEl0 = q('.wb-body') || q('.panel-body');
    var outerCs0 = outerEl0 ? win.getComputedStyle(outerEl0) : null;
    var navLeft0 = navBox0 ? px2(navBox0.left) : -1;
    var navTop0 = navBox0 ? px2(navBox0.top) : -1;
    var shellPadLeft = shellCs0 ? shellCs0.paddingLeft : '(未找到 .lore-shell)';
    var outerPadLeft = outerCs0 ? outerCs0.paddingLeft : '(未找到 .wb-body/.panel-body)';
    ev.loreOffsets = {
      navLeft: navLeft0, navTop: navTop0, topbarBottom: barBottom0,
      shellPaddingLeft: shellPadLeft, outerPaddingLeft: outerPadLeft,
      outerElement: outerEl0 ? String(outerEl0.className || '') : null
    };
    need('设定有效留白 left=28', Math.abs(navLeft0 - 28) <= 1,
      'nav.left=' + navLeft0 + '（期望 28±1）shell.paddingLeft=' + shellPadLeft
        + ' wbBody.paddingLeft=' + outerPadLeft + ' 外层=' + ev.loreOffsets.outerElement);
    need('设定有效留白 top=24', barBottom0 >= 0 && Math.abs(navTop0 - barBottom0 - 24) <= 1,
      'nav.top=' + navTop0 + ' topbarBottom=' + barBottom0 + ' 差=' + px2(navTop0 - barBottom0)
        + '（期望 24±1）shell.paddingLeft=' + shellPadLeft);
    need('设定外层不再叠 padding', outerPadLeft === '0px',
      'wbBody.paddingLeft=' + outerPadLeft + ' paddingTop=' + (outerCs0 ? outerCs0.paddingTop : '?')
        + '（要求 0px：留白只归 .lore-shell 一层）');

    /* ---- A · nav 列 ---- */
    var navW0 = wOf(NAV);
    need('设定 nav 列宽 220', Math.abs(navW0 - 220) <= 1, 'nav 实测 ' + navW0 + 'px（期望 220±1）视口=' + width);
    var collapsed = click('.nav-collapse');
    await wait(320);
    var navW1 = wOf(NAV), railNav = q(NAV + ' .lore-rail'), railTxt = txt(NAV + ' .lore-rail');
    need('设定 nav 可收成 40 细轨', collapsed && Math.abs(navW1 - 40) <= 1 && vis(railNav) && railTxt.indexOf('世界设定') >= 0,
      '点 .nav-collapse → nav ' + navW1 + 'px（期望 40±1）；细轨可见=' + vis(railNav) + ' 文案「' + railTxt + '」');
    var railBack = click(NAV + ' .lore-rail');
    await wait(320);
    var navW2 = wOf(NAV);
    need('设定 nav 细轨可复原', railBack && Math.abs(navW2 - 220) <= 1, '点细轨 → nav ' + navW2 + 'px（期望 220±1）');
    click('.nav-collapse');
    await wait(320);
    var navW3 = wOf(NAV);
    var prefNavClosed = await readPref('loreNavClosed');
    need('设定 nav 收起落 appconfig', Math.abs(navW3 - 40) <= 1 && prefNavClosed === true,
      '再收起后 nav ' + navW3 + 'px；appconfig.loreNavClosed=' + JSON.stringify(prefNavClosed) + '（要求 true → reload 后仍是 40）');
    click(NAV + ' .lore-rail');
    await wait(320);
    need('设定 nav 复原后回到 220', Math.abs(wOf(NAV) - 220) <= 1, 'nav ' + wOf(NAV) + 'px');

    /* ---- A · 分隔条 ---- */
    var div = q(DIV);
    var dInfo = div ? {
      role: div.getAttribute('role'), now: div.getAttribute('aria-valuenow'),
      min: div.getAttribute('aria-valuemin'), max: div.getAttribute('aria-valuemax'),
      w: px2(div.getBoundingClientRect().width)
    } : null;
    need('设定分隔条 role=separator 且带 aria-valuenow', !!dInfo && dInfo.role === 'separator' && Number(dInfo.now) === 220 && dInfo.w === 16,
      dInfo ? 'role=' + dInfo.role + ' aria-valuenow=' + dInfo.now + '（min ' + dInfo.min + ' max ' + dInfo.max + '）分隔列宽 ' + dInfo.w + 'px'
        : '未找到 ' + DIV);
    if (div) {
      var r0 = div.getBoundingClientRect();
      var x0 = Math.round(r0.left + r0.width / 2), y0 = Math.round(r0.top + r0.height / 2);
      try {
        div.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, pointerId: 1, isPrimary: true }));
        win.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, clientX: x0 + 40, clientY: y0, button: 0, pointerId: 1, isPrimary: true }));
        win.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, clientX: x0 + 40, clientY: y0, button: 0, pointerId: 1, isPrimary: true }));
      } catch (e) { st.dragErr = String(e && e.message || e); }
      await wait(340);
    }
    var navDrag = wOf(NAV);
    need('设定分隔条拖 +40 → nav 260', Math.abs(navDrag - 260) <= 1, '拖 +40 后 nav ' + navDrag + 'px（期望 260±1）' + (st.dragErr ? '；派发异常=' + st.dragErr : ''));
    if (div) {
      var r1 = div.getBoundingClientRect();
      div.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: Math.round(r1.left + r1.width / 2), clientY: Math.round(r1.top + r1.height / 2), view: win }));
      await wait(340);
    }
    var navDbl = wOf(NAV);
    /* 默认值来自 lore-layout.js 的 LORE_PANE.nav.def（设计稿 studio.css --nav-w: 220）；不要在这里写死第二份。 */
    need('设定分隔条双击回默认值', Math.abs(navDbl - 220) <= 1, '双击后 nav ' + navDbl + 'px（期望 220±1）');
    pressKey('ArrowRight', false);
    await wait(340);
    var navKey = wOf(NAV);
    need('设定分隔条 ArrowRight → +10', Math.abs(navKey - 230) <= 1, 'ArrowRight 后 nav ' + navKey + 'px（期望 230±1）');
    pressKey('Home', false);
    await wait(320);

    /* ---- B · 设定详情（同级条目列） ---- */
    await view('detail');
    /* 宽档不渲染回列表 pill：那颗 .lore-detail-return .lore-mobile-back 由 v-if="listBack" 控制，
       listBack ← narrow，宽档必须是 0 个（防它被无条件渲染回来，回列表只有窄档才需要）。 */
    var widePill = doc.querySelectorAll('.lore-detail-return .lore-mobile-back').length;
    need('宽档不渲染回列表 pill', widePill === 0,
      '.lore-detail-return .lore-mobile-back ' + widePill + ' 个（宽档要求 0）视口=' + width);
    var listW0 = wOf(LIST);
    need('设定 B 同级条目列 300', Math.abs(listW0 - 300) <= 1, 'list 列宽 ' + listW0 + 'px（期望 300±1）');
    need('设定 B 页头显示当前节点名', txt('.lore-h1') === txt('.lore-detail-title'), 'h1=「' + txt('.lore-h1') + '」');
    need('设定 B 页头显示节点规模', !!q('.lore-pane[data-pane="main"] > .lore-head .lore-meta'),
      q('.lore-head .lore-meta') ? '仍有 .lore-meta：' + txt('.lore-head .lore-meta') : 'ok');
    var graphInReader = doc.querySelectorAll('.lore-detail-reader .lg-node').length + doc.querySelectorAll('.lore-detail-reader svg.lg-svg').length;
    need('设定 B 阅读区无内联关系图谱', !q('.lore-detail-graph') && graphInReader === 0,
      '.lore-detail-graph=' + !!q('.lore-detail-graph') + '；阅读区内图谱节点/画布 ' + graphInReader + ' 个（旧内联关系图谱已并入关联关系行与 C）');
    /* 详情完整性：用户报的「详情界面不全」在窄档是整块离屏，宽档这里守同一组五件套同时在 main 屏内。 */
    var swW = doc.querySelectorAll('.lore-switch button');
    need('设定详情完整（宽 1280）', !!q(MAIN + ' > .lore-head') && txt('.lore-h1') === txt('.lore-detail-title') && swW.length === 3
      && !!q('.lore-detail-title') && !!q('.lore-detail-footer'),
      'main 屏五件套：页头=' + !!q(MAIN + ' > .lore-head') + ' h1=「' + txt('.lore-h1') + '」视图按钮=' + swW.length
        + ' 阅读区标题=「' + txt('.lore-detail-title') + '」页脚=' + !!q('.lore-detail-footer'));
    /* 类型体系：entry-menu 的类型文案来自 kindOf(node)（node.kind → tags[0] → 名称启发式 → 条目）。 */
    var KIND_LABELS = ['地点', '组织', '规则', '历史', '物件', '民俗', '条目'];
    var ctxTxt = txt('.lore-detail-menu .lore-detail-context');
    /* 取前两个字：KINDS 的 label 全是两字（地点/组织/规则/历史/物件/民俗/条目），避开在 HARNESS 模板串里
       写 \\S 的转义坑（模板串会把 \\S 变成 S，regex 就永远不命中）。 */
    var ctxLab = String(ctxTxt || '').slice(0, 2);
    need('设定详情类型文案来自 kindOf', KIND_LABELS.indexOf(ctxLab) >= 0,
      'entry-menu 类型文案=「' + ctxLab + '」（要求 ∈ ' + KIND_LABELS.join('/') + '）；整行=「' + ctxTxt + '」');
    var listCollapse = click('.lore-detail-list-head button[aria-label="收起条目列表"]') || click('.lore-detail-list-head .lore-icon');
    await wait(340);
    var listW1 = wOf(LIST), railList = q(LIST + ' .lore-rail');
    need('设定 B 条目列可收成 40', listCollapse && Math.abs(listW1 - 40) <= 1 && vis(railList),
      '点收起键 → list ' + listW1 + 'px（期望 40±1）；细轨可见=' + vis(railList));
    click(LIST + ' .lore-rail');
    await wait(320);
    var listW2 = wOf(LIST);
    need('设定 B 条目列细轨可复原', Math.abs(listW2 - 300) <= 1, 'list ' + listW2 + 'px（期望 300±1）');
    var t0 = txt('.lore-detail-title');
    var cands = doc.querySelectorAll('.lore-detail-entries .lore-detail-entry');
    var pick = null;
    for (var ci = 0; ci < cands.length; ci++) {
      if (!cands[ci].classList.contains('selected')) { pick = cands[ci]; break; }
    }
    var pickName = pick ? String(pick.getAttribute('title') || pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18) : '';
    if (pick) pick.click();
    await wait(360);
    var t1 = txt('.lore-detail-title');
    need('设定 B 点条目切换阅读区', !!pick && !!t1 && t1 !== t0,
      '阅读区标题「' + t0 + '」→「' + t1 + '」（点的是「' + pickName + '」，候选 ' + cands.length + ' 条）');

    /* ---- C · 视觉导图（摘要列） ---- */
    await view('map');
    var detW0 = wOf(DETAIL);
    need('设定 C 摘要列 348', Math.abs(detW0 - 348) <= 1, 'detail 列宽 ' + detW0 + 'px（期望 348±1）');
    need('设定 C 页头 h1=视觉导图', txt('.lore-h1') === '视觉导图', 'h1=「' + txt('.lore-h1') + '」');
    need('设定 C 页头显示节点规模', !!q('.lore-pane[data-pane="main"] > .lore-head .lore-meta'),
      q('.lore-head .lore-meta') ? '仍有 .lore-meta' : 'ok');
    var detCollapse = click('.lore-map-insp-close');
    await wait(340);
    var detW1 = wOf(DETAIL), railDet = q(DETAIL + ' .lore-rail');
    need('设定 C 摘要列可收成 40', detCollapse && Math.abs(detW1 - 40) <= 1 && vis(railDet),
      '点收起键 → detail ' + detW1 + 'px（期望 40±1）；细轨可见=' + vis(railDet));
    click(DETAIL + ' .lore-rail');
    await wait(320);
    var detW2 = wOf(DETAIL);
    need('设定 C 摘要列细轨可复原', Math.abs(detW2 - 348) <= 1, 'detail ' + detW2 + 'px（期望 348±1）');

    /* ---- A · 页头 h1 与范围切换（set → all → set） ---- */
    await view('write');
    var h1A = txt('.lore-h1');
    need('设定 A 页头 h1=当前集名', !!setName && h1A === setName, 'h1=「' + h1A + '」集名=「' + setName + '」');
    need('设定 A 页头有概要行', !!q('.lore-pane[data-pane="main"] > .lore-head .lore-meta'),
      q('.lore-head .lore-meta') ? '「' + txt('.lore-head .lore-meta').slice(0, 60) + '」' : '未找到 .lore-meta');
    var scoped = click('.lore-scope');
    await wait(360);
    var headN = doc.querySelectorAll('.lore-set-head').length;
    var headNames = Array.prototype.map.call(doc.querySelectorAll('.lore-set-head'), function (x) {
      return String((x.querySelector('.ls-name') || x.querySelector('h2') || {}).textContent || '').trim();
    });
    need('设定 all 范围每集一个组头', scoped && setCount >= 2 && headN === setCount,
      '点 .lore-scope 后集头 ' + headN + ' 个 / 设定集 ' + setCount + ' 个 ' + JSON.stringify(headNames)
        + '；aria-pressed=' + (q('.lore-scope') ? q('.lore-scope').getAttribute('aria-pressed') : '?'));
    need('设定 all 范围 h1=全部设定', txt('.lore-h1') === '全部设定', 'h1=「' + txt('.lore-h1') + '」');
    var ed = q('.ob-editor'), head0 = q('.lore-set-head');
    if (ed && head0) {
      var edTop = ed.getBoundingClientRect().top;
      ed.scrollTop = 160;
      await wait(120);
      var headTop = head0.getBoundingClientRect().top;
      ed.scrollTop = 0;
      ev.loreSticky = { editor: Math.round(edTop), head: Math.round(headTop) };
      need('设定集头吸顶对齐滚动口', Math.abs(headTop - edTop) <= 1.5,
        'all 范围滚 160px 后：head.top=' + Math.round(headTop) + ' editor.top=' + Math.round(edTop));
    } else {
      need('设定集头吸顶对齐滚动口', false, 'all 范围下未渲染 .ob-editor 或 .lore-set-head');
    }
    /* 第三轮：集头宽度稳定（左右内缩 / 滚动条两态），外加单击改名。
       此时 scope 已是 all、每集一个 .mubu-set-head；第一个就代表全部（同一 --lore-pad-x 算出）。 */
    await setHeadProbe(width);
    if (width === 1280) await renameProbe();
    click('.lore-scope');
    await wait(360);
    var headBack = doc.querySelectorAll('.lore-set-head').length;
    need('设定切回 set 后组头归零', headBack === 0 && txt('.lore-h1') === setName,
      '切回后集头 ' + headBack + ' 个；h1=「' + txt('.lore-h1') + '」');
    /* ---- 默认设定集 + 类型体系（全部走应用自己的 store；raw IndexedDB 里预建 mubu 行会被 Dexie 升级清空）----
       空作品 → 打开设定 → 自动建六个默认集；已有六集再调 ensureDefaultMubuSets({onlyMissing:true}) 不应新增。 */
    var pin2 = pinia(frame), shelf2 = pin2 ? pin2._s.get('shelf') : null;
    var origWorkId = wk && wk.work ? wk.work.id : null;
    if (!shelf2 || !wk || !origWorkId) {
      need('设定空作品自动建六个默认集', false,
        'shelf store=' + !!shelf2 + ' work store=' + !!wk + ' 当前作品 id=' + origWorkId + '（缺一即无法建空作品）');
    } else {
      var setRows = [];
      try {
        /* 真实路径（2026-11-06 修复单后）：新建作品 → 打开 → 切设定，六个默认集由 repo.seedWorkDefaults 直接落库
           （DEFAULT_MUBU_SETS 是唯一真源），onMounted 的 ensureDefaultMubuSets() 只做兜底。 */
        var madeWork = await shelf2.createWork({ title: '验收空作品', withVolume: false });
        await wk.open(madeWork.id);
        await wait(260);
        var lorecatRows = (wk.lorecats || []).length;
        var rootsOnOpen = wk.mubuRoots().length;
        wk.tab = 'lore';
        /* ensureDefaultMubuSets 在 onMounted 里是 fire-and-forget：轮询到六行为止，别拿固定 sleep 赌时序。 */
        var tSets = Date.now();
        while (Date.now() - tSets < 8000 && doc.querySelectorAll('.lore-pane[data-pane="nav"] .category:not(.all-scope)').length < 6) await wait(200);
        await wait(260);
        setRows = doc.querySelectorAll('.lore-pane[data-pane="nav"] .category:not(.all-scope)');
        var setNames = [], setKinds = [], setIcons = [];
        Array.prototype.forEach.call(setRows, function (r) {
          var sp = r.querySelector('span');
          setNames.push(String(sp ? sp.textContent : '').replace(/\s+/g, ' ').trim());
          setKinds.push(r.getAttribute('data-kind'));
          var ds = [];
          Array.prototype.forEach.call(r.querySelectorAll('svg path'), function (p) { ds.push(p.getAttribute('d') || ''); });
          setIcons.push(ds.join('|'));
        });
        var uniqIcons = 0, seen = {};
        setIcons.forEach(function (d) { if (d && !seen[d]) { seen[d] = 1; uniqIcons++; } });
        ev.loreSets = {
          count: setRows.length, names: setNames, kinds: setKinds, distinctIconD: uniqIcons,
          lorecatRows: lorecatRows, rootsOnOpen: rootsOnOpen
        };
        need('设定空作品自动建六个默认集', setRows.length === 6
          && setNames.join('/') === '地理与场所/组织与势力/规则与禁忌/历史与纪年/物件与线索/民俗与信仰',
          '顶层集 ' + setRows.length + ' 个：' + JSON.stringify(setNames)
            + '（建作品时 lorecats 行数=' + lorecatRows + '；open 后 mubu 顶层 ' + rootsOnOpen + ' 个）');
        need('设定六个集 data-kind 依次对齐', setKinds.join(',') === 'place,faction,rule,history,object,belief',
          'data-kind=' + JSON.stringify(setKinds) + '（期望 place,faction,rule,history,object,belief）');
        need('设定六个集图标 d 不全相同', setRows.length === 6 && uniqIcons >= 2,
          '六行图标互不相同的 svg d 组合数=' + uniqIcons + '/6（要求两两不全相同，即 ≥2）'
            + '；每行 path 数=' + JSON.stringify(setIcons.map(function (d) { return d ? d.split('|').length : 0; })));
        need('设定新作品不再写旧设定集', lorecatRows === 0,
          'this.lorecats 行数=' + lorecatRows + '（要求 0：旧 lorecats 种子已删，六个默认集直接落 mubu 表）');
        /* 1440 档在这里要一张「新建作品 + 六集六种图标」的真机图（requestShot 由 Node 侧拍完再放行）。 */
        if (width === 1440) await requestShot('lore-v2-newwork-1440');
        /* 老作品回归：5 个旧分类没有 kind，靠 kindOf 的名称启发式判型，onlyMissing 只应补「民俗与信仰」一项。 */
        var oldWork = await shelf2.createWork({ title: '验收老作品', withVolume: false });
        await wk.open(oldWork.id);
        await wait(240);
        wk.mubuRoots().forEach(function (r) { wk.mubuRemove(r.id); });
        await wait(200);
        ['地点', '势力', '物品', '体系', '大事记'].forEach(function (t) { wk.mubuAdd(null, null, t); });
        await wait(220);
        var beforeOld = wk.mubuRoots().length;
        var addMissing = await wk.ensureDefaultMubuSets({ onlyMissing: true });
        await wait(240);
        var afterOld = wk.mubuRoots();
        var afterNames2 = afterOld.map(function (n) { return String(n.text || '').trim(); });
        var createdText = (addMissing.created || []).map(function (id) {
          var hit = wk.mubu.find(function (x) { return x.id === id; });
          return hit ? String(hit.text || '') : '?';
        });
        var dupes2 = afterNames2.filter(function (t2, i2) { return afterNames2.indexOf(t2) !== i2; });
        need('设定老作品 onlyMissing 只补一项', beforeOld === 5 && afterOld.length === 6
          && createdText.join('/') === '民俗与信仰' && !dupes2.length,
          '老作品 5 个旧分类 → ensureDefaultMubuSets({onlyMissing:true}) created=' + JSON.stringify(createdText)
            + ' skipped=' + JSON.stringify(addMissing.skipped || []) + '；顶层集 ' + beforeOld + ' → ' + afterOld.length
            + '；名称=' + JSON.stringify(afterNames2) + '；重名=' + JSON.stringify(dupes2));
        /* ---- 幂等：已有六集的作品再进设定，不得新增、不得重排（onlyMissing 对它是 no-op）----
           走真实入口：把 tab 切走再切回 lore，LoreWorkspace 重新挂载 → onMounted 的
           ensureDefaultMubuSets({onlyMissing:true}) 再跑一遍。 */
        await wk.open(madeWork.id);
        await wait(280);
        wk.tab = 'lore';
        await wait(900);
        var sixBefore = wk.mubuRoots().map(function (n) { return String(n.text || '').trim(); });
        wk.tab = 'chapters';
        await wait(340);
        wk.tab = 'lore';
        await wait(1150);
        var sixAfter = wk.mubuRoots().map(function (n) { return String(n.text || '').trim(); });
        var again = await wk.ensureDefaultMubuSets({ onlyMissing: true });
        await wait(220);
        var sixAfter2 = wk.mubuRoots().map(function (n) { return String(n.text || '').trim(); });
        ev.loreIdempotent = {
          before: sixBefore, afterRemount: sixAfter, afterDirect: sixAfter2,
          created: again.created || [], skipped: (again.skipped || []).length
        };
        need('设定已有六集再进设定不新增', sixBefore.length === 6 && sixAfter.length === 6
          && sixAfter.join('/') === sixBefore.join('/') && sixAfter2.join('/') === sixBefore.join('/')
          && (again.created || []).length === 0,
          '六集作品切走再切回设定：' + sixBefore.length + ' → ' + sixAfter.length + ' → ' + sixAfter2.length
            + ' 个顶层集；ensureDefaultMubuSets({onlyMissing:true}) created=' + JSON.stringify(again.created || [])
            + ' skipped=' + (again.skipped || []).length + ' 项；名称=' + JSON.stringify(sixAfter));
        /* ---- 缺两集的作品：onlyMissing 补齐后，原有集的相对顺序不得变（新集追加在末尾）---- */
        var missWork = await shelf2.createWork({ title: '验收缺两集', withVolume: false });
        await wk.open(missWork.id);
        await wait(340);
        var dropNames = ['规则与禁忌', '物件与线索'];
        wk.mubuRoots().forEach(function (r) { if (dropNames.indexOf(String(r.text || '').trim()) >= 0) wk.mubuRemove(r.id); });
        await wait(280);
        var keepNames = wk.mubuRoots().map(function (n) { return String(n.text || '').trim(); });
        var fill = await wk.ensureDefaultMubuSets({ onlyMissing: true });
        await wait(280);
        var filledAll = wk.mubuRoots().map(function (n) { return String(n.text || '').trim(); });
        var created2 = (fill.created || []).map(function (id) {
          var n2 = wk.mubu.find(function (x) { return x.id === id; });
          return n2 ? String(n2.text || '').trim() : '?';
        });
        var survivors = filledAll.filter(function (t3) { return keepNames.indexOf(t3) >= 0; });
        need('设定缺两集补齐后原集顺序不变', keepNames.length === 4 && (fill.created || []).length === 2
          && created2.slice().sort().join('/') === dropNames.slice().sort().join('/')
          && survivors.join('/') === keepNames.join('/') && filledAll.length === 6,
          '六集作品删掉 ' + JSON.stringify(dropNames) + ' → 剩 ' + JSON.stringify(keepNames)
            + '；ensureDefaultMubuSets({onlyMissing:true}) created=' + JSON.stringify(created2)
            + ' → 共 ' + filledAll.length + ' 个：' + JSON.stringify(filledAll)
            + '；原有集相对顺序=' + JSON.stringify(survivors) + '（要求与删后一致）');
      } catch (e) {
        need('设定空作品自动建六个默认集', false, '建空作品 / 切作品失败: ' + String(e && e.message || e));
      }
      /* 切回种子作品：截图要落回默认写视图的原状（Node 在探针返回后拍）。 */
      try {
        await wk.open(origWorkId);
        await wait(240);
        wk.tab = 'lore';
        await wait(900);
      } catch (e2) { st.restoreWorkErr = String(e2 && e2.message || e2); }
    }
  } else {
    /* ---- 窄档（≤1099）：nav 常驻细轨 + 抽屉 + 两屏 + 移动栏 ---- */
    var divs = doc.querySelectorAll('.lore-divider');
    var divVisible = 0;
    Array.prototype.forEach.call(divs, function (d) { if (vis(d)) divVisible++; });
    /* 2026-11-06 第二轮改判：窄档的 nav 不是「收起的抽屉」，而是常驻 40px 细轨（display:flex 恒真）。
       旧判据「不出三列 = nav 不可见」在新行为下恒假，改成量细轨宽 + 分隔条不可见；
       抽屉是否存在看 [data-drawer] / .lore-scrim，不再看 nav 可见性。 */
    var navEl = q(NAV), navDisp = navEl ? win.getComputedStyle(navEl).display : '未渲染';
    var navRailW = navEl ? px2(navEl.getBoundingClientRect().width) : -1;
    need('设定窄档 nav 常驻 40 细轨', Math.abs(navRailW - 40) <= 1 && navDisp === 'flex' && divVisible === 0,
      'nav 宽=' + navRailW + 'px（期望 40±1）display=' + navDisp + '（要求 flex 恒真）；可见分隔条 '
        + divVisible + '/' + divs.length + '；视口=' + width);
    var byCrumb = click('.lore-crumb-nav');
    await wait(360);
    var drawerEl = q(NAV), scrimEl = q('.lore-scrim'), shellEl = q('.lore-shell');
    need('设定窄档 crumb 开抽屉', byCrumb && vis(drawerEl) && vis(scrimEl) && !!shellEl && shellEl.getAttribute('data-drawer') === 'nav',
      '点 .lore-crumb-nav → nav 可见=' + vis(drawerEl) + '（宽 ' + (drawerEl && vis(drawerEl) ? px2(drawerEl.getBoundingClientRect().width) : -1) + 'px）'
        + '；遮罩可见=' + vis(scrimEl) + '；data-drawer=' + (shellEl ? shellEl.getAttribute('data-drawer') : '?'));
    try { win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { st.escErr = String(e && e.message || e); }
    await wait(340);
    var drawerAfterEsc = !!q('.lore-shell[data-drawer="nav"]');
    need('设定窄档 Esc 关抽屉', !drawerAfterEsc && !vis(q('.lore-scrim')),
      'Esc 后 [data-drawer] 仍在=' + drawerAfterEsc + ' 遮罩可见=' + vis(q('.lore-scrim'))
        + '（改判：nav 是常驻 40 细轨、恒可见，抽屉开合只看 data-drawer 与遮罩）');
    click('.lore-crumb-nav');
    await wait(340);
    var scrimShown = vis(q('.lore-scrim'));
    click('.lore-scrim');
    await wait(340);
    var drawerAfterScrim = !!q('.lore-shell[data-drawer="nav"]');
    need('设定窄档点遮罩关抽屉', scrimShown && !drawerAfterScrim && !vis(q('.lore-scrim')),
      '再开后遮罩可见=' + scrimShown + '；点遮罩后 [data-drawer] 仍在=' + drawerAfterScrim
        + ' 遮罩可见=' + vis(q('.lore-scrim')) + '（改判：不看 nav 可见性）');
    if (width >= 600) {
      click('.lore-crumb-nav');
      await wait(340);
      var dw = drawerEl ? px2(drawerEl.getBoundingClientRect().width) : -1;
      need('设定窄档抽屉宽 270', Math.abs(dw - 270) <= 1, '抽屉实测 ' + dw + 'px（期望 270±1）视口=' + width);
      click('.lore-scrim');
      await wait(300);
    }
    var se = doc.documentElement;
    need('设定窄档无横向溢出', se.scrollWidth <= se.clientWidth && (!shellEl || shellEl.scrollWidth <= shellEl.clientWidth + 1),
      'document ' + se.scrollWidth + '<=' + se.clientWidth + '；shell '
        + (shellEl ? shellEl.scrollWidth + '<=' + shellEl.clientWidth : '未找到'));
    await view('detail');
    var shell2 = q('.lore-shell');
    var screen2 = shell2 ? shell2.getAttribute('data-screen') : '?';
    /* 2026-11-06 第二轮：窄档进详情默认停在正文屏 main（旧行为停在 list，导致页头/正文/页脚整块离屏，
       也就是用户报的「详情界面不全」）。列表屏改为移动栏左键 / 阅读区「← 条目列表」显式进入。 */
    need('设定 B 窄档默认正文屏 main', screen2 === 'main' && vis(q(MAIN)) && !vis(q(LIST)),
      'data-screen=' + screen2 + '（期望 main）；main 可见=' + vis(q(MAIN)) + ' list 可见=' + vis(q(LIST)));
    need('设定窄档 list/detail 不在当前屏', !vis(q(LIST)) && !vis(q(DETAIL)),
      'main 屏下 list 可见=' + vis(q(LIST)) + ' detail 可见=' + vis(q(DETAIL)) + '；data-screen=' + screen2
        + '（窄档三列改判：只有 nav 常驻细轨，list/detail 随 data-screen 离屏）');
    /* 第三轮（2026-11-06）：窄档移动栏 .lore-mobile-bar 整条已删，回列表入口改成阅读区里的一颗 pill
       （.lore-detail-return > button.lore-mobile-back「条目列表」，:list-back="narrow"）。
       原「设定 B 窄档回列表入口=移动栏左键」「设定详情不再有阅读区返回键」两条随旧 DOM 一起删掉：
       前者判的 .lore-mobile-btn 已不存在，后者恰好把新实现的 pill 判成红。 */
    var pick2 = doc.querySelector('.lore-detail-entries .lore-detail-entry');
    if (pick2) click(pick2);
    await wait(380);
    var shell3 = q('.lore-shell');
    need('设定 B 窄档点条目回正文屏', !!shell3 && shell3.getAttribute('data-screen') === 'main' && vis(q(MAIN)) && !vis(q(LIST)),
      '点列表项后 data-screen=' + (shell3 ? shell3.getAttribute('data-screen') : '?') + '；main 可见=' + vis(q(MAIN))
        + ' list 可见=' + vis(q(LIST)) + '；视口=' + width);
    /* 阅读区「返回」按钮改由返回栈决定：v-if="canBack" ← :can-back="ui.loreReturn.length > 0"。 */
    var retLen = ui && ui.loreReturn ? ui.loreReturn.length : -1;
    var retBtns = Array.prototype.filter.call(doc.querySelectorAll('.lore-detail-return button'), function (b) {
      return String(b.textContent || '').indexOf('返回') >= 0;
    }).length;
    var retWant = retLen > 0 ? 1 : 0;
    need('设定详情返回按钮按 loreReturn 渲染', retLen >= 0 && retBtns === retWant,
      'ui.loreReturn.length=' + retLen + ' → .lore-detail-return 里「返回」按钮 ' + retBtns + ' 个（期望 ' + retWant + '）');
    /* ---- 窄档 pill 闭环（1000 / 760 / 380 各一条）：正文屏里那颗「条目列表」→ 点它进列表屏 → 点条目回正文屏。
       这是第三轮改判的核心：回列表入口从整条移动栏收成阅读区里的一颗 pill。 ---- */
    var pill0 = q('.lore-detail-return .lore-mobile-back');
    var pillTxt = pill0 ? String(pill0.textContent || '').trim() : '(缺)';
    var pillVis = vis(pill0);
    var pillClicked = click(pill0);
    await wait(400);
    var shellPill = q('.lore-shell');
    var pillTo = shellPill ? shellPill.getAttribute('data-screen') : '?';
    var pillListVis = vis(q(LIST)), pillMainVis = vis(q(MAIN));
    var pillToList = pillTo === 'list' && pillListVis && !pillMainVis;
    var pickP = doc.querySelector('.lore-detail-entries .lore-detail-entry');
    if (pickP) click(pickP);
    await wait(420);
    var shellPill2 = q('.lore-shell');
    var pillTo2 = shellPill2 ? shellPill2.getAttribute('data-screen') : '?';
    var pillBackMainVis = vis(q(MAIN)), pillBackListVis = vis(q(LIST));
    var pillBack = pillTo2 === 'main' && pillBackMainVis && !pillBackListVis;
    need('设定窄档 pill 回列表闭环', pillVis && pillTxt.indexOf('条目列表') >= 0 && pillClicked && pillToList && pillBack,
      '.lore-detail-return .lore-mobile-back 可见=' + pillVis + ' 文案=「' + pillTxt + '」；点它 → data-screen=' + pillTo
        + '（list 可见=' + pillListVis + ' main 可见=' + pillMainVis + '）；再点条目 → data-screen=' + pillTo2
        + '（main 可见=' + pillBackMainVis + ' list 可见=' + pillBackListVis + '）；视口=' + width);
    if (width === 760) {
      var swN = doc.querySelectorAll('.lore-switch button');
      need('设定详情完整（窄 760）', !!q(MAIN + ' > .lore-head') && txt('.lore-h1') === txt('.lore-detail-title') && swN.length === 3
        && !!q('.lore-detail-title') && !!q('.lore-detail-footer'),
        'main 屏五件套：页头=' + !!q(MAIN + ' > .lore-head') + ' h1=「' + txt('.lore-h1') + '」视图按钮=' + swN.length
          + ' 阅读区标题=' + !!q('.lore-detail-title') + ' 页脚=' + !!q('.lore-detail-footer'));
    }
    /* 集头宽度稳定 + 滚动条两态：第三轮新增，五档各量一次（宽窄同源，都是 --lore-pad-x 算出来的）。 */
    await setHeadProbe(width);
    await view('map');
    need('设定 C 窄档返回键齐备', doc.querySelectorAll('.lore-mobile-back').length >= 2,
      'C 视图 .lore-mobile-back 共 ' + doc.querySelectorAll('.lore-mobile-back').length + ' 个（导图子条「摘要」/ 摘要列「‹ 视觉导图」）；当前可见 '
        + visibleCount('.lore-mobile-back') + ' 个');
    /* C 视图两颗 pill 各走一步：导图子条「摘要」→ 摘要屏；摘要屏「‹ 视觉导图」→ 回导图主屏。 */
    var cPillFrom = q('.lore-map-subbar .lore-mobile-back');
    var cPillTo = q('.lore-pane[data-pane="detail"] .lore-mobile-back');
    var cPillFromTxt = cPillFrom ? String(cPillFrom.textContent || '').trim() : '(缺)';
    var cPillToTxt = cPillTo ? String(cPillTo.textContent || '').trim() : '(缺)';
    var cScreen0 = q('.lore-shell') ? q('.lore-shell').getAttribute('data-screen') : '?';
    var cClick1 = click(cPillFrom);
    await wait(400);
    var shellC1 = q('.lore-shell');
    var cScreen1 = shellC1 ? shellC1.getAttribute('data-screen') : '?';
    var cInspVis1 = vis(q(DETAIL));
    var toInsp = cScreen1 === 'insp' && cInspVis1;
    var cClick2 = click(cPillTo);
    await wait(400);
    var shellC2 = q('.lore-shell');
    var cScreen2 = shellC2 ? shellC2.getAttribute('data-screen') : '?';
    var cMainVis2 = vis(q(MAIN)), cInspVis2 = vis(q(DETAIL));
    var backMapMain = cScreen2 === 'main' && cMainVis2;
    need('设定 C 窄档两颗 pill 互切', cClick1 && toInsp && cClick2 && backMapMain,
      '导图主屏 data-screen=' + cScreen0 + '；点导图子条「' + cPillFromTxt + '」→ data-screen=' + cScreen1
        + '（摘要列可见=' + cInspVis1 + '）；再点摘要屏「' + cPillToTxt + '」→ data-screen=' + cScreen2
        + '（main 可见=' + cMainVis2 + ' 摘要列可见=' + cInspVis2 + '）；视口=' + width);
  }

  /* 第四轮（2026-11-06）：关系网络 / 空态 / 全部设定总览。放在收尾复原之前跑，
     跑完再统一复原成「默认写视图 + set 范围」，截图不继承探针态。 */
  try {
    await loreGraphProbe(frame, out, width);
    await loreHierarchyProbe(frame, out, width);
    /* 第五轮：行首圆点几何只在 lore-1280 档断言（同一份 CSS、与屏宽无关，逐档重复只会拉长跑时）。 */
    if (width === 1280) await loreRowAlignProbe(frame, out, width);
  } catch (eG) {
    need('设定导图第四轮探针可跑', false, '探针抛错（视口=' + width + '）: ' + String(eG && eG.message || eG));
  }

  /* 收尾：回到默认写视图 + 三列全展开 + scope=set。 */
  try {
    if (ui) {
      if (ui.loreView !== 'write') ui.setLoreView('write');
      if (ui.loreNavClosed) await ui.setPref('loreNavClosed', false);
      if (ui.loreListClosed) await ui.setPref('loreListClosed', false);
      if (ui.loreDetailClosed) await ui.setPref('loreDetailClosed', false);
      if (ui.loreScope !== 'set') await ui.setPref('loreScope', 'set');
    }
  } catch (e9) { st.restoreErr = String(e9 && e9.message || e9); }
  await wait(360);
  ev.loreMatrix = st;
  out.ok = out.items.every(function (i) { return i.pass; });
  return out;
}

/* ===== 人物 · 面板矩阵（2026-11-05 融合总稿） =====
   外壳 roster | 16 | main | 16 | context 由 CharactersWorkspace.vue 渲染，数据全在 work / ui 两个 store，
   所以造数与断言一律走 store + 真机点路径（与 loreMatrixProbe 同一套写法、同一套「实测 …（期望 …）」证据串）。
   期望值出处：chars-shell.css 的 grid-template-columns + char-layout.js 的 CHAR_PANE 默认值
   （profile 248/304、graph 220/332）；docs/前端美化/人物-融合总稿-20261105/report.json 的实测几何
   （1440 = 28..276 / 292..1092 / 1108..1412；1280 = 28..276 / 292..932 / 948..1252；760 单块 20..740；380 单块 12..368）。
   页头两套 DOM：卷宗是 .char-module-head + .char-crumbs + .char-segmented，剧场沿用 .module-head + .breadcrumbs
   + .segmented —— 设计稿的 .module-head / .segmented / .pane-foot 一族类名实现给卷宗那套加了 char- 前缀，
   这里按真机 DOM 取选择器，判据（h1 文案 / 两粒切换 / 两颗收起键 / 三段底栏）与设计稿一字不差。
   reload 级复验（刷新后仍记住视图）属 scripts/compare-characters.mjs，本探针只读本轮 work.charView。 */
async function charMatrixProbe(frame, out, width) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var ROSTER = '.char-pane[data-pane="roster"]', MAIN = '.char-pane[data-pane="main"]', CONTEXT = '.char-pane[data-pane="context"]', SHELL = '.char-shell';
  var PAD = width <= 559 ? 12 : 20, wide = width >= 1100, phone = width <= 559, st = {};
  /* 本轮修正后的设计稿真值（node 直读），期望按档位取自 chars-dossier.css / chars-roster.css 的当前值：
     基准（>1320）= max-width 860 / padding 35-36-38 / 头像 82x105 / 小传 15px / 小节间距 33 / 页头 min-height 112；
     1100–1320 中档 = padding 30-27 / 头像 70x93；≤1099 = max-width 800 / padding 30-35-40 / 头像 80x100 / 页头 105；
     ≤559 = padding 26-22-32 / 头像 63x84 / 小传 14px / 小节间距 27 / 页头 108。 */
  var midW = width >= 1100 && width <= 1320;
  var EXP = {
    dossierMax: wide ? '860px' : '800px',
    dossierPad: phone ? [26, 22, 32, 22] : (midW ? [30, 27, 30, 27] : (wide ? [35, 36, 38, 36] : [30, 35, 40, 35])),
    portraitW: phone ? 63 : (midW ? 70 : (wide ? 82 : 80)),
    portraitH: phone ? 84 : (midW ? 93 : (wide ? 105 : 100)),
    proseFs: phone ? 14 : 15,
    secGap: phone ? 27 : 33,
    headMinH: phone ? 108 : (wide ? 112 : 105),
    rosterPad: [21, 20, 16, 20]
  };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function need(name, ok, e) { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  function px2(v) { return Math.round(parseFloat(v) * 10) / 10; }
  function q(sel) { return doc.querySelector(sel); }
  function vis(n) { if (!n) return false; var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function rect(n) { if (!n) return null; var r = n.getBoundingClientRect(); return { l: px2(r.left), r: px2(r.right), t: px2(r.top), b: px2(r.bottom), w: px2(r.width), h: px2(r.height) }; }
  function wOf(sel) { var n = q(sel); return n && vis(n) ? px2(n.getBoundingClientRect().width) : -1; }
  function hOf(sel) { var n = q(sel); return n && vis(n) ? px2(n.getBoundingClientRect().height) : -1; }
  function count(sel) { return doc.querySelectorAll(sel).length; }
  function pad4(cs) { return [px2(cs.paddingTop), px2(cs.paddingRight), px2(cs.paddingBottom), px2(cs.paddingLeft)]; }
  function padOk(cs, want) { var g = pad4(cs); return g[0] === want[0] && g[1] === want[1] && g[2] === want[2] && g[3] === want[3]; }
  function padStr(cs) { return pad4(cs).join('/'); }
  function click(x) { var n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
  function setInput(el, v) { if (!el) return false; el.focus(); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); return true; }
  function byText(sel, want) { var l = doc.querySelectorAll(sel); for (var i = 0; i < l.length; i++) { if (flat(l[i].textContent).indexOf(want) >= 0) return l[i]; } return null; }
  /* 本函数整段住在外层模板串里，写不得转义序列（模板串会把反斜杠吃掉），空白归一化手写、不走正则。 */
  function flat(s) {
    var src = String(s === null || s === undefined ? '' : s), acc = '', sp = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i), cc = ch.charCodeAt(0);
      if (cc === 32 || cc === 9 || cc === 10 || cc === 13) { sp = true; continue; }
      if (sp && acc) acc += ' ';
      sp = false; acc += ch;
    }
    return acc.trim();
  }
  function txt(sel) { var n = q(sel); return n ? flat(n.textContent) : ''; }
  /* appconfig 落库证据（与 loreMatrixProbe 同一读法）：直接读 IndexedDB，不 reload —— reload 会把本场景的页面语境换掉。 */
  function readPref(key) {
    return new Promise(function (res) {
      var done = false;
      function fin(v) { if (!done) { done = true; res(v); } }
      function openNamed(name) {
        var rq = win.indexedDB.open(name);
        rq.onerror = function () { fin('打开 ' + name + ' 失败'); };
        rq.onsuccess = function () {
          var db = rq.result;
          if (Array.prototype.slice.call(db.objectStoreNames || []).indexOf('appconfig') < 0) { db.close(); return fin('无 appconfig 表'); }
          try {
            var get = db.transaction('appconfig', 'readonly').objectStore('appconfig').get(key);
            get.onsuccess = function () { var row = get.result; try { db.close(); } catch (e) { /* 已关 */ } fin(row ? row.value : '(无此行)'); };
            get.onerror = function () { try { db.close(); } catch (e) { /* 已关 */ } fin('读 appconfig 失败'); };
          } catch (e) { try { db.close(); } catch (e2) { /* 已关 */ } fin('事务失败: ' + String(e && e.message || e)); }
        };
      }
      try {
        var dl = win.indexedDB.databases ? win.indexedDB.databases() : null;
        if (!dl) return fin('indexedDB.databases() 不可用');
        dl.then(function (list) {
          var hit = (list || []).filter(function (d) { return String(d && d.name || '').indexOf('novel-studio') >= 0; });
          if (!hit.length) return fin('未找到 novel-studio 库');
          openNamed(hit[0].name);
        }).catch(function (e) { fin('databases() 失败: ' + String(e && e.message || e)); });
      } catch (e) { fin('IndexedDB 不可用: ' + String(e && e.message || e)); }
    });
  }
  var wk = workStore(frame), ui = uiStore(frame);
  if (!wk || !ui) { need('人物工作区外壳可测', false, 'work/ui store 缺失（pinia._s.get 为空）'); out.ok = false; return out; }
  function me() { for (var i = 0; i < wk.characters.length; i++) { var c = wk.characters[i]; if (c.id === wk.selCharacterId && !c.deletedAt) return c; } return null; }
  function relsOf(id) {
    var n = 0;
    for (var i = 0; i < wk.relations.length; i++) {
      var r = wk.relations[i];
      if (r.fromId !== id && r.toId !== id) continue;
      var other = r.fromId === id ? r.toId : r.fromId;
      for (var j = 0; j < wk.characters.length; j++) { if (wk.characters[j].id === other && !wk.characters[j].deletedAt) { n++; break; } }
    }
    return n;
  }
  /* 造数：本场景的库是全新的（seedDb 只建 works / chapters），人物一律走应用自己的 store。
     三个种子人物覆盖卷宗五件套（姓名 / 角色 / 别名 / 标签 / 一句话 / 自定义字段 / 小传），
     两条人物关系 + 一条「人物 → 设定」关联，让右列与剧场都有真数据可数。 */
  var SEED = [
    ['沈砚舟', '主角/导师', '沈九/老沈', ['雾港', '守灯人'], '灯亮着的人才算活着。', '守灯人协会的第三任会长。', '三十年没让北湾的灯灭过一次。'],
    ['白鹭', '配角', '鹭娘', ['雾港', '航运'], '她只在退潮的时候说话。', '北岸航运局的记账人。', '替所有没有编号的船记过账。'],
    ['温叙', '反派', '叙先生', ['灯塔'], '第七个名字是他的。', '灯塔管委会的主任。', '从不独自进灯室。']
  ];
  try {
    var guard = 0;
    while (wk.liveCharacters.length < SEED.length && guard < 8) {
      var meta = SEED[wk.liveCharacters.length], made = wk.addCharacter(meta[0]);
      wk.updateCharacter(made.id, { role: meta[1], aliases: meta[2], tags: meta[3], fields: { '一句话': meta[4], '身份': meta[5] }, content: meta[6] });
      guard++;
    }
    var ids = wk.liveCharacters.map(function (c) { return c.id; });
    if (ids.length >= 3 && !wk.relations.length) { wk.addRelation(ids[0], ids[1], '师徒'); wk.addRelation(ids[1], ids[2], '宿敌'); }
    var mubu0 = wk.mubu && wk.mubu.length ? wk.mubu[0] : null;
    if (mubu0 && ids.length && !wk.loreLinksOf('character', ids[0]).length) wk.addLoreLink({ fromKind: 'character', fromId: ids[0], toKind: 'mubu', toId: mubu0.id, label: '出身' });
    if (ids.length) wk.selCharacterId = ids[0];
    wk.setCharView('list');
  } catch (e1) { st.seedErr = String(e1 && e1.message || e1); }
  try {
    var p0 = JSON.parse(JSON.stringify(ui.charPrefs || {}));
    p0.profile = Object.assign({}, p0.profile || {}, { left: 248, right: 304, leftClosed: false, rightClosed: false });
    p0.graph = Object.assign({}, p0.graph || {}, { left: 220, right: 332, leftClosed: false, rightClosed: false });
    await ui.setPref('charPrefs', p0);
    ui.charQuery = ''; ui.charRole = ''; ui.charTag = ''; ui.charScope = 'local';
  } catch (e2) { st.normalizeErr = String(e2 && e2.message || e2); }
  await wait(460);
  var shellEl = q(SHELL), rR = rect(q(ROSTER)), mR = rect(q(MAIN)), cR = rect(q(CONTEXT));
  var cur = me(), cid = cur ? cur.id : '', curName = cur ? String(cur.name || '') : '';
  need('人物外壳 .char-shell 渲染', !!shellEl && vis(shellEl), shellEl ? 'shell ' + px2(shellEl.getBoundingClientRect().width) + 'x' + px2(shellEl.getBoundingClientRect().height) + ' data-view=' + shellEl.getAttribute('data-view') + ' data-screen=' + shellEl.getAttribute('data-screen') : '未找到 .char-shell（CharactersWorkspace 未挂载）');
  /* 宽档三列都得真渲染；窄档只该有单列（另两条窄档断言守单列与两屏），故这里只对宽档要求三列可见。 */
  need('人物三列同时渲染', !!mR && vis(q(MAIN)) && (wide ? (vis(q(ROSTER)) && vis(q(CONTEXT))) : true),
    'roster=' + (rR ? rR.w + 'px 可见=' + vis(q(ROSTER)) : '缺') + ' main=' + (mR ? mR.w + 'px 可见=' + vis(q(MAIN)) : '缺') + ' context=' + (cR ? cR.w + 'px 可见=' + vis(q(CONTEXT)) : '缺') + '（宽档要求三列全可见）');
  if (wide) {
    /* ---- 三列几何：设计稿 1440 = 28..276 / 292..1092 / 1108..1412，1280 = 28..276 / 292..932 / 948..1252 ---- */
    var divs = doc.querySelectorAll('.char-divider'), divW = [], divVis = 0;
    Array.prototype.forEach.call(divs, function (d) { var x = rect(d); if (x && x.w > 0) divW.push(x.w); if (vis(d)) divVis++; });
    need('人物两条 16px 分隔条', divs.length === 2 && divVis === 2 && divW.length === 2 && Math.abs(divW[0] - 16) <= 1 && Math.abs(divW[1] - 16) <= 1, '分隔条 ' + divs.length + ' 条（可见 ' + divVis + '）列宽 ' + divW.join(' / ') + 'px（期望 16 / 16 ±1）');
    need('人物名录列宽 248', !!rR && Math.abs(rR.w - 248) <= 1, 'roster 实测 ' + (rR ? rR.w : -1) + 'px（期望 248±1 = CHAR_PANE.profile.left.def）视口=' + width);
    need('人物右列宽 304', !!cR && Math.abs(cR.w - 304) <= 1, 'context 实测 ' + (cR ? cR.w : -1) + 'px（期望 304±1 = CHAR_PANE.profile.right.def）');
    need('人物主区吃掉剩余宽度', !!mR && Math.abs(mR.w - (width - 640)) <= 1, 'main 实测 ' + (mR ? mR.w : -1) + 'px（期望 ' + (width - 640) + '±1 = 视口 - 56 留白 - 32 两条分隔 - 248 - 304）');
    need('人物三列落在设计稿几何上', !!rR && !!mR && !!cR && Math.abs(rR.l - 28) <= 1 && Math.abs(mR.l - 292) <= 1 && Math.abs(mR.r - (width - 348)) <= 1 && Math.abs(cR.l - (width - 332)) <= 1 && Math.abs(cR.r - (width - 28)) <= 1,
      'roster ' + (rR ? rR.l + '..' + rR.r : '?') + ' / main ' + (mR ? mR.l + '..' + mR.r : '?') + ' / context ' + (cR ? cR.l + '..' + cR.r : '?') + '（期望 28..276 / 292..' + (width - 348) + ' / ' + (width - 332) + '..' + (width - 28) + '）');
    var barEl = q('.app-topbar'), barB = barEl ? px2(barEl.getBoundingClientRect().bottom) : -1;
    need('人物列上下沿对齐设计稿', !!rR && Math.abs(rR.t - (barB + 24)) <= 1 && Math.abs(rR.b - (win.innerHeight - 30)) <= 1,
      'pane.top=' + (rR ? rR.t : -1) + '（期望 顶栏底 ' + barB + ' + 24 = 108）pane.bottom=' + (rR ? rR.b : -1) + '（期望 视口高 ' + win.innerHeight + ' - 30）');
    /* ---- 页头 ---- */
    var h1 = txt('.char-module-head h1');
    need('卷宗页头 h1=人物卷宗', h1 === '人物卷宗', 'h1=「' + h1 + '」（原型 moduleHead("人物卷宗")：页头是固定标题，人物名改由 identity 的 h2 承担；当前人物=「' + curName + '」）');
    need('卷宗页头有面包屑', txt('.char-crumbs').indexOf('人物') >= 0, '面包屑=「' + txt('.char-crumbs') + '」（期望 书名 › 人物）');
    var segB = doc.querySelectorAll('.char-segmented button');
    var segTxt = Array.prototype.map.call(segB, function (b) { return flat(b.textContent); }).join('/');
    need('卷宗视图切换两粒', segB.length === 2 && segTxt === '人物卷宗/关系剧场', '切换项 ' + segB.length + ' 个 → 「' + segTxt + '」');
    need('宽档两颗收起键可见', vis(q('.char-head-toggle[data-act="toggle-left"]')) && vis(q('.char-head-toggle[data-act="toggle-right"]')),
      'toggle-left 可见=' + vis(q('.char-head-toggle[data-act="toggle-left"]')) + ' toggle-right 可见=' + vis(q('.char-head-toggle[data-act="toggle-right"]')) + '（宽档 ≥1100 才有，≤1099 收进顶部工具条）');
    need('页头住在 main 列', !!q(MAIN + ' > .char-dossier-wrap > .char-module-head'), q(MAIN + ' > .char-dossier-wrap > .char-module-head') ? 'ok' : '页头不在 .char-pane[data-pane=main] 内');
    /* ---- 名录 ---- */
    var search = q('.char-search input');
    need('名录搜索框占位文案', !!search && search.getAttribute('placeholder') === '搜索姓名、别名、标签…', search ? 'placeholder=「' + search.getAttribute('placeholder') + '」' : '未找到 .char-search input');
    need('名录两个筛选下拉', count('.char-filters select') === 2, 'select ' + count('.char-filters select') + ' 个（期望 2：角色 / 标签）');
    var labelTxt = txt('.char-roster-label'), persons = doc.querySelectorAll('.char-person');
    need('名录计数行与行数一致', labelTxt.indexOf(String(wk.liveCharacters.length) + ' 人') >= 0 && persons.length === wk.liveCharacters.length,
      '计数行=「' + labelTxt + '」人物行 ' + persons.length + ' 个（期望 = work.liveCharacters ' + wk.liveCharacters.length + ' 个）');
    var otherRow = null;
    for (var pi = 0; pi < persons.length; pi++) { if (!persons[pi].classList.contains('on')) { otherRow = persons[pi]; break; } }
    var selBefore = wk.selCharacterId;
    if (otherRow) { otherRow.click(); await wait(340); }
    var pickedRow = me();
    need('名录点行切换选中', !!otherRow && wk.selCharacterId !== selBefore && !!pickedRow, '点非选中行 → work.selCharacterId ' + (wk.selCharacterId === selBefore ? '未变' : '切到「' + (pickedRow ? pickedRow.name : '?') + '」'));
    need('名录选中行带 aria-current', count('.char-person[aria-current="true"]') === 1, '选中行标记 ' + count('.char-person[aria-current="true"]') + ' 个（期望 1）');
    need('名录页脚新建人物', txt('.char-roster-foot .char-btn').indexOf('新建人物') >= 0, '页脚=「' + txt('.char-roster-foot .char-btn') + '」（点它会 work.addCharacter 并选中新行）');
    if (cid) { wk.selCharacterId = cid; await wait(320); }
    cur = me(); curName = cur ? String(cur.name || '') : '';
    /* ---- 卷宗（阅读态五件套 + 01/02/03 三段） ---- */
    need('卷宗身份 h2=姓名', txt('.char-identity h2') === curName, 'h2=「' + txt('.char-identity h2') + '」当前人物=「' + curName + '」');
    need('卷宗角色点行', !!q('.char-identity .char-role-mark') && txt('.char-identity .char-role-mark').length > 0, '角色点行=「' + txt('.char-identity .char-role-mark') + '」（role-mark::before 是那颗 5px 圆点）');
    need('卷宗别名行', txt('.char-aliases') === String((cur && cur.aliases) || '尚未填写别名'), '别名=「' + txt('.char-aliases') + '」');
    need('卷宗标签 chips', count('.char-tags .char-tag') === ((cur && cur.tags) || []).length, 'chips ' + count('.char-tags .char-tag') + ' 个（期望 = tags ' + ((cur && cur.tags) || []).length + ' 个）');
    need('卷宗一句话小注', txt('.char-identity-note').length > 0, '小注=「' + txt('.char-identity-note') + '」（fields 里的一句话说清人物位置）');
    var idxArr = Array.prototype.map.call(doc.querySelectorAll('.char-section-index'), function (x) { return flat(x.textContent); });
    var hsArr = Array.prototype.map.call(doc.querySelectorAll('.char-section-head h3'), function (x) { return flat(x.textContent); });
    need('卷宗 01 人物小传', idxArr[0] === '01' && hsArr[0] === '人物小传' && count('.char-prose p') > 0, '段号=' + idxArr.join('/') + ' 标题=' + hsArr.join('/') + ' 小传段 ' + count('.char-prose p') + ' 段');
    need('卷宗 02 自定义字段', idxArr[1] === '02' && hsArr[1] === '自定义字段' && count('.char-field-item') === 1, '段号/标题=' + idxArr[1] + '/' + hsArr[1] + ' 字段行 ' + count('.char-field-item') + ' 行（期望 1：fields 里除「一句话」只剩「身份」）');
    need('卷宗 03 关联关系', idxArr[2] === '03' && String(hsArr[2] || '').indexOf('关联关系') >= 0, '段号/标题=' + idxArr[2] + '/' + hsArr[2] + '（与右列同一数据源，条数在右列判）');
    need('卷宗页脚编辑档案', txt('.char-pane-foot .char-btn').indexOf('编辑档案') >= 0, '页脚按钮=「' + txt('.char-pane-foot .char-btn') + '」');
    /* ---- 编辑态：点「编辑档案」→ 表单 → 改名 → 完成 → store 里已生效（即时落库，没有草稿层） ---- */
    var editClick = click('.char-pane-foot .char-btn');
    await wait(400);
    var nameInp = q('.char-edit .char-name-input');
    need('点编辑档案进编辑态', editClick && !!q('.char-edit') && !!nameInp, '点「编辑档案」→ .char-edit ' + (q('.char-edit') ? '出现' : '未出现') + '，姓名输入 ' + (nameInp ? '在' : '缺'));
    need('编辑态自定义字段可增删', !!q('.char-edit .char-field-editor-title') && count('.char-edit .char-custom-field') === 1 && count('.char-edit .char-custom-field .char-icon-btn') === 1,
      '字段编辑区=' + !!q('.char-edit .char-field-editor-title') + ' 字段行 ' + count('.char-edit .char-custom-field') + ' 行，移除键 ' + count('.char-edit .char-custom-field .char-icon-btn') + ' 个（另有「添加字段」）');
    var doneBtn = q('.char-edit-buttons .char-btn.primary'), cancelBtn = byText('.char-edit .char-btn', '取消');
    need('编辑态取消与完成齐全', !!doneBtn && !!cancelBtn && flat(doneBtn.textContent) === '完成', '取消=' + !!cancelBtn + ' 完成=' + (doneBtn ? '「' + flat(doneBtn.textContent) + '」' : '缺'));
    var typedName = curName + '改';
    setInput(nameInp, typedName);
    await wait(280);
    var liveName = me() ? String(me().name || '') : '';
    if (doneBtn) doneBtn.click();
    await wait(380);
    var afterName = me() ? String(me().name || '') : '';
    need('编辑改字即时写库', liveName === typedName, '输入框写入「' + typedName + '」→ work.updateCharacter 后 store.name=「' + liveName + '」');
    need('点完成退出编辑并保留改动', afterName === typedName && !q('.char-edit'), '完成 → store.name=「' + afterName + '」编辑表单仍在=' + !!q('.char-edit'));
    if (cid) { wk.updateCharacter(cid, { name: curName }); await wait(260); }
    /* ---- 右列（关系与设定） ---- */
    need('右列列头 inspector-label', !!q(CONTEXT + ' .inspector-label'), q(CONTEXT + ' .inspector-label') ? '列头=「' + txt(CONTEXT + ' .inspector-heading') + '」' : '未找到 .inspector-label');
    var miniH = hOf(CONTEXT + ' .mini-network');
    need('右列小关系网高 65', Math.abs(miniH - 65) <= 1, 'mini-network 实测高 ' + miniH + 'px（期望 65±1，fusion.css:4）');
    var relN = cid ? relsOf(cid) : -1, loreN = cid ? wk.loreLinksOf('character', cid).length : -1;
    need('右列关系行数=该人物关系数', count(CONTEXT + ' .relation-row') === relN, 'relation-row ' + count(CONTEXT + ' .relation-row') + ' 行（期望 = ' + relN + ' 条：work.relations 两向取对端）');
    need('右列关联设定行', txt(CONTEXT + ' .context-section:nth-of-type(2) h3').indexOf('关联设定') >= 0 && count(CONTEXT + ' .lore-row') === loreN,
      '分区标题=「' + txt(CONTEXT + ' .context-section:nth-of-type(2) h3') + '」设定行 ' + count(CONTEXT + ' .lore-row') + ' 行（期望 ' + loreN + ' 条 = loreLinksOf(character)）');
    var footBtn0 = byText(CONTEXT + ' .pane-foot .btn', '在关系图中查看');
    need('右列页脚在关系图中查看', !!footBtn0, footBtn0 ? '页脚按钮=「' + flat(footBtn0.textContent) + '」' : '未找到「在关系图中查看」');
    /* ---- 收起 / 展开：两颗收起键 → 44 细轨 → 点细轨复原，并读 appconfig.charPrefs ---- */
    var leftClick = click('.char-head-toggle[data-act="toggle-left"]');
    await wait(420);
    var railL = q(ROSTER + ' .char-rail');
    need('收起人物名录取 44 细轨', leftClick && Math.abs(wOf(ROSTER) - 44) <= 1 && vis(railL), '点 toggle-left → roster ' + wOf(ROSTER) + 'px（期望 44±1 = char-layout.js RAIL_W / .char-rail width:44px）；细轨可见=' + vis(railL) + ' 文案=「' + flat(railL ? railL.textContent : '') + '」');
    need('细轨按钮宽 44 与列宽一致', !!railL && Math.abs(railL.offsetWidth - 44) <= 1 && Math.abs(wOf(ROSTER) - 44) <= 1, '细轨按钮实测 ' + (railL ? railL.offsetWidth : -1) + 'px / 收起列宽 ' + wOf(ROSTER) + 'px（期望都是 44±1，与 .workspace.left-closed 的 44px 网格列同值）');
    var memClosed = ui.charPrefs && ui.charPrefs.profile ? ui.charPrefs.profile.leftClosed : '(无)';
    var cloneErr = '';
    try { win.structuredClone(ui.charPrefs); } catch (e) { cloneErr = String(e && e.name || '') + ': ' + String(e && e.message || e); }
    var prefClosed = await readPref('charPrefs');
    await wait(180);
    need('收起态落 appconfig.charPrefs', !!prefClosed && typeof prefClosed === 'object' && prefClosed.profile && prefClosed.profile.leftClosed === true,
      'appconfig.charPrefs.profile.leftClosed=' + JSON.stringify(prefClosed && typeof prefClosed === 'object' && prefClosed.profile ? prefClosed.profile.leftClosed : prefClosed)
        + '（要求 true：reload 后仍收成 44）；内存 ui.charPrefs.profile.leftClosed=' + String(memClosed)
        + '；附注 structuredClone(ui.charPrefs)=' + (cloneErr ? '抛 DataCloneError（store 是 reactive proxy，写库路径必须先归一化成普通对象，本条只判库里落到的值）' : 'ok'));
    click(ROSTER + ' .char-rail');
    await wait(400);
    need('名录细轨可复原 248', Math.abs(wOf(ROSTER) - 248) <= 1, '点 .char-rail[data-rail=roster] → roster ' + wOf(ROSTER) + 'px（期望 248±1）');
    var rightClick = click('.char-head-toggle[data-act="toggle-right"]');
    await wait(420);
    var railC = q(CONTEXT + ' .char-rail');
    need('收起右列取 44 细轨', rightClick && Math.abs(wOf(CONTEXT) - 44) <= 1 && vis(railC), '点 toggle-right → context ' + wOf(CONTEXT) + 'px（期望 44±1 = char-layout.js RAIL_W / .char-rail width:44px）；细轨可见=' + vis(railC) + ' 文案=「' + flat(railC ? railC.textContent : '') + '」');
    click(CONTEXT + ' .char-rail');
    await wait(400);
    need('右列细轨可复原 304', Math.abs(wOf(CONTEXT) - 304) <= 1, '点 .char-rail[data-rail=context] → context ' + wOf(CONTEXT) + 'px（期望 304±1）');
    /* 视图记忆的宽档入口：右列页脚那颗「在关系图中查看」（壳层 setView，写入 work.charView）。 */
    st.graphFrom = 'right-footer';
    st.toGraphClick = click(byText(CONTEXT + ' .pane-foot .btn', '在关系图中查看'));
    await wait(480);
  } else {
    /* ---- 窄档（≤1099）：单列 + 48px 工具条 + 名录抽屉 + 侧栏第二屏 ---- */
    var divVisN = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('.char-divider'), function (d) { if (vis(d)) divVisN++; });
    need('窄档单列无分隔条', divVisN === 0, '可见分隔条 ' + divVisN + ' 个（窄档 .char-divider display:none，要求 0）视口=' + width);
    need('窄档单块 pane 落在设计稿左右沿', !!mR && Math.abs(mR.l - PAD) <= 1 && Math.abs(mR.r - (width - PAD)) <= 1,
      'main ' + (mR ? mR.l + '..' + mR.r : '缺') + '（期望 ' + PAD + '..' + (width - PAD) + '；@≤1099 留白 12px 20px、@≤559 收成 7px 12px）');
    var barR = rect(q('.char-mobilebar'));
    need('窄档工具条高 48', !!barR && Math.abs(barR.h - 48) <= 1, '工具条实测高 ' + (barR ? barR.h : -1) + 'px（期望 48±1）');
    var barBtns = doc.querySelectorAll('.char-mobilebar .char-mobile-btn');
    need('窄档工具条三段', barBtns.length === 2 && count('.char-mobilebar .char-mobile-title') === 1, '按钮 ' + barBtns.length + ' 个 + 标题 ' + count('.char-mobilebar .char-mobile-title') + ' 个（期望 [左键][标题][右键]）');
    var leftTxt = flat(barBtns[0] ? barBtns[0].textContent : ''), rightTxt = flat(barBtns[1] ? barBtns[1].textContent : '');
    need('窄档左键=人物名录', leftTxt === '人物名录', '左键=「' + leftTxt + '」（主屏唯一的名录入口）');
    need('窄档右键=关系与设定', rightTxt === '关系与设定', '右键=「' + rightTxt + '」（卷宗视图；剧场视图该键为「人物档案」）');
    var openClick = click(barBtns[0]);
    await wait(440);
    var shD = q(SHELL), drawerR = rect(q(ROSTER)), scrimV = vis(q('.char-scrim')), wantDrawer = Math.min(300, width - (width <= 559 ? 24 : 40));
    need('窄档左键开名录抽屉', openClick && !!shD && shD.getAttribute('data-drawer') === 'roster' && scrimV && !!drawerR && Math.abs(drawerR.w - wantDrawer) <= 1,
      'data-drawer=' + (shD ? shD.getAttribute('data-drawer') : '?') + '；抽屉宽 ' + (drawerR ? drawerR.w : -1) + 'px（期望 ' + wantDrawer + '±1 = min(300, 100vw-' + (width <= 559 ? 24 : 40) + ')）遮罩可见=' + scrimV);
    need('窄档抽屉里能点人物行', count(ROSTER + ' .char-person') === wk.liveCharacters.length, '抽屉内 .char-person ' + count(ROSTER + ' .char-person') + ' 行（期望 ' + wk.liveCharacters.length + ' 行）');
    try { win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { st.escErr = String(e && e.message || e); }
    await wait(400);
    var shE = q(SHELL);
    need('窄档 Esc 关抽屉', !!shE && !shE.getAttribute('data-drawer') && !vis(q('.char-scrim')), 'Esc 后 data-drawer=' + JSON.stringify(shE ? shE.getAttribute('data-drawer') : '?') + ' 遮罩可见=' + vis(q('.char-scrim')));
    var ctxClick = click(doc.querySelectorAll('.char-mobilebar .char-mobile-btn')[1]);
    await wait(460);
    var shC = q(SHELL);
    var leftTxt2 = flat(doc.querySelectorAll('.char-mobilebar .char-mobile-btn')[0].textContent);
    var rightTxt2 = flat(doc.querySelectorAll('.char-mobilebar .char-mobile-btn')[1].textContent);
    need('窄档右键进第二屏', ctxClick && !!shC && shC.getAttribute('data-screen') === 'context' && vis(q(CONTEXT)) && !vis(q(MAIN)),
      'data-screen=' + (shC ? shC.getAttribute('data-screen') : '?') + '；context 可见=' + vis(q(CONTEXT)) + ' main 可见=' + vis(q(MAIN)));
    need('窄档第二屏左键变返回', leftTxt2.indexOf('‹') === 0 && leftTxt2.indexOf('人物卷宗') >= 0, '第二屏左键=「' + leftTxt2 + '」（期望「‹ 人物卷宗」）');
    need('窄档第二屏右键=人物名录', rightTxt2 === '人物名录', '第二屏右键=「' + rightTxt2 + '」');
    need('窄档第二屏列头 inspector-label', !!q(CONTEXT + ' .inspector-label'), q(CONTEXT + ' .inspector-label') ? '列头=「' + txt(CONTEXT + ' .inspector-heading') + '」' : '未找到 .inspector-label');
    var miniH2 = hOf(CONTEXT + ' .mini-network');
    need('窄档小关系网高 65', Math.abs(miniH2 - 65) <= 1, 'mini-network 实测高 ' + miniH2 + 'px（期望 65±1）');
    var relN2 = cid ? relsOf(cid) : -1, loreN2 = cid ? wk.loreLinksOf('character', cid).length : -1;
    need('窄档关系行数=关系数', count(CONTEXT + ' .relation-row') === relN2, 'relation-row ' + count(CONTEXT + ' .relation-row') + ' 行（期望 ' + relN2 + ' 条）');
    need('窄档关联设定行', count(CONTEXT + ' .lore-row') === loreN2, 'lore-row ' + count(CONTEXT + ' .lore-row') + ' 行（期望 ' + loreN2 + ' 条；无关联时该区显示空态文案）');
    click(doc.querySelectorAll('.char-mobilebar .char-mobile-btn')[0]);
    await wait(440);
    var shM = q(SHELL);
    need('窄档第二屏返回主屏', !!shM && shM.getAttribute('data-screen') === 'main' && vis(q(MAIN)), '点「‹ …」→ data-screen=' + (shM ? shM.getAttribute('data-screen') : '?') + ' main 可见=' + vis(q(MAIN)));
    need('窄档卷宗身份 h2=姓名', txt('.char-identity h2') === curName, 'h2=「' + txt('.char-identity h2') + '」当前人物=「' + curName + '」');
    var idxN = Array.prototype.map.call(doc.querySelectorAll('.char-section-index'), function (x) { return flat(x.textContent); });
    var hsN = Array.prototype.map.call(doc.querySelectorAll('.char-section-head h3'), function (x) { return flat(x.textContent); });
    need('窄档卷宗三段齐全', idxN.join('/') === '01/02/03' && hsN[0] === '人物小传' && hsN[1] === '自定义字段', '段号=' + idxN.join('/') + ' 标题=' + hsN.join('/'));
    need('窄档卷宗页脚编辑档案', txt('.char-pane-foot .char-btn').indexOf('编辑档案') >= 0, '页脚按钮=「' + txt('.char-pane-foot .char-btn') + '」');
    var editClick2 = click('.char-pane-foot .char-btn');
    await wait(420);
    need('窄档点编辑档案进编辑态', editClick2 && !!q('.char-edit') && !!q('.char-edit .char-name-input'), '点「编辑档案」→ .char-edit ' + (q('.char-edit') ? '出现' : '未出现') + '，取消/完成 ' + count('.char-edit-buttons .char-btn') + ' 个');
    var typedName2 = curName + '改';
    setInput(q('.char-edit .char-name-input'), typedName2);
    await wait(280);
    var doneBtn2 = q('.char-edit-buttons .char-btn.primary');
    if (doneBtn2) doneBtn2.click();
    await wait(380);
    var afterName2 = me() ? String(me().name || '') : '';
    need('窄档编辑改字写库', afterName2 === typedName2 && !q('.char-edit'), '写入「' + typedName2 + '」→ 完成 → store.name=「' + afterName2 + '」编辑表单仍在=' + !!q('.char-edit'));
    if (cid) { wk.updateCharacter(cid, { name: curName }); await wait(260); }
    var se2 = doc.documentElement;
    need('窄档无横向溢出', se2.scrollWidth <= se2.clientWidth, 'document ' + se2.scrollWidth + ' <= ' + se2.clientWidth + '（视口=' + width + '）');
    /* 视图记忆的窄档入口：页头那两粒切换（工具条左右键管抽屉与两屏，不承担换视图）。 */
    st.graphFrom = 'head-segmented';
    st.toGraphClick = click(byText('.char-segmented button', '关系剧场'));
    await wait(480);
  }
  /* ---- 视图记忆 + 关系剧场 ---- */
  need('切到关系剧场写回 charView', wk.charView === 'graph', '入口=' + st.graphFrom + '；work.charView=' + wk.charView + '（要求 graph；刷新后仍记住的 reload 级复验交给 compare-characters）');
  var h1G = txt('.module-head h1');
  need('剧场页头 h1=关系剧场', h1G === '关系剧场', 'h1=「' + h1G + '」（.module-head 由 CharGraphPane 渲染）');
  need('剧场页头有面包屑', txt('.breadcrumbs').indexOf('人物') >= 0, '面包屑=「' + txt('.breadcrumbs') + '」');
  var segG = doc.querySelectorAll('.module-head .segmented button');
  var segGTxt = Array.prototype.map.call(segG, function (b) { return flat(b.textContent); }).join('/');
  need('剧场视图切换两粒', segG.length === 2 && segGTxt === '人物卷宗/关系剧场', '切换项 ' + segG.length + ' 个 → 「' + segGTxt + '」');
  var subTxt = txt('.graph-subbar');
  need('剧场范围条有对象与关系计数', subTxt.indexOf('人物') >= 0 && subTxt.indexOf('关系') >= 0, '范围条=「' + subTxt.slice(0, 70) + '」');
  var nodesLocal = count('.graph-node');
  click(byText('.graph-tools .segmented button', '全部人物'));
  await wait(520);
  var nodesAll = count('.graph-node');
  need('剧场一度关系→全部人物改计数', nodesAll === wk.liveCharacters.length && nodesAll !== nodesLocal,
    '一度关系 ' + nodesLocal + ' 个节点 → 全部人物 ' + nodesAll + ' 个（要求 = work.liveCharacters ' + wk.liveCharacters.length + ' 个，且与一度不同）');
  var stageCs = q('.graph-stage') ? win.getComputedStyle(q('.graph-stage')) : null;
  need('剧场舞台点阵 24px', !!stageCs && String(stageCs.backgroundSize).indexOf('24px') === 0, 'background-size=' + (stageCs ? stageCs.backgroundSize : '(未找到 .graph-stage)') + '（期望 24px 24px）');
  var plainNode = null, selNode = null;
  Array.prototype.forEach.call(doc.querySelectorAll('.graph-node'), function (n) { if (n.classList.contains('selected')) selNode = n; else if (!plainNode) plainNode = n; });
  /* 节点尺寸量 offsetWidth/offsetHeight：.graph-world 带 zoom 变换（相机 80% 时 rect 只有 0.8 倍），
     layout 尺寸才是 studio.css 那条 width:134px / min-height:84px 的真值。 */
  var pW = plainNode ? plainNode.offsetWidth : -1, pH = plainNode ? plainNode.offsetHeight : -1;
  var sW = selNode ? selNode.offsetWidth : -1, sH = selNode ? selNode.offsetHeight : -1;
  var zoomNow = txt('.graph-foot .zoom-controls button:nth-child(2)');
  var wantW = width <= 559 ? 148 : 134, wantMinH = width <= 559 ? 90 : 84;
  need('剧场节点宽 ' + wantW, Math.abs(pW - wantW) <= 1, '节点 layout ' + pW + 'x' + pH + '（宽期望 ' + wantW + '±1' + (width <= 559 ? '；≤559 档 studio.css 把节点加到 148' : '；studio.css .graph-node width:134px') + '；画布 zoom=' + zoomNow + '，rect 量出来会被缩放，故按 layout 量）');
  need('剧场节点高不少于 ' + wantMinH, pH >= wantMinH - 1, '节点 layout 高 ' + pH + 'px（studio.css 写的是 min-height:' + wantMinH + '，设计稿实测 84 是原型排版结果，本条守 min-height 下限）');
  need('剧场选中节点宽 156', Math.abs(sW - 156) <= 1, '选中节点 layout ' + sW + 'x' + sH + '（宽期望 156±1 = .graph-node.selected width:156px）');
  need('剧场选中节点高不少于 103', sH >= 102, '选中节点 layout 高 ' + sH + 'px（.graph-node.selected 是 min-height:103，设计稿实测 103）');
  var footSeg = doc.querySelectorAll('.graph-foot > span, .graph-foot > .zoom-controls, .graph-foot > .btn');
  var zoomTxt = txt('.graph-foot .zoom-controls button:nth-child(2)'), relBtn = q('.graph-foot .btn');
  need('剧场底栏三段（缩放百分比 / 关系）', footSeg.length === 3 && zoomTxt.length > 1 && !!relBtn && flat(relBtn.textContent).indexOf('关系') >= 0,
    '底栏三段 ' + footSeg.length + ' 个；缩放=「' + zoomTxt + '」；按钮=「' + flat(relBtn ? relBtn.textContent : '') + '」');
  if (wide) {
    need('剧场名录列宽 220', Math.abs(wOf(ROSTER) - 220) <= 1, 'roster 实测 ' + wOf(ROSTER) + 'px（期望 220±1 = CHAR_PANE.graph.left.def / fusion.css:2）');
    need('剧场右列宽 332', Math.abs(wOf(CONTEXT) - 332) <= 1, 'context 实测 ' + wOf(CONTEXT) + 'px（期望 332±1 = CHAR_PANE.graph.right.def / fusion.css:3）');
  }
  /* 收尾：回卷宗 + 两列展开 + 清筛选，截图不继承探针态。 */
  try {
    wk.setCharView('list');
    var p1 = JSON.parse(JSON.stringify(ui.charPrefs || {}));
    p1.profile = Object.assign({}, p1.profile || {}, { leftClosed: false, rightClosed: false });
    p1.graph = Object.assign({}, p1.graph || {}, { leftClosed: false, rightClosed: false });
    await ui.setPref('charPrefs', p1);
    ui.charQuery = ''; ui.charRole = ''; ui.charTag = ''; ui.charScope = 'local';
  } catch (e9) { st.restoreErr = String(e9 && e9.message || e9); }
  await wait(560);
  /* ---- 本轮修正后的设计稿真值（卷宗排版 / 头像 / 字号 / 小节间距 / 页头与名录头高度）----
     量 computed style 与 layout 尺寸（不看视觉位置），期望按档位取自 EXP；view 已回卷宗、两列已展开。 */
  var dossierEl = q('.char-dossier'), csD = dossierEl ? win.getComputedStyle(dossierEl) : null;
  need('卷宗正文面 max-width ' + EXP.dossierMax, !!csD && csD.maxWidth === EXP.dossierMax, 'computed max-width=' + (csD ? csD.maxWidth : '(未找到 .char-dossier)') + '（期望 ' + EXP.dossierMax + '）');
  need('卷宗正文面 padding ' + EXP.dossierPad.join('/'), !!csD && padOk(csD, EXP.dossierPad), 'computed padding 上/右/下/左=' + (csD ? padStr(csD) : '(缺)') + '（期望 ' + EXP.dossierPad.join('/') + '；基准 35/36/38、1100–1320 中档 30/27、≤1099 30/35/40、≤559 26/22/32）');
  var pEl = q('.char-dossier .char-portrait'), pCs = pEl ? win.getComputedStyle(pEl) : null;
  need('身份头像 ' + EXP.portraitW + 'x' + EXP.portraitH, !!pEl && Math.abs(pEl.offsetWidth - EXP.portraitW) <= 1 && Math.abs(pEl.offsetHeight - EXP.portraitH) <= 1,
    '头像实测 ' + (pEl ? pEl.offsetWidth + 'x' + pEl.offsetHeight : '缺') + '（期望 ' + EXP.portraitW + 'x' + EXP.portraitH + '±1；基准 82x105、中档 70x93、≤1099 80x100、≤559 63x84）'
      + (pCs ? ' computed ' + flat(pCs.width) + 'x' + flat(pCs.height) : ''));
  var h2Cs = q('.char-identity h2') ? win.getComputedStyle(q('.char-identity h2')) : null;
  var h2Fs = h2Cs ? px2(h2Cs.fontSize) : -1;
  need('身份 h2 字号落 clamp(28,2.6vw,40)', h2Fs >= 28 && h2Fs <= 40,
    'computed font-size=' + h2Fs + 'px（区间 28–40；2.6vw@' + width + '=' + px2(width * 0.026) + 'px，≤1099 档被 36px、≤559 档被 32px 覆盖）');
  var proseCs = q('.char-prose') ? win.getComputedStyle(q('.char-prose')) : null;
  /* 比值不套 px2（它按 1 位小数取整，1.95 会被舍成 2，判据就自己把自己判红）：保留原始计算值再算比值。 */
  var proseFs = proseCs ? parseFloat(proseCs.fontSize) : -1;
  var proseLh = proseCs ? parseFloat(proseCs.lineHeight) : -1;
  var lhRatio = proseFs > 0 ? Math.round((proseLh / proseFs) * 1000) / 1000 : -1;
  need('小传字号 ' + EXP.proseFs + ' 行高 1.95', proseFs === EXP.proseFs && Math.abs(lhRatio - 1.95) <= 0.02,
    'font-size=' + proseFs + 'px line-height=' + proseLh + 'px（比值 ' + lhRatio + '，期望 ' + EXP.proseFs + 'px / 1.95±0.02）');
  var sec2 = doc.querySelectorAll('.char-dossier .char-section')[1];
  var secMt = sec2 ? px2(win.getComputedStyle(sec2).marginTop) : -1;
  need('小节间距 margin-top ' + EXP.secGap, Math.abs(secMt - EXP.secGap) <= 1,
    '第 2 个 .char-section 的 margin-top=' + secMt + 'px（期望 ' + EXP.secGap + '±1；≤559 档 27，其余 33）');
  var headCs = q('.char-module-head') ? win.getComputedStyle(q('.char-module-head')) : null;
  need('卷宗页头 min-height ' + EXP.headMinH, !!headCs && headCs.minHeight === EXP.headMinH + 'px',
    'computed min-height=' + (headCs ? headCs.minHeight : '(缺)') + '（期望 ' + EXP.headMinH + 'px；基准 112、≤1099 105、≤559 108）');
  var rhCs = q('.char-roster-head') ? win.getComputedStyle(q('.char-roster-head')) : null;
  need('名录头 min-height 70 与 padding 21/20/16', !!rhCs && rhCs.minHeight === '70px' && padOk(rhCs, EXP.rosterPad),
    'min-height=' + (rhCs ? rhCs.minHeight : '(缺)') + ' padding 上/右/下/左=' + (rhCs ? padStr(rhCs) : '(缺)') + '（期望 70px / 21/20/16/20，各档同值）');
  ev.charMatrix = st;
  out.ok = out.items.every(function (i) { return i.pass; });
  return out;
}
/* ===== 设定 · 关系网络 / 空态叠字 / 全部设定总览（2026-11-06 第四轮） =====
   用户截图两个现象：①关系网络里只有一张孤立卡片 —— 中心被点选在 0 关系条目，一条边也画不出来；
   ②空态文案与中心卡片叠在一起 —— 空态层和卡片同处一个坐标系，缩放/居中后正好压在卡片上。
   对应三条源码改动：LoreWorkspace.vue:168 graphCenterId 四级择优、LoreGraph.vue:56 emptyMode
   （空态整层不渲染 + .lg-empty 移出 .om-inner）、LoreTreeMap.vue:16/45/101 setIds 多根 + fit({minZoom:0.12})。
   造数一律走应用自己的 store（addLoreLink / addCharacter / removeLoreLink），不碰 raw IndexedDB。 */
async function loreGraphProbe(frame, out, width) {
  var doc = frame.contentDocument, ev = out.evidence;
  var wk = workStore(frame), ui = uiStore(frame);
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function need(name, ok, e) { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  function q(sel) { return doc.querySelector(sel); }
  function flat(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function txt(sel) { var n = q(sel); return n ? flat(n.textContent) : ''; }
  function vis(n) { if (!n) return false; var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function click(x) { var n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
  function mapTab(label) {
    var bs = doc.querySelectorAll('.lore-map-modes button');
    for (var i = 0; i < bs.length; i++) {
      if (flat(bs[i].textContent) === label) { try { bs[i].click(); } catch (e) { return false; } return true; }
    }
    return false;
  }
  function rectOf(n) { var r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
  function overlap(a1, b1) { return Math.min(a1.r, b1.r) > Math.max(a1.l, b1.l) && Math.min(a1.b, b1.b) > Math.max(a1.t, b1.t); }
  var tag = '（' + width + '）';
  var g = {};
  ev.loreGraph = ev.loreGraph || {};
  ev.loreGraph[width] = g;
  if (!wk || !ui) { need('关系网络可测' + tag, false, 'work/ui store 缺失（pinia._s.get 取不到）'); return; }

  /* ---- 造数：mubu→mubu 两条 + mubu→character 一条（原始关系共 3 条） ---- */
  var live = wk.mubu.filter(function (n) { return !n.deletedAt; });
  var root = wk.currentMubuRoot ? wk.currentMubuRoot() : null;
  var rootId = root ? root.id : (wk.mubuRoots()[0] || {}).id;
  var setEntries = rootId ? wk.mubuDescendants(rootId) : [];
  var a = setEntries[0], b = setEntries[1], c = null;
  for (var ci = 2; ci < setEntries.length; ci++) {
    if (setEntries[ci].id !== a.id && setEntries[ci].id !== b.id) { c = setEntries[ci]; break; }
  }
  if (!a || !b || !c) {
    need('关系网络造数前提' + tag, false, '当前设定集条目不足 3 条（' + setEntries.length + '），构造不出 mubu→mubu 两条');
    return;
  }
  var ch = wk.liveCharacters[0], madeChar = false;
  if (!ch) {
    ch = wk.addCharacter('关系验证人物');
    madeChar = true;
    /* addCharacter 顺手把 tab 切到 characters，造完要立刻切回设定页，否则下面点不到导图 */
    wk.tab = 'lore';
    await wait(540);
  }
  var want = ['同行', '同门', '门生'];
  var l1 = wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'mubu', toId: b.id, label: want[0] });
  var l2 = wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'mubu', toId: c.id, label: want[1] });
  var l3 = wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'character', toId: ch.id, label: want[2] });
  ui.loreActiveId = a.id;
  g.seed = { center: flat(a.text), peers: [flat(b.text), flat(c.text)], character: flat(ch.name), created: [!!l1, !!l2, !!l3], madeChar: madeChar };
  need('关系网络造数成功' + tag, !!l1 && !!l2 && !!l3,
    'addLoreLink mubu→mubu「' + want[0] + '」=' + !!l1 + ' / 「' + want[1] + '」=' + !!l2 + ' / mubu→character「' + want[2] + '」=' + !!l3
      + '（中心「' + flat(a.text) + '」→「' + flat(b.text) + '」「' + flat(c.text) + '」+ 人物「' + flat(ch.name) + '」' + (madeChar ? '，人物为本轮新建' : '') + '）');
  await wait(320);

  /* 真机路径：视觉导图 → 关系网络 */
  click('.lore-switch button[data-lore-view="map"]');
  await wait(420);
  var relTab = mapTab('关系网络');
  await wait(560);

  /* ---- 1) 关系网络非空：节点 / 连线 / 标签 / 工具条计数 ---- */
  var nodesN = doc.querySelectorAll('.lg-node').length;
  var edgeN = doc.querySelectorAll('.lg-edges path:not(.lg-edge-hit)').length;
  var labels = Array.prototype.map.call(doc.querySelectorAll('.lg-elabel'), function (n) { return flat(n.textContent); });
  var countTxt = txt('.lg-toolbar .oc-count');
  var centerT = txt('.lg-node.center .lg-title');
  g.rel = { nodes: nodesN, edges: edgeN, labels: labels, count: countTxt, center: centerT, relTab: relTab };
  need('关系网络渲染节点' + tag, nodesN >= 2, '切到「关系网络」=' + relTab + '；.lg-node ' + nodesN + ' 个（造了 3 条关系，期望 >=2）');
  need('关系网络画出连线' + tag, edgeN >= 1, 'svg.lg-edges 非 hit 层 path ' + edgeN + ' 条（3 条关系期望 >=1）');
  need('关系网络标注关系名' + tag, labels.length >= 1 && labels.every(function (t) { return want.indexOf(t) >= 0; }),
    '.lg-elabel ' + labels.length + ' 个 → ' + JSON.stringify(labels) + '（期望全部是所建关系名 ' + JSON.stringify(want) + '）');
  need('关系网络工具条计数' + tag, countTxt.indexOf('条关系') >= 0 && countTxt !== '0 条关系',
    'oc-count=「' + countTxt + '」（要求含「条关系」且不是「0 条关系」）');
  await requestShot('lore-v4-relations-' + width);

  /* ---- 2) 中心择优：把当前条目点成 0 关系的那条，中心必须自己落到有关系的节点上 ---- */
  var zero = null;
  for (var zi = 0; zi < live.length; zi++) {
    var zn = live[zi];
    if (zn.id === a.id || zn.id === b.id || zn.id === c.id) continue;
    if (wk.loreLinksOf('mubu', zn.id).length) continue;
    zero = zn;
    break;
  }
  if (!zero) {
    need('关系网络中心择优' + tag, false, '找不到 0 关系的条目做对照');
  } else {
    ui.loreActiveId = zero.id;
    await wait(520);
    var centerT2 = txt('.lg-node.center .lg-title');
    var zeroT = flat(zero.text).slice(0, 20);
    var aT = flat(a.text).slice(0, 20);
    g.center = { pickedZero: zeroT, centerNow: centerT2, expect: aT };
    need('关系网络中心择优' + tag, !!centerT2 && centerT2 !== zeroT && centerT2 === aT,
      '把 ui.loreActiveId 设成 0 关系条目「' + zeroT + '」→ 中心卡标题「' + centerT2 + '」（要求 ≠ 该条目名，且 = 有关系条目「' + aT + '」）');
  }

  /* ---- 3) 空态不叠字：删光关系 → 空态层在场、节点层 0 个、两矩形零相交 ---- */
  var doomed = wk.liveLoreLinks.slice();
  var removed = 0;
  for (var di = 0; di < doomed.length; di++) {
    try { await wk.removeLoreLink(doomed[di].id); removed++; } catch (eRm) { /* 单条删失败不中断 */ }
  }
  await wait(620);
  var emptyEl = q('.lg-empty');
  var nodeN2 = doc.querySelectorAll('.lg-node').length;
  var edgeN2 = doc.querySelectorAll('.lg-edges path:not(.lg-edge-hit)').length;
  var emptyR = emptyEl ? rectOf(emptyEl) : null;
  var intersect = 0;
  Array.prototype.forEach.call(doc.querySelectorAll('.lg-node'), function (n) {
    if (emptyR && overlap(emptyR, rectOf(n))) intersect++;
  });
  var canvasEl = q('.lg-canvas');
  var canvasR = canvasEl ? rectOf(canvasEl) : null;
  var centered = !!(emptyR && canvasR
    && Math.abs((emptyR.l + emptyR.w / 2) - (canvasR.l + canvasR.w / 2)) <= 2
    && Math.abs((emptyR.t + emptyR.h / 2) - (canvasR.t + canvasR.h / 2)) <= 2
    && Math.abs(emptyR.w - canvasR.w) <= 2 && Math.abs(emptyR.h - canvasR.h) <= 2);
  g.empty = { removed: removed, leftLinks: wk.liveLoreLinks.length, nodes: nodeN2, edges: edgeN2, intersect: intersect, centered: centered,
    empty: emptyR ? { w: Math.round(emptyR.w), h: Math.round(emptyR.h) } : null, canvas: canvasR ? { w: Math.round(canvasR.w), h: Math.round(canvasR.h) } : null };
  need('关系网络空态成层' + tag, !!emptyEl && vis(emptyEl),
    emptyEl ? '.lg-empty 存在且可见' : '删光 ' + removed + ' 条关系后未找到 .lg-empty（剩 ' + wk.liveLoreLinks.length + ' 条）');
  need('关系网络空态不渲染节点层' + tag, nodeN2 === 0, '.lg-node ' + nodeN2 + ' 个（空态要求 0；剩余关系 ' + wk.liveLoreLinks.length + ' 条）');
  need('关系网络空态与节点零相交' + tag, intersect === 0, '相交 ' + intersect + ' 对（节点 ' + nodeN2 + ' 个；节点为 0 时该判据自动成立，仍要断）');
  need('关系网络空态居中铺满画布' + tag, centered,
    emptyR ? '.lg-empty ' + Math.round(emptyR.w) + 'x' + Math.round(emptyR.h) + ' vs .lg-canvas ' + Math.round(canvasR ? canvasR.w : -1) + 'x' + Math.round(canvasR ? canvasR.h : -1)
      + '；中心差 ' + (canvasR ? Math.round(((emptyR.l + emptyR.w / 2) - (canvasR.l + canvasR.w / 2)) * 10) / 10 : '?') + '/'
      + (canvasR ? Math.round(((emptyR.t + emptyR.h / 2) - (canvasR.t + canvasR.h / 2)) * 10) / 10 : '?') + 'px（要求 <=2）' : '未找到 .lg-empty');
  if (width === 1280) await requestShot('lore-v4-relations-empty-1280');

  /* 空态按钮 → 关系面板（@empty-action="openRelPanel"） */
  var emptyBtn = q('.lg-empty .lore-btn.primary') || q('.lg-empty button');
  var btnTxt = emptyBtn ? flat(emptyBtn.textContent) : '(缺)';
  var opened = click(emptyBtn);
  await wait(520);
  var panelState = ui.loreRelationPanel ? (ui.loreRelationPanel.kind + ':' + ui.loreRelationPanel.id) : '';
  var panelEl = q('.lrp-panel');
  g.emptyAction = { btn: btnTxt, clicked: opened, panelStore: panelState, panelDom: vis(panelEl) };
  need('关系网络空态按钮开关系面板' + tag, opened && (!!panelState || vis(panelEl)),
    '按钮「' + btnTxt + '」点击=' + opened + '；ui.loreRelationPanel=' + (panelState || 'null') + '；.lrp-panel 可见=' + vis(panelEl));
  var closed = click(q('.lrp-panel .lrp-close'));
  await wait(320);
  if (ui.loreRelationPanel) ui.loreRelationPanel = null;
  await wait(260);
  g.emptyAction.closed = closed || !ui.loreRelationPanel;
  need('关系网络空态面板可关闭' + tag, !ui.loreRelationPanel && !vis(q('.lrp-panel')),
    '点 .lrp-close=' + closed + '，ui.loreRelationPanel=' + (ui.loreRelationPanel ? '仍在' : 'null') + '，.lrp-panel 可见=' + vis(q('.lrp-panel')));
}

/* ---- 全部设定总览（层级导图多根）/ 单集层级：节点数 · 副标题 · 适应后不越界 · 多根折叠 ---- */
async function loreHierarchyProbe(frame, out, width) {
  var doc = frame.contentDocument, ev = out.evidence;
  var wk = workStore(frame), ui = uiStore(frame);
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function need(name, ok, e) { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  function q(sel) { return doc.querySelector(sel); }
  function flat(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function txt(sel) { var n = q(sel); return n ? flat(n.textContent) : ''; }
  function click(x) { var n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
  function mapTab(label) {
    var bs = doc.querySelectorAll('.lore-map-modes button');
    for (var i = 0; i < bs.length; i++) {
      if (flat(bs[i].textContent) === label) { try { bs[i].click(); } catch (e) { return false; } return true; }
    }
    return false;
  }
  function titles() {
    return Array.prototype.map.call(doc.querySelectorAll('.lore-tm-node'), function (n) { return flat(n.getAttribute('title')); });
  }
  /* 「适应」后越界像素：所有节点矩形超出 .lore-tm-wrap 的最大像素（容差 8px，见断言） */
  function overflowPx() {
    var wrap = q('.lore-tm-wrap');
    if (!wrap) return -1;
    var wr = wrap.getBoundingClientRect();
    var max = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('.lore-tm-node'), function (n) {
      var r = n.getBoundingClientRect();
      var px = Math.max(0, wr.left - r.left, r.right - wr.right, wr.top - r.top, r.bottom - wr.bottom);
      if (px > max) max = px;
    });
    return Math.round(max * 10) / 10;
  }
  function fitClick() { return click(q('.lore-map-foot button[title="适应当前内容"]')); }
  var tag = '（' + width + '）';
  var h = {};
  ev.loreHierarchy = ev.loreHierarchy || {};
  ev.loreHierarchy[width] = h;
  if (!wk || !ui) { need('全部设定总览可测' + tag, false, 'work/ui store 缺失（pinia._s.get 取不到）'); return; }

  click('.lore-switch button[data-lore-view="map"]');
  await wait(420);
  var hierTab = mapTab('层级导图');
  await wait(400);

  /* ---- 4a) all 范围：节点数 = 设定集数 + 全部条目数 ---- */
  if (ui.loreScope !== 'all') { await ui.setPref('loreScope', 'all'); }
  await wait(680);
  var roots = wk.mubuRoots();
  var descAll = 0;
  roots.forEach(function (r) { descAll += wk.mubuDescendants(r.id).length; });
  var expAll = roots.length + descAll;
  var domAll = doc.querySelectorAll('.lore-tm-node').length;
  var edgeAll = doc.querySelectorAll('.lore-tm-edge').length;
  var subAll = txt('.lore-map-context');
  var fitAllClicked = fitClick();
  await wait(560);
  var ovAll = overflowPx();
  var wrapEl = q('.lore-tm-wrap');
  h.all = { roots: roots.length, entries: descAll, expect: expAll, dom: domAll, edges: edgeAll, expEdges: expAll - roots.length,
    subtitle: subAll, fit: fitAllClicked, overflow: ovAll, wrap: wrapEl ? { w: Math.round(wrapEl.getBoundingClientRect().width), h: Math.round(wrapEl.getBoundingClientRect().height) } : null,
    rootNames: roots.map(function (r) { return flat(r.text); }) };
  need('全部设定总览节点数' + tag, hierTab && domAll === expAll,
    '层级导图=' + hierTab + '；.lore-tm-node ' + domAll + ' 个 = 设定集 ' + roots.length + ' + 条目 ' + descAll + '（期望 ' + expAll + '）');
  need('全部设定总览多根连线' + tag, edgeAll === expAll - roots.length,
    '.lore-tm-edge ' + edgeAll + ' 条（每棵树的非根节点各一条父子线 → 期望 ' + (expAll - roots.length) + '）');
  need('全部设定总览副标题' + tag, subAll === '全部设定 · 层级', '副标题「' + subAll + '」（期望「全部设定 · 层级」）');
  need('全部设定总览适应后不越界' + tag, fitAllClicked && ovAll >= 0 && ovAll <= 8,
    '点「适应」=' + fitAllClicked + '；节点越界最大 ' + ovAll + 'px（容差 8px）；画布 ' + (wrapEl ? Math.round(wrapEl.getBoundingClientRect().width) + 'x' + Math.round(wrapEl.getBoundingClientRect().height) : '?'));
  if (width === 1440 || width === 1280) await requestShot('lore-v4-hierarchy-all-' + width);

  /* ---- 5) 多根折叠：只收一棵树，另一集的节点数不变 ---- */
  var cards = Array.prototype.slice.call(doc.querySelectorAll('.lore-tm-node.set'));
  var foldBtn = null, targetRoot = null;
  for (var ci = 0; ci < cards.length; ci++) {
    var fb = cards[ci].querySelector('.lore-tm-fold');
    if (!fb) continue;
    var t0 = flat(cards[ci].getAttribute('title'));
    for (var ri = 0; ri < roots.length; ri++) {
      if (flat(roots[ri].text) === t0) { targetRoot = roots[ri]; break; }
    }
    if (targetRoot) { foldBtn = fb; break; }
  }
  if (!foldBtn || !targetRoot) {
    need('多根折叠只收一棵树' + tag, false, '找不到带 .lore-tm-fold 的集根卡片（集 ' + cards.length + ' 个）');
  } else {
    var beforeN = doc.querySelectorAll('.lore-tm-node').length;
    var foldDesc = wk.mubuDescendants(targetRoot.id);
    var otherTitles = [];
    roots.forEach(function (r) {
      if (r.id === targetRoot.id) return;
      otherTitles.push(flat(r.text));
      wk.mubuDescendants(r.id).forEach(function (n) { otherTitles.push(flat(n.text)); });
    });
    var prevTitles = titles();
    var otherBefore = prevTitles.filter(function (t) { return otherTitles.indexOf(t) >= 0; }).sort().join('|');
    var folded = click(foldBtn);
    await wait(560);
    var afterN = doc.querySelectorAll('.lore-tm-node').length;
    var otherAfter = titles().filter(function (t) { return otherTitles.indexOf(t) >= 0; }).sort().join('|');
    h.fold = { set: flat(targetRoot.text), drop: foldDesc.length, before: beforeN, after: afterN, expectAfter: beforeN - foldDesc.length, otherSame: otherAfter === otherBefore };
    need('多根折叠只收一棵树' + tag, folded && afterN === beforeN - foldDesc.length,
      '折叠「' + flat(targetRoot.text) + '」→ .lore-tm-node ' + beforeN + ' → ' + afterN + '（该集子节点 ' + foldDesc.length + ' 个 → 期望 ' + (beforeN - foldDesc.length) + '）');
    need('多根折叠不动其它集' + tag, otherAfter === otherBefore,
      '其它 ' + (roots.length - 1) + ' 个集的节点标题序列不变：' + (otherAfter === otherBefore ? '一致' : '变了'));
    click(foldBtn);
    await wait(420);
  }

  /* ---- 4b) set 范围：当前集子树 ---- */
  await ui.setPref('loreScope', 'set');
  await wait(700);
  var cur = wk.currentMubuRoot ? wk.currentMubuRoot() : null;
  var descSet = cur ? wk.mubuDescendants(cur.id).length : 0;
  var expSet = cur ? 1 + descSet : 0;
  var domSet = doc.querySelectorAll('.lore-tm-node').length;
  var subSet = txt('.lore-map-context');
  var fitSetClicked = fitClick();
  await wait(560);
  var ovSet = overflowPx();
  h.set = { set: cur ? flat(cur.text) : null, expect: expSet, dom: domSet, subtitle: subSet, fit: fitSetClicked, overflow: ovSet };
  need('条目层级节点数' + tag, domSet === expSet,
    '当前集「' + (cur ? flat(cur.text) : '?') + '」子树：.lore-tm-node ' + domSet + ' 个（1 + 条目 ' + descSet + ' = 期望 ' + expSet + '）');
  need('条目层级副标题' + tag, subSet === '条目层级', '副标题「' + subSet + '」（期望「条目层级」）');
  need('条目层级适应后不越界' + tag, fitSetClicked && ovSet >= 0 && ovSet <= 8,
    '点「适应」=' + fitSetClicked + '；节点越界最大 ' + ovSet + 'px（容差 8px）');
  if (width === 1440 || width === 1280) await requestShot('lore-v4-hierarchy-set-' + width);
}

/* 嵌套弹层 click-outside 探针（695，只记录不判红）：「更多格式」弹层里嵌着 颜色/底色/链接 三个 NPopover，
   naive-ui 可能在外层展开时把它一起关掉。抓到外层节点引用再点内层颜色键，看外层是否还在 ——
   结论写进 evidence.nestedPopover，由 Node 侧汇总打印，不产生断言项（免得把总数变红）。 */
/* 关掉所有可见的 .n-popover：方式是「再点一次触发器」的真点击（走 naive 的 toggle），
   而不是向 body 派发合成事件 —— 后者在真机上收不干净。最多点 maxA 次；仍关不掉只记录，不判红。 */
/* ===== 设定树行首几何：圆点折叠前后不动 / 同层叶子对齐 / 不再有 ▸ 伪元素（2026-11-06 第五轮） =====
   用户截图：折叠一个分支后行首圆点整体左移，父行与子行的圆点不在一条竖线上。
   根因是两套样式叠在一起 —— ①dsh 层折叠态用 .ob-bullet::after 画 ▸、且 ::before 用写死 margin -2.5/-3.5px，
   与展开态盒模型不一致；②另一路并发样式 lore-free-tree.css（未被 git 跟踪）又用 ::after 画圆点；
   ③叶子行的 .ob-fold-toggle 曾用 display:none，占位消失把后面的圆点顶左。
   修法是两层 CSS（themes.css:1684-1713 / dsh.css:2744-2774）把行首一组做成确定性几何：
   折叠键 16×27、圆点 21×27、圆点只用 ::before 绝对居中、::after 一律 content:none、
   叶子折叠键改 visibility:hidden 保留占位；并用 (0,6,1) 特异性压过 lore-free-tree.css 的 (0,6,0)。
   判据只认 rect：同一颗圆点折叠前后 left/top 必须相等（≤0.5px），同层叶子与父行圆点 left 也必须相等。 */
async function loreRowAlignProbe(frame, out, width) {
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  var wk = workStore(frame), ui = uiStore(frame);
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function need(name, ok, e) { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }); }
  function q(sel) { return doc.querySelector(sel); }
  function click(x) { var n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
  function rows() { return Array.prototype.slice.call(doc.querySelectorAll('.ob-row')); }
  function rowByNode(id) { return q('.ob-row[data-node="' + id + '"]'); }
  function depthOf(r) { return r ? Number(r.getAttribute('data-depth')) : -1; }
  function bulletOf(r) { return r ? r.querySelector('.ob-bullet') : null; }
  function toggleOf(r) { return r ? r.querySelector('.ob-fold-toggle') : null; }
  function textOf(r) { var t = r ? r.querySelector('.ob-text') : null; return t ? String(t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 16) : ''; }
  function px2(v) { return Math.round(Number(v) * 100) / 100; }
  function rectOf(n) {
    var r = n.getBoundingClientRect();
    return { l: px2(r.left), t: px2(r.top), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  }
  function failAll(msg) {
    need('设定树圆点折叠前后不动（' + width + '）', false, msg);
    need('设定树圆点展开复位不跑位（' + width + '）', false, msg);
    need('设定树同层叶子与父行对齐（' + width + '）', false, msg);
    need('设定树圆点不再有 ▸ 伪元素（' + width + '）', false, msg);
    need('设定树叶子行折叠键占位（' + width + '）', false, msg);
  }
  var st = {};
  ev.loreRowAlign = ev.loreRowAlign || {};
  ev.loreRowAlign[width] = st;
  if (!wk || !ui) { failAll('work/ui store 缺失（pinia._s.get 取不到）'); return; }

  /* 回到条目编写 + set 范围（前两个探针把视图留在导图上），并关掉可能残留的临时样式 */
  click('.lore-switch button[data-lore-view="write"]');
  await wait(480);
  if (ui.loreScope !== 'set') { await ui.setPref('loreScope', 'set'); await wait(640); }
  await wait(240);

  /* 挑一个「有子节点」的行（depth>=1 才有父级，便于必要时补一颗同层叶子） */
  var list = rows(), picked = null;
  for (var i = 0; i < list.length; i++) {
    var b = bulletOf(list[i]);
    if (!b || !b.classList.contains('has-children')) continue;
    if (depthOf(list[i]) < 1) continue;
    picked = list[i];
    break;
  }
  if (!picked) { failAll('找不到「有子节点」且 depth>=1 的行（视口=' + width + '，行 ' + list.length + ' 个）'); return; }
  var nodeId = picked.getAttribute('data-node');
  /* 已折叠的先展开，量的是「展开 → 折叠 → 再展开」三次同一颗圆点的位置 */
  var pre = toggleOf(picked);
  if (pre && picked.querySelector('.ob-bullet').classList.contains('folded')) {
    click(pre);
    await wait(360);
  }
  var row0 = rowByNode(nodeId);
  if (row0) { try { row0.scrollIntoView({ block: 'center' }); } catch (e) { /* 老浏览器无参也接住 */ } }
  await wait(320);
  var row1 = rowByNode(nodeId);
  if (!row1 || !bulletOf(row1)) { failAll('滚到可见后取不到 .ob-row[data-node=' + nodeId + '] 的 .ob-bullet'); return; }

  var vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  var rr = row1.getBoundingClientRect();
  var clip = {
    x: Math.max(0, Math.round(rr.left - 14)),
    y: Math.max(0, Math.round(rr.top - 12)),
    width: 0, height: 0
  };
  clip.width = Math.min(660, vw - clip.x);
  clip.height = Math.min(260, vh - clip.y);

  var b0 = rectOf(bulletOf(row1));
  var depthP = depthOf(row1);
  var textP = textOf(row1);
  await requestShot('lore-v5-row-expanded-1280', clip);

  /* 折叠 */
  var folded = click(toggleOf(rowByNode(nodeId)));
  await wait(360);
  var rowF = rowByNode(nodeId);
  var b1 = rowF && bulletOf(rowF) ? rectOf(bulletOf(rowF)) : null;
  var dxF = b1 ? px2(Math.abs(b1.l - b0.l)) : -1;
  var dyF = b1 ? px2(Math.abs(b1.t - b0.t)) : -1;
  st.fold = { text: textP, depth: depthP, before: b0, after: b1, dx: dxF, dy: dyF, foldedClass: !!(rowF && bulletOf(rowF).classList.contains('folded')) };
  need('设定树圆点折叠前后不动（' + width + '）', folded && !!b1 && dxF >= 0 && dxF <= 0.5 && dyF <= 0.5,
    '父行「' + textP + '」（depth=' + depthP + '）圆点 left/top：展开 ' + b0.l + '/' + b0.t + ' → 折叠 ' + (b1 ? b1.l + '/' + b1.t : '未取到')
      + '；Δ ' + dxF + '/' + dyF + 'px（要求 ≤0.5）；size ' + b0.w + 'x' + b0.h + ' → ' + (b1 ? b1.w + 'x' + b1.h : '?'));
  await requestShot('lore-v5-row-folded-1280', clip);

  /* 再展开：位置必须原样回来 */
  var expanded = click(toggleOf(rowByNode(nodeId)));
  await wait(380);
  var rowE = rowByNode(nodeId);
  var b2 = rowE && bulletOf(rowE) ? rectOf(bulletOf(rowE)) : null;
  var dxE = b2 ? px2(Math.abs(b2.l - b0.l)) : -1;
  var dyE = b2 ? px2(Math.abs(b2.t - b0.t)) : -1;
  st.expand = { after: b2, dx: dxE, dy: dyE };
  need('设定树圆点展开复位不跑位（' + width + '）', expanded && !!b2 && dxE >= 0 && dxE <= 0.5 && dyE <= 0.5,
    '再点一次展开 → 圆点 ' + (b2 ? b2.l + '/' + b2.t : '未取到') + '；Δ 相对首次展开 ' + dxE + '/' + dyE + 'px（要求 ≤0.5）');

  /* 同层叶子对齐：优先复用现成的同 depth 叶子，没有就用 store API 在同一个父级下补一颗 */
  var leafRow = null, madeLeaf = false;
  function findLeaf() {
    var l = rows();
    for (var k = 0; k < l.length; k++) {
      var bb = bulletOf(l[k]);
      if (!bb || bb.classList.contains('has-children')) continue;
      if (depthOf(l[k]) !== depthP) continue;
      return l[k];
    }
    return null;
  }
  leafRow = findLeaf();
  if (!leafRow) {
    var self = wk.mubu.find(function (n) { return n.id === nodeId; });
    var sibParent = self ? (self.parentId || null) : null;
    try { wk.mubuAdd(sibParent, null, '对齐验证叶子'); madeLeaf = true; } catch (eAdd) { st.addErr = String(eAdd && eAdd.message || eAdd); }
    await wait(520);
    leafRow = findLeaf();
  }
  var rowPe = rowByNode(nodeId);
  var bParent = rowPe && bulletOf(rowPe) ? rectOf(bulletOf(rowPe)) : null;
  var bLeaf = leafRow && bulletOf(leafRow) ? rectOf(bulletOf(leafRow)) : null;
  var leafTxt = textOf(leafRow);
  var dLeaf = bParent && bLeaf ? px2(Math.abs(bLeaf.l - bParent.l)) : -1;
  st.leaf = { text: leafTxt, depth: depthOf(leafRow), parentLeft: bParent ? bParent.l : null, leafLeft: bLeaf ? bLeaf.l : null, dx: dLeaf, made: madeLeaf, addErr: st.addErr || '' };
  need('设定树同层叶子与父行对齐（' + width + '）', !!bLeaf && dLeaf >= 0 && dLeaf <= 0.5,
    'depth=' + depthP + '：父行「' + textP + '」圆点 left=' + (bParent ? bParent.l : '?') + '，叶子行「' + leafTxt + '」圆点 left='
      + (bLeaf ? bLeaf.l : '?') + ' → Δ ' + dLeaf + 'px（要求 ≤0.5；叶子' + (madeLeaf ? '为本轮新建' : '为现成节点') + '）');

  /* 不再有 ▸ 伪元素：::after 必须 content:none/normal */
  var bullets = Array.prototype.slice.call(doc.querySelectorAll('.ob-row > .ob-bullet')).slice(0, 8);
  var afterVals = [];
  var badAfter = 0;
  for (var ci = 0; ci < bullets.length; ci++) {
    var cv = '';
    try { cv = String(win.getComputedStyle(bullets[ci], '::after').content); } catch (eCs) { cv = '读取失败'; }
    afterVals.push(cv);
    if (cv !== 'none' && cv !== 'normal') badAfter++;
  }
  st.after = { checked: bullets.length, values: afterVals, bad: badAfter };
  need('设定树圆点不再有 ▸ 伪元素（' + width + '）', bullets.length > 0 && badAfter === 0,
    '检查 ' + bullets.length + ' 颗 .ob-bullet 的 ::after.content → ' + JSON.stringify(afterVals) + '（要求全部 none/normal，异常 ' + badAfter + ' 个）');

  /* 叶子行折叠键仍占位：visibility:hidden 且宽度 ≥12 */
  var leafToggle = leafRow ? toggleOf(leafRow) : null;
  var lv = leafToggle ? String(win.getComputedStyle(leafToggle).visibility) : '(无)';
  var lw = leafToggle ? leafToggle.offsetWidth : -1;
  var lfEmpty = !!(leafToggle && leafToggle.classList.contains('empty'));
  st.leafToggle = { visibility: lv, offsetWidth: lw, emptyClass: lfEmpty };
  need('设定树叶子行折叠键占位（' + width + '）', !!leafToggle && lv === 'hidden' && lw >= 12,
    '叶子行「' + leafTxt + '」的 .ob-fold-toggle：class.empty=' + lfEmpty + ' visibility=' + lv + ' offsetWidth=' + lw + 'px（要求 hidden 且 ≥12）');
}

function closePopovers(doc, maxA) {
  function vis(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function anyVisible() {
    var l = doc.querySelectorAll('.n-popover');
    for (var i = 0; i < l.length; i++) if (vis(l[i])) return l[i];
    return null;
  }
  function trigger() {
    return doc.querySelector('.editor-toolbar [data-act="more-features"]') || doc.querySelector('[data-act="more-features"]');
  }
  var n = 0, limit = maxA || 2;
  function step() {
    if (!anyVisible()) return Promise.resolve(n);
    var t = trigger();
    try { if (t) t.click(); } catch (e) { /* 点不动就算了 */ }
    n++;
    return new Promise(function (r) { setTimeout(r, 220); }).then(function () {
      return n < limit ? step() : n;
    });
  }
  return step();
}
/* 请求一张中间态快照：写 __NS_SHOT，等 Node 拍完置 __NS_SHOT_OK（上限 5s，超时也继续，绝不挂住流程）。 */
function requestShot(name, clip) {
  window.__NS_SHOT = name;
  /* 可选裁剪：{x,y,width,height} 给「同一个父行折叠前后」这类近景用，Node 侧按它裁 clip；
     不传就是整屏（历史调用点行为不变）。拍完两端一起清，免得下一张图继承上一张的裁剪。 */
  window.__NS_SHOT_CLIP = clip || null;
  window.__NS_SHOT_OK = false;
  var t0 = Date.now();
  return new Promise(function (res) {
    (function poll() {
      if (window.__NS_SHOT_OK === true || Date.now() - t0 > 5000) {
        window.__NS_SHOT = null; window.__NS_SHOT_CLIP = null; res(null); return;
      }
      setTimeout(poll, 60);
    })();
  });
}
function popoverVisibleCount(doc) {
  var cnt = 0, l = doc.querySelectorAll('.n-popover');
  for (var i = 0; i < l.length; i++) {
    var r = l[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) cnt++;
  }
  return cnt;
}
function nestedPopoverProbe(frame, out) {
  var width = out.width;
  var doc = frame.contentDocument, win = frame.contentWindow, ev = out.evidence;
  function vis(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function firstVisiblePopover() {
    var list = doc.querySelectorAll('.n-popover');
    for (var i = 0; i < list.length; i++) if (vis(list[i])) return list[i];
    return null;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var st = { moreClicked: false, poppedBefore: false, colorClicked: false, poppedAfter: false, visiblePopoversAfter: 0, err: '' };
  var outer = null;
  return wait(40).then(function () {
    try {
      var more = doc.querySelector('.editor-toolbar [data-act="more-features"]') || doc.querySelector('[data-act="more-features"]');
      st.moreClicked = !!more;
      if (more) more.click();
    } catch (e) { st.err = String(e && e.message || e); }
    return wait(280);
  }).then(function () {
    outer = firstVisiblePopover();
    st.poppedBefore = !!outer;
    var chapterControls = outer && outer.querySelector('.editor-bar-status');
    var chapterSelect = chapterControls && chapterControls.querySelector('.n-select');
    var historyButton = chapterControls && chapterControls.querySelector('.n-button');
    out.items.push({ name: '更多格式保留状态与历史', pass: vis(chapterSelect) && vis(historyButton),
      ev: '状态可见=' + vis(chapterSelect) + ' 历史可见=' + vis(historyButton) });
    /* 小尺寸下弹层不许突破视口下沿（2026-11 六改）：改前是一根 200px 宽、16 行 ≈750px 的竖条，
       naive 的 .n-popover 本身没有 max-height，于是 695/760 档直接掉出屏幕。 */
    var mbox0 = outer && outer.querySelector('.tb-more');
    var mr0 = mbox0 ? mbox0.getBoundingClientRect() : null;
    var mcs0 = mbox0 ? win.getComputedStyle(mbox0) : null;
    var mCount0 = mbox0 ? mbox0.querySelectorAll('.tb').length : -1;
    out.evidence.moreFormats = {
      width: width,
      box: mr0 ? { top: Math.round(mr0.top), bottom: Math.round(mr0.bottom), h: Math.round(mr0.height), w: Math.round(mr0.width) } : '未找到',
      vh: win.innerHeight,
      maxHeight: mcs0 ? mcs0.maxHeight : '',
      overflowY: mcs0 ? mcs0.overflowY : '',
      scrollH: mbox0 ? mbox0.scrollHeight : -1,
      clientH: mbox0 ? mbox0.clientHeight : -1,
      items: mCount0
    };
    out.items.push({
      name: '更多格式不破底线',
      pass: !!mr0 && mr0.top >= 0 && mr0.bottom <= win.innerHeight - 4 && mcs0.overflowY !== 'visible',
      ev: mr0
        ? '弹层 ' + Math.round(mr0.top) + '…' + Math.round(mr0.bottom) + '（高 ' + Math.round(mr0.height) + '/' + Math.round(mr0.width)
          + '）视口=' + win.innerHeight + ' max-height=' + (mcs0.maxHeight || '(无)') + ' overflow-y=' + mcs0.overflowY
          + ' scrollH=' + (mbox0 ? mbox0.scrollHeight : -1) + ' clientH=' + (mbox0 ? mbox0.clientHeight : -1)
        : 'contextmenu 之后没有渲染 .tb-more'
    });
    /* 与右键菜单重合的条目已删（对齐 4 项 / 列表 2 项 / 引用 / 清除格式 / 内联取色器） */
    var leftover = mbox0 ? mbox0.querySelectorAll('.n-color-picker, [data-act="align-left"], [data-act="bullet-list"]').length : -1;
    out.items.push({
      name: '更多格式已去重',
      pass: mCount0 > 0 && mCount0 <= 12 && leftover === 0,
      ev: '可见条目=' + mCount0 + '（要求 1~12，改前 16+）；重合控件残留=' + leftover
    });
    /* 插件版不提供纸面切换 */
    var paperEl = mbox0 ? mbox0.querySelector('.tb-paper-in-more, .paper-menu-trigger, [data-paper-choice]') : null;
    out.items.push({
      name: '插件版无纸面切换', pass: !!mbox0 && !paperEl,
      ev: mbox0 ? ('纸面入口=' + (paperEl ? '仍存在（' + String(paperEl.className || '') + '）' : '已移除')) : '弹层未渲染'
    });
    try {
      var colorBtn = doc.querySelector('.n-popover [data-act="color"]') || doc.querySelector('[data-act="color"]');
      st.colorClicked = !!colorBtn;
      if (colorBtn) colorBtn.click();
    } catch (e2) { st.err = st.err || String(e2 && e2.message || e2); }
    return wait(340);
  }).then(function () {
    st.poppedAfter = !!outer && doc.contains(outer) && vis(outer);
    st.visiblePopoversAfter = popoverVisibleCount(doc);
    ev.nestedPopover = st;
    /* 「更多格式」弹层的排版留证：等动画走完（再等 260ms，叠在前面的 340ms 之后）再请求快照，
       不拍中间态；拍完才关弹层，顺序与之前一致。 */
    return wait(260).then(function () {
      return requestShot('chapters-695-more');
    }).then(function () {
    /* 纯取证（不判红）：「更多格式」弹层每项只有约 26px 宽、左对齐贴死，怀疑 .tb-more .tb{width:100%}
       没吃到（容器被子类改成 block 时 100% 也不会变宽）。把容器与首个按钮的 computed 关键值、
       类名与 inline style 一起交出去，答案在 Node 汇总的「只记录不判红的探针」一节。 */
    (function () {
      var mbox = doc.querySelector('.n-popover .tb-more') || doc.querySelector('.tb-more') || outer;
      if (!mbox) { ev.morePopover = { container: '未找到' }; return; }
      var bcs = win.getComputedStyle(mbox);
      var mbtns = mbox.querySelectorAll('button');
      var firstBtn2 = mbtns.length ? mbtns[0] : null;
      var fcs = firstBtn2 ? win.getComputedStyle(firstBtn2) : null;
      var fr2 = firstBtn2 ? firstBtn2.getBoundingClientRect() : null;
      var kids2 = mbox.children || [];
      function lead(el) { var h = String(el.outerHTML || ''); return h.length > 120 ? h.slice(0, 120) : h; }
      ev.morePopover = {
        container: {
          display: bcs.display, flexDirection: bcs.flexDirection, minWidth: bcs.minWidth,
          width: bcs.width, padding: bcs.padding, alignItems: bcs.alignItems
        },
        firstItem: firstBtn2 ? {
          tagName: String(firstBtn2.tagName || ''), cls: String(firstBtn2.className || ''),
          width: fr2 ? Math.round(fr2.width) : -1, height: fr2 ? Math.round(fr2.height) : -1,
          whiteSpace: fcs.whiteSpace, flexBasis: fcs.flexBasis, display: fcs.display,
          computedWidthRuleHint: '见 evidence',
          inlineStyle: firstBtn2.getAttribute ? String(firstBtn2.getAttribute('style') || '') : ''
        } : '无 button',
        itemCount: mbtns.length,
        outerHTMLLead: [kids2[0] ? lead(kids2[0]) : null, kids2[1] ? lead(kids2[1]) : null]
      };
    })();
    /* 收尾用「再点一次触发器」的真点击关弹层（最多 2 次）；关不掉只记录，不判红 —— 那是产品问题。 */
    return closePopovers(doc, 2).then(function (n) {
      return wait(120).then(function () {
        st.closeClicks = n;
        st.popoversLeftVisible = popoverVisibleCount(doc);
        return null;
      });
    });
    });
  });
}
function done(module, width, frame) {
  if (new URLSearchParams(location.search).has('inspect')) { window.__NS_INSPECT_READY = true; return; }
  window.__NS_PROGRESS = { stage: 'done-enter' };
  var out;
  try { out = measure(module, frame, width); } catch (e) { out = { module: module, width: width, ok: false, items: [], error: 'measure 失败: ' + String(e && e.message || e) }; }
  window.__NS_PROGRESS = { stage: 'measured', promise: !!(out && typeof out.then === 'function') };
  Promise.resolve(out).then(function (o) {
    window.__NS_PROGRESS = { stage: 'resolved', items: o && o.items ? o.items.length : -1 };
    o.module = module;
    o.width = width;
    finish(o);
    window.__NS_PROGRESS = { stage: 'finished' };
  }, function (e) {
    window.__NS_PROGRESS = { stage: 'rejected', ev: String((e && e.message) || e) };
  });
}
function ticks(frame, module, width) {
  /* 拆窗面板场景的 module 形如 'panel-outline'：ticks 与 boot 各算一次。
     （曾经只写在 boot() 里，ticks 取到的是未声明的全局 —— 非书架场景每 tick 都抛 ReferenceError，
      于是正文与四个模块全都卡在「页面没到可测状态」上。） */
  var panelType = module.indexOf('panel-') === 0 ? module.slice(6) : '';
  var tries = 0, opened = false;
  window.__NS_PROGRESS = { stage: 'start' };
  /* 设定幕布种子只能走应用自己的 store：在 raw IndexedDB 里预建 mubu 表没用 ——
     Dexie 从 v1 升到 v12 时会把未声明的表清空（实测 mubu.length=0）。 */
  var mubuSeeded = false;
  var snipSeeded = false;
  function seedSnippets() {
    if (snipSeeded) return;
    var ws2 = workStore(frame);
    if (!ws2 || !ws2.work) return;
    if (ws2.snippets && ws2.snippets.length) { snipSeeded = true; return; }
    snipSeeded = true;
    try {
      var firstId = null;
      SNIPPETS.forEach(function (n) {
        var row = ws2.addSnippet(n.content, { tags: n.tags, links: n.links });
        if (row && row.id && !firstId) firstId = row.id;
      });
      if (ws2.tab !== 'snippets') ws2.tab = 'snippets';
      if (firstId) ws2.selSnippetId = firstId;
    } catch (e) { /* 造数失败只影响灵感样例，不影响其余判据 */ }
  }
  function seedMubu() {
    if (mubuSeeded) return;
    var ws0 = workStore(frame);
    if (!ws0 || !ws0.work) return;
    mubuSeeded = true;
    if (ws0.mubu.length) return;
    var s1 = ws0.mubuAdd(null, null, '地理与场所');
    var a1 = ws0.mubuAdd(s1.id, null, '雾港灯塔');
    ws0.mubuSetTags(a1.id, ['地点']);
    var a1b = ws0.mubuAdd(a1.id, null, '建筑与空间');
    ws0.mubuAdd(a1b.id, null, '塔身有七十二级台阶，顶层灯室朝北开窗。');
    var a2 = ws0.mubuAdd(s1.id, null, '旧港与栈桥');
    ws0.mubuSetTags(a2.id, ['地点', '雾港']);
    var a3 = ws0.mubuAdd(s1.id, null, '潮汐集市');
    ws0.mubuAdd(a3.id, null, '退潮后开市，摊主用没有日期的潮汐表记账。');
    ws0.mubuAdd(a3.id, null, '卖海水送回来的旧物。');
    var a2x = ws0.mubuAdd(a2.id, null, '第七栈桥');
    ws0.mubuAdd(a2x.id, null, '涨潮时只露出桩头。');
    ws0.mubuAdd(a2x.id, null, '夜里有灯，却不属于任何一条船。');
    var s2 = ws0.mubuAdd(null, null, '组织与势力');
    var b1 = ws0.mubuAdd(s2.id, null, '守灯人协会');
    ws0.mubuSetTags(b1.id, ['秘社']);
    ws0.mubuAdd(b1.id, null, '交班前清点钥匙；三点前不独自进入灯室。');
    var b1b = ws0.mubuAdd(b1.id, null, '未记入册的第七条');
    ws0.mubuAdd(b1b.id, null, '如果有人从海上呼唤你的名字，不要回头。');
    var b2 = ws0.mubuAdd(s2.id, null, '北岸航运局');
    ws0.mubuAdd(b2.id, null, '只登记有编号的船。');
    ws0.mubuAdd(s2.id, null, '灯塔管委会');
    ws0.setMubuSet(s1.id);
  }
  /* 回收站要有真条目（设置页的数据页要数它）：走 store 的软删——与用户在列表里点删除同一条路径。
     章节挑第 3 章（正文导出判据只认第 1 章），人物现建现删，两者互不干扰。 */
  var trashSeeded = false;
  function seedTrash() {
    if (trashSeeded) return;
    var ws1 = workStore(frame);
    if (!ws1 || !ws1.work) return;
    trashSeeded = true;
    try {
      var chs = ws1.liveChapters || [];
      if (chs.length > 2) ws1.deleteChapter(chs[2].id);
      var made = ws1.addCharacter('对稿临时人物');
      if (made && made.id) ws1.deleteCharacter(made.id);
    } catch (e) { /* 造数失败只影响回收站那几条，不影响其余判据 */ }
  }
  var timer = setInterval(function () {
    tries++;
    shim(frame);
    var doc = frame.contentDocument;
    if (!doc) return;
    if (tries > 400) {
      clearInterval(timer);
      finish({ module: module, width: width, ok: false, items: [], error: '超时：40s 内页面没到可测状态 (tries=' + tries + ', opened=' + opened + ')' });
      return;
    }
    if (module === 'shelf') {
      if (tries > 12 && doc.querySelector('.latent-shelf .ls-card')) { clearInterval(timer); done(module, width, frame); }
      return;
    }
    /* 拆窗面板：不经书架、不切页签 —— PanelHost 自己按 ?panel= 打开作品并设页签，
       面板顶栏出现即 status=ready 的唯一可见标志（其余判据都读面板内的 DOM）。 */
    if (panelType) {
      /* 设置面板没有 .panel-topbar（PanelHost 的 settings 分支只渲染 SettingsWindow）：
         就绪标志改成共用的 .settings-shell。 */
      var panelReadySel = panelType === 'settings' ? '.settings-shell' : '.panel-host .panel-topbar';
      if (tries > 12 && doc.querySelector(panelReadySel)) {
        clearInterval(timer);
        try { var pw = frame.contentWindow; pw.dispatchEvent(new pw.Event('resize')); } catch (e8) { /* ignore */ }
        setTimeout(function () { shim(frame); done(module, width, frame); }, 1200);
      }
      return;
    }
    /* 设置工作区（ui.view='settings'）：不经 workbench 页签，先把种子作品打开（数据页要真实读库），
       造好设定与回收站条目，再把视图切到 settings —— 与产品入口（settings-entry 的兜底路径）同一处状态。
       就绪标志是 .settings-shell 出现。 */
    if (module === 'settings' || module === 'settings-restore') {
      if (!opened) {
        var setOpenBtn = doc.querySelector('.latent-shelf .ls-primary')
          || doc.querySelector('.latent-shelf .ls-card')
          || doc.querySelector('.os-book-open');
        if (setOpenBtn) { setOpenBtn.click(); opened = true; }
        return;
      }
      var wbSet = doc.querySelector('.workbench-shell');
      /* 作品已经打开（工作台在）才轮到造数；切到设置视图之后工作台就卸载了，所以造数只在有工作台时做。 */
      if (wbSet) {
        seedMubu();
        seedTrash();
        try {
          var usSet = uiStore(frame);
          if (usSet && usSet.view !== 'settings') usSet.view = 'settings';
        } catch (eSet) { /* 取不到就等下一拍 */ }
      }
      if (tries > 12 && doc.querySelector('.settings-shell')) {
        clearInterval(timer);
        setTimeout(function () { shim(frame); done(module, width, frame); }, 1500);
      }
      return;
    }
    if (!opened) {
      /* 点卡片只换聚焦，「继续写作」才 emit open；旧桌面皮肤的按钮排最后，仅为不弄坏老路径。 */
      var btn = doc.querySelector('.latent-shelf .ls-primary')
        || doc.querySelector('.latent-shelf .ls-card')
        || doc.querySelector('.os-book-open[data-work-id="w1"]')
        || doc.querySelector('.os-book-open');
      if (btn) { btn.click(); opened = true; }
      return;
    }
    /* 页签切换走 store：顶栏导航与 ?panel= 不过是它的两副面孔。切完再看 data-module，
       没到位就继续等 —— 组件是异步挂载的，切完立刻量会量到上一页的 DOM。 */
    var wantTab = module === 'chapters' ? 'chapters' : module;
    var wbShell = doc.querySelector('.workbench-shell');
    /* 「作品已打开」= 工作台外壳在 + 顶栏在。不能拿 .tiptap 当门槛：切到大纲/设定后编辑器已经卸载，
       拿它当门槛会永远等不到下一步。 */
    var openedWork = !!wbShell && !!doc.querySelector('.app-topbar .app-topbar-save');
    window.__NS_PROGRESS = { stage: 'work', tries: tries, openedWork: openedWork, tab: wbShell.getAttribute('data-module'), want: wantTab };
    if (!openedWork) return;
    seedMubu();
    if (wantTab === 'snippets') seedSnippets();
    if (wbShell.getAttribute('data-module') !== wantTab) {
      try { var ws = workStore(frame); if (ws) ws.tab = wantTab; } catch (e) { /* 保持默认 tab */ }
      return;
    }
    if (tries > 12) {
      clearInterval(timer);
      setTimeout(function () {
        /* 先记「默认态」，再打开目录栏：面板内断言（首按钮/滚动播放/不折行/左对齐/不压字数/新建按钮/收起键同尺寸）
           全都要求 .side-panel 已渲染，而它现在是默认收起的浮层。 */
        try {
          var dfd = frame.contentDocument;
          SIDE_DEFAULT = {
            panel: !!dfd.querySelector('.workbench-shell #writing-directory.side-panel') || !!dfd.querySelector('.side-panel'),
            rail: !!dfd.querySelector('.ol-side-rail')
          };
          var us = uiStore(frame);
          if (us && !us.sidePanelOpen) us.setPref('sidePanelOpen', true);
        } catch (e0) { /* 取不到就按现有 DOM 判断 */ }
        try { frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('resize')); } catch (e) { /* ignore */ }
        setTimeout(function () { shim(frame); done(module, width, frame); }, 1200);
      }, 350);
    }
  }, 100);
}
function boot() {
  var qp = new URLSearchParams(location.search);
  var module = qp.get('module') || 'shelf';
  var width = Number(qp.get('vw') || 1280);
  /* 拆窗面板场景（module='panel-<type>'）：iframe 直接指向带 ?panel= 的地址，由 PanelHost 自己打开作品。
     作品 id 用种子里的 w1 —— 书架聚焦卡，「继续写作」打开的也是它，两条路径因此同源。 */
  var panelType = module.indexOf('panel-') === 0 ? module.slice(6) : '';
  applyHostTokens();
  var names = ['novel-studio', 'novel-studio@dsh'];
  Promise.all(names.map(deleteDb))
    .then(function () { return Promise.all(names.map(seedDb)); })
    .then(function () {
      var frame = document.createElement('iframe');
      frame.id = 'ns-frame';
      frame.style.cssText = 'width:' + width + 'px;height:' + VH + 'px;position:fixed;left:0;top:0;border:0;background:#151517';
      /* 设置面板窗口走产品自己的地址形状（?panel=settings:app:）；其余面板仍按作品 id 打开。
         设置场景额外带上 nsverify-bus：只有它需要宿主桥（跨窗口 prefs-changed）。 */
      var panelQuery = panelType === 'settings' ? '&panel=settings:app:' : (panelType ? '&panel=' + panelType + ':w1' : '');
      frame.src = PREFIX + '/index.html?embed=1' + panelQuery + (module === 'settings' ? '&nsverify-bus=1' : '');
      frame.addEventListener('load', function () { shim(frame); if (!frame.dataset.verifyReload) ticks(frame, module, width); });
      document.body.appendChild(frame);
    })
    .catch(function (e) { finish({ module: module, width: width, ok: false, items: [], error: '种子失败: ' + String(e) }); });
}
boot();
</script>
</body></html>`

/* ===== 设置 · 面板矩阵（2026-11-06 设置融合总稿） =====
   SettingsWorkspace.vue 把分类、检索定位、滚动记忆、预览、弹窗全捏在一个组件里，数据真源是
   ui / work 两个 store，所以造数与断言一律走 store + 真机点路径（与 loreMatrixProbe / charMatrixProbe
   同一套写法、同一套「实测 …（期望 …）」证据串）。

   与 Node 侧的交互（浏览器验收环境缺的那几件，总稿 tools/verify.mjs 同款做法）走一份极小请求表：
   页内举起 window.__NS_REQ = {id, kind, payload}，runOne 的轮询回路执行完把结果写进
   window.__NS_REQ_RESULT。用途是：受信任点击/按键（原生 <dialog> 只认受信任的 Esc）、
   等下载真的落盘（文件名/字节数/正文首行都从磁盘读）、把备份文件喂给动态创建的 input[type=file]
   （Page.setInterceptFileChooserDialog → DOM.setFileInputFiles）、写临时文件、开第二个窗口。
   这些都不是「跳过用例」：它们是这条链路在浏览器里唯一能走通的真路径。

   期望值出处：settings-fusion.css（总稿 studio.css 的 1:1 移植）与 settings-entry / settings-prefs
   的常量（外观默认 song/none/17/false、字号区间 13–24、检索目录 SETTINGS_CATALOG）。
   重活在 1440/1280 跑一遍（下载、喂文件、第二个窗口都慢），窄档只跑结构、外观与窄档专属判据。 */
async function settingsProbe(frame, out, width) {
  const ev = out.evidence
  const S = (ev.settings = {})
  const need = (name, ok, e) => { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }) }
  const doc = () => frame.contentDocument
  const win = () => frame.contentWindow
  const q = (sel) => { const d = doc(); return d ? d.querySelector(sel) : null }
  const qa = (sel) => { const d = doc(); return d ? Array.prototype.slice.call(d.querySelectorAll(sel)) : [] }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const t0 = Date.now()
    const lim = ms || 12000
    for (;;) {
      let v = false
      try { v = fn() } catch (e) { v = false }
      if (v) return true
      if (Date.now() - t0 > lim) return false
      await wait(100)
    }
  }
  const px2 = (v) => Math.round(parseFloat(v) * 10) / 10
  const flat = (s) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim()
  const txt = (sel) => { const n = q(sel); return n ? flat(n.textContent) : '' }
  const vis = (n) => {
    if (!n) return false
    const r = n.getBoundingClientRect()
    const c = win().getComputedStyle(n)
    return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'
  }
  const css = (sel) => { const n = q(sel); return n ? win().getComputedStyle(n) : null }
  const box = (sel) => {
    const n = q(sel)
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { l: px2(r.left), t: px2(r.top), r: px2(r.right), b: px2(r.bottom), w: px2(r.width), h: px2(r.height) }
  }
  const click = (x) => { const n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); return true } catch (e) { return false } }
  const setInput = (sel, value) => {
    const n = q(sel)
    if (!n) return false
    n.focus()
    n.value = value
    n.dispatchEvent(new (win().Event)('input', { bubbles: true }))
    return true
  }
  const choose = (sel, value) => {
    const n = q(sel)
    if (!n) return false
    n.value = value
    n.dispatchEvent(new (win().Event)('change', { bubbles: true }))
    return true
  }
  const stores = () => {
    try {
      const appEl = doc().querySelector('#app')
      const pinia = appEl && appEl.__vue_app__ ? appEl.__vue_app__.config.globalProperties.$pinia : null
      if (!pinia) return { ui: null, work: null }
      return { ui: pinia._s.get('ui'), work: pinia._s.get('work') }
    } catch (e) { return { ui: null, work: null } }
  }
  const snap = () => {
    const u = stores().ui
    return u ? { editorFont: u.editorFont, editorLatin: u.editorLatin, fontSize: u.fontSize, topbarAutoHide: u.topbarAutoHide } : null
  }

  /* ---- Node 侧请求表 ---- */
  async function req(kind, payload, timeoutMs) {
    const id = 'r' + Date.now() + Math.floor(Math.random() * 1e6)
    window.__NS_REQ_RESULT = null
    window.__NS_REQ = { id: id, kind: kind, payload: payload || {} }
    const t0 = Date.now()
    let value = null
    for (;;) {
      const got = window.__NS_REQ_RESULT
      if (got && got.id === id) { value = got.value; break }
      if (Date.now() - t0 > (timeoutMs || 30000)) break
      await wait(120)
    }
    window.__NS_REQ = null
    if (value === null) return { error: 'Node 侧无响应：' + kind }
    return value
  }
  async function trustedClick(sel) {
    const n = typeof sel === 'string' ? q(sel) : sel
    if (!n) return { error: '未找到 ' + sel }
    const r = n.getBoundingClientRect()
    return req('click', { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  const trustedEsc = () => req('key', { key: 'Escape' })
  /* 打开恢复弹窗需要「受信任点击 → 拦住文件框 → 喂文件」三步；拆窗 target 里偶发一次没拦住，
     就重来一次整串（最多三次），并在证据里记下喂文件返回的内容。 */
  async function feedRestore(name) {
    let last = null
    for (let attempt = 0; attempt < 3; attempt++) {
      await req('arm-chooser')
      await trustedClick('[data-act="restore"]')
      last = await req('choose-file', { name: name, timeoutMs: 20000 })
      if (last && !last.error) return last
      await wait(700)
    }
    return last || { error: '三次重试都没能把文件喂进选择框' }
  }

  /* ---- IndexedDB 直读（与 settings-data-actions 的 loadLibrarySummary 同一口径） ---- */
  function idbOpen() {
    return new Promise((resolve) => {
      const w = win()
      let done = false
      const fin = (v) => { if (!done) { done = true; resolve(v) } }
      let list = null
      try { list = w.indexedDB.databases ? w.indexedDB.databases() : null } catch (e) { list = null }
      if (!list || typeof list.then !== 'function') return fin({ error: 'indexedDB.databases() 不可用' })
      list.then((dbs) => {
        const hit = (dbs || []).filter((d) => String(d && d.name || '').indexOf('novel-studio') >= 0)
        if (!hit.length) return fin({ error: '未找到 novel-studio 库' })
        const rq = w.indexedDB.open(hit[0].name)
        rq.onerror = () => fin({ error: '打开 ' + hit[0].name + ' 失败' })
        rq.onsuccess = () => fin({ db: rq.result, name: hit[0].name })
      }).catch((e) => fin({ error: 'databases() 失败: ' + String(e && e.message || e) }))
    })
  }
  function idbAll(handle, storeName) {
    return new Promise((resolve) => {
      try {
        if (Array.prototype.slice.call(handle.objectStoreNames || []).indexOf(storeName) < 0) return resolve([])
        const rq = handle.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        rq.onsuccess = () => resolve(rq.result || [])
        rq.onerror = () => resolve([])
      } catch (e) { resolve([]) }
    })
  }
  async function idbCounts() {
    const opened = await idbOpen()
    if (!opened.db) return opened
    const w = win()
    const live = (rows) => rows.filter((r) => !r || !r.deletedAt)
    const dead = (rows) => rows.filter((r) => r && r.deletedAt)
    const all = await Promise.all(['works', 'chapters', 'characters', 'mubu', 'lore', 'snippets']
      .map((t) => idbAll(opened.db, t)))
    const works = all[0], chapters = all[1], characters = all[2], mubu = all[3], lore = all[4], snippets = all[5]
    const countWords = typeof (w.__ns && w.__ns.countWords) === 'function' ? w.__ns.countWords : () => 0
    const words = live(chapters).reduce((sum, c) => sum + Number(countWords(String(c && c.content == null ? '' : c.content)) || 0), 0)
    try { opened.db.close() } catch (e) { /* 已关 */ }
    return {
      works: live(works).length,
      chapters: live(chapters).length,
      words: words,
      characters: live(characters).length,
      lore: live(mubu).length + live(lore).length,
      trash: dead(chapters).length + dead(characters).length + dead(mubu).length + dead(lore).length + dead(snippets).length,
      trashByKind: {
        chapters: dead(chapters).length,
        characters: dead(characters).length,
        lore: dead(mubu).length + dead(lore).length,
        snippets: dead(snippets).length
      }
    }
  }
  const numOf = (s) => Number(String(s === null || s === undefined ? '' : s).replace(/[^0-9]/g, ''))

  if (!q('.settings-shell')) {
    need('设置外壳渲染', false, '未找到 .settings-shell（SettingsWorkspace 未挂载）')
    return out
  }
  await wait(320)
  S.width = width
  const wide = width >= 1100
  const phone = width <= 559
  /* 重活（真实下载、喂备份、第二个窗口）只在 1440 主档跑一遍：1280/1000/760/380 守的是
     结构、外观与窄档判据，同一条链路重复跑只会拉长跑时。 */
  const heavy = width === 1440

  /* ---------- 1. 结构 ---------- */
  const inset = phone ? { l: 12, gap: 8, b: 12 } : wide ? { l: 28, gap: 16, b: 24 } : { l: 20, gap: 12, b: 20 }
  const shell = box('.settings-shell'), topbar = box('.app-topbar-shell')
  const vh = win().innerHeight
  need('设置外壳紧贴实际顶栏', !!shell && !!topbar
    && Math.abs(shell.l - inset.l) <= 1 && Math.abs(shell.t - topbar.b - inset.gap) <= 1
    && Math.abs(shell.r - (width - inset.l)) <= 1 && Math.abs(shell.b - (vh - inset.b)) <= 1,
    JSON.stringify({ shell, topbar, inset, width, vh }))
  const KID_CLASSES = ['side-pane', 'main-pane', 'scrim', 'toast']
  const kids = qa('.settings-shell > *').map(el=>KID_CLASSES.find(c=>el.classList.contains(c)) || el.tagName)
  need('窄屏工具位于面板页头', kids.join(',') === KID_CLASSES.join(',') && !!q('.page-head .mobile-tools [data-act="open-drawer"]'),
    '外壳直接子元素 ' + kids.join('/'))
  if (!wide) need('窄屏排版预览入口可点击', vis(q('.mobile-preview-toggle')))
  await requestShot('settings-compact-'+width)
  if (width === 864 || width === 380) {
    const u = stores().ui, wasAuto = u.topbarAutoHide
    await u.setPref('topbarAutoHide',true)
    await wait(300)
    const collapsed = box('.app-topbar-shell'), compact = box('.settings-shell')
    need('顶栏隐藏时设置面板随之上移', collapsed && compact && compact.t < shell.t && Math.abs(compact.t-collapsed.b-inset.gap)<=1,
      JSON.stringify({ collapsed, compact }))
    await u.setPref('topbarAutoHide',wasAuto)
    await wait(150)
  }

  const PAGES = [['appearance', '外观与排版'], ['data', '备份与数据'], ['about', '帮助与关于']]
  const heads = []
  for (let i = 0; i < PAGES.length; i++) {
    if (i > 0) { click('.category[data-page="' + PAGES[i][0] + '"]'); await wait(340) }
    heads.push(txt('.page-head h1'))
  }
  need('页头 h1 随分类变化', heads.join('|') === PAGES.map((p) => p[1]).join('|'),
    '实测「' + heads.join('」「') + '」（期望「' + PAGES.map((p) => p[1]).join('」「') + '」）')
  const cats = qa('.category')
  const currentCat = qa('.category[aria-current="page"]')
  need('分类三项且当前项带 aria-current', cats.length === 3 && currentCat.length === 1
    && currentCat[0].getAttribute('data-page') === 'about',
    '实测分类 ' + cats.length + ' 项（期望 3）；aria-current=page ' + currentCat.length + ' 项，当前='
      + (currentCat[0] ? currentCat[0].getAttribute('data-page') : '(无)') + '（期望 1 项 / about）')
  /* 页脚版本号不带 v（总稿 app.mjs:22 的 nav-foot 就是「小说工坊 · 0.2.8」）；
     关于页那句「DSH 插件版 · v0.2.8」仍带 v，两条都要在，别把哪一条改跑偏。 */
  need('侧栏页脚带版本号（不带 v）', txt('.nav-foot').indexOf('小说工坊 · 0.2.8') >= 0 && txt('.nav-foot').indexOf('v0.2.8') < 0,
    '实测「' + txt('.nav-foot') + '」（期望含 小说工坊 · 0.2.8，且不含 v0.2.8：总稿 nav-foot 不带 v）')
  /* 侧栏页脚必须是块级两行：themes.css 里那条未加 .lore-shell 前缀的
     .nav-foot{display:flex;white-space:nowrap} 曾把说明行顶成同一行、并被 .pane 的 overflow 裁掉
     （2026-11-06 在 settings-fusion.css:62 补 display:block;white-space:normal 修复）。
     只在宽档量：≤1099 侧栏是抽屉，收起时 .nav-foot 不可见。高度按原型 86px ±4（产物 83px，差在行高合成）。 */
  if (wide) {
    const nfEl = q('.nav-foot')
    const nfCs = nfEl ? win().getComputedStyle(nfEl) : null
    const nfStrong = nfEl ? nfEl.querySelector('strong') : null
    const nfP = nfEl ? nfEl.querySelector('p') : null
    const nfGap = nfStrong && nfP ? Math.abs(nfStrong.getBoundingClientRect().top - nfP.getBoundingClientRect().top) : -1
    const nfH = nfEl ? nfEl.offsetHeight : -1
    need('侧栏页脚是块级两行', !!nfCs && nfCs.display === 'block' && nfCs.whiteSpace === 'normal' && nfGap > 4 && Math.abs(nfH - 87) <= 1,
      '实测 .nav-foot display=' + (nfCs ? nfCs.display : '(缺)') + ' white-space=' + (nfCs ? nfCs.whiteSpace : '(缺)')
        + '；strong 与 p 的 rect.top 差=' + (nfGap < 0 ? '(缺)' : Math.round(nfGap * 10) / 10) + 'px（要求 >4 = 不同行）'
        + '；offsetHeight=' + nfH + 'px（原型 87，容差 ±1：settings-fusion.css 已把容器 strut 补回 14px/1.65）')
  }
  const bars = qa('.app-topbar')
  need('全页只有一处顶栏', bars.length === 1, '实测 .app-topbar ' + bars.length + ' 处（期望 1：设置外壳自带 AppTopbar）')

  /* ---------- 2. 外观页 ---------- */
  click('.category[data-page="appearance"]')
  await wait(420)
  need('#editorFont 六项字体', qa('#editorFont option').length === 6,
    '实测 ' + qa('#editorFont option').length + ' 项（期望 6：思源宋体/霞鹜文楷/京华老宋体/朝华标题/云游手书/系统黑体）')
  need('#editorLatin 三项字体', qa('#editorLatin option').length === 3,
    '实测 ' + qa('#editorLatin option').length + ' 项（期望 3：跟随中文/Playfair Display/Montenegrin Gothic One）')
  setInput('#font-size-range', '24')
  await wait(300)
  const fs24 = css('.preview-copy') ? css('.preview-copy').fontSize : '(缺)'
  need('滑杆拉到 24 预览即时跟随', fs24 === '24px', '实测 .preview-copy font-size=' + fs24 + '（期望 24px）')
  need('24px 时增号按钮禁用', !!q('[data-act="font-up"]') && q('[data-act="font-up"]').disabled,
    '实测 [data-act=font-up].disabled=' + (q('[data-act="font-up"]') ? q('[data-act="font-up"]').disabled : '(缺)') + '（期望 true：13–24 上限夹紧）')
  setInput('#font-size-range', '13')
  await wait(300)
  need('13px 时减号按钮禁用', !!q('[data-act="font-down"]') && q('[data-act="font-down"]').disabled,
    '实测 [data-act=font-down].disabled=' + (q('[data-act="font-down"]') ? q('[data-act="font-down"]').disabled : '(缺)') + '（期望 true）')
  setInput('#font-size-range', '17')
  await wait(260)
  const sw = q('#topbar-switch')
  click(sw)
  await wait(340)
  need('顶栏开关驱动预览隐藏', !!sw && sw.getAttribute('aria-checked') === 'true' && !!q('.preview-window.is-hidden'),
    '实测 aria-checked=' + (sw ? sw.getAttribute('aria-checked') : '(缺)') + '，.preview-window.is-hidden='
      + !!q('.preview-window.is-hidden') + '（期望 true / true）')
  click(sw)
  await wait(420)
  const famOf = () => (css('.preview-copy') ? css('.preview-copy').fontFamily : '(缺)')
  choose('#editorFont', 'kai')
  await wait(340)
  const kaiFam = famOf()
  need('中文正文字体实际应用（霞鹜文楷）', kaiFam.indexOf('LXGW WenKai') >= 0,
    '实测 .preview-copy font-family=' + kaiFam + '（期望含 LXGW WenKai）')
  choose('#editorLatin', 'playfair')
  await wait(340)
  const playFam = famOf()
  need('西文字体实际应用（Playfair Display）', playFam.indexOf('Playfair Display') >= 0,
    '实测 .preview-copy font-family=' + playFam + '（期望含 Playfair Display，且排在中文字族之前）')
  choose('#editorFont', 'song')
  choose('#editorLatin', 'none')
  await wait(380)

  if (heavy) {
    /* ---------- 3. 保存态（真实写库失败：serve() 注入的 appconfig 事务开关） ---------- */
    const uiS = stores().ui
    if (!uiS) {
      need('设置页可测（ui store）', false, 'pinia._s.get("ui") 为空')
    } else {
      const size0 = Number(uiS.fontSize)
      win().__NS_FAIL_PREFS_SAVE = true
      click('[data-act="font-up"]')
      await wait(700)
      const faults = Number(win().__NS_FAILED_PREF_SAVES) || 0
      const banner = q('#save-error')
      need('写库失败给出可重试提示', faults > 0 && vis(banner) && !!q('#save-error [data-act="retry"]'),
        '实测 IndexedDB 拦截 ' + faults + ' 次；.save-error-banner 可见=' + vis(banner) + '；重试键='
          + !!q('#save-error [data-act="retry"]') + '；文案「' + txt('#save-error').slice(0, 46) + '」（期望 有/是/有）')
      need('写库失败页脚转错误态', !!q('.page-foot.error'), '实测 .page-foot.error=' + !!q('.page-foot.error') + '（期望 true）')
      const saveEl = q('.app-topbar-save')
      need('写库失败顶栏保存态转 error', !!saveEl && saveEl.getAttribute('data-save-state') === 'error',
        '实测 顶栏 .app-topbar-save[data-save-state]=' + (saveEl ? saveEl.getAttribute('data-save-state') : '(缺)') + '（期望 error）')
      need('写库失败保留当前选择', Number(stores().ui.fontSize) === size0 + 1,
        '实测 ui.fontSize=' + Number(stores().ui.fontSize) + '（期望 ' + (size0 + 1) + ' = 改前 ' + size0 + ' + 1：内存值先落、写库后补）')
      win().__NS_FAIL_PREFS_SAVE = false
      click('#save-error [data-act="retry"]')
      await wait(1100)
      const uRetry = stores().ui
      need('重试后三处清态', !!uRetry && !uRetry.prefsSave.error && !vis(q('#save-error')) && !q('.page-foot.error')
        && !!q('.app-topbar-save') && q('.app-topbar-save').getAttribute('data-save-state') !== 'error',
        '实测 prefsSave.error=' + JSON.stringify(uRetry ? uRetry.prefsSave.error : '(无 store)') + '；横幅可见=' + vis(q('#save-error'))
          + '；.page-foot.error=' + !!q('.page-foot.error') + '；顶栏='
          + (q('.app-topbar-save') ? q('.app-topbar-save').getAttribute('data-save-state') : '(缺)') + '（期望 空/false/false/saved）')
    }

    /* ---------- 4. 恢复默认：先确认、可撤销 ---------- */
    const uiR = stores().ui
    if (uiR) {
      const PRE = { editorFont: 'kai', editorLatin: 'gothic', fontSize: 21, topbarAutoHide: true }
      for (const k of Object.keys(PRE)) await uiR.applyPref(k, PRE[k])
      await wait(520)
      S.preReset = snap()
      click('.btn.soft[data-act="reset-appearance"]')
      await wait(460)
      const dlg = q('dialog[open]')
      need('恢复默认先开二次确认', !!dlg,
        dlg ? ('dialog[open] 存在，标题「' + txt('#settings-dialog-title') + '」（期望 恢复默认外观）') : '实测未出现 dialog[open]')
      need('未确认前外观四项不变', JSON.stringify(snap()) === JSON.stringify(PRE),
        '实测 ' + JSON.stringify(snap()) + '（期望 ' + JSON.stringify(PRE) + '）')
      await trustedEsc()
      await wait(560)
      need('Esc 关弹窗且偏好与视图不变', !q('dialog[open]') && JSON.stringify(snap()) === JSON.stringify(PRE) && !!q('.settings-shell'),
        '实测 dialog[open]=' + !!q('dialog[open]') + '；四项未变=' + (JSON.stringify(snap()) === JSON.stringify(PRE))
          + '；仍在设置视图=' + !!q('.settings-shell') + '（期望 false/true/true）')
      click('.btn.soft[data-act="reset-appearance"]')
      await wait(400)
      click('[data-act="reset-confirm"]')
      await wait(620)
      const DEF = { editorFont: 'song', editorLatin: 'none', fontSize: 17, topbarAutoHide: false }
      need('确认后外观四项回默认', JSON.stringify(snap()) === JSON.stringify(DEF),
        '实测 ' + JSON.stringify(snap()) + '（期望 ' + JSON.stringify(DEF) + '）')
      need('恢复默认给出撤销入口', txt('.toast').indexOf('外观已恢复默认。') >= 0 && !!q('.toast [data-act="undo"]'),
        '实测 toast「' + txt('.toast') + '」；撤销键=' + !!q('.toast [data-act="undo"]') + '（期望 外观已恢复默认。/有）')
      click('.toast [data-act="undo"]')
      await wait(620)
      need('撤销恢复默认回到改前值', JSON.stringify(snap()) === JSON.stringify(PRE),
        '实测 ' + JSON.stringify(snap()) + '（期望回到 ' + JSON.stringify(PRE) + '）')
      need('撤销给出结论提示', txt('.toast').indexOf('已撤销上一步操作。') >= 0, '实测 toast「' + txt('.toast') + '」（期望 已撤销上一步操作。）')
      const uiZ = stores().ui
      for (const k of ['editorFont', 'editorLatin']) await uiZ.applyPref(k, k === 'editorFont' ? 'song' : 'none')
      await uiZ.applyPref('fontSize', 17)
      await uiZ.applyPref('topbarAutoHide', false)
      await wait(620)
    }

    /* ---------- 5. 检索与定位 ---------- */
    const ask = async (text) => { setInput('#settings-query', text); await wait(380) }
    await ask('文楷')
    const hits = qa('.search-result')
    need('检索「文楷」命中字体一项', hits.length === 1 && hits[0].getAttribute('data-id') === 'editorFont',
      '实测 ' + hits.length + ' 条 ' + JSON.stringify(hits.map((h) => h.getAttribute('data-id'))) + '（期望 1 条 editorFont）')
    if (hits.length) click(hits[0])
    await wait(460)
    const activeId = doc().activeElement ? String(doc().activeElement.id || '') : ''
    const rowT = q('.setting-row[data-setting="editorFont"]')
    need('点检索结果定位并聚焦控件', activeId === 'editorFont' && !!rowT && rowT.classList.contains('target'),
      '实测 activeElement.id=' + (activeId || '(空)') + '；.setting-row[data-setting=editorFont].target='
        + (!!rowT && rowT.classList.contains('target')) + '（期望 editorFont / true）')
    await ask('没有这样的设置')
    need('无结果给出空态与清除入口', !!q('.empty') && !!q('.empty [data-act="clear-search"]') && qa('.search-result').length === 0,
      '实测 .empty=' + !!q('.empty') + '；清除键=' + !!q('.empty [data-act="clear-search"]') + '；结果 ' + qa('.search-result').length + ' 条（期望 true/true/0）')
    click('.empty [data-act="clear-search"]')
    await wait(460)
    need('清除搜索回到分类页', !q('.search-results') && !!q('.appearance-layout'),
      '实测 .search-results=' + !!q('.search-results') + '；.appearance-layout=' + !!q('.appearance-layout') + '（期望 false/true）')
    await ask('备份')
    const hitB = qa('.search-result').filter((h) => h.getAttribute('data-id') === 'backup')
    if (hitB.length) click(hitB[0])
    await wait(560)
    const rowB = q('[data-setting="backup"]')
    need('检索「备份」定位到数据页备份行', !!rowB && rowB.classList.contains('target') && txt('.page-head h1') === '备份与数据',
      '实测 [data-setting=backup].target=' + (!!rowB && rowB.classList.contains('target')) + '；h1=「' + txt('.page-head h1')
        + '」（期望 true / 备份与数据）')
    await ask('快捷键')
    const hitH = qa('.search-result').filter((h) => h.getAttribute('data-id') === 'help')
    if (hitH.length) click(hitH[0])
    await wait(560)
    const rowH = q('[data-setting="help"]')
    need('检索「快捷键」定位到关于页帮助行', !!rowH && rowH.classList.contains('target') && txt('.page-head h1') === '帮助与关于',
      '实测 [data-setting=help].target=' + (!!rowH && rowH.classList.contains('target')) + '；h1=「' + txt('.page-head h1')
        + '」（期望 true / 帮助与关于）')
  }

  if (!wide) {
    /* ---------- 6. 窄档：抽屉与手机预览 ---------- */
    need('窄档显示移动工具条', vis(q('.mobile-tools')),
      '实测 .mobile-tools 可见=' + vis(q('.mobile-tools')) + '（期望 true：≤1099 才挂出来）')
    click('.mobile-tools [data-act="open-drawer"]')
    await wait(460)
    need('窄档点分类键打开抽屉', (q('.settings-shell').getAttribute('data-drawer') || '') === 'open',
      '实测 data-drawer=' + JSON.stringify(q('.settings-shell').getAttribute('data-drawer')) + '（期望 open）')
    need('抽屉打开时主区 inert', !!q('.main-pane') && q('.main-pane').hasAttribute('inert'),
      '实测 .main-pane[inert]=' + (!!q('.main-pane') && q('.main-pane').hasAttribute('inert')) + '（期望 true）')
    const activeQ = doc().activeElement ? String(doc().activeElement.id || '') : ''
    need('抽屉打开时焦点进搜索框', activeQ === 'settings-query', '实测 activeElement.id=' + (activeQ || '(空)') + '（期望 settings-query）')
    await trustedEsc()
    await wait(520)
    /* 拆窗 target 在 headless 里偶尔拿不到键盘焦点（受信任按键到不了页面），此时补一次页面内
       keydown —— 走的是同一个 document 监听器（只有原生 <dialog> 的默认行为才必须受信任），
       证据里写明用的是哪条路径。 */
    let escPath = 'trusted'
    if ((q('.settings-shell').getAttribute('data-drawer') || '') === 'open') {
      doc().dispatchEvent(new (win().KeyboardEvent)('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      escPath = 'synthetic（受信任按键未生效）'
      await wait(520)
    }
    const backAct = doc().activeElement ? String(doc().activeElement.getAttribute('data-act') || '') : ''
    need('Esc 关抽屉并归还焦点', (q('.settings-shell').getAttribute('data-drawer') || '') !== 'open' && backAct === 'open-drawer',
      '实测 data-drawer=' + JSON.stringify(q('.settings-shell').getAttribute('data-drawer')) + '；焦点 data-act=' + (backAct || '(空)')
        + '；按键路径=' + escPath + '（期望 关 / open-drawer）')
    if (phone) {
      click('.head-actions [data-act="toggle-preview"]')
      await wait(560)
      need('手机预览独立成屏', (q('.settings-shell').getAttribute('data-preview') || '') === 'open' && vis(q('.preview-column'))
        && !vis(q('.appearance-controls')),
        '实测 data-preview=' + JSON.stringify(q('.settings-shell').getAttribute('data-preview')) + '；.preview-column 可见='
          + vis(q('.preview-column')) + '；.appearance-controls 可见=' + vis(q('.appearance-controls')) + '（期望 open/true/false）')
      const sizeBefore = Number(stores().ui ? stores().ui.fontSize : -1)
      click('.preview-mode-buttons [data-act="font-up"]')
      await wait(460)
      const sizeAfter = Number(stores().ui ? stores().ui.fontSize : -1)
      const pvFs = css('.preview-copy') ? css('.preview-copy').fontSize : '(缺)'
      const pvOut = txt('#preview-mobile-size')
      need('预览里改字号偏好与预览同步', sizeAfter === sizeBefore + 1 && pvFs === sizeAfter + 'px' && numOf(pvOut) === sizeAfter,
        '实测 ui.fontSize ' + sizeBefore + '→' + sizeAfter + '；.preview-copy font-size=' + pvFs + '；#preview-mobile-size=「'
          + pvOut + '」（期望 ' + (sizeBefore + 1) + ' / ' + (sizeBefore + 1) + 'px / ' + (sizeBefore + 1) + '）')
      click('.preview-mode-buttons [data-act="font-down"]')
      await wait(360)
      click('.head-actions [data-act="toggle-preview"]')
      await wait(520)
      need('再点返回调整', (q('.settings-shell').getAttribute('data-preview') || '') !== 'open' && vis(q('.appearance-controls'))
        && !vis(q('.preview-column')),
        '实测 data-preview=' + JSON.stringify(q('.settings-shell').getAttribute('data-preview')) + '；.appearance-controls 可见='
          + vis(q('.appearance-controls')) + '；.preview-column 可见=' + vis(q('.preview-column')) + '（期望 关/true/false）')
    }
  }

  if (heavy) {
    /* ---------- 7. 数据页：真实备份 / 校验 / 导出 / 回收站 ---------- */
    click('.category[data-page="data"]')
    await wait(760)
    const actionRows = qa('.action-row').map((r) => r.getAttribute('data-setting'))
    /* 作品库定位接入后数据页新增 storageLocation / changeLocation（revealLocation 视平台能力出现），
       断言改为「五个基础动作按序齐备」，不锁定总数，避免每加一行都要改脚本。 */
    const required = ['backup', 'restore', 'import', 'export', 'trash']
    const requiredInOrder = actionRows.filter((a) => required.includes(a)).join(',') === required.join(',')
    need('数据页基础动作齐备', requiredInOrder,
      '实测 [' + actionRows.join(', ') + ']（期望含且按序 ' + required.join('/') + '）')
    const c0 = await idbCounts()
    const libCells = qa('.library-list > div').map((d) => flat(d.querySelector('dd') ? d.querySelector('dd').textContent : ''))
    need('右栏六项与库直读一致', libCells.length === 6
      && numOf(libCells[0]) === c0.works && numOf(libCells[1]) === c0.chapters && numOf(libCells[2]) === c0.words
      && numOf(libCells[3]) === c0.characters && numOf(libCells[4]) === c0.lore && numOf(libCells[5]) === c0.trash,
      '实测右栏 ' + JSON.stringify(libCells) + '；IndexedDB 直读 works=' + c0.works + ' chapters=' + c0.chapters
        + ' words=' + c0.words + ' characters=' + c0.characters + ' lore=' + c0.lore + ' trash=' + c0.trash + '（期望逐项相等）')
    need('最近一次备份初始为未创建', txt('.backup-time') === '尚未创建备份',
      '实测「' + txt('.backup-time') + '」（期望 尚未创建备份）')

    click('[data-act="backup"]')
    const dlRes = await req('download', { prefix: '小说工坊-完整备份-', suffix: '.json', timeoutMs: 30000 })
    const dlName = dlRes && !dlRes.error ? String(dlRes.name) : ''
    need('完整备份真实落盘', !!dlName && /^小说工坊-完整备份-\d{4}-\d{2}-\d{2}\.json$/.test(dlName) && Number(dlRes.size) > 100,
      dlRes && !dlRes.error
        ? ('实测磁盘文件「' + dlName + '」' + dlRes.size + ' 字节，正文首段「' + String(dlRes.head || '').slice(0, 40) + '」（期望 小说工坊-完整备份-YYYY-MM-DD.json 且内容非空）')
        : '未等到下载：' + JSON.stringify(dlRes))
    await wait(700)
    const backupTimeTxt = txt('.backup-time')
    need('备份时间戳来自真实落盘', backupTimeTxt !== '尚未创建备份' && backupTimeTxt.length > 0,
      '实测「' + backupTimeTxt + '」（期望 具体时间，不再是 尚未创建备份）')
    need('备份给出完成提示', txt('.toast').indexOf('完整备份文件已生成。') >= 0, '实测 toast「' + txt('.toast') + '」（期望 完整备份文件已生成。）')

    /* 非法 JSON：pickFiles + parseBackupText 在开弹窗前就否掉，一个字节的数据都不该动 */
    await req('write-file', { name: 'settings-bad.json', text: '{"bad":true}' })
    const pickBad = await feedRestore('settings-bad.json')
    await wait(900)
    const cBad = await idbCounts()
    need('非法备份不开弹窗也不动数据', !q('dialog[open]') && cBad.works === c0.works,
      '实测 dialog[open]=' + !!q('dialog[open]') + '；作品数 ' + c0.works + '→' + cBad.works + '；提示「' + txt('.toast') + '」；喂文件='
        + JSON.stringify(pickBad).slice(0, 120) + '（期望 false/不变/含 不兼容）')

    /* 合法备份：只走到「确认前」就取消——真恢复由 settings-restore 场景单独跑 */
    const pickOk = await feedRestore(dlName)
    const openedDlg = await until(() => !!q('dialog[open]'), 9000)
    const cells = qa('.restore-summary > div')
    need('恢复确认列出四格规模', openedDlg && cells.length === 4,
      '实测 dialog 打开=' + openedDlg + '；.restore-summary ' + cells.length + ' 格 ' + JSON.stringify(cells.map((c) => flat(c.textContent)))
        + '；喂文件=' + JSON.stringify(pickOk).slice(0, 120) + '（期望 true / 4 格：作品/章节/人物/设定）')
    const confirmBtn = q('[data-act="restore-confirm"]')
    need('未勾选前确认按钮不可点', !!confirmBtn && confirmBtn.disabled,
      '实测 [data-act=restore-confirm].disabled=' + (confirmBtn ? confirmBtn.disabled : '(缺)') + '（期望 true）')
    const agree = q('#restore-agree')
    if (agree) { agree.checked = true; agree.dispatchEvent(new (win().Event)('change', { bubbles: true })) }
    await wait(360)
    const confirmNow = q('[data-act="restore-confirm"]')
    need('勾选确认后按钮可用', !!confirmNow && !confirmNow.disabled,
      '实测 勾选后 disabled=' + (confirmNow ? confirmNow.disabled : '(缺)') + '（期望 false）')
    click('[data-act="dialog-close"]')
    await wait(620)
    const cCancel = await idbCounts()
    need('取消恢复不动数据', !q('dialog[open]') && cCancel.works === c0.works && cCancel.chapters === c0.chapters,
      '实测 dialog[open]=' + !!q('dialog[open]') + '；作品 ' + c0.works + '→' + cCancel.works + '，章节 '
        + c0.chapters + '→' + cCancel.chapters + '（期望 false/不变）')

    click('[data-act="export"]')
    await until(() => qa('.chapter-pick').length > 0, 9000)
    const picks = qa('.chapter-pick input[type="checkbox"]')
    need('导出弹窗默认全选章节', picks.length > 0 && picks.filter((p) => p.checked).length === picks.length,
      '实测 ' + picks.length + ' 个章节复选框，勾选 ' + picks.filter((p) => p.checked).length + ' 个（期望 全部勾选）')
    const checkboxInline = picks.length ? String(picks[0].getAttribute('style') || '') : ''
    need('章节复选框内联复位不被皮肤压成竖排', checkboxInline.indexOf('width: auto') >= 0 && picks.every((p) => p.getBoundingClientRect().height <= 30),
      '实测 inline style=「' + checkboxInline + '」；复选框高 ' + (picks[0] ? px2(picks[0].getBoundingClientRect().height) : '?')
        + 'px（期望 含 width: auto 且高 <=30，即总稿 .form-field input 的 100% 宽没落到复选框上）')
    for (let i = 0; i < picks.length; i++) { picks[i].checked = false; picks[i].dispatchEvent(new (win().Event)('change', { bubbles: true })) }
    await wait(380)
    need('取消全选后不可导出', !!q('[data-act="export-confirm"]') && q('[data-act="export-confirm"]').disabled,
      '实测 [data-act=export-confirm].disabled=' + (q('[data-act="export-confirm"]') ? q('[data-act="export-confirm"]').disabled : '(缺)') + '（期望 true）')
    for (let i = 0; i < picks.length; i++) { picks[i].checked = true; picks[i].dispatchEvent(new (win().Event)('change', { bubbles: true })) }
    await wait(380)
    click('[data-act="export-confirm"]')
    const txtRes = await req('download', { prefix: '', suffix: '.txt', timeoutMs: 30000 })
    need('正文 TXT 真实落盘', !!txtRes && !txtRes.error && /\.txt$/.test(String(txtRes.name)) && Number(txtRes.size) > 10
      && String(txtRes.head || '').indexOf('雾港纪年') >= 0,
      txtRes && !txtRes.error
        ? ('实测磁盘文件「' + txtRes.name + '」' + txtRes.size + ' 字节，首行「' + String(txtRes.head || '').slice(0, 30) + '」（期望 书名.txt 且首行是书名）')
        : '未等到下载：' + JSON.stringify(txtRes))
    await wait(600)

    /* 回收站：计数与库一致 → 筛选 → 恢复一条 → 彻底删除两步 */
    const cTrash = await idbCounts()
    click('[data-act="trash"]')
    await until(() => qa('.trash-tabs button').length > 0, 9000)
    const tabs = qa('.trash-tabs button').map((b) => flat(b.textContent))
    let kindSum = 0
    for (let i = 1; i < tabs.length; i++) kindSum += numOf(tabs[i])
    need('回收站计数与全库一致', tabs.length >= 2 && numOf(tabs[0]) === cTrash.trash && kindSum === cTrash.trash,
      '实测 tabs ' + JSON.stringify(tabs) + '；IndexedDB 软删 ' + cTrash.trash + ' 条 ' + JSON.stringify(cTrash.trashByKind)
        + '（期望 全部=N 且各分项之和=N）')
    const chTab = q('.trash-tabs [data-kind="chapters"]')
    if (chTab) { chTab.click(); await wait(460) }
    const filteredRows = qa('.trash-row').length
    need('回收站按类型筛选', !chTab || filteredRows === cTrash.trashByKind.chapters,
      '实测点「正文」后 ' + filteredRows + ' 行（期望 ' + cTrash.trashByKind.chapters + ' 行 = 库内软删章节数）')
    const firstRowName = txt('.trash-row strong')
    const firstRestore = q('[data-act="trash-restore"]')
    click(firstRestore)
    await wait(1100)
    need('回收站恢复一条并报出条目名', txt('.toast').indexOf('已恢复「') >= 0 && txt('.toast').indexOf(firstRowName) >= 0,
      '实测 toast「' + txt('.toast') + '」（期望 已恢复「' + firstRowName + '」。）')
    await wait(400)
    const purgeBtn = q('[data-act="trash-purge"]')
    const purgeId = purgeBtn ? String(purgeBtn.getAttribute('data-id') || '') : ''
    click(purgeBtn)
    const purgeOpened = await until(() => !!q('[data-act="purge-confirm"]'), 8000)
    need('彻底删除先问再删', purgeOpened && !!q('[data-act="trash-back"]'),
      '实测 二次确认弹窗=' + purgeOpened + '；保留键=' + !!q('[data-act="trash-back"]') + '；文案「' + txt('dialog[open] .dialog-body').slice(0, 40) + '」（期望 true/true）')
    click('[data-act="trash-back"]')
    await wait(900)
    const cBack = await idbCounts()
    need('保留条目后软删行仍在', cBack.trash === cTrash.trash - 1,
      '实测软删 ' + cBack.trash + ' 条（期望 ' + (cTrash.trash - 1) + ' = 原 ' + cTrash.trash + ' - 已恢复 1）')
    click('[data-act="trash-purge"][data-id="' + purgeId + '"]')
    const purgeAgain = await until(() => !!q('[data-act="purge-confirm"]'), 8000)
    click('[data-act="purge-confirm"]')
    await wait(1200)
    const cPurge = await idbCounts()
    need('确认后条目彻底移除', purgeAgain && cPurge.trash === cTrash.trash - 2,
      '实测软删 ' + cPurge.trash + ' 条（期望 ' + (cTrash.trash - 2) + ' = 原 ' + cTrash.trash + ' - 恢复 1 - 彻底删除 1）')
    click('[data-act="dialog-close"]')
    await wait(520)

    /* ---------- 8. 关于页 ---------- */
    click('.category[data-page="about"]')
    await wait(700)
    need('关于页品牌字为「工」', txt('.about-mark') === '工', '实测「' + txt('.about-mark') + '」（期望 工）')
    need('关于页版本行', txt('.about-brand').indexOf('DSH 插件版 · v0.2.8') >= 0,
      '实测「' + txt('.about-brand') + '」（期望含 DSH 插件版 · v0.2.8）')
    const shortcuts = qa('.keyboard-panel .shortcut')
    const kbTexts = shortcuts.map((s) => flat(s.querySelector('kbd') ? s.querySelector('kbd').textContent : ''))
    need('键盘面板五条快捷键', shortcuts.length === 5 && kbTexts.join('|') === 'Tab|Shift + Tab|Esc|← / →|Ctrl / ⌘ + S',
      '实测 ' + shortcuts.length + ' 条 ' + JSON.stringify(kbTexts) + '（期望 5 条 Tab/Shift + Tab/Esc/← / →/Ctrl / ⌘ + S）')
    click('[data-act="help"]')
    await until(() => !!q('.help-copy'), 8000)
    need('帮助弹窗四枚 kbd', qa('.help-copy kbd').length === 4,
      '实测 .help-copy kbd ' + qa('.help-copy kbd').length + ' 枚 ' + JSON.stringify(qa('.help-copy kbd').map((k) => flat(k.textContent))) + '（期望 4 枚）')
    await trustedEsc()
    await wait(560)
    need('帮助弹窗可 Esc 关闭', !q('dialog[open]'), '实测 dialog[open]=' + !!q('dialog[open]') + '（期望 false）')
    click('[data-act="stats"]')
    await until(() => qa('.stats-list dd').length === 5, 8000)
    const dd = qa('.stats-list dd').map((d) => flat(d.textContent))
    const cStats = await idbCounts()
    const grouped = (n) => Number(n || 0).toLocaleString('zh-CN')
    need('写作概览五项与 summarizeLibrary 同值', dd.length === 5
      && dd[0] === cStats.works + ' 部' && dd[1] === cStats.chapters + ' 章' && dd[2] === grouped(cStats.words) + ' 字'
      && dd[3] === cStats.characters + ' 人' && dd[4] === cStats.lore + ' 条',
      '实测 ' + JSON.stringify(dd) + '；库直读 works=' + cStats.works + ' chapters=' + cStats.chapters + ' words=' + cStats.words
        + ' characters=' + cStats.characters + ' lore=' + cStats.lore + '（期望 五项逐项相等）')
    click('[data-act="dialog-close"]')
    await wait(460)

    /* ---------- 9. 滚动记忆：数据页滚到底 → 切外观 → 切回 ---------- */
    click('.category[data-page="data"]')
    await wait(760)
    const scEl = q('.content-scroll')
    if (scEl) { scEl.scrollTop = scEl.scrollHeight; scEl.dispatchEvent(new (win().Event)('scroll', { bubbles: false })) }
    await wait(760)
    const scrolled = scEl ? Math.round(scEl.scrollTop) : -1
    const maxScroll = scEl ? Math.round(scEl.scrollHeight - scEl.clientHeight) : -1
    click('.category[data-page="appearance"]')
    await wait(620)
    click('.category[data-page="data"]')
    await wait(760)
    const scBack = q('.content-scroll') ? Math.round(q('.content-scroll').scrollTop) : -1
    need('分类切回恢复滚动位置', Math.abs(scBack - scrolled) <= 2 && maxScroll > 0,
      '实测 滚到底 scrollTop=' + scrolled + '（可滚 ' + maxScroll + 'px），切走再回来=' + scBack + '（期望 相差 <=2px）')
    S.scroll = { scrolled: scrolled, back: scBack, max: maxScroll }

    /* ---------- 10. 跨窗口：另一窗口改偏好，本窗口跟随但页面/滚动位不跳 ---------- */
    const other = await req('other-window', { pref: 'fontSize', value: 19 }, 60000)
    await wait(1800)
    const uiNow = stores().ui
    const pageNow = txt('.page-head h1')
    const scNow = q('.content-scroll') ? Math.round(q('.content-scroll').scrollTop) : -1
    need('另一窗口改偏好本窗口跟随', !!uiNow && Number(uiNow.fontSize) === 19,
      '实测 本窗口 ui.fontSize=' + (uiNow ? Number(uiNow.fontSize) : '(无 store)') + '；另一窗口设 19'
        + (other && other.error ? '（第二个窗口异常：' + other.error + '）' : '') + '（期望 19）')
    need('另一窗口不改本窗口页面', pageNow === '备份与数据' && scNow === scBack,
      '实测 页头「' + pageNow + '」；scrollTop=' + scNow + '（期望 备份与数据 / ' + scBack + '：界面键不跟着别的窗口跳）')
    click('.category[data-page="appearance"]')
    await wait(700)
    const fsNow = css('.preview-copy') ? css('.preview-copy').fontSize : '(缺)'
    need('预览跟随跨窗口改动', fsNow === '19px' && numOf(txt('#size-value')) === 19,
      '实测 .preview-copy font-size=' + fsNow + '；#size-value=「' + txt('#size-value') + '」（期望 19px / 19px）')
    const uiEnd = stores().ui
    if (uiEnd) await uiEnd.applyPref('fontSize', 17)
    await wait(420)

    /* ---------- 11. 减少动画：真 reload 后流动背板仍合法、无异常 ----------
       设置页现在也挂 .st-backdrop-wrap（T3 第 3 轮），而 settings-fusion.css 的
       prefers-reduced-motion 段会关掉全部动画；要点是「关掉动画之后背板照样能起来」，
       所以这里真的把媒体特性切到 reduce 再 reload 一次，重新进设置页量同一套钩子。
       放在最后：reload 会把页面状态重置，前面的判据都已经收完。 */
    const rmSet = await req('reduced-motion', { value: 'reduce' })
    frame.dataset.verifyReload = '1'
    let rmReloaded = false
    try { win().location.reload(); rmReloaded = true } catch (e) { rmReloaded = false }
    const rmReady = await until(() => {
      const d2 = doc()
      return !!d2 && !!d2.querySelector('#app') && !!win().__ns && !!d2.querySelector('#app').__vue_app__
    }, 60000)
    await wait(1400)
    const uiRm = stores().ui
    if (uiRm) uiRm.view = 'settings'
    const rmShellBack = await until(() => !!q('.settings-shell'), 30000)
    await until(() => !!q('.st-backdrop-wrap > canvas.st-backdrop'), 25000)
    await wait(1000)
    const rmWrap = q('.st-backdrop-wrap')
    const rmCv = q('.st-backdrop-wrap > canvas.st-backdrop')
    const rmCvRect = rmCv ? rmCv.getBoundingClientRect() : null
    const rmStatsFn = typeof win().__nsSettingsBackdrop === 'function' ? win().__nsSettingsBackdrop : null
    let rmStats = null
    try { rmStats = rmStatsFn ? rmStatsFn() : null } catch (e) { rmStats = null }
    const rmBackend = rmStats && rmStats.backend ? String(rmStats.backend) : ''
    let rmMatch = null
    try { rmMatch = win().matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { rmMatch = null }
    need('减少动画重载后背板仍合法', rmReloaded && rmReady && rmShellBack && rmMatch === true && !!rmWrap && !!rmCv
      && !!rmCvRect && rmCvRect.width > 0 && rmCvRect.height > 0 && rmCv.width > 0 && rmCv.height > 0
      && (rmBackend === 'gpu' || rmBackend === 'cpu'),
      '实测 媒体特性=' + (rmSet && rmSet.error ? ('切换失败 ' + rmSet.error) : 'prefers-reduced-motion:reduce')
        + '；matchMedia(reduce)=' + rmMatch + '；reload=' + rmReloaded + '；应用就绪=' + rmReady + '；外壳重建=' + rmShellBack
        + '；.st-backdrop-wrap=' + !!rmWrap + '；canvas.st-backdrop=' + !!rmCv
        + (rmCvRect ? ('（盒 ' + Math.round(rmCvRect.width) + 'x' + Math.round(rmCvRect.height) + '，缓冲区 ' + (rmCv ? rmCv.width + 'x' + rmCv.height : '?') + '）') : '')
        + '；__nsSettingsBackdrop().backend=' + (rmBackend || '(无)')
        + '（期望 true/true/true/true/true/gpu|cpu）')
  }

  S.snapshotEmpty = (doc().querySelectorAll('.settings-shell').length === 0)
  return out
}

/* ===== 设置 · 恢复链路（单独场景：会用备份真的冲掉库并 reload） =====
   链路：真实备份落盘 → Node 把备份改成「另一份库」（只留一本书一章）→ 走弹窗勾选确认 →
   真 reload → 断言数据确实被替换、sessionStorage 快照在、toast 是「工作区已从备份恢复。」
   → 点撤销 → 快照键被清除、数据回到恢复前。
   本探针住在外层壳（HARNESS 父页面），所以 iframe reload 不会打断它；reload 前把
   frame.dataset.verifyReload 置位，ticks 就不会重跑。 */
async function settingsRestoreProbe(frame, out, width) {
  const ev = out.evidence
  const S = (ev.restoreFlow = {})
  const need = (name, ok, e) => { out.items.push({ name: name, pass: !!ok, ev: e === undefined ? null : String(e) }) }
  const doc = () => frame.contentDocument
  const win = () => frame.contentWindow
  const q = (sel) => { const d = doc(); return d ? d.querySelector(sel) : null }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const t0 = Date.now()
    const lim = ms || 15000
    for (;;) {
      let v = false
      try { v = fn() } catch (e) { v = false }
      if (v) return true
      if (Date.now() - t0 > lim) return false
      await wait(120)
    }
  }
  const flat = (s) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim()
  const txt = (sel) => { const n = q(sel); return n ? flat(n.textContent) : '' }
  const click = (x) => { const n = typeof x === 'string' ? q(x) : x; if (!n) return false; try { n.click(); return true } catch (e) { return false } }
  async function req(kind, payload, timeoutMs) {
    const id = 'r' + Date.now() + Math.floor(Math.random() * 1e6)
    window.__NS_REQ_RESULT = null
    window.__NS_REQ = { id: id, kind: kind, payload: payload || {} }
    const t0 = Date.now()
    let value = null
    for (;;) {
      const got = window.__NS_REQ_RESULT
      if (got && got.id === id) { value = got.value; break }
      if (Date.now() - t0 > (timeoutMs || 30000)) break
      await wait(120)
    }
    window.__NS_REQ = null
    if (value === null) return { error: 'Node 侧无响应：' + kind }
    return value
  }
  async function trustedClick(sel) {
    const n = typeof sel === 'string' ? q(sel) : sel
    if (!n) return { error: '未找到 ' + sel }
    const r = n.getBoundingClientRect()
    return req('click', { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  const SNAPSHOT_KEY = 'novelstudio:settings:restoreSnapshot'
  const snapshotOf = () => { try { return win().sessionStorage.getItem(SNAPSHOT_KEY) } catch (e) { return null } }
  function stores() {
    try {
      const appEl = doc().querySelector('#app')
      const pinia = appEl && appEl.__vue_app__ ? appEl.__vue_app__.config.globalProperties.$pinia : null
      if (!pinia) return { ui: null }
      return { ui: pinia._s.get('ui') }
    } catch (e) { return { ui: null } }
  }
  function idbAll(handle, storeName) {
    return new Promise((resolve) => {
      try {
        if (Array.prototype.slice.call(handle.objectStoreNames || []).indexOf(storeName) < 0) return resolve([])
        const rq = handle.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        rq.onsuccess = () => resolve(rq.result || [])
        rq.onerror = () => resolve([])
      } catch (e) { resolve([]) }
    })
  }
  async function idbWorks() {
    const w = win()
    const opened = await new Promise((resolve) => {
      let done = false
      const fin = (v) => { if (!done) { done = true; resolve(v) } }
      let list = null
      try { list = w.indexedDB.databases ? w.indexedDB.databases() : null } catch (e) { list = null }
      if (!list || typeof list.then !== 'function') return fin(null)
      list.then((dbs) => {
        const hit = (dbs || []).filter((d) => String(d && d.name || '').indexOf('novel-studio') >= 0)
        if (!hit.length) return fin(null)
        const rq = w.indexedDB.open(hit[0].name)
        rq.onerror = () => fin(null)
        rq.onsuccess = () => fin(rq.result)
      }).catch(() => fin(null))
    })
    if (!opened) return { error: '打开库失败' }
    const works = await idbAll(opened, 'works')
    const chapters = await idbAll(opened, 'chapters')
    try { opened.close() } catch (e) { /* 已关 */ }
    const live = (rows) => rows.filter((r) => !r || !r.deletedAt)
    return { works: live(works).map((r) => String(r.title || '')), chapters: live(chapters).map((r) => String(r.title || '')) }
  }

  if (!q('.settings-shell')) {
    need('设置外壳渲染（恢复场景）', false, '未找到 .settings-shell')
    return out
  }
  click('.category[data-page="data"]')
  await until(() => txt('.page-head h1') === '备份与数据', 12000)
  await wait(700)
  const before = await idbWorks()
  S.before = before
  need('恢复前库内作品已读到', !before.error && before.works.length > 1,
    before.error ? before.error : ('实测作品 ' + JSON.stringify(before.works) + '（期望 >=2 本：恢复要能看出差异）'))

  click('[data-act="backup"]')
  const dl = await req('download', { prefix: '小说工坊-完整备份-', suffix: '.json', timeoutMs: 30000 })
  need('恢复链路的第一步：真实备份落盘', !!dl && !dl.error && Number(dl.size) > 100,
    dl && !dl.error ? ('实测磁盘文件「' + dl.name + '」' + dl.size + ' 字节') : ('未等到备份：' + JSON.stringify(dl)))
  const prep = await req('prepare-backup', { source: dl && dl.name ? dl.name : '', target: 'settings-restore-target.json', title: '换库验证书', chapterTitle: '恢复后的第一章' }, 30000)
  need('把备份改成另一份库（Node 侧改写 JSON）', !!prep && !prep.error && prep.works === 1,
    prep ? (prep.error ? prep.error : ('实测改写后 works=' + prep.works + ' chapters=' + prep.chapters + ' 书名「' + prep.title + '」')) : '改写失败')

  frame.dataset.verifyReload = '1'
  let pick = null
  let openedDlg = false
  for (let attempt = 0; attempt < 3 && !openedDlg; attempt++) {
    await req('arm-chooser')
    await trustedClick('[data-act="restore"]')
    pick = await req('choose-file', { name: 'settings-restore-target.json', timeoutMs: 25000 })
    openedDlg = await until(() => !!q('dialog[open]'), 10000)
    if (!openedDlg) await wait(700)
  }
  need('恢复弹窗打开并列出新库规模', openedDlg && txt('.restore-summary').indexOf('1 部') >= 0,
    '实测 dialog 打开=' + openedDlg + '；.restore-summary=「' + txt('.restore-summary') + '」；喂文件=' + JSON.stringify(pick).slice(0, 160) + '（期望 true / 含 1 部）')
  const agree = q('#restore-agree')
  if (agree) { agree.checked = true; agree.dispatchEvent(new (win().Event)('change', { bubbles: true })) }
  await wait(360)
  click('[data-act="restore-confirm"]')
  /* 真 reload：等新文档就绪，再把视图切回设置页的数据页——产品里「恢复后重载 → 数据页给撤销」就是这条路 */
  const reloaded = await until(() => {
    const d2 = doc()
    return !!d2 && !!d2.querySelector('#app') && !!win().__ns && !!d2.querySelector('#app').__vue_app__
  }, 60000)
  await wait(1400)
  const uiAfter = stores().ui
  if (uiAfter) uiAfter.view = 'settings'
  const shellBack = await until(() => !!q('.settings-shell'), 30000)
  await until(() => !!q('.data-layout'), 20000)
  await wait(1200)
  const after = await idbWorks()
  S.after = after
  const snapRaw = snapshotOf()
  need('确认后真的 reload 并换掉库', reloaded && shellBack && !after.error
    && after.works.length === 1 && after.works[0] === '换库验证书' && after.chapters.indexOf('恢复后的第一章') >= 0,
    after.error ? after.error : ('实测 reload=' + reloaded + '；重建设置视图=' + shellBack + '；库内作品 ' + JSON.stringify(after.works)
      + '，章节 ' + JSON.stringify(after.chapters) + '（期望 1 本「换库验证书」+ 1 章「恢复后的第一章」）'))
  need('撤销快照写进 sessionStorage', !!snapRaw && snapRaw.indexOf('"json"') >= 0,
    '实测 sessionStorage[' + SNAPSHOT_KEY + '] ' + (snapRaw ? snapRaw.length + ' 字节' : '缺失') + '（期望 非空，形如 {at, json}）')
  const toastTxt = txt('.toast')
  need('重载后数据页给出恢复回执', toastTxt.indexOf('工作区已从备份恢复。') >= 0 && !!q('.toast [data-act="undo"]'),
    '实测 toast「' + toastTxt + '」；撤销键=' + !!q('.toast [data-act="undo"]') + '（期望 工作区已从备份恢复。/有）')
  frame.dataset.verifyReload = '1'
  click('.toast [data-act="undo"]')
  const cleared = await until(() => !snapshotOf(), 12000)
  need('点撤销后快照键被清除', cleared, '实测 sessionStorage[' + SNAPSHOT_KEY + '] ' + (snapshotOf() ? '仍在' : '已清除') + '（期望 已清除）')
  const backReady = await until(() => {
    const d2 = doc()
    return !!d2 && !!d2.querySelector('#app') && !!win().__ns && !!d2.querySelector('#app').__vue_app__
  }, 60000)
  await wait(1600)
  const restored = await idbWorks()
  S.undo = restored
  need('撤销后库回到恢复前的作品集', backReady && !restored.error && restored.works.length === before.works.length
    && restored.works.join('|') === before.works.join('|'),
    restored.error ? restored.error : ('实测作品 ' + JSON.stringify(restored.works) + '（期望回到 ' + JSON.stringify(before.works) + '）'))
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function widthOf(s) {
  let w = 0
  for (const ch of String(s)) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1
  return w
}
function pad(s, n) {
  const t = widthOf(s)
  return t >= n ? s + ' ' : s + ' '.repeat(n - t)
}

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const send = (code, body, type) => {
      res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    }
    try {
      if (url.pathname === '/harness.html') return send(200, HARNESS, MIME['.html'])
      if (url.pathname === '/') return send(200, 'verify:app harness at /harness.html', MIME['.html'])
      if (!url.pathname.startsWith(PREFIX)) return send(404, 'not found: ' + url.pathname)
      const rel = normalize(decodeURIComponent(url.pathname.slice(PREFIX.length)))
      const file = join(APP_DIR, rel)
      if (!resolve(file).startsWith(APP_DIR)) return send(403, 'forbidden')
      let body = await readFile(file)
      // Install before Dexie opens the database: its backend caches a bound transaction.
      // This switch belongs only to the isolated verifier, never the shipped application.
      if (extname(file) === '.html') body = body.toString().replace('<head>', `<head><script>
        const nativeAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function(row, ...args) {
          if (window.__NS_FAIL_WORDLOG && this.name === 'wordlog') {
            window.__NS_FAILED_WORDLOG = (window.__NS_FAILED_WORDLOG || 0) + 1;
            throw new DOMException('Intentional writing log failure', 'UnknownError');
          }
          return nativeAdd.call(this, row, ...args);
        };
        const nativeTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(stores, mode, ...args) {
          const storeNames = Array.from(typeof stores === 'string' ? [stores] : stores);
          if (window.__NS_FAIL_STATS_READ && mode === 'readonly' && storeNames.includes('wordlog') && storeNames.includes('snippets')) {
            throw new DOMException('Intentional writing stats read failure', 'UnknownError');
          }
          if (window.__NS_FAIL_LORE_SAVE && mode === 'readwrite' && storeNames.includes('mubu')) {
            window.__NS_FAILED_LORE_SAVES = (window.__NS_FAILED_LORE_SAVES || 0) + 1;
            throw new DOMException('Intentional setting save failure', 'UnknownError');
          }
          if (window.__NS_FAIL_PREFS_SAVE && mode === 'readwrite' && storeNames.includes('appconfig')) {
            window.__NS_FAILED_PREF_SAVES = (window.__NS_FAILED_PREF_SAVES || 0) + 1;
            throw new DOMException('Intentional preference save failure', 'UnknownError');
          }
          return nativeTransaction.call(this, stores, mode, ...args);
        };
        /* 宿主桥替身，只在 ?nsverify-bus 的场景装：真机里 window.native 由 DSH 客户端
           （src/client/iframe-shim.js）注入进 iframe，浏览器验收环境没有这条通道，
           跨窗口偏好同步（prefs-changed → ui.loadPrefs）就只有装上它才验得到。
           语义照 shim：本窗口监听器同步派发一遍，再用 BroadcastChannel 过窗。 */
        if (String(location.search || '').indexOf('nsverify-bus') >= 0 && !window.native) {
          const listeners = new Set();
          let channel = null;
          try { channel = new BroadcastChannel('novel-studio-verify-bus'); } catch (err) { channel = null; }
          if (channel) channel.onmessage = (msg) => {
            const payload = msg && msg.data;
            if (!payload) return;
            listeners.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
          };
          window.native = {
            isElectron: false,
            appOnEvent: (handler) => { listeners.add(handler); return () => listeners.delete(handler); },
            appBroadcast: (payload) => {
              listeners.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
              try { channel && channel.postMessage(payload); } catch (e) { /* 通道已关 */ }
              return Promise.resolve();
            }
          };
          window.__NS_VERIFY_BUS = true;
        }
      </script>`)
      return send(200, body, MIME[extname(file)] || 'application/octet-stream')
    } catch (e) {
      return send(500, String(e))
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

function launchChrome() {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--hide-crash-restore-bubble',
    '--window-size=1280,860',
    'about:blank'
  ]
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((ok, fail) => {
    let acc = ''
    const timer = setTimeout(() => fail(new Error('20s 内没拿到 DevTools 地址，Chrome 可能没起来')), 20000)
    const marker = 'DevTools listening on '
    const scan = (chunk) => {
      acc += chunk.toString()
      const i = acc.indexOf(marker)
      if (i < 0) return
      const wsUrl = acc.slice(i + marker.length).split(' ')[0].trim()
      if (!wsUrl.startsWith('ws://')) return
      clearTimeout(timer)
      proc.stderr.off('data', scan)
      ok({ proc, wsUrl })
    }
    proc.stderr.on('data', scan)
    proc.on('error', (e) => { clearTimeout(timer); fail(new Error('启动 Chrome 失败: ' + e.message)) })
    proc.on('exit', (code) => { clearTimeout(timer); fail(new Error('Chrome 提前退出 code=' + code)) })
  })
}

function cdpClient(wsUrl) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const events = []
    let seq = 0
    const send = (method, params, sessionId) =>
      new Promise((resolve0, reject0) => {
        const id = ++seq
        const timer = setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject0(new Error('CDP 超时: ' + method)) }
        }, 60000)
        pending.set(id, { resolve0, reject0, timer })
        ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }))
      })
    ws.addEventListener('message', (ev) => {
      let msg
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
      if (!msg.id) { events.push(msg); return }
      if (!pending.has(msg.id)) return
      const { resolve0, reject0, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      if (msg.error) reject0(new Error(msg.method + ' 失败: ' + msg.error.message))
      else resolve0(msg.result)
    })
    ws.addEventListener('open', () => ok({ send, events, close: () => ws.close() }))
    ws.addEventListener('error', () => fail(new Error('WebSocket 连接 DevTools 失败: ' + wsUrl)))
  })
}

/* ---- 设置的 Node 侧请求处理器 ------------------------------------------------------------
   设置场景要在浏览器里走通「真实下载 / 喂文件 / 受信任点击与按键 / 第二个窗口」这几件
   页内做不到的事，页内只举请求，执行在这里（总稿 tools/verify.mjs 用的是同一组 CDP 调用）。
   ctx: { send, cdp, origin, flowDir, chooser }，chooser 由 runOne 的轮询回路写。 */
function safeFlowName(raw) {
  const name = String(raw || '').replace(/[\\/]/g, '_').trim()
  if (!name || name === '.' || name === '..') throw new Error('非法文件名: ' + String(raw))
  return name
}
async function handleSettingsReq(kind, p, ctx) {
  const { send, cdp, flowDir } = ctx
  if (kind === 'click') {
    const x = Math.round(Number(p.x))
    const y = Math.round(Number(p.y))
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(80)
    return { ok: true, x, y }
  }
  if (kind === 'key') {
    const key = String(p.key || 'Escape')
    const vk = { Escape: 27, Tab: 9, Enter: 13, ArrowLeft: 37, ArrowRight: 39 }[key] || 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await sleep(100)
    return { ok: true, key }
  }
  if (kind === 'arm-chooser') {
    ctx.chooser = null
    return { ok: true }
  }
  if (kind === 'reduced-motion') {
    const value = String(p.value || 'reduce')
    const features = value === 'none' ? [] : [{ name: 'prefers-reduced-motion', value }]
    await send('Emulation.setEmulatedMedia', { features })
    return { ok: true, features }
  }
  if (kind === 'choose-file') {
    const name = safeFlowName(p.name)
    const file = join(flowDir, name)
    const t0 = Date.now()
    while (!ctx.chooser) {
      if (Date.now() - t0 > (Number(p.timeoutMs) || 20000)) return { error: '文件选择框未打开（Page.fileChooserOpened 未到）' }
      await sleep(120)
    }
    const backendNodeId = ctx.chooser
    ctx.chooser = null
    /* pickFiles 造的 input 是游离节点：先按 backendNodeId 喂，节点已被回收/DOM 代理失效时
       退到 resolveNode 拿 objectId 再喂一次（两条都是真实文件选择路径）。 */
    const fails = []
    try {
      await send('DOM.setFileInputFiles', { files: [file], backendNodeId })
    } catch (e1) {
      fails.push(String(e1 && e1.message || e1))
      try {
        const resolved = await send('DOM.resolveNode', { backendNodeId })
        await send('DOM.setFileInputFiles', { files: [file], objectId: resolved.object.objectId })
      } catch (e2) {
        fails.push(String(e2 && e2.message || e2))
        return { error: '喂文件失败：' + fails.join(' / ') }
      }
    }
    await sleep(340)
    const st = await stat(file)
    return { ok: true, name, size: st.size, fallback: fails.length ? fails : null }
  }
  if (kind === 'write-file') {
    const name = safeFlowName(p.name)
    await writeFile(join(flowDir, name), String(p.text === undefined ? '' : p.text), 'utf8')
    const st = await stat(join(flowDir, name))
    return { ok: true, name, size: st.size }
  }
  if (kind === 'download') {
    const prefix = String(p.prefix || '')
    const suffix = String(p.suffix || '')
    const t0 = Date.now()
    for (;;) {
      let names = []
      try { names = await readdir(flowDir) } catch { names = [] }
      const hit = names.filter((n) => n.indexOf(prefix) === 0 && n.endsWith(suffix) && n.indexOf('.crdownload') < 0)
      if (hit.length) {
        const name = hit[hit.length - 1]
        const full = join(flowDir, name)
        const st = await stat(full)
        let head = ''
        if (st.size < 512 * 1024) {
          const buf = await readFile(full)
          head = buf.slice(0, 200).toString('utf8').replace(/\s+/g, ' ').trim()
        }
        return { name, size: st.size, head }
      }
      if (Date.now() - t0 > (Number(p.timeoutMs) || 25000)) return { error: '下载超时：' + prefix + '*' + suffix, dir: flowDir }
      await sleep(150)
    }
  }
  if (kind === 'prepare-backup') {
    const src = join(flowDir, safeFlowName(p.source))
    const dump = JSON.parse(await readFile(src, 'utf8'))
    if (!dump || !dump.data || typeof dump.data !== 'object') throw new Error('备份结构不符，无法改写')
    const title = String(p.title || '换库验证书')
    const chapterTitle = String(p.chapterTitle || '恢复后的第一章')
    const baseWork = (Array.isArray(dump.data.works) && dump.data.works[0]) || { id: 'verify-work-1' }
    const baseChapter = (Array.isArray(dump.data.chapters) && dump.data.chapters[0]) || { id: 'verify-chapter-1' }
    const workId = 'verify-work-1'
    dump.data.works = [Object.assign({}, baseWork, { id: workId, title, deletedAt: null, updatedAt: Date.now(), createdAt: Date.now() })]
    dump.data.chapters = [Object.assign({}, baseChapter, { id: 'verify-chapter-1', workId, volumeId: null, title: chapterTitle, content: '恢复后的正文。', deletedAt: null, sortOrder: 0 })]
    /* 其余表都挂在作品下：留着会变成孤儿行，恢复后反而干扰判据，统一清空（只保留 appconfig 偏好） */
    const TABLES = ['volumes', 'outlines', 'characters', 'relations', 'lorecats', 'lore', 'mubu', 'lorelinks',
      'snippets', 'links', 'wordlog', 'bookmarks', 'olnodes', 'annotations', 'aisum', 'aikb', 'aikbmeta',
      'airuns', 'aidecisions', 'aistyle', 'aikbvec', 'aipresets', 'aipresetstate']
    for (const t of TABLES) if (Array.isArray(dump.data[t])) dump.data[t] = []
    dump.assets = []
    const target = join(flowDir, safeFlowName(p.target || 'settings-restore-target.json'))
    await writeFile(target, JSON.stringify(dump), 'utf8')
    const st = await stat(target)
    return { ok: true, works: dump.data.works.length, chapters: dump.data.chapters.length, title, bytes: st.size }
  }
  if (kind === 'other-window') {
    const url = ctx.origin + PREFIX + '/index.html?embed=1&nsverify-bus=1'
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
    const oSend = (m, pp) => cdp.send(m, pp, attached.sessionId)
    try {
      await oSend('Page.enable')
      await oSend('Runtime.enable')
      await oSend('Emulation.setDeviceMetricsOverride', { width: 1280, height: VH, deviceScaleFactor: 1, mobile: false })
      await oSend('Page.navigate', { url })
      const t0 = Date.now()
      let ready = false
      while (Date.now() - t0 < 60000) {
        const r = await oSend('Runtime.evaluate', { expression: '!!(window.__ns && document.querySelector("#app") && document.querySelector("#app").__vue_app__)', returnByValue: true })
        if (r && r.result && r.result.value) { ready = true; break }
        await sleep(300)
      }
      if (!ready) return { error: '第二个窗口 60s 内未就绪' }
      const prefKey = JSON.stringify(String(p.pref || 'fontSize'))
      const prefValue = JSON.stringify(p.value)
      const expr = '(function(){var p=document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;'
        + 'var ui=p._s.get("ui");return Promise.resolve(ui.applyPref(' + prefKey + ',' + prefValue + '))'
        + '.then(function(){return {fontSize: ui.fontSize}})})()'
      const r2 = await oSend('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      await sleep(500)
      return { ok: true, result: r2 && r2.result ? r2.result.value : null }
    } finally {
      try { await cdp.send('Target.closeTarget', { targetId: created.targetId }) } catch { /* 已关 */ }
    }
  }
  return { error: '未知请求 ' + kind }
}

async function runOne(cdp, origin, run) {
  const label = run.module + '-' + run.width
  console.log('')
  console.log('>>> ' + label)
  const settingsLike = run.module === 'settings' || run.module === 'settings-restore'
  const flowDir = join(OUT_DIR, 'settings-flow', label)
  const ctx = { send: null, cdp, origin, flowDir, chooser: null }
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => cdp.send(method, params, sessionId)
  ctx.send = send
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: run.width, height: VH, deviceScaleFactor: 1, mobile: false })
    /* 设置类的 target 逐个激活：headless 里多开的标签页不一定拿到焦点，受信任按键会打空
       （拆窗面板的 Esc 关抽屉就踩过这个坑）。其余场景保持原样，避免动到既有判据的焦点语境。 */
    if (settingsLike || run.module === 'panel-settings') await send('Page.bringToFront')
    if (process.env.NS_VERIFY_REDUCED_MOTION === '1') await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    /* 设置场景：下载要真落盘（备份/TXT 判据读磁盘），文件选择框要被拦住（pickFiles 动态建 input），
       DOM 域供 setFileInputFiles 用。目录按场景清空，避免上一次的文件冒充这一次的。 */
    let eventsFrom = cdp.events.length
    if (settingsLike) {
      await rm(flowDir, { recursive: true, force: true })
      await mkdir(flowDir, { recursive: true })
      await send('DOM.enable')
      await send('Page.setInterceptFileChooserDialog', { enabled: true })
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: flowDir, eventsEnabled: true })
    }
    await send('Page.navigate', { url: origin + '/harness.html?module=' + run.module + '&vw=' + run.width })
    /* 设置场景要真 reload 两次（恢复 + 撤销），150s 不够；其余场景口径不变。 */
    const deadline = Date.now() + (settingsLike ? 420000 : DEADLINE_MS)
    const states = []
    const handledReq = new Set()
    let payload = null
    while (Date.now() < deadline) {
      await sleep(300)
      /* 文件选择框：把这一轮里到达的 Page.fileChooserOpened 记成「待喂的节点」，等页内来要 */
      if (settingsLike) {
        const fresh = cdp.events.slice(eventsFrom)
        for (const e of fresh) {
          if (e && e.method === 'Page.fileChooserOpened' && e.sessionId === sessionId && e.params && e.params.backendNodeId) ctx.chooser = e.params.backendNodeId
        }
        eventsFrom = cdp.events.length
        /* 页内请求表：举起来的请求在这里执行，结果写回 window.__NS_REQ_RESULT */
        const rq = await send('Runtime.evaluate', { expression: 'window.__NS_REQ || null', returnByValue: true })
        const ask = rq && rq.result ? rq.result.value : null
        if (ask && ask.id && !handledReq.has(ask.id)) {
          handledReq.add(ask.id)
          let value
          try {
            value = await handleSettingsReq(String(ask.kind || ''), ask.payload || {}, ctx)
          } catch (e) {
            value = { error: String(e && e.message || e) }
          }
          await send('Runtime.evaluate', {
            expression: 'window.__NS_REQ_RESULT = ' + JSON.stringify({ id: ask.id, value }),
            returnByValue: true
          }).catch(() => {})
        }
      }
      /* 页内随时可以请求一张「某个中间状态」的快照（目前只有 695 档的目录栏打开态）：
         页内写 window.__NS_SHOT，这里拍完落盘、登记进 states，再置 __NS_SHOT_OK 放行页内继续。 */
      const sh = await send('Runtime.evaluate', { expression: 'window.__NS_SHOT || null', returnByValue: true })
      const shotName = sh && sh.result ? sh.result.value : null
      if (shotName && !states.some((x) => x.name === shotName)) {
        /* 页内可选给一段裁剪（requestShot 的第二参数）：第五轮的「折叠前后圆点近景」靠它出图。 */
        const cl = await send('Runtime.evaluate', { expression: 'window.__NS_SHOT_CLIP || null', returnByValue: true })
        const clRaw = cl && cl.result ? cl.result.value : null
        const clip = clRaw
          ? {
              x: Math.max(0, Math.round(clRaw.x)),
              y: Math.max(0, Math.round(clRaw.y)),
              width: Math.max(40, Math.round(clRaw.width)),
              height: Math.max(40, Math.round(clRaw.height)),
              scale: 1
            }
          : { x: 0, y: 0, width: run.width, height: VH, scale: 1 }
        const st = await send('Page.captureScreenshot', { format: 'png', clip })
        /* lore-v2-* / lore-v4-* / lore-v5-* 这类本轮新图直接落 .tmp-verify-app/ 根（文档按文件名引用）；
           其它历史图仍在 screenshots/ 下，旧引用不受影响。 */
        const rel = (shotName.indexOf('lore-v2-') === 0 || shotName.indexOf('lore-v4-') === 0 || shotName.indexOf('lore-v5-') === 0) ? shotName + '.png' : 'screenshots/' + shotName + '.png'
        await writeFile(join(OUT_DIR, rel), Buffer.from(st.data, 'base64'))
        states.push({ name: shotName, file: rel, width: clip.width, height: clip.height })
        await send('Runtime.evaluate', { expression: 'window.__NS_SHOT_OK = true', returnByValue: true })
      }
      const r = await send('Runtime.evaluate', { expression: 'window.__NS_VERIFY_RESULT || null', returnByValue: true })
      if (r && r.exceptionDetails) throw new Error('页面内求值异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
      if (r && r.result && r.result.value) { payload = r.result.value; break }
    }
    if (!payload) {
      /* 就绪超时：把页面当场状态带出来，否则只剩一句「没就绪」无从下手。 */
      let diag = null
      try {
        const r0 = await send('Runtime.evaluate', {
          expression: 'JSON.stringify((function(){var f=document.querySelector("iframe");var d=f&&f.contentDocument;var w=d&&d.querySelector(".workbench-shell");return {title:document.title,iframes:document.querySelectorAll("iframe").length,ready:d?d.readyState:null,module:w?w.getAttribute("data-module"):null,shell:!!(d&&d.querySelector(".snip-shell")),cards:d?d.querySelectorAll(".snip-note").length:-1,progress:window.__NS_PROGRESS||null,snipStep:(function(){try{return d.querySelector("#app")?window.frames[0].__SNIP_STEP||null:null}catch(e){return "n/a"}})(),result:window.__NS_VERIFY_RESULT?1:0};})())',
          returnByValue: true
        })
        diag = r0 && r0.result ? r0.result.value : null
      } catch (e) { diag = 'diag 失败: ' + String(e && e.message || e) }
      throw new Error('150s 内没拿到断言结果（页面没就绪，见截图 ' + label + '.png）；现场: ' + String(diag))
    }
    /* 设置场景补一条「无浏览器运行异常」（总稿 tools/verify.mjs:53 同款判据）：
       只算本 target 这一轮新到的 Runtime.exceptionThrown，不看别的场景的历史事件。 */
    if (settingsLike) {
      const errs = cdp.events.slice(eventsFrom)
        .filter((e) => e && e.method === 'Runtime.exceptionThrown' && e.sessionId === sessionId)
        .map((e) => String((e.params && e.params.exceptionDetails && (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text)) || ''))
      payload.items = payload.items || []
      payload.items.push({
        name: '无浏览器运行异常',
        pass: errs.length === 0,
        ev: errs.length ? (errs.length + ' 条：' + errs.slice(0, 3).join(' | ')) : 'Runtime.exceptionThrown 0 条'
      })
    }
    await sleep(400)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: run.width, height: VH, scale: 1 } })
    const file = label + '.png'
    await writeFile(join(OUT_DIR, file), Buffer.from(shot.data, 'base64'))
    return { label, file, payload, states }
  } finally {
    try { await cdp.send('Target.closeTarget', { targetId }) } catch { /* 目标可能已关 */ }
  }
}

async function main() {
  if (!existsSync(join(APP_DIR, 'index.html'))) {
    console.error('FAIL：assets/app/index.html 不存在 —— 先跑 npm run build:app')
    return 1
  }
  if (!existsSync(CHROME)) {
    console.error('FAIL：找不到 Chrome：' + CHROME + '（可用环境变量 NS_CHROME 指定可执行文件）')
    return 1
  }
  await rm(PROFILE_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(join(OUT_DIR, 'screenshots'), { recursive: true })

  const server = await serve()
  const origin = 'http://127.0.0.1:' + server.address().port
  console.log('[1] 静态服务 ' + origin + '  挂载 ' + PREFIX + ' -> assets/app')

  const { proc, wsUrl } = await launchChrome()
  console.log('[2] Chrome headless profile=' + PROFILE_DIR)
  const cdp = await cdpClient(wsUrl)
  console.log('[3] CDP 已连接 ' + wsUrl)

  const results = []
  try {
    for (const run of RUNS.filter((r) => !process.env.NS_VERIFY_RUN || r.module + '-' + r.width === process.env.NS_VERIFY_RUN)) {
      results.push(await runOne(cdp, origin, run))
    }
  } finally {
    try { cdp.close() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
    server.close()
  }

  const rows = []
  const states = []
  for (const res of results) {
    const p = res.payload || {}
    if (p.error) rows.push({ label: res.label, name: '页面就绪', ev: String(p.error), pass: false })
    for (const it of p.items || []) rows.push({ label: res.label, name: it.name, ev: String(it.ev), pass: !!it.pass })
    for (const s of res.states || []) states.push({ run: res.label, name: s.name, file: s.file, width: s.width })
  }

  console.log('')
  console.log('=== verify:app 汇总（暗色 / 顶栏与工具栏单位 px） ===')
  console.log(pad('run', 16) + pad('断言', 26) + pad('实测', 44) + '判定')
  for (const r of rows) console.log(pad(r.label, 16) + pad(r.name, 26) + pad(r.ev, 44) + (r.pass ? 'PASS' : 'FAIL'))
  if (states.length) {
    console.log('')
    console.log('=== 中间态截图（页内在「复原之前」请求，Node 拍完再放行） ===')
    for (const s of states) console.log('  ' + pad(s.run, 16) + pad(s.name, 26) + s.file + '  @' + s.width + 'px')
  }
  /* 只记录、不判红的探针（目前只有 695 的嵌套弹层 click-outside）：单独一节打印，不进 items。 */
  const probes = []
  for (const res of results) {
    const ev0 = (res.payload && res.payload.evidence) || {}
    const np = ev0.nestedPopover || null
    const mp = ev0.morePopover || null
    const fp = ev0.fontProbe || null
    if (np || mp) probes.push({ label: res.label, nestedPopover: np, morePopover: mp })
    if (fp) probes.push({ label: res.label, fontProbe: fp })
  }
  if (probes.length) {
    console.log('')
    console.log('=== 只记录不判红的探针 ===')
    for (const p of probes) {
      if (p.nestedPopover) console.log('  ' + pad(p.label, 16) + 'nestedPopover ' + JSON.stringify(p.nestedPopover))
      if (p.morePopover) console.log('  ' + pad(p.label, 16) + 'morePopover ' + JSON.stringify(p.morePopover))
      if (p.fontProbe) console.log('  ' + pad(p.label, 16) + 'fontProbe ' + JSON.stringify(p.fontProbe))
    }
  }

  const failed = rows.filter((r) => !r.pass)
  console.log('')
  if (failed.length) {
    console.log('=== FAIL 明细 ===')
    for (const r of failed) console.log('FAIL ' + r.label + ' :: ' + r.name + ' :: 实测 ' + r.ev)
    console.log('')
    console.log('FAIL ' + failed.length + '/' + rows.length + ' 项不通过；截图见 .tmp-verify-app/')
    return 1
  }
  console.log('PASS ' + rows.length + '/' + rows.length + ' 项通过（' + results.length + ' 个场景）；截图见 .tmp-verify-app/')
  return 0
}

export { HARNESS, launchChrome, cdpClient, serve }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('FAIL：' + String(e && e.stack || e))
    process.exit(1)
  })
}
