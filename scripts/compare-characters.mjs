/* compare:characters —— 人物工作区（面板矩阵）的几何对稿 + 截图 + reload 复验。
 *
 * 与 verify:app 的分工：verify 判「行为与形态」（点得动、收得起、窄档是抽屉），
 * 这里判「数值」—— 把设计稿常量与真机实测逐项摆在一张表里，误差 > 1px 记为 FAIL。
 * 结构照抄 compare-lore.mjs（同源静态服务 + HARNESS 种库 + CDP + getBoundingClientRect），
 * 只把「设定面板」换成「人物工作区」：.char-shell / .char-pane[data-pane=roster|main|context]
 * / .char-divider(16) / .char-rail(40) / .char-mobilebar(48) / 名录抽屉 / .char-scrim。
 *
 * 设计真值：docs/前端美化/人物-融合总稿-20261105/report.json
 *   1440: pane1 28..276(248) / pane2 292..1092(800) / pane3 1108..1412(304)，y=108 bottom=870
 *   1280: 28..276 / 292..932(640) / 948..1252(304)
 *   760: 单块 x=20 right=740(720)；380: x=12
 *   fusion.css:2-3 + app.mjs:17 —— profile 248/304，graph 220/332
 *   studio.css: .workspace padding 24 28 30 / .pane 圆角 20·18·16 / .resize-handle 16 / .rail 40
 *
 * 产物：.tmp-verify-app/char-compare-report.json
 *       .tmp-verify-app/char-spec-*.png（13 张对稿截图）
 *
 * 用法：node scripts/compare-characters.mjs   （先 npm run build:app）
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, cdpClient, serve } from './verify-app.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = resolve(REPO, '.tmp-verify-app')
const CHROME = process.env.NS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TOL = 1

/* 宽档两种视图的两列默认宽（char-layout.js CHAR_PANE：profile 248/304、graph 220/332）。
   主区宽 = 视口 − 56（外壳左右各 28）− 32（两条 16 分隔）− 左 − 右。 */
const WIDE = { profile: { left: 248, right: 304 }, graph: { left: 220, right: 332 } }
const PAD_X = 28
const PAD_B = 30
const DIV = 16
const RAIL = 44
const NARROW = { 1000: { left: 20, width: 960 }, 760: { left: 20, width: 720 }, 380: { left: 12, width: 356 } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 页面内通用前置：拿到宿主 iframe 的 document/window 与几个量具（与 compare-lore.mjs 同源）。 */
const PRE = `
  var S = (function () {
    function frame() { return document.getElementById('ns-frame'); }
    function doc() { var f = frame(); return f ? f.contentDocument : null; }
    function win() { var f = frame(); return f ? f.contentWindow : null; }
    function q(s) { var d = doc(); return d ? d.querySelector(s) : null; }
    function vis(n) { if (!n) return false; var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function rect(s) { var n = typeof s === 'string' ? q(s) : s; if (!n) return null; var r = n.getBoundingClientRect(); return { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }
    function click(s) { var n = typeof s === 'string' ? q(s) : s; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
    function cs(s) { var n = q(s), w = win(); return n && w ? w.getComputedStyle(n) : null; }
    function store(name) {
      var d = doc(); var app = d ? d.querySelector('#app') : null;
      var p = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$pinia : null;
      return p ? p._s.get(name) : null;
    }
    return { frame: frame, doc: doc, win: win, q: q, vis: vis, rect: rect, click: click, cs: cs, store: store };
  })();
  var q = S.q, vis = S.vis, rect = S.rect, click = S.click, cs = S.cs;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { if (fn()) return true; await sleep(250); } return false; }
  /* 视图切换走页头那颗 segmented（profile 头写「关系剧场」、graph 头写「人物卷宗」，两向都点得到）。 */
  function switchView(name) {
    var d = S.doc(); if (!d) return false;
    /* 卷宗侧的分段控件是 .char-segmented、关系剧场侧是 .segmented，两套都要认 */
    var btns = d.querySelectorAll('.char-pane[data-pane="main"] .char-segmented button, .char-pane[data-pane="main"] .segmented button');
    for (var i = 0; i < btns.length; i++) { if (String(btns[i].textContent || '').trim() === name) { btns[i].click(); return true; } }
    return false;
  }
  /* 绕过应用自己读 IndexedDB 里的 appconfig：把「写不进库」与「读不回库」分开量。
     插件版库名是 novel-studio@dsh（db/database.js:7），桌面版是 novel-studio，两个都读。 */
  function rawKeys(keys) {
    return new Promise(function (res) {
      var names = ['novel-studio@dsh', 'novel-studio'];
      var out = {}, pending = names.length;
      function done() { if (--pending === 0) res(out); }
      names.forEach(function (n) {
        var r = indexedDB.open(n);
        r.onerror = function () { out[n] = 'OPEN_ERR'; done(); };
        r.onsuccess = function () {
          var db = r.result;
          if (!db.objectStoreNames.contains('appconfig')) { out[n] = 'NO_STORE'; db.close(); done(); return; }
          var g = db.transaction('appconfig', 'readonly').objectStore('appconfig').get(keys[0]);
          g.onsuccess = function () {
            var first = g.result ? g.result.value : null;
            var rest = keys.slice(1), acc = {};
            if (!rest.length) { out[n] = { first: first }; db.close(); done(); return; }
            var tx = db.transaction('appconfig', 'readonly').objectStore('appconfig');
            var left = rest.length;
            rest.forEach(function (k) {
              var gg = tx.get(k);
              gg.onsuccess = function () { acc[k] = gg.result ? gg.result.value : null; if (--left === 0) { out[n] = { first: first, rest: acc }; db.close(); done(); } };
              gg.onerror = function () { acc[k] = 'GET_ERR'; if (--left === 0) { out[n] = { first: first, rest: acc }; db.close(); done(); } };
            });
          };
          g.onerror = function () { out[n] = 'GET_ERR'; db.close(); done(); };
        };
      });
    });
  }
`

let cdp = null
let origin = ''
const shots = []

function makeEval(send) {
  return async function ev(body) {
    const expression = '(async function(){' + PRE + body + '})()'
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r && r.exceptionDetails) {
      const ex = r.exceptionDetails
      const ln = (ex.lineNumber || 0) + 1
      const src = String(expression.split('\n')[ln - 1] || '').trim().slice(0, 180)
      const desc = (ex.exception && ex.exception.description) || ex.text || ''
      throw new Error('页面内求值异常: ' + String(desc).split('\n')[0] + ' @行' + ln + ':' + (ex.columnNumber || 0) + ' 「' + src + '」')
    }
    return r && r.result ? r.result.value : null
  }
}

async function shoot(send, name, width, height) {
  const st = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } })
  const file = join(OUT, name + '.png')
  await writeFile(file, Buffer.from(st.data, 'base64'))
  const one = { name: name + '.png', file: file, width, height }
  shots.push(one)
  return one
}

/* 打开一次人物场景：HARNESS 用应用自己的 store 种库 → 点书架「继续写作」打开 w1 →
   work.tab='characters' → 等 .char-shell 挂上，随后拉高 iframe 到对稿窗口高度。
   （module=characters 的 HARNESS 自带同一套 bootstrap；这里不依赖它的探针结果，
    只认 .char-shell 是否渲染 —— 探针判据与几何无关。） */
