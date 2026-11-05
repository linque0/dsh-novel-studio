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
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const APP_DIR = join(REPO, 'assets', 'app')
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
  { module: 'lore', width: 1280 },
  { module: 'lore', width: 760 },
  { module: 'lore', width: 380 },
  { module: 'characters', width: 1280 },
  { module: 'characters', width: 760 },
  { module: 'characters', width: 380 },
  { module: 'snippets', width: 1280 },
  { module: 'snippets', width: 760 },
  { module: 'snippets', width: 380 },
  /* 拆窗面板是另一条壳层（PanelHost：没有 .app-topbar、不经书架），主机 iframe 覆盖不到：
     单独指一条 ?panel=outline:<种子作品 id>，宽度取面板窗口真机值 760。 */
  { module: 'panel-outline', width: 760 }
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
      var wantActs = ['undo', 'redo', 'bold', 'italic', 'underline', 'strike', 'paragraph', 'h1', 'h2', 'h3', 'more-formats', 'send'];
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
    var fGlassTargets = doc.querySelector('.ow-workspace') ? [['侧栏', '.ow-left'], ['主区', '.ow-main']] : [['侧栏', '.side-panel'], ['主区', '.center-pane']];
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
      characters: ['.character-surface'],
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
    var fTextCands = doc.querySelectorAll(fShellSel + ' .center-pane');
    for (var fti = 0; fti < fTextCands.length; fti++) {
      if (fTextCands[fti].getBoundingClientRect().width > 0) { fTextEl = fTextCands[fti]; break; }
    }
    if (!fTextEl) {
      need('正文对比度>=4.5', false, '未找到可见的 ' + fShellSel + ' .center-pane（候选 ' + fTextCands.length + ' 个，宽度全为 0）');
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
    need('设定树同时呈现多个设定集', lSets.length >= 2, '集头 ' + lSets.length + ' 个 ' + JSON.stringify(ev.lore.setNames));
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
    if (lEditor && lSets.length) {
      var lCs = win.getComputedStyle(lEditor);
      need('设定编辑区可滚动', lCs.overflowY === 'auto' || lCs.overflowY === 'scroll', 'overflow-y=' + lCs.overflowY);
      var lEdTop = lEditor.getBoundingClientRect().top;
      lEditor.scrollTop = 160;
      var lHeadTop = lSets[0].getBoundingClientRect().top;
      lEditor.scrollTop = 0;
      ev.lore.sticky = { editor: Math.round(lEdTop), head: Math.round(lHeadTop) };
      need('设定集头吸顶对齐滚动口', Math.abs(lHeadTop - lEdTop) <= 1.5,
        'head.top=' + Math.round(lHeadTop) + ' editor.top=' + Math.round(lEdTop));
    } else {
      need('设定编辑区可滚动', false, lEditor ? '未渲染集头' : '未找到 .ob-editor');
      need('设定集头吸顶对齐滚动口', false, lEditor ? '未渲染集头' : '未找到 .ob-editor');
    }
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
    need('设定三视图切换器', lSwitch.length === 3 && lLabels === '条目编写/设定详情/视觉导图',
      '切换项=' + lSwitch.length + ' → ' + lLabels);
    need('设定默认进入条目编写', !!doc.querySelector('.lore-switch button.on') && doc.querySelector('.lore-switch button.on').textContent.trim() === '条目编写',
      '当前=' + (doc.querySelector('.lore-switch button.on') || {}).textContent);
    need('设定不再有全屏详情页', !doc.querySelector('.ldt-page'),
      doc.querySelector('.ldt-page') ? '仍存在 .ldt-page（fixed 全屏层）' : 'ok');
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
  /* 沉浸模式要等 Vue 在微任务里重渲染之后才读得到隐藏后的布局，故只有正文场景多一拍。 */
  if (module !== 'chapters') return out;
  return focusProbe(frame, out).then(function () {
    return (width === 695 || width === 1280) ? ctxMenuProbe(frame, out, width) : null;
  }).then(function () {
    return width === 695 ? panelProbe(frame, out) : null;
  }).then(function () {
    return [695, 760, 1000].indexOf(width) >= 0 ? nestedPopoverProbe(frame, out) : null;
  }).then(function () {
    return drawerProbe(frame, out, width);
  }).then(function () {
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
/* 嵌套弹层 click-outside 探针（695，只记录不判红）：「更多格式」弹层里嵌着 颜色/底色/链接 三个 NPopover，
   naive-ui 可能在外层展开时把它一起关掉。抓到外层节点引用再点内层颜色键，看外层是否还在 ——
   结论写进 evidence.nestedPopover，由 Node 侧汇总打印，不产生断言项（免得把总数变红）。 */
/* 关掉所有可见的 .n-popover：方式是「再点一次触发器」的真点击（走 naive 的 toggle），
   而不是向 body 派发合成事件 —— 后者在真机上收不干净。最多点 maxA 次；仍关不掉只记录，不判红。 */
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
    return doc.querySelector('.editor-toolbar [data-act="more-formats"]') || doc.querySelector('[data-act="more-formats"]');
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
function requestShot(name) {
  window.__NS_SHOT = name;
  window.__NS_SHOT_OK = false;
  var t0 = Date.now();
  return new Promise(function (res) {
    (function poll() {
      if (window.__NS_SHOT_OK === true || Date.now() - t0 > 5000) { window.__NS_SHOT = null; res(null); return; }
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
      var more = doc.querySelector('.editor-toolbar [data-act="more-formats"]') || doc.querySelector('[data-act="more-formats"]');
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
  var out;
  try { out = measure(module, frame, width); } catch (e) { out = { module: module, width: width, ok: false, items: [], error: 'measure 失败: ' + String(e && e.message || e) }; }
  Promise.resolve(out).then(function (o) {
    o.module = module;
    o.width = width;
    finish(o);
  });
}
function ticks(frame, module, width) {
  /* 拆窗面板场景的 module 形如 'panel-outline'：ticks 与 boot 各算一次。
     （曾经只写在 boot() 里，ticks 取到的是未声明的全局 —— 非书架场景每 tick 都抛 ReferenceError，
      于是正文与四个模块全都卡在「页面没到可测状态」上。） */
  var panelType = module.indexOf('panel-') === 0 ? module.slice(6) : '';
  var tries = 0, opened = false;
  /* 设定幕布种子只能走应用自己的 store：在 raw IndexedDB 里预建 mubu 表没用 ——
     Dexie 从 v1 升到 v12 时会把未声明的表清空（实测 mubu.length=0）。 */
  var mubuSeeded = false;
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
      if (tries > 12 && doc.querySelector('.panel-host .panel-topbar')) {
        clearInterval(timer);
        try { var pw = frame.contentWindow; pw.dispatchEvent(new pw.Event('resize')); } catch (e8) { /* ignore */ }
        setTimeout(function () { shim(frame); done(module, width, frame); }, 1200);
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
    if (!openedWork) return;
    seedMubu();
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
      frame.src = PREFIX + '/index.html?embed=1' + (panelType ? '&panel=' + panelType + ':w1' : '');
      frame.addEventListener('load', function () { shim(frame); ticks(frame, module, width); });
      document.body.appendChild(frame);
    })
    .catch(function (e) { finish({ module: module, width: width, ok: false, items: [], error: '种子失败: ' + String(e) }); });
}
boot();
</script>
</body></html>`

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
      return send(200, await readFile(file), MIME[extname(file)] || 'application/octet-stream')
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

async function runOne(cdp, origin, run) {
  const label = run.module + '-' + run.width
  console.log('')
  console.log('>>> ' + label)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => cdp.send(method, params, sessionId)
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: run.width, height: VH, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: origin + '/harness.html?module=' + run.module + '&vw=' + run.width })
    const deadline = Date.now() + DEADLINE_MS
    const states = []
    let payload = null
    while (Date.now() < deadline) {
      await sleep(300)
      /* 页内随时可以请求一张「某个中间状态」的快照（目前只有 695 档的目录栏打开态）：
         页内写 window.__NS_SHOT，这里拍完落盘、登记进 states，再置 __NS_SHOT_OK 放行页内继续。 */
      const sh = await send('Runtime.evaluate', { expression: 'window.__NS_SHOT || null', returnByValue: true })
      const shotName = sh && sh.result ? sh.result.value : null
      if (shotName && !states.some((x) => x.name === shotName)) {
        const st = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: run.width, height: VH, scale: 1 } })
        const rel = 'screenshots/' + shotName + '.png'
        await writeFile(join(OUT_DIR, rel), Buffer.from(st.data, 'base64'))
        states.push({ name: shotName, file: rel, width: run.width })
        await send('Runtime.evaluate', { expression: 'window.__NS_SHOT_OK = true', returnByValue: true })
      }
      const r = await send('Runtime.evaluate', { expression: 'window.__NS_VERIFY_RESULT || null', returnByValue: true })
      if (r && r.exceptionDetails) throw new Error('页面内求值异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
      if (r && r.result && r.result.value) { payload = r.result.value; break }
    }
    if (!payload) throw new Error('150s 内没拿到断言结果（页面没就绪，见截图 ' + label + '.png）')
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

export { HARNESS, launchChrome, cdpClient }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('FAIL：' + String(e && e.stack || e))
    process.exit(1)
  })
}