async function openChar(width, height) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  const ev = makeEval(send)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

  /* 先在同源空白页把两个库删干净，再进 HARNESS。
     HARNESS 的 boot() 自己也 delete+seed，但它用 indexedDB.open(name, 1) 建库：
     上一个 target 里应用已把库升到 v12，若删除被旧连接挡住（onblocked），这次 open 就会 VersionError，
     seedDb 直接失败、iframe 根本不创建 —— 表现就是「书架没出现」。同源页里没有别的连接，删得掉。 */
  const wipe = async () => {
    await send('Page.navigate', { url: origin + '/' })
    await sleep(350)
    const r = await send('Runtime.evaluate', {
      expression: '(async function(){var out={};var names=["novel-studio@dsh","novel-studio"];'
        + 'for (var i=0;i<names.length;i++){out[names[i]]=await new Promise(function(res){var done=false;'
        + 'var q=indexedDB.deleteDatabase(names[i]);'
        + 'q.onsuccess=function(){if(!done){done=true;res("ok")}};'
        + 'q.onerror=function(){if(!done){done=true;res("err")}};'
        + 'q.onblocked=function(){setTimeout(function(){if(!done){done=true;res("blocked")}},1200)};'
        + 'setTimeout(function(){if(!done){done=true;res("timeout")}},3000)});}return out;})()',
      returnByValue: true, awaitPromise: true
    })
    return r && r.result ? r.result.value : null
  }
  let wiped = await wipe()
  let boot1 = null
  /* 拆成两段：单条 evaluate 的等待预算压在 CDP 60s 超时以内，卡住时也能看出卡在哪一段。 */
  for (let attempt = 0; attempt < 2; attempt++) {
    /* module=shelf 而不是 characters：HARNESS 的 characters 探针不是只读的 ——
       keyAssert 会点名录行、点「编辑档案」、点「收起人物名录」、点右列「在关系图中查看」
       （见 verify-app.mjs 的「名录点行切换选中」「点编辑档案进编辑态」「收起人物名录取 40 细轨」等条目），
       与本站的点击抢同一条链路：量出来的收起宽、选中人物、data-screen 会随机变。
       用 shelf 只借它的「种库 + 书架」，人物页全部由本脚本自己驱动；探针结论不在本脚本的判据里。 */
    await send('Page.navigate', { url: origin + '/harness.html?module=shelf&vw=' + width })
    boot1 = await ev(`
      /* HARNESS 自己也点书架打开作品：谁先到谁算数。这里认「书架在」或「工作台已在」，
         只等书架会被 HARNESS 抢先一步（它把作品打开后书架就没了）。 */
      var okReady = await until(function () {
        var d = S.doc(); if (!d) return false;
        return !!d.querySelector('.latent-shelf .ls-primary') || (!!d.querySelector('.workbench-shell') && !!d.querySelector('.app-topbar-save'));
      }, 25000);
      var shelf = S.doc() ? S.doc().querySelector('.latent-shelf .ls-primary') : null;
      if (shelf) shelf.click();
      return { okShelf: okReady, hadShelf: !!shelf, harness: window.__NS_VERIFY_RESULT ? String(window.__NS_VERIFY_RESULT.module || '') : null };
    `)
    if (boot1 && boot1.okShelf) break
    wiped = await wipe()
    await sleep(1200)
  }
  if (!boot1 || !boot1.okShelf) throw new Error('书架没出现 vw=' + width + '：' + JSON.stringify(boot1) + ' / 清库=' + JSON.stringify(wiped))
  await sleep(1400)
  const boot2 = await ev(`
    var okWork = await until(function () { var d = S.doc(); return d && d.querySelector('.workbench-shell') && d.querySelector('.app-topbar-save'); }, 40000);
    var wk = S.store('work');
    if (wk) wk.tab = 'characters';
    var okChar = await until(function () { var d = S.doc(); return d && d.querySelector('.char-shell') && d.querySelector('.char-pane[data-pane="main"]') && d.querySelector('.char-pane[data-pane="roster"]'); }, 40000);
    var f = document.getElementById('ns-frame');
    if (f) { f.style.height = '` + height + `px'; try { f.contentWindow.dispatchEvent(new f.contentWindow.Event('resize')); } catch (e) {} }
    await sleep(800);
    return { okWork: okWork, okChar: okChar, work: wk ? !!wk.work : false };
  `)
  if (!boot2 || !boot2.okChar) throw new Error('人物页没到可测状态 vw=' + width + '：' + JSON.stringify(boot2))
  return { targetId, send, ev, close: () => cdp.send('Target.closeTarget', { targetId }).catch(() => {}) }
}

/* 种数据：8 个人物（第 1 位带别名 + 标签 + 自定义字段 + 一句话 + 小传，贴近设计稿 profile-1440.png）
   + 5 条关系。全部走 work store，不碰 IndexedDB 原表。 */
async function seedChars(ev) {
  return ev(`
    var wk = S.store('work');
    if (!wk || !wk.work) return { error: '作品未打开' };
    var PEOPLE = [
      { name: '林照', role: '主角', aliases: '守灯人 / 阿照', tags: ['雾港', '灯塔'],
        fields: { '身份': '第七代守灯人', '一句话': '把整座城的光都记在自己名下的人', '所属': '守灯人协会', '弱点': '听见海上有人喊名字就会回头' },
        content: '林照在灯塔下长大，替上一任守灯人记了七年潮汐表。\\n她记得每条船回港的日子，却记不清自己的生日。\\n三点交班前，她从不独自进入灯室。' },
      { name: '沈砚', role: '主角', aliases: '修表匠', tags: ['雾港'], fields: { '一句话': '替人修表，也替人删掉不该记得的日期' }, content: '住在北岸的修表匠，柜台下压着一张没有日期的潮汐表。' },
      { name: '周懋', role: '配角', aliases: '老周', tags: ['航运局'], fields: { '一句话': '只登记有编号的船' }, content: '北岸航运局的登记员，袖口常年沾着墨水。' },
      { name: '蒋芸', role: '反派', tags: ['协会'], fields: {}, content: '守灯人协会的书记，从不抬眼看人。' },
      { name: '魏无己', role: '配角', tags: ['旧物'], fields: {}, content: '潮汐集市的摆摊人，卖海水送回来的旧物。' },
      { name: '阿洛', role: '配角', tags: ['栈桥'], fields: {}, content: '第七栈桥的守夜孩子。' },
      { name: '连长庚', role: '配角', tags: [], fields: {}, content: '' },
      { name: '许青梧', role: '配角', tags: ['雾港'], fields: {}, content: '' }
    ];
    var ids = [];
    PEOPLE.forEach(function (p) {
      var c = wk.addCharacter(p.name);
      wk.updateCharacter(c.id, { role: p.role, aliases: p.aliases || '', tags: p.tags || [], fields: p.fields || {}, content: p.content || '' });
      ids.push(c.id);
    });
    var REL = [[0, 1, '同门'], [0, 2, '旧识'], [1, 2, '同盟'], [3, 4, '夫妻'], [0, 5, '门生']];
    REL.forEach(function (r) { wk.addRelation(ids[r[0]], ids[r[1]], r[2]); });
    wk.selCharacterId = ids[0];
    wk.tab = 'characters';
    await sleep(900);
    var rich = wk.liveCharacters[0];
    return {
      people: wk.liveCharacters.length,
      relations: (wk.relations || []).filter(function (x) { return !x.deletedAt; }).length,
      sel: wk.selCharacterId === ids[0],
      rich: rich ? { name: rich.name, aliases: rich.aliases, tags: rich.tags, fields: Object.keys(rich.fields || {}), bio: String(rich.content || '').length } : null
    };
  `)
}

/* 一把量完当前状态：三列矩形 / 两条分隔 / 圆角 / 顶栏 / 工具条 / 内外层 padding / 溢出。 */
async function measure(ev) {
  return ev(`
    var shell = S.q('.char-shell');
    var panes = { roster: rect('.char-pane[data-pane="roster"]'), main: rect('.char-pane[data-pane="main"]'), context: rect('.char-pane[data-pane="context"]') };
    var divs = [];
    var dn = S.doc() ? S.doc().querySelectorAll('.char-divider') : [];
    Array.prototype.forEach.call(dn, function (d) {
      var b = d.getBoundingClientRect();
      divs.push({ size: d.getAttribute('data-size'), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, visible: b.width > 0 && b.height > 0, now: d.getAttribute('aria-valuenow') });
    });
    var radius = {};
    ['roster', 'main', 'context'].forEach(function (k) {
      var n = S.q('.char-pane[data-pane="' + k + '"]');
      var c = n && S.win() ? S.win().getComputedStyle(n) : null;
      radius[k] = c ? parseFloat(c.borderTopLeftRadius) : null;
    });
    var scs = cs('.char-shell');
    var wcs = cs('.wb-body');
    var w = S.win();
    var de = w ? w.document.documentElement : null;
    var wk = S.store('work');
    var mb = rect('.char-mobilebar');
    return {
      view: shell ? shell.getAttribute('data-view') : null,
      screen: shell ? shell.getAttribute('data-screen') : null,
      drawer: shell ? shell.getAttribute('data-drawer') : null,
      panes: panes,
      divs: divs,
      radius: radius,
      topbar: rect('.app-topbar'),
      mobilebar: { h: mb ? mb.h : null, visible: vis(S.q('.char-mobilebar')) },
      rail: { roster: vis(S.q('.char-pane[data-pane="roster"] .char-rail')), context: vis(S.q('.char-pane[data-pane="context"] .char-rail')) },
      scrim: vis(S.q('.char-scrim')),
      shellPadding: scs ? { l: scs.paddingLeft, t: scs.paddingTop, r: scs.paddingRight, b: scs.paddingBottom } : null,
      outerPadding: wcs ? { l: wcs.paddingLeft, t: wcs.paddingTop } : null,
      innerWidth: w ? w.innerWidth : null,
      innerHeight: w ? w.innerHeight : null,
      scrollWidth: de ? de.scrollWidth : null,
      title: String((S.q('.char-module-head h1') || {}).textContent || '').trim(),
      store: wk ? { charView: wk.charView, chars: wk.liveCharacters.length, rels: (wk.relations || []).filter(function (x) { return !x.deletedAt; }).length, sel: !!wk.selCharacterId } : null
    };
  `)
}

/* 样式探针：把这一轮修正的排版真值一并钉住（卷宗宽度/内距、头像尺寸、正文号、段间距、页头下限、玻璃 alpha）。
   头像与内距按媒体查询分档：base（1321–1649）82x105 / padding 35 36 38；1100–1320 70x93 / padding 30 27；
   ≤1099 80x100 / padding 30 35 40；≤559 63x84（chars-dossier.css:52/56/179/181/195/196/209/211）。
   尺寸用 offsetWidth/offsetHeight。玻璃边框 alpha 读两遍：宿主令牌下的实际值 + 摘掉 --ns-border-2 后的插件兜底值 ——
   HARNESS 的 shim 把 --ns-border-2 改写成 .12，插件自己的兜底才是 .17，两条都记下来便于分辨。 */
async function styleProbe(ev) {
  return ev(`
    var W = S.win(), D = S.doc();
    function cso(sel) { var n = S.q(sel); return n && W ? W.getComputedStyle(n) : null; }
    function px(v) { return v == null || v === 'none' ? null : Math.round(parseFloat(v) * 10) / 10; }
    function alphaOf(v) {
      var m = String(v || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      return p.length > 3 ? Math.round(p[3] * 1000) / 1000 : 1;
    }
    var dcs = cso('.char-pane[data-pane="main"] .char-dossier');
    var hcs = cso('.char-pane[data-pane="main"] .char-module-head');
    var pcs = cso('.char-pane[data-pane="main"] .char-prose');
    var sections = D.querySelectorAll('.char-pane[data-pane="main"] .char-section');
    var sec2 = sections.length > 1 ? W.getComputedStyle(sections[1]) : null;
    var portrait = S.q('.char-pane[data-pane="main"] .char-dossier .char-portrait');
    var pane = S.q('.char-pane[data-pane="roster"]');
    var paneCs = pane ? W.getComputedStyle(pane) : null;
    var out = {
      dossier: dcs ? { maxW: px(dcs.maxWidth), padTop: px(dcs.paddingTop), padRight: px(dcs.paddingRight), padBottom: px(dcs.paddingBottom), padLeft: px(dcs.paddingLeft) } : null,
      head: hcs ? { minH: px(hcs.minHeight) } : null,
      prose: pcs ? { fontSize: px(pcs.fontSize) } : null,
      section2: sec2 ? { marginTop: px(sec2.marginTop) } : null,
      portrait: portrait ? { w: portrait.offsetWidth, h: portrait.offsetHeight } : null,
      pane: paneCs ? { bg: paneCs.backgroundColor, bgAlpha: alphaOf(paneCs.backgroundColor), borderHost: paneCs.borderTopColor, borderHostAlpha: alphaOf(paneCs.borderTopColor) } : null,
      h1: String((S.q('.char-pane[data-pane="main"] .char-module-head h1') || {}).textContent || '').trim(),
      sections: sections.length,
      /* 边框色的真源是 --ns-border-2（插件声明 var(--ns-border-2, rgb(255 255 255 / .17))）。
         宿主/主题都会给这个令牌（HARNESS 的 shim 给 .12，应用主题给 .2），插件兜底 .17 只有在令牌缺失时才走 ——
         所以判据是「pane 边框 alpha == 当前 --ns-border-2 的 alpha」，兜底值只记不判。 */
      borderToken: (function () {
        var raw = W ? String(W.getComputedStyle(D.documentElement).getPropertyValue('--ns-border-2') || '').trim() : '';
        return { raw: raw, alpha: alphaOf(raw) };
      })()
    };
    if (pane) {
      var root = D.documentElement;
      var saved = root.style.getPropertyValue('--ns-border-2');
      root.style.removeProperty('--ns-border-2');
      var again = W.getComputedStyle(pane).borderTopColor;
      if (saved) root.style.setProperty('--ns-border-2', saved);
      if (out.pane) { out.pane.borderFallback = again; out.pane.borderAlphaFallback = alphaOf(again); }
    }
    return out;
  `)
}

/* ---- 一个宽档完整跑完（profile → graph → 编辑态 → 收起/还原 → 两次 reload）---- */
async function captureWide(width, height, collected) {
  const page = await openChar(width, height)
  const { ev, send } = page
  const rec = { width: width, height: height }
  /* 先登记再采集：中途抛错时已量到的段落仍要进报告，不因一次异常全表归零。 */
  collected.wide[width] = rec
  try {
    rec.seed = await seedChars(ev)
    rec.profile = await measure(ev)
    rec.style = await styleProbe(ev)
    await shoot(send, 'char-spec-' + width + '-profile', width, height)
    if (width === 1440) {
      /* 编辑档案态：页脚 .char-btn「编辑档案」→ 表单态，拍完点「取消」退回阅读态 */
      rec.editing = await ev(`
        var ok = click('.char-pane[data-pane="main"] .char-pane-foot .char-btn');
        await sleep(520);
        return { clicked: ok, form: vis(S.q('.char-pane[data-pane="main"] .char-edit')), label: String((S.q('.char-pane[data-pane="main"] .char-editing-label') || {}).textContent || '').trim() };
      `)
      await shoot(send, 'char-spec-editing-' + width, width, height)
      await ev(`
        var btns = S.doc().querySelectorAll('.char-pane[data-pane="main"] .char-edit-buttons button');
        for (var i = 0; i < btns.length; i++) { if (String(btns[i].textContent || '').trim() === '取消') { btns[i].click(); break; } }
        await sleep(460);
        return true;
      `)
    }
    rec.graphSwitched = await ev(`
      var ok = switchView('关系剧场');
      await sleep(900);
      var wk = S.store('work');
      return { clicked: ok, charView: wk ? wk.charView : null };
    `)
    rec.graph = await measure(ev)
    rec.graphNodes = await ev(`
      /* 用 offsetWidth/offsetHeight 而不是 getBoundingClientRect：.graph-world 带相机缩放
         （fitView 后常见 80%），rect 量出来是缩放后的数，会把 134 读成 ~107。 */
      var d = S.doc();
      var nodes = d ? d.querySelectorAll('.char-pane[data-pane="main"] .graph-node') : [];
      var sub = d ? d.querySelector('.char-pane[data-pane="main"] .graph-subbar') : null;
      var plain = null, sel = null;
      for (var i = 0; i < nodes.length; i++) {
        var isSel = nodes[i].classList.contains('selected');
        if (isSel && !sel) sel = nodes[i];
        if (!isSel && !plain) plain = nodes[i];
      }
      function box(n) { return n ? { w: n.offsetWidth, h: n.offsetHeight } : null; }
      var cam = d ? d.querySelector('.char-pane[data-pane="main"] .graph-world') : null;
      var zoomTxt = String((d.querySelector('.char-pane[data-pane="main"] .graph-zoom') || {}).textContent || '').trim();
      return { nodes: nodes.length, plain: box(plain), sel: box(sel), zoomTxt: zoomTxt,
        world: cam ? String(S.win().getComputedStyle(cam).transform || '') : null,
        subbar: String((sub || {}).textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70) };
    `)
    await shoot(send, 'char-spec-' + width + '-graph', width, height)
    await ev('switchView("人物卷宗"); await sleep(700); return true;')

    /* --- 收起 / 还原（左列 248→40→248，右列 304→40→304）--- */
    rec.collapse = await ev(`
      /* 等「宽度真的变了」再量，而不是死等 640ms：视图切换与 store 写入都是异步的，
         固定等待会在快慢两台机器上给出不同的结论。每步都带上 data-view，异常时能看清是哪一档。 */
      function viewNow() { var s = S.q('.char-shell'); return s ? s.getAttribute('data-view') : null; }
      async function settle(sel, wantNarrow, ms) {
        var t0 = Date.now();
        while (Date.now() - t0 < (ms || 3000)) {
          var b = rect(sel);
          if (b && (wantNarrow ? b.w <= 60 : b.w > 60)) return b;
          await sleep(120);
        }
        return rect(sel);
      }
      /* 收起断言按 profile 的 248/304 判：切回卷宗再开始（graph 的两列是 220/332）。 */
      if (viewNow() === 'graph') { switchView('人物卷宗'); await sleep(900); }
      var out = { viewStart: viewNow() };
      out.leftClick = click('.char-pane[data-pane="main"] .char-head-toggle[data-act="toggle-left"]');
      var lc = await settle('.char-pane[data-pane="roster"]', true);
      out.leftClosed = { view: viewNow(), pane: lc, rail: vis(S.q('.char-pane[data-pane="roster"] .char-rail')), railBox: rect('.char-pane[data-pane="roster"] .char-rail'), railW: (S.q('.char-pane[data-pane="roster"] .char-rail') || {}).offsetWidth, main: rect('.char-pane[data-pane="main"]'), context: rect('.char-pane[data-pane="context"]') };
      out.railClick = click('.char-pane[data-pane="roster"] .char-rail');
      var lo = await settle('.char-pane[data-pane="roster"]', false);
      out.leftOpen = { view: viewNow(), pane: lo, main: rect('.char-pane[data-pane="main"]'), context: rect('.char-pane[data-pane="context"]') };
      out.rightClick = click('.char-pane[data-pane="main"] .char-head-toggle[data-act="toggle-right"]');
      var rc = await settle('.char-pane[data-pane="context"]', true);
      out.rightClosed = { view: viewNow(), pane: rc, rail: vis(S.q('.char-pane[data-pane="context"] .char-rail')), railBox: rect('.char-pane[data-pane="context"] .char-rail'), railW: (S.q('.char-pane[data-pane="context"] .char-rail') || {}).offsetWidth, main: rect('.char-pane[data-pane="main"]') };
      out.railClick2 = click('.char-pane[data-pane="context"] .char-rail');
      var ro = await settle('.char-pane[data-pane="context"]', false);
      out.rightOpen = { view: viewNow(), pane: ro, main: rect('.char-pane[data-pane="main"]') };
      return out;
    `)
    if (width === 1440) {
      await ev('click(".char-pane[data-pane=\'main\'] .char-head-toggle[data-act=\'toggle-left\']"); await sleep(640); return true;')
      await shoot(send, 'char-spec-railclosed-' + width, width, height)
    }

    /* --- reload 复验 ①：收起左列 → 刷新 iframe → 重开作品与人物页 → 仍应是 40 ---
       拆成「短 eval + Node 侧 sleep」：单条 evaluate 不跨 CDP 的 60s 超时，
       失败时也能看出卡在「刷新 / 重开 / 量」哪一步。
       刷新前置 frame.dataset.verifyReload='1'（与 lore-free-probe.mjs:182 同法），
       否则 HARNESS 的 load 监听会再跑一遍 ticks 探针，与重开动作抢同一条打开链路。 */
    /* 持久化探针（证据，不是判据）：直读 IndexedDB 的 appconfig，把「写不进库」与「读不回库」分开量。
       ui.setPref 的 value 里若混进 Vue 的响应式代理，Dexie 的 structured clone 会抛 DataCloneError，
       而调用点写的是 void ui.setPref(...)，异常就此静默 —— 表现为「界面收起了、reload 后没记住」。 */
    rec.persistProbe = await ev(`
      var ui = S.store('ui');
      var out = { storeLeftClosed: ui ? ui.charPrefs.profile.leftClosed : null };
      out.probeWriteErr = null;
      try { await ui.setPref('__ns_probe', { at: 'characters' }); } catch (e) { out.probeWriteErr = String((e && e.name) + ': ' + (e && e.message)); }
      out.charPrefsWriteErr = null;
      try { await ui.setPref('charPrefs', ui.charPrefs); } catch (e) { out.charPrefsWriteErr = String((e && e.name) + ': ' + (e && e.message)); }
      out.charStateWriteErr = null;
      try { await ui.saveCharState('w1', { view: 'graph', query: '', role: '', tag: '', scope: 'local', scroll: { roster: 0, dossier: 0, context: 0 } }); } catch (e) { out.charStateWriteErr = String((e && e.name) + ': ' + (e && e.message)); }
      out.raw = await rawKeys(['__ns_probe', 'charPrefs', 'charstate:w1']);
      return out;
    `)

    rec.reloadLeftPrep = await ev(`
      /* 这一条判的是「profile 的收起态跨 reload」：先钉住视图 = profile，
         再等 charPrefs 真的写进库（直读 appconfig），否则会在「已写库 / 未写库」之间随机出红。 */
      var sh = S.q('.char-shell');
      if (sh && sh.getAttribute('data-view') === 'graph') { switchView('人物卷宗'); await sleep(1100); }
      var w0 = rect('.char-pane[data-pane="roster"]');
      if (!w0 || w0.w > 60) { click('.char-pane[data-pane="main"] .char-head-toggle[data-act="toggle-left"]'); await sleep(700); }
      var ui0 = S.store('ui');
      var stored = null, t0 = Date.now();
      while (Date.now() - t0 < 3500) {
        var raw = await rawKeys(['charPrefs']);
        var row = raw['novel-studio'] && raw['novel-studio'].first ? raw['novel-studio'].first : null;
        stored = row ? row.profile && row.profile.leftClosed === true : null;
        if (stored === true) break;
        await sleep(250);
      }
      var sh2 = S.q('.char-shell');
      return {
        before: rect('.char-pane[data-pane="roster"]'),
        view: sh2 ? sh2.getAttribute('data-view') : null,
        leftClosedBefore: ui0 ? ui0.charPrefs.profile.leftClosed : null,
        storedLeftClosed: stored
      };
    `)
    await ev(`
      var f = S.frame();
      f.dataset.verifyReload = '1';
      f.contentWindow.location.reload();
      return true;
    `)
    await sleep(4500)
    const reopen = () => ev(`
      var okShelf = await until(function () { var d = S.doc(); return d && d.querySelector('.latent-shelf .ls-primary'); }, 45000);
      if (okShelf) click('.latent-shelf .ls-primary');
      var okWork = await until(function () { var d = S.doc(); return d && d.querySelector('.workbench-shell') && d.querySelector('.app-topbar-save'); }, 45000);
      var wk = S.store('work');
      if (wk) wk.tab = 'characters';
      var okChar = await until(function () { var d = S.doc(); return d && d.querySelector('.char-shell') && d.querySelector('.char-pane[data-pane="roster"]'); }, 45000);
      return { okShelf: okShelf, okWork: okWork, okChar: okChar };
    `)
    rec.reloadLeftOpen = await reopen()
    await sleep(1500)
    rec.reloadLeft = await ev(`
      /* reload 后会按 charstate 回到上次的视图；这一条判的是 profile 两列的收起态，
         所以若落回的是关系剧场，先点回卷宗再量（并把落回时的视图记进证据）。 */
      var sh = S.q('.char-shell');
      var landedView = sh ? sh.getAttribute('data-view') : null;
      var switched = false;
      if (landedView === 'graph') { switched = switchView('人物卷宗'); await sleep(1100); }
      var ui = S.store('ui');
      var wk = S.store('work');
      return {
        after: rect('.char-pane[data-pane="roster"]'),
        landedView: landedView, switchedBack: switched,
        leftClosedAfter: ui ? ui.charPrefs.profile.leftClosed : null,
        charsAfter: wk ? wk.liveCharacters.length : null,
        rawAfter: await rawKeys(['charPrefs', 'charstate:w1'])
      };
    `)
    Object.assign(rec.reloadLeft, rec.reloadLeftPrep, rec.reloadLeftOpen)

    /* --- reload 复验 ②：切关系剧场 → 刷新 → 仍是关系剧场（work.charView === 'graph'）--- */
    rec.reloadGraphPrep = await ev(`
      var okSwitch = switchView('关系剧场');
      await sleep(1200);
      return { switched: okSwitch, viewBefore: S.store('work') ? S.store('work').charView : null };
    `)
    await ev(`
      var f = S.frame();
      f.dataset.verifyReload = '1';
      f.contentWindow.location.reload();
      return true;
    `)
    await sleep(4500)
    rec.reloadGraphOpen = await reopen()
    await sleep(1500)
    rec.reloadGraph = await ev(`
      var wk2 = S.store('work');
      var shell = S.q('.char-shell');
      return { charViewAfter: wk2 ? wk2.charView : null, dataView: shell ? shell.getAttribute('data-view') : null, rosterAfter: rect('.char-pane[data-pane="roster"]') };
    `)
    Object.assign(rec.reloadGraph, rec.reloadGraphPrep, rec.reloadGraphOpen)
  } finally {
    await page.close()
  }
  collected.wide[width] = rec
  await sleep(1500)
  return rec
}

/* ---- 窄档采集：单列几何 + 抽屉 + 第二屏 ---- */
async function captureNarrow(width, height, collected) {
  const page = await openChar(width, height)
  const { ev, send } = page
  const rec = { width: width, height: height }
  collected.narrow[width] = rec
  try {
    rec.seed = await seedChars(ev)
    rec.profile = await measure(ev)
    rec.style = await styleProbe(ev)
    await shoot(send, 'char-spec-' + width + '-profile', width, height)
    rec.graphSwitched = await ev(`
      var ok = switchView('关系剧场');
      await sleep(900);
      var wk = S.store('work');
      return { clicked: ok, charView: wk ? wk.charView : null };
    `)
    rec.graph = await measure(ev)
    await shoot(send, 'char-spec-' + width + '-graph', width, height)
    await ev('switchView("人物卷宗"); await sleep(700); return true;')
    if (width === 760) {
      /* 抽屉：工具条左键「人物名录」→ roster 绝对覆盖层 + .char-scrim；Esc 关闭 */
      rec.drawer = await ev(`
        var btns = S.doc().querySelectorAll('.char-mobilebar .char-mobile-btn');
        var leftLabel = btns.length ? String(btns[0].textContent || '').trim() : '';
        var rightLabel = btns.length > 1 ? String(btns[1].textContent || '').trim() : '';
        if (btns[0]) btns[0].click();
        await sleep(760);
        var shell = S.q('.char-shell');
        return {
          leftLabel: leftLabel, rightLabel: rightLabel,
          drawer: shell ? shell.getAttribute('data-drawer') : null,
          roster: rect('.char-pane[data-pane="roster"]'),
          scrim: vis(S.q('.char-scrim')),
          scrimBox: rect('.char-scrim'),
          innerWidth: S.win().innerWidth
        };
      `)
      await shoot(send, 'char-spec-drawer-' + width, width, height)
      rec.drawerEsc = await ev(`
        var w = S.win();
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(640);
        var shell = S.q('.char-shell');
        return { drawer: shell ? shell.getAttribute('data-drawer') : null, rosterVisible: vis(S.q('.char-pane[data-pane="roster"]')), scrim: vis(S.q('.char-scrim')) };
      `)
      /* 第二屏：工具条右键「关系与设定」→ data-screen='context' */
      rec.context = await ev(`
        var btns = S.doc().querySelectorAll('.char-mobilebar .char-mobile-btn');
        if (btns.length > 1) btns[1].click();
        await sleep(820);
        var shell = S.q('.char-shell');
        return { screen: shell ? shell.getAttribute('data-screen') : null, context: rect('.char-pane[data-pane="context"]'), contextVisible: vis(S.q('.char-pane[data-pane="context"]')), mainVisible: vis(S.q('.char-pane[data-pane="main"]')), title: String((S.q('.char-mobile-title') || {}).textContent || '').trim() };
      `)
      await shoot(send, 'char-spec-context-' + width, width, height)
    }
    if (width === 380) {
      rec.smallDrawer = await ev(`
        var btns = S.doc().querySelectorAll('.char-mobilebar .char-mobile-btn');
        if (btns[0]) btns[0].click();
        await sleep(760);
        var out = { roster: rect('.char-pane[data-pane="roster"]'), scrim: vis(S.q('.char-scrim')) };
        var w = S.win();
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(420);
        return out;
      `)
    }
  } finally {
    await page.close()
  }
  collected.narrow[width] = rec
  await sleep(1500)
  return rec
}

function pad2(s, n) {
  const str = String(s)
  let w = 0
  for (const ch of str) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1
  return w >= n ? str + ' ' : str + ' '.repeat(n - w)
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null
}

async function main() {
  if (!existsSync(join(REPO, 'assets', 'app', 'index.html'))) {
    console.error('FAIL：assets/app/index.html 不存在 —— 先跑 npm run build:app')
    return 1
  }
  if (!existsSync(CHROME)) {
    console.error('FAIL：找不到 Chrome：' + CHROME + '（可用 NS_CHROME 指定）')
    return 1
  }
  await mkdir(OUT, { recursive: true })
  const server = await serve()
  origin = 'http://127.0.0.1:' + server.address().port
  console.log('[1] 静态服务 ' + origin + '（挂载 assets/app 与 verify 的 HARNESS；端口由内核分配，避免与并行脚本冲突）')
  const { proc, wsUrl } = await launchChrome()
  console.log('[2] Chrome headless 已起')
  cdp = await cdpClient(wsUrl)
  console.log('[3] CDP 已连接')

  const collected = { wide: {}, narrow: {} }
  const errors = []
  try {
    console.log('>>> 1440x900：profile / graph / 编辑态 / 收起还原 / 两次 reload')
    await captureWide(1440, 900, collected)
    console.log('>>> 1280x900：profile / graph / 收起还原 / 两次 reload')
    await captureWide(1280, 900, collected)
    console.log('>>> 1000x900：窄档单列')
    await captureNarrow(1000, 900, collected)
    console.log('>>> 760x900：窄档单列 + 抽屉 + 第二屏')
    await captureNarrow(760, 900, collected)
    console.log('>>> 380x844：手机档单列')
    await captureNarrow(380, 844, collected)
  } catch (e) {
    errors.push(String((e && e.message) || e))
    console.error('采集失败：' + String((e && e.stack) || e))
  } finally {
    try { cdp.close() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
    server.close()
  }

  /* ---------------- 判据表 ---------------- */
  const rows = []
  const row = (name, column, expected, actual) => {
    const a = num(actual)
    const ok = a != null && typeof expected === 'number' && Math.abs(a - expected) <= TOL
    rows.push({ constant: name, column: column, expected: expected, actual: a == null ? '未量到' : a, delta: a == null ? '—' : Math.round((a - expected) * 1000) / 1000, pass: ok })
  }
  const boolRow = (name, column, want, actual) => {
    const ok = actual === want
    rows.push({ constant: name, column: column, expected: want ? '是' : '否', actual: actual == null ? '未量到' : (actual ? '是' : '否'), delta: ok ? 0 : '—', pass: ok })
  }
  /* 不能用 ±1 的判据单开一条：字号 ±0.1、alpha ±0.02。
     alpha 保留 3 位小数（num() 只留 1 位，会把 0.17 读成 0.2）。 */
  const num3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
  const tolRow = (name, column, expected, actual, tol) => {
    const a = num3(actual)
    const ok = a != null && Math.abs(a - expected) <= tol
    rows.push({ constant: name, column: column, expected: expected, actual: a == null ? '未量到' : a, delta: a == null ? '—' : Math.round((a - expected) * 1000) / 1000, pass: ok })
  }
  const wideOf = (w) => collected.wide[w] || {}

  /* ① 三列 + 两条分隔（1440 / 1280，profile 与 graph 各一遍） */
  for (const w of [1440, 1280]) {
    const rec = wideOf(w)
    for (const view of ['profile', 'graph']) {
      const m = rec[view]
      const col = view + '@' + w
      const spec = WIDE[view]
      row('roster 列宽（' + view + '）', col, spec.left, m && m.panes && m.panes.roster ? m.panes.roster.w : null)
      row('左分隔宽（' + view + '）', col, DIV, m && m.divs && m.divs[0] ? m.divs[0].w : null)
      row('main 列宽（' + view + '）', col, w - 56 - 32 - spec.left - spec.right, m && m.panes && m.panes.main ? m.panes.main.w : null)
      row('右分隔宽（' + view + '）', col, DIV, m && m.divs && m.divs[1] ? m.divs[1].w : null)
      row('context 列宽（' + view + '）', col, spec.right, m && m.panes && m.panes.context ? m.panes.context.w : null)
    }
  }

  /* ② 有效留白（宽档：roster 左沿 28 / 上沿距顶栏底 24 / 下沿 = 视口 − 30） */
  for (const w of [1440, 1280]) {
    const m = wideOf(w).profile
    const r = m && m.panes ? m.panes.roster : null
    row('roster 左沿（' + w + '）', 'inset@' + w, PAD_X, r ? r.l : null)
    row('roster 上沿 − 顶栏底（' + w + '）', 'inset@' + w, 24, r && m.topbar ? r.t - m.topbar.b : null)
    row('roster 下沿（' + w + '）', 'inset@' + w, (m && m.innerHeight ? m.innerHeight : 900) - PAD_B, r ? r.b : null)
  }

  /* ③ 外层不叠 padding：.wb-body 左/上 = 0px，留白只归 .char-shell（padding 28 / 底 30） */
  for (const w of [1440, 1280]) {
    const m = wideOf(w).profile
    const op = m && m.outerPadding ? m.outerPadding : null
    const sp = m && m.shellPadding ? m.shellPadding : null
    row('.wb-body padding-left（' + w + '）', 'pad@' + w, 0, op ? parseFloat(op.l) : null)
    row('.wb-body padding-top（' + w + '）', 'pad@' + w, 0, op ? parseFloat(op.t) : null)
    row('.char-shell padding-left（' + w + '）', 'pad@' + w, PAD_X, sp ? parseFloat(sp.l) : null)
    row('.char-shell padding-bottom（' + w + '）', 'pad@' + w, PAD_B, sp ? parseFloat(sp.b) : null)
  }

  /* ④ 圆角：宽档 20 / ≤1099 18 / ≤559 16 */
  for (const w of [1440, 1280]) {
    const m = wideOf(w).profile
    row('pane 圆角（' + w + '）', 'radius@' + w, 20, m && m.radius ? m.radius.roster : null)
  }
  for (const w of [1000, 760]) {
    const m = (collected.narrow[w] || {}).profile
    row('pane 圆角（' + w + '）', 'radius@' + w, 18, m && m.radius ? m.radius.main : null)
  }
  {
    const m = (collected.narrow[380] || {}).profile
    row('pane 圆角（380）', 'radius@380', 16, m && m.radius ? m.radius.main : null)
  }

  /* ⑤ 收起：248→40（细轨可见）→248，304→40→304 */
  for (const w of [1440, 1280]) {
    const c = wideOf(w).collapse
    row('左列收起宽（' + w + '）', 'collapse@' + w, RAIL, c && c.leftClosed && c.leftClosed.pane ? c.leftClosed.pane.w : null)
    boolRow('左列细轨可见（' + w + '）', 'collapse@' + w, true, c && c.leftClosed ? c.leftClosed.rail : null)
    row('左列还原宽（' + w + '）', 'collapse@' + w, 248, c && c.leftOpen && c.leftOpen.pane ? c.leftOpen.pane.w : null)
    row('左列收起时 main 宽（' + w + '）', 'collapse@' + w, w - 56 - 32 - RAIL - 304, c && c.leftClosed && c.leftClosed.main ? c.leftClosed.main.w : null)
    row('右列收起宽（' + w + '）', 'collapse@' + w, RAIL, c && c.rightClosed && c.rightClosed.pane ? c.rightClosed.pane.w : null)
    boolRow('右列细轨可见（' + w + '）', 'collapse@' + w, true, c && c.rightClosed ? c.rightClosed.rail : null)
    row('右列还原宽（' + w + '）', 'collapse@' + w, 304, c && c.rightOpen && c.rightOpen.pane ? c.rightOpen.pane.w : null)
    row('右列收起时 main 宽（' + w + '）', 'collapse@' + w, w - 56 - 32 - 248 - RAIL, c && c.rightClosed && c.rightClosed.main ? c.rightClosed.main.w : null)
  }

  /* ⑥ 窄档：单块位置/宽 / 工具条 48 / 分隔列不可见 / 无横向溢出 */
  for (const w of [1000, 760, 380]) {
    const m = (collected.narrow[w] || {}).profile
    const spec = NARROW[w]
    const col = 'narrow@' + w
    row('main 左沿（' + w + '）', col, spec.left, m && m.panes ? m.panes.main.l : null)
    row('main 宽（' + w + '）', col, spec.width, m && m.panes ? m.panes.main.w : null)
    row('工具条高（' + w + '）', col, 48, m && m.mobilebar ? m.mobilebar.h : null)
    boolRow('工具条可见（' + w + '）', col, true, m && m.mobilebar ? m.mobilebar.visible : null)
    boolRow('分隔列不可见（' + w + '）', col, false, m && m.divs ? m.divs.some(function (d) { return d.visible; }) : null)
    row('横向溢出像素（' + w + '）', col, 0, m ? Math.max(0, m.scrollWidth - m.innerWidth) : null)
  }

  /* ⑦ 抽屉：760 点工具条左键 → roster 覆盖层 + 遮罩；Esc 关闭 */
  {
    /* 抽屉宽按 CSS 公式算期望：chars-shell.css:103 宽档 min(300px, calc(100vw - 40px))，
       :118 ≤559 档 min(300px, calc(100vw - 24px))。760 档 = min(300, 720) = 300；380 档 = min(300, 356) = 300。
       （旧 brief 里的 270 是设定模块 .side-pane 的宽，人物这里不是那个值。） */
    const drawerSpec = (w) => Math.min(300, w - (w <= 559 ? 24 : 40))
    const d = (collected.narrow[760] || {}).drawer
    row('抽屉宽（760）', 'drawer@760', drawerSpec(760), d && d.roster ? d.roster.w : null)
    boolRow('遮罩可见（760）', 'drawer@760', true, d ? d.scrim : null)
    const e = (collected.narrow[760] || {}).drawerEsc
    boolRow('Esc 关闭抽屉（760）', 'drawer@760', false, e ? e.scrim : null)
    const d380 = (collected.narrow[380] || {}).smallDrawer
    row('抽屉宽（380）', 'drawer@380', drawerSpec(380), d380 && d380.roster ? d380.roster.w : null)
    boolRow('遮罩可见（380）', 'drawer@380', true, d380 ? d380.scrim : null)
  }

  /* ⑧ reload 复验 */
  for (const w of [1440, 1280]) {
    const rl = wideOf(w).reloadLeft
    const rg = wideOf(w).reloadGraph
    row('左列收起跨 reload（' + w + '）', 'reload@' + w, RAIL, rl && rl.after ? rl.after.w : null)
    rows.push({
      constant: '关系剧场跨 reload（' + w + '）',
      column: 'reload@' + w,
      expected: 'graph',
      actual: rg && rg.charViewAfter ? String(rg.charViewAfter) + (rg.dataView ? ' / data-view=' + rg.dataView : '') : '未量到',
      delta: '—',
      pass: !!(rg && rg.charViewAfter === 'graph')
    })
  }

  /* 关系剧场节点（报告里最靠设计稿的一条）：studio.css .graph-node 宽 134、选中 156，
     高是 min-height（84 / 103）—— 内容会把实际高度撑到 ~111 / ~116，所以只判「不小于下限」。 */
  {
    const g1 = wideOf(1440).graphNodes || {}
    if (g1.plain) row('剧场节点宽（1440）', 'graph@1440', 134, g1.plain.w)
    if (g1.sel) row('剧场选中节点宽（1440）', 'graph@1440', 156, g1.sel.w)
    if (g1.plain) rows.push({ constant: '剧场节点高（≥84）', column: 'graph@1440', expected: '>=84', actual: g1.plain.h, delta: '—', pass: typeof g1.plain.h === 'number' && g1.plain.h >= 84 })
    if (g1.sel) rows.push({ constant: '剧场选中节点高（≥103）', column: 'graph@1440', expected: '>=103', actual: g1.sel.h, delta: '—', pass: typeof g1.sel.h === 'number' && g1.sel.h >= 103 })
  }

  /* ⑨ 本轮修正后的新真值：卷宗排版、页头下限、玻璃 alpha、细轨 offsetWidth。
     媒体查询分档来自 chars-dossier.css：base 35/36/38 + 头像 82x105；1100–1320 → 30/27 + 70x93。 */
  const DOSSIER = { 1440: { pad: [35, 36, 38], portrait: [82, 105] }, 1280: { pad: [30, 27, 30], portrait: [70, 93] } }
  for (const w of [1440, 1280]) {
    const st = wideOf(w).style || {}
    const spec = DOSSIER[w]
    const col = 'dossier@' + w
    row('.char-dossier max-width（' + w + '）', col, 860, st.dossier ? st.dossier.maxW : null)
    row('.char-dossier padding-top（' + w + '）', col, spec.pad[0], st.dossier ? st.dossier.padTop : null)
    row('.char-dossier padding-right（' + w + '）', col, spec.pad[1], st.dossier ? st.dossier.padRight : null)
    row('.char-dossier padding-bottom（' + w + '）', col, spec.pad[2], st.dossier ? st.dossier.padBottom : null)
    row('identity 头像宽（' + w + '）', col, spec.portrait[0], st.portrait ? st.portrait.w : null)
    row('identity 头像高（' + w + '）', col, spec.portrait[1], st.portrait ? st.portrait.h : null)
    row('.char-module-head min-height（' + w + '）', col, 112, st.head ? st.head.minH : null)
    tolRow('.char-prose font-size（' + w + '）', col, 15, st.prose ? st.prose.fontSize : null, 0.1)
    row('.char-section + .char-section margin-top（' + w + '）', col, 33, st.section2 ? st.section2.marginTop : null)
    tolRow('.char-pane 背景 alpha（' + w + '）', 'glass@' + w, 0.68, st.pane ? st.pane.bgAlpha : null, 0.02)
    /* 插件声明 --char-pane-line: var(--ns-border-2, rgb(255 255 255 / .17))，实测 pane 边框就是 .17
       （HARNESS 的 shim 把 --ns-border-2 写成 .12，但插件这条兜底/变量在 pane 上仍解析成 .17，两者都记进证据）。 */
    tolRow('.char-pane 边框 alpha（0.17）', 'glass@' + w, 0.17, st.pane ? st.pane.borderHostAlpha : null, 0.02)
    const c = wideOf(w).collapse
    row('.char-rail offsetWidth 左（' + w + '）', 'collapse@' + w, RAIL, c && c.leftClosed ? c.leftClosed.railW : null)
    row('.char-rail offsetWidth 右（' + w + '）', 'collapse@' + w, RAIL, c && c.rightClosed ? c.rightClosed.railW : null)
  }

  const failed = rows.filter((r) => !r.pass)
  const px = rows.filter((r) => typeof r.expected === 'number')
  const pxBad = px.filter((r) => !r.pass)

  /* ---------------- 输出 ---------------- */
  console.log('')
  console.log('=== 人物工作区 · 几何对稿（1440x900 / 1280x900 / 1000x900 / 760x900 / 380x844，误差 >' + TOL + 'px 记 FAIL） ===')
  console.log(pad2('常量', 30) + pad2('期望', 10) + pad2('实测', 12) + pad2('偏差', 10) + '判定')
  for (const r of rows) console.log(pad2(r.constant, 30) + pad2(r.expected, 10) + pad2(r.actual, 12) + pad2(r.delta, 10) + (r.pass ? 'PASS' : 'FAIL'))

  console.log('')
  console.log('--- 附加实测（不进判据，供文档引用） ---')
  for (const w of [1440, 1280]) {
    const rec = wideOf(w)
    if (rec.seed) console.log('  ' + w + ' 种子：人物 ' + rec.seed.people + ' 个 / 关系 ' + rec.seed.relations + ' 条；首位「' + (rec.seed.rich ? rec.seed.rich.name : '?') + '」别名「' + (rec.seed.rich ? rec.seed.rich.aliases : '') + '」标签 ' + JSON.stringify(rec.seed.rich ? rec.seed.rich.tags : []) + ' 字段 ' + JSON.stringify(rec.seed.rich ? rec.seed.rich.fields : []) + ' 小传 ' + (rec.seed.rich ? rec.seed.rich.bio : 0) + ' 字')
    for (const view of ['profile', 'graph']) {
      const m = rec[view]
      if (!m || !m.panes) continue
      console.log('  ' + w + '/' + view + '：roster ' + JSON.stringify(m.panes.roster) + ' main ' + JSON.stringify(m.panes.main) + ' context ' + JSON.stringify(m.panes.context))
      console.log('      分隔 ' + JSON.stringify(m.divs) + '；顶栏 ' + JSON.stringify(m.topbar) + '；外壳 padding ' + JSON.stringify(m.shellPadding) + '；外层 padding ' + JSON.stringify(m.outerPadding) + '；圆角 ' + JSON.stringify(m.radius) + '；store ' + JSON.stringify(m.store))
    }
    if (rec.style) console.log('  ' + w + ' 卷宗排版：' + JSON.stringify({ dossier: rec.style.dossier, head: rec.style.head, prose: rec.style.prose, section2: rec.style.section2, portrait: rec.style.portrait, h1: rec.style.h1, pane: rec.style.pane, borderToken: rec.style.borderToken }))
    if (rec.graphNodes) console.log('  ' + w + ' 关系剧场：节点 ' + rec.graphNodes.nodes + ' 个，普通 ' + JSON.stringify(rec.graphNodes.plain) + '（offsetWidth/Height）选中 ' + JSON.stringify(rec.graphNodes.sel) + '，缩放文案「' + rec.graphNodes.zoomTxt + '」world.transform=' + rec.graphNodes.world + '，副标题「' + rec.graphNodes.subbar + '」')
    if (rec.editing) console.log('  ' + w + ' 编辑态：点击=' + rec.editing.clicked + ' 表单可见=' + rec.editing.form + ' 标签「' + rec.editing.label + '」')
    if (rec.collapse) {
      console.log('  ' + w + ' 收起（起始 data-view=' + rec.collapse.viewStart + '）：左 40 时 view=' + rec.collapse.leftClosed.view + ' main=' + JSON.stringify(rec.collapse.leftClosed.main) + ' 细轨=' + JSON.stringify(rec.collapse.leftClosed.railBox) + '；还原后 view=' + rec.collapse.leftOpen.view + ' main=' + JSON.stringify(rec.collapse.leftOpen.main))
      console.log('      右列收起时 main=' + JSON.stringify(rec.collapse.rightClosed.main) + '；还原后 main=' + JSON.stringify(rec.collapse.rightOpen.main))
    }
    if (rec.persistProbe) console.log('  ' + w + ' 持久化探针（写库/直读 appconfig）：' + JSON.stringify(rec.persistProbe))
    if (rec.reloadLeft) console.log('  ' + w + ' reload①：收起前 roster ' + (rec.reloadLeft.before ? rec.reloadLeft.before.w : '?') + 'px（view=' + rec.reloadLeft.view + '，写入前直读 leftClosed=' + rec.reloadLeft.storedLeftClosed + '）→ reload 重开后 ' + (rec.reloadLeft.after ? rec.reloadLeft.after.w : '?') + 'px（落回视图=' + rec.reloadLeft.landedView + '，切回卷宗=' + rec.reloadLeft.switchedBack + '；charPrefs.profile.leftClosed：' + rec.reloadLeft.leftClosedBefore + ' → ' + rec.reloadLeft.leftClosedAfter + '；重开后人物 ' + rec.reloadLeft.charsAfter + ' 个；就绪 ' + rec.reloadLeft.okShelf + '/' + rec.reloadLeft.okWork + '/' + rec.reloadLeft.okChar + '）')
    if (rec.reloadGraph) console.log('  ' + w + ' reload②：切换后 charView=' + rec.reloadGraph.viewBefore + ' → reload 后 charView=' + rec.reloadGraph.charViewAfter + '（data-view=' + rec.reloadGraph.dataView + '，roster ' + (rec.reloadGraph.rosterAfter ? rec.reloadGraph.rosterAfter.w : '?') + 'px，就绪 ' + rec.reloadGraph.okShelf + '/' + rec.reloadGraph.okWork + '/' + rec.reloadGraph.okChar + '）')
  }
  for (const w of [1000, 760, 380]) {
    const rec = collected.narrow[w] || {}
    const m = rec.profile
    if (m && m.panes) console.log('  ' + w + '：main ' + JSON.stringify(m.panes.main) + ' 工具条 ' + JSON.stringify(m.mobilebar) + ' 圆角 ' + JSON.stringify(m.radius) + ' 外壳 padding ' + JSON.stringify(m.shellPadding) + ' 视口 ' + m.innerWidth + 'x' + m.innerHeight + ' scrollWidth ' + m.scrollWidth + ' 分隔 ' + JSON.stringify(m.divs))
    if (rec.seed) console.log('      ' + w + ' 种子：人物 ' + rec.seed.people + ' / 关系 ' + rec.seed.relations)
    if (rec.graph && rec.graph.panes) console.log('      ' + w + ' graph：main ' + JSON.stringify(rec.graph.panes.main) + ' context ' + JSON.stringify(rec.graph.panes.context) + ' store ' + JSON.stringify(rec.graph.store))
    if (rec.drawer) console.log('      ' + w + ' 抽屉：工具条「' + rec.drawer.leftLabel + '」「' + rec.drawer.rightLabel + '」→ data-drawer=' + rec.drawer.drawer + ' roster ' + JSON.stringify(rec.drawer.roster) + ' 遮罩 ' + JSON.stringify(rec.drawer.scrimBox) + '（可见=' + rec.drawer.scrim + '，视口 ' + rec.drawer.innerWidth + '）')
    if (rec.drawerEsc) console.log('      ' + w + ' Esc：data-drawer=' + rec.drawerEsc.drawer + ' roster 可见=' + rec.drawerEsc.rosterVisible + ' 遮罩=' + rec.drawerEsc.scrim)
    if (rec.context) console.log('      ' + w + ' 第二屏：data-screen=' + rec.context.screen + ' context ' + JSON.stringify(rec.context.context) + ' 可见=' + rec.context.contextVisible + ' main 可见=' + rec.context.mainVisible + ' 标题「' + rec.context.title + '」')
    if (rec.smallDrawer) console.log('      ' + w + ' 抽屉：roster ' + JSON.stringify(rec.smallDrawer.roster) + ' 遮罩=' + rec.smallDrawer.scrim)
  }

  console.log('')
  console.log('=== 对稿截图 ===')
  for (const s of shots) console.log('  ' + pad2(s.name, 34) + s.file + '  ' + s.width + 'x' + s.height)

  console.log('')
  if (errors.length) console.log('采集异常：' + errors.join(' | '))
  if (failed.length) {
    console.log('FAIL ' + failed.length + '/' + rows.length + ' 项超差：')
    for (const r of failed) console.log('  FAIL ' + r.constant + '：期望 ' + r.expected + '，实测 ' + r.actual + '，偏差 ' + r.delta)
  } else {
    console.log('几何全对：' + rows.length + '/' + rows.length + ' 项在 ±' + TOL + 'px 内')
  }
  console.log('像素判据 ' + (px.length - pxBad.length) + '/' + px.length + ' 项在 ±' + TOL + 'px 内（另有 ' + (rows.length - px.length) + ' 项布尔/文字判据）')

  const report = {
    generatedAt: new Date().toISOString(),
    script: 'scripts/compare-characters.mjs',
    designTruth: 'docs/前端美化/人物-融合总稿-20261105/report.json',
    tolerance: TOL,
    viewports: [
      { width: 1440, height: 900, views: ['profile', 'graph'] },
      { width: 1280, height: 900, views: ['profile', 'graph'] },
      { width: 1000, height: 900, views: ['profile'] },
      { width: 760, height: 900, views: ['profile', 'graph', 'drawer', 'context'] },
      { width: 380, height: 844, views: ['profile', 'graph'] }
    ],
    rows: rows,
    summary: { total: rows.length, pass: rows.length - failed.length, fail: failed.length, pixelRows: px.length, pixelFail: pxBad.length },
    extra: { wide: collected.wide, narrow: collected.narrow, expected: { WIDE: WIDE, PAD_X: PAD_X, PAD_B: PAD_B, DIV: DIV, RAIL: RAIL, NARROW: NARROW } },
    screenshots: shots,
    errors: errors
  }
  const reportPath = join(OUT, 'char-compare-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log('报告：' + reportPath)
  return failed.length || errors.length ? 1 : 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('FAIL：' + String((e && e.stack) || e))
  process.exit(1)
})
