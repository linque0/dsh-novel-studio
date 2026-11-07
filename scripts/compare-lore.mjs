/* compare:lore —— 设定面板矩阵的几何对稿（1440×900 为主，760 补抽屉宽）。
 *
 * 与 verify:app 的分工：verify 判「行为与形态」（点得动、收得起、窄档是抽屉），
 * 这里判「数值」——把设计稿常量与真机实测逐项摆在一张表里，误差 > 1px 记为 FAIL。
 *
 * 复用 verify-app.mjs 的浏览器与打开作品方式（同源静态服务 + HARNESS 种库 + CDP），
 * 所以页面状态与 verify:app 完全同源：同一份种子、同一套真点击路径。
 *
 * 产物：.tmp-verify-app/lore-compare-report.json（逐项常量/实测/偏差）
 *       .tmp-verify-app/lore-spec-*.png（对稿截图：A/B/C 三视图 + 三种收起 + 抽屉）
 *
 * 用法：node scripts/compare-lore.mjs   （先 npm run build:app）
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome, cdpClient, serve } from './verify-app.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = resolve(REPO, '.tmp-verify-app')
const VH = 900
const CHROME = process.env.NS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TOL = 1

/* 设计常量出处：docs/前端美化/设定-融合总稿-20261105/
 *   studio.css → .workspace（padding 24 28 30）/ .pane（20px 圆角、1px 亮线）/ .divider（16px）/ .nav-rail（40px）
 *   fusion.css → .fusion-head（105 高）/ .mubu-toolbar（42 高）/ .scope-toggle
 * 三列默认宽 220 / 300 / 348 来自 app/src/components/lore/lore-layout.js 的 LORE_PANE。
 * 抽屉宽 270 来自 studio.css @media(max-width:1099px) 的 .pane.nav。 */
const SPEC = {
  /* 有效留白按「元素位置」判，不按 .lore-shell 的 computed padding 判：
     2026-11-06 出现过 .lore-shell 与 .wb-body/.panel-body 各给一层 padding（有效 56/48 vs 设计 28/24），
     只量 .lore-shell 的 computed padding 永远是绿的。故这里量导航卡左沿与上沿的实际偏移。 */
  'nav 左偏移（1440）': 28,
  'nav 上偏移（1440）': 24,
  'nav 列宽': 220,
  '分隔列宽': 16,
  'pane 圆角': 20,
  'pane 边框 alpha': 0.17,
  '页头 min-height': 105,
  '工具条高': 42,
  '细轨宽': 40,
  '抽屉宽（760）': 270,
  '抽屉 left（760）': 16,
  'list 列宽（B）': 300,
  'detail 列宽（C）': 348
}
const COLUMN_OF = {
  'nav 左偏移（1440）': 'pane-nav',
  'nav 上偏移（1440）': 'pane-nav',
  'nav 列宽': 'pane-nav',
  '分隔列宽': 'divider',
  'pane 圆角': 'pane-main',
  'pane 边框 alpha': 'pane-main',
  '页头 min-height': 'head',
  '工具条高': 'toolbar',
  '细轨宽': 'pane-nav',
  '抽屉宽（760）': 'pane-nav',
  '抽屉 left（760）': 'pane-nav',
  'list 列宽（B）': 'pane-list',
  'detail 列宽（C）': 'pane-detail'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 页面内通用前置：拿到宿主 iframe 的 document/window 与几个量具。 */
const PRE = `
  var S = (function () {
    /* 逐次取帧：reload 之后 contentDocument/Window 都是新对象，
       预先缓存那一份会指向已经卸载的旧文档（量出来全是 0 宽）。 */
    function frame() { return document.getElementById('ns-frame'); }
    function doc() { var f = frame(); return f ? f.contentDocument : null; }
    function win() { var f = frame(); return f ? f.contentWindow : null; }
    function q(s) { var d = doc(); return d ? d.querySelector(s) : null; }
    function vis(n) { if (!n) return false; var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function box(s) { var n = q(s); if (!n) return null; var r = n.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.left * 10) / 10 }; }
    function click(s) { var n = typeof s === 'string' ? q(s) : s; if (!n) return false; try { n.click(); } catch (e) { return false; } return true; }
    function alpha(s) { var m = String(s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; var p = m[1].split(',').map(function (x) { return parseFloat(x); }); return p.length > 3 ? p[3] : 1; }
    function cs(s) { var n = q(s), w = win(); return n && w ? w.getComputedStyle(n) : null; }
    return { frame: frame, doc: doc, win: win, q: q, vis: vis, box: box, click: click, alpha: alpha, cs: cs };
  })();
  var q = S.q, vis = S.vis, box = S.box, click = S.click, alpha = S.alpha, cs = S.cs;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { if (fn()) return true; await sleep(250); } return false; }
`

let cdp = null
let origin = ''

function makeEval(send) {
  return async function ev(body) {
    const expression = '(async function(){' + PRE + body + '})()'
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r && r.exceptionDetails) throw new Error('页面内求值异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r && r.result ? r.result.value : null
  }
}

async function shoot(send, name, width) {
  const st = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: VH, scale: 1 } })
  const file = join(OUT, name + '.png')
  await writeFile(file, Buffer.from(st.data, 'base64'))
  return { name: name + '.png', file: file, width, height: VH }
}

/* 局部特写：把 clip 收在某个元素周围（集头近景 / 改名输入框态用）。 */
async function shootClip(send, name, clip) {
  const w = Math.max(40, Math.round(clip.width))
  const h = Math.max(40, Math.round(clip.height))
  const st = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(clip.x), y: Math.round(clip.y), width: w, height: h, scale: 1 } })
  const file = join(OUT, name + '.png')
  await writeFile(file, Buffer.from(st.data, 'base64'))
  return { name: name + '.png', file: file, width: w, height: h }
}

/* 第三轮：集头几何 + 滚动条两态。
   .ob-editor 用 --lore-pad-x（34 / ≤1099 20 / ≤559 14）+ scrollbar-gutter: stable，
   .mubu-set-head 用 margin: 0 calc(-1*var(--lore-pad-x)) 抵消内距横贯写区 ——
   所以集头相对 .write-surface 的左右内缩应各为 0，且「有滚动条 / 无滚动条」两态下宽度不变。
   （旧实现写死 -34/-20/-14，且只在一层样式里改，沟槽一出现集头就窄 15px。） */
async function collectSetHead(page, width, collected) {
  const { ev } = page
  collected.setHead = collected.setHead || {}
  collected.setHead[width] = await ev(`
    var appEl = S.doc().querySelector('#app');
    var pin = appEl && appEl.__vue_app__ ? appEl.__vue_app__.config.globalProperties.$pinia : null;
    var ui = pin ? pin._s.get('ui') : null;
    if (ui) {
      if (ui.loreView !== 'write') { ui.setLoreView('write'); await sleep(600); }
      if (ui.loreScope !== 'all') { await ui.setPref('loreScope', 'all'); await sleep(640); }
    }
    await sleep(240);
    function rect(n) { if (!n) return null; var r = n.getBoundingClientRect(); return { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }
    var surf = rect(S.q('.write-surface'));
    var heads = [];
    Array.prototype.forEach.call(S.doc().querySelectorAll('.mubu-set-head'), function (h) { if (h.getBoundingClientRect().width > 0) heads.push(h); });
    if (!surf || !heads.length) return { error: '未找到 .write-surface / 可见 .mubu-set-head', heads: heads.length };
    var h0 = rect(heads[0]);
    var ed = S.q('.ob-editor');
    var gutter = ed ? cs('.ob-editor').scrollbarGutter : null;
    var withBar = { headW: h0.w, clientW: ed ? ed.clientWidth : -1, scrollH: ed ? ed.scrollHeight : -1, clientH: ed ? ed.clientHeight : -1 };
    heads[0].classList.add('__ns_keep_head');
    var st2 = S.doc().createElement('style');
    st2.id = '__ns_noscroll';
    st2.textContent = '.ob-editor .ob-row{display:none!important}'
      + '.ob-editor .mubu-set-head:not(.__ns_keep_head){display:none!important}';
    S.doc().head.appendChild(st2);
    await sleep(300);
    var h1b = rect(heads[0]);
    var ed2 = S.q('.ob-editor');
    var noBar = { headW: h1b ? h1b.w : -1, clientW: ed2 ? ed2.clientWidth : -1, scrollH: ed2 ? ed2.scrollHeight : -1 };
    if (st2.parentNode) st2.parentNode.removeChild(st2);
    heads[0].classList.remove('__ns_keep_head');
    await sleep(220);
    return {
      surf: surf, head: h0, headCount: heads.length, gutter: gutter,
      leftIn: Math.round((h0.l - surf.l) * 10) / 10,
      rightIn: Math.round((surf.r - h0.r) * 10) / 10,
      withBar: withBar, noBar: noBar,
      gutterDelta: Math.round((noBar.headW - withBar.headW) * 10) / 10
    };
  `)
  return collected.setHead[width]
}

/* 打开一次设定场景：HARNESS 用应用自己的 store 种库 → 打开作品 → 切到设定页 → 跑完 verify 探针
   （探针收尾会把视图/范围/列宽复原成默认写视图），随后才在干净状态上量。 */
async function openLore(width) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => cdp.send(m, p, sessionId)
  const ev = makeEval(send)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height: VH, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: origin + '/harness.html?module=lore&vw=' + width })
  const deadline = Date.now() + 180000
  let ready = false
  while (Date.now() < deadline) {
    await sleep(400)
    const r = await send('Runtime.evaluate', { expression: 'window.__NS_VERIFY_RESULT || null', returnByValue: true })
    if (r && r.result && r.result.value) { ready = true; break }
  }
  if (!ready) throw new Error('180s 内页面没到可测状态（vw=' + width + '）')
  /* HARNESS 的 iframe 高度写死 860；对稿窗口是 900，这里把它拉上去再派一次 resize。 */
  await ev(`
    var f = document.getElementById('ns-frame');
    f.style.height = '` + VH + `px';
    try { f.contentWindow.dispatchEvent(new f.contentWindow.Event('resize')); } catch (e) {}
    await sleep(500);
    return true;
  `)
  return { targetId, send, ev, close: () => cdp.send('Target.closeTarget', { targetId }).catch(() => {}) }
}

/* ---- 宽档采集：A/B/C 三视图 + 三种收起 + reload 复验 ---- */
async function captureWide(width, prefix, shots, collected) {
  const page = await openLore(width)
  const { ev, send } = page
  try {
    collected.wide[width] = await ev(`
      var wb = cs('.wb-body');
      var main = box('.lore-pane[data-pane="main"]');
      var mcs = cs('.lore-pane[data-pane="main"]');
      var ncs = cs('.lore-pane[data-pane="nav"]');
      var head = box('.lore-head');
      var hcs = cs('.lore-head');
      var tb = box('.ob-toolbar');
      var shell = S.q('.lore-shell');
      var scs = cs('.lore-shell');
      var dv = S.q('.lore-divider[data-size="nav"]');
      /* 有效留白：导航卡的视口位置 vs 顶栏底部；外加两层的 computed padding（只作证据）。 */
      var navR = S.q('.lore-pane[data-pane="nav"]');
      var navB = navR ? navR.getBoundingClientRect() : null;
      var barEl = S.q('.app-topbar');
      var barB = barEl ? barEl.getBoundingClientRect() : null;
      var outerCs = cs('.wb-body') || cs('.panel-body');
      return {
        view: shell ? shell.getAttribute('data-view') : null,
        shellCols: scs ? scs.gridTemplateColumns : null,
        shellGap: scs ? scs.columnGap : null,
        padding: wb ? { t: parseFloat(wb.paddingTop), r: parseFloat(wb.paddingRight), b: parseFloat(wb.paddingBottom), l: parseFloat(wb.paddingLeft) } : null,
        panes: { nav: box('.lore-pane[data-pane="nav"]'), main: main, list: box('.lore-pane[data-pane="list"]'), detail: box('.lore-pane[data-pane="detail"]') },
        divider: dv ? { w: box('.lore-divider[data-size="nav"]').w, role: dv.getAttribute('role'), now: dv.getAttribute('aria-valuenow') } : null,
        radius: { main: mcs ? parseFloat(mcs.borderTopLeftRadius) : null, nav: ncs ? parseFloat(ncs.borderTopLeftRadius) : null },
        border: { color: mcs ? mcs.borderTopColor : null, alpha: mcs ? alpha(mcs.borderTopColor) : null, width: mcs ? mcs.borderTopWidth : null },
        head: { h: head ? head.h : null, minH: hcs ? parseFloat(hcs.minHeight) : null },
        toolbar: { h: tb ? tb.h : null },
        offsets: {
          navLeft: navB ? Math.round(navB.left * 10) / 10 : null,
          navTop: navB ? Math.round(navB.top * 10) / 10 : null,
          topbarBottom: barB ? Math.round(barB.bottom * 10) / 10 : null,
          shellPaddingLeft: scs ? scs.paddingLeft : null,
          outerPaddingLeft: outerCs ? outerCs.paddingLeft : null,
          outerPaddingTop: outerCs ? outerCs.paddingTop : null
        }
      };
    `)
    shots.push(await shoot(send, prefix + '-A', width))

    await ev(`click('.lore-switch button[data-lore-view="detail"]'); await sleep(460); return true;`)
    collected.detail = await ev(`
      var sh = S.q('.lore-shell');
      /* 第三轮：阅读区那颗回列表 pill（.lore-detail-return .lore-mobile-back）只在窄档渲染，
         宽档 :list-back="narrow" 为 false → 0 个。这里在 B 视图（阅读区在场）里量，量在写视图里没有意义。 */
      var pills = S.doc().querySelectorAll('.lore-detail-return .lore-mobile-back');
      var pill = pills.length ? pills[0] : null;
      return { screen: sh ? sh.getAttribute('data-view') : null, list: box('.lore-pane[data-pane="list"]'), nav: box('.lore-pane[data-pane="nav"]'), h1: (S.q('.lore-h1') || {}).textContent,
        pill: { count: pills.length, visible: pill ? S.vis(pill) : false, text: pill ? String(pill.textContent || '').trim() : null } };
    `)
    collected.pill = collected.pill || {}
    collected.pill[width] = collected.detail && collected.detail.pill ? collected.detail.pill : null
    shots.push(await shoot(send, prefix + '-B', width))

    await ev(`click('.lore-switch button[data-lore-view="map"]'); await sleep(560); return true;`)
    collected.map = await ev(`
      var sh = S.q('.lore-shell');
      return { screen: sh ? sh.getAttribute('data-view') : null, detail: box('.lore-pane[data-pane="detail"]'), h1: (S.q('.lore-h1') || {}).textContent };
    `)
    shots.push(await shoot(send, prefix + '-C', width))

    /* 第四轮：关系网络 / 全部设定总览两组采集 —— 只在 1440 档采一次（这两组判的是形态与数量，
      与规格常量无关，逐档重复采只会拉长跑时）。位置在 reload 与「默认集」之前：那时 work store 还是种子作品。 */
    if (width === 1440) await collectGraphGroups(page, shots, collected)

    /* 第三轮：集头几何（左右内缩 / 宽度 / 滚动条两态）+ 1280 的集头近景与改名输入框态。
       collectSetHead 结束把 scope 复原成 set，后面的「三种收起」截图与上一轮同态。 */
    collected.setHead = collected.setHead || {}
    const setHead = await collectSetHead(page, width, collected)
    if (width === 1280 && setHead && !setHead.error) {
      const clip = {
        x: Math.max(0, setHead.head.l - 16),
        y: Math.max(0, setHead.head.t - 16),
        width: Math.min(width, setHead.head.w + 32),
        height: Math.max(120, setHead.head.h * 2.4)
      }
      shots.push(await shootClip(send, 'lore-v3-sethead-' + width, clip))
      /* 单击集名 = 进入改名：输入框聚焦并全选。拍完按 Esc 取消，名字与数据都不动。 */
      await ev(`
        try { S.win().focus(); } catch (e) { /* ignore */ }
        var n = S.q('.mubu-set-head .ls-name');
        if (n) n.click();
        await sleep(320);
        var inp = S.q('.mubu-set-head .ls-input');
        return { input: !!inp, active: inp ? S.doc().activeElement === inp : false, sel: inp ? [inp.selectionStart, inp.selectionEnd] : null, value: inp ? inp.value : null };
      `)
      const hb = await ev(`
        var h = S.q('.mubu-set-head');
        if (!h) return null;
        var r = h.getBoundingClientRect();
        return { l: r.left, t: r.top, w: r.width, h: r.height };
      `)
      if (hb) {
        shots.push(await shootClip(send, 'lore-v3-rename-' + width, {
          x: Math.max(0, hb.l - 16),
          y: Math.max(0, hb.t - 16),
          width: Math.min(width, hb.w + 32),
          height: Math.max(120, hb.h * 2.4)
        }))
      }
      await ev(`var W2 = S.win(); var inp2 = S.q('.mubu-set-head .ls-input'); if (inp2 && W2) inp2.dispatchEvent(new W2.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await sleep(320); return true;`)
    }
    await ev(`
      var appEl2 = S.doc().querySelector('#app');
      var pin2 = appEl2 && appEl2.__vue_app__ ? appEl2.__vue_app__.config.globalProperties.$pinia : null;
      var ui2 = pin2 ? pin2._s.get('ui') : null;
      if (ui2 && ui2.loreScope !== 'set') await ui2.setPref('loreScope', 'set');
      if (ui2 && ui2.loreView !== 'write') ui2.setLoreView('write');
      await sleep(520);
      return true;
    `)

    /* 三种收起各一张：nav / list / detail。 */
    await ev(`click('.lore-switch button[data-lore-view="write"]'); await sleep(460); click('.nav-collapse'); await sleep(480); return true;`)
    collected.closedNav = await ev(`
      return { nav: box('.lore-pane[data-pane="nav"]'), rail: box('.lore-pane[data-pane="nav"] .lore-rail'), railText: (S.q('.lore-pane[data-pane="nav"] .lore-rail span') || {}).textContent };
    `)
    shots.push(await shoot(send, 'lore-spec-navclosed-' + width, width))

    await ev(`
      click('.lore-pane[data-pane="nav"] .lore-rail'); await sleep(440);
      click('.lore-switch button[data-lore-view="detail"]'); await sleep(480);
      click('.lore-detail-list-head .lore-icon'); await sleep(480);
      return true;
    `)
    collected.closedList = await ev(`return { list: box('.lore-pane[data-pane="list"]'), rail: box('.lore-pane[data-pane="list"] .lore-rail') };`)
    shots.push(await shoot(send, 'lore-spec-listclosed-' + width, width))

    await ev(`
      click('.lore-pane[data-pane="list"] .lore-rail'); await sleep(440);
      click('.lore-switch button[data-lore-view="map"]'); await sleep(520);
      click('.lore-map-insp-close'); await sleep(480);
      return true;
    `)
    collected.closedDetail = await ev(`return { detail: box('.lore-pane[data-pane="detail"]'), rail: box('.lore-pane[data-pane="detail"] .lore-rail') };`)
    shots.push(await shoot(send, 'lore-spec-detailclosed-' + width, width))

    /* 真 reload 复验：收起 nav → 刷 iframe → 重新打开作品与设定页 → 仍应是 40。
       （verify:app 里只读 appconfig 行：reload 会换掉那个场景的页面语境，所以放在这里做。） */
    collected.reload = await ev(`
      click('.lore-pane[data-pane="detail"] .lore-rail'); await sleep(420);
      click('.lore-switch button[data-lore-view="write"]'); await sleep(420);
      click('.nav-collapse'); await sleep(480);
      var before = box('.lore-pane[data-pane="nav"]');
      S.frame().contentWindow.location.reload();
      var okShelf = await until(function () { var d2 = document.getElementById('ns-frame').contentDocument; return d2 && d2.querySelector('.latent-shelf .ls-primary'); }, 90000);
      await sleep(500);
      click('.latent-shelf .ls-primary');
      var okWork = await until(function () { var d2 = document.getElementById('ns-frame').contentDocument; return d2 && d2.querySelector('.workbench-shell') && d2.querySelector('.app-topbar-save'); }, 90000);
      var dd = S.doc();
      var appEl = dd ? dd.querySelector('#app') : null;
      var pin = appEl && appEl.__vue_app__ ? appEl.__vue_app__.config.globalProperties.$pinia : null;
      if (pin) pin._s.get('work').tab = 'lore';
      var okLore = await until(function () { var d2 = S.doc(); return d2 && d2.querySelector('.lore-shell'); }, 60000);
      await sleep(800);
      var after = box('.lore-pane[data-pane="nav"]');
      var st = pin ? pin._s.get('ui') : null;
      return { before: before, after: after, storeClosed: st ? st.loreNavClosed : null, okShelf: okShelf, okWork: okWork, okLore: okLore };
    `)
    await ev(`click('.lore-pane[data-pane="nav"] .lore-rail'); await sleep(520); return true;`)

    /* 默认设定集 + 类型体系：用应用自己的 store 新建一部空作品（raw IndexedDB 里预建 mubu 行会被 Dexie 升级清空），
       打开设定后 onMounted 的 ensureDefaultMubuSets() 应建出六个默认集；截图取这份六行的真实渲染。 */
    collected.kinds = await ev(`
      var app = S.doc().querySelector('#app');
      var pin = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$pinia : null;
      if (!pin) return { error: 'pinia 取不到' };
      var shelf = pin._s.get('shelf'), wk = pin._s.get('work');
      if (!shelf || !wk) return { error: 'shelf/work store 缺失' };
      var made = await shelf.createWork({ title: '对稿空作品', withVolume: false });
      await wk.open(made.id);
      await sleep(320);
      /* 新作品先带 5 个旧设定集（lorecats 迁移），零集状态靠 store 软删清空；之后再重进设定页触发默认六集。 */
      var legacy = wk.mubuRoots().map(function (n) { return String(n.text || ''); });
      wk.mubuRoots().forEach(function (r) { wk.mubuRemove(r.id); });
      await sleep(260);
      wk.tab = 'lore';
      var t0 = Date.now();
      function rowN() { var d = S.doc(); return d ? d.querySelectorAll('.lore-pane[data-pane="nav"] .category:not(.all-scope)').length : 0; }
      while (Date.now() - t0 < 8000 && rowN() < 6) await sleep(200);
      await sleep(320);
      var rows = S.doc().querySelectorAll('.lore-pane[data-pane="nav"] .category:not(.all-scope)');
      var out = { count: rows.length, kinds: [], names: [], iconD: [], legacySeed: legacy };
      Array.prototype.forEach.call(rows, function (r) {
        out.kinds.push(r.getAttribute('data-kind'));
        var sp = r.querySelector('span');
        out.names.push(sp ? String(sp.textContent || '').trim() : '');
        var ds = [];
        Array.prototype.forEach.call(r.querySelectorAll('svg path'), function (p) { ds.push(String(p.getAttribute('d') || '')); });
        out.iconD.push(ds.join('|'));
      });
      var uniq = {}, n = 0;
      out.iconD.forEach(function (d) { if (d && !uniq[d]) { uniq[d] = 1; n++; } });
      out.distinctIcon = n;
      return out;
    `)
    shots.push(await shoot(send, 'lore-v3-kinds-' + width, width))
  } finally {
    await page.close()
  }
}

/* ---- 窄档采集：A / B（正文屏）/ C 三视图 + 移动栏 + 抽屉 ----
   B 默认屏在 2026-11-06 第二轮改成 main（旧判据停在 list），移动栏只在窄档存在：三段文案与高度都记进 collected。 */
async function captureNarrow(width, prefix, shots, collected) {
  const page = await openLore(width)
  const { ev, send } = page
  try {
    shots.push(await shoot(send, prefix + '-A', width))
    await ev(`click('.lore-switch button[data-lore-view="detail"]'); await sleep(520); return true;`)
    collected.narrowB = await ev(`
      var sh = S.q('.lore-shell');
      /* 第三轮：窄档移动栏 .lore-mobile-bar 已删，回列表入口改成阅读区里那颗 pill
         （.lore-detail-return .lore-mobile-back，「条目列表」，:list-back="narrow"）。 */
      var pills = S.doc().querySelectorAll('.lore-detail-return .lore-mobile-back');
      var pill = pills.length ? pills[0] : null;
      return {
        screen: sh ? sh.getAttribute('data-screen') : null,
        list: box('.lore-pane[data-pane="list"]'),
        main: box('.lore-pane[data-pane="main"]'),
        mainVisible: vis(S.q('.lore-pane[data-pane="main"]')),
        listVisible: vis(S.q('.lore-pane[data-pane="list"]')),
        navW: box('.lore-pane[data-pane="nav"]') ? box('.lore-pane[data-pane="nav"]').w : null,
        pill: { count: pills.length, visible: pill ? vis(pill) : false, text: pill ? String(pill.textContent || '').trim() : null },
        detail: { head: vis(S.q('.lore-pane[data-pane="main"] > .lore-head')), h1: (S.q('.lore-h1') || {}).textContent, switchN: S.doc().querySelectorAll('.lore-switch button').length, title: (S.q('.lore-detail-title') || {}).textContent, footer: vis(S.q('.lore-detail-footer')) }
      };
    `)
    shots.push(await shoot(send, prefix + '-B', width))
    collected.pill = collected.pill || {}
    collected.pill[width] = collected.narrowB && collected.narrowB.pill ? collected.narrowB.pill : null

    /* 第三轮：pill 真点击两条（进列表屏 → 点条目回正文屏）。旧「移动栏真点击」随 .lore-mobile-btn 一起删掉。 */
    collected.pillTap = await ev(`
      var pills = S.doc().querySelectorAll('.lore-detail-return .lore-mobile-back');
      var t0 = (S.q('.lore-detail-title') || {}).textContent;
      var pillText = pills[0] ? String(pills[0].textContent || '').trim() : '(缺)';
      if (pills[0]) pills[0].click();
      await sleep(440);
      var sh = S.q('.lore-shell');
      var inList = { screen: sh ? sh.getAttribute('data-screen') : null, listVisible: vis(S.q('.lore-pane[data-pane="list"]')), mainVisible: vis(S.q('.lore-pane[data-pane="main"]')), pillText: pillText };
      var cands = S.doc().querySelectorAll('.lore-detail-entries .lore-detail-entry');
      var pick = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var nm = String(cands[ci].getAttribute('title') || cands[ci].textContent || '').trim();
        if (nm && nm !== t0) { pick = cands[ci]; break; }
      }
      if (!pick && cands.length) pick = cands[0];
      if (pick) pick.click();
      await sleep(460);
      var sh2 = S.q('.lore-shell');
      var t1 = (S.q('.lore-detail-title') || {}).textContent;
      return { inList: inList, back: { screen: sh2 ? sh2.getAttribute('data-screen') : null, mainVisible: vis(S.q('.lore-pane[data-pane="main"]')), titleChanged: t0 !== t1, from: t0, to: t1 } };
    `)

    await ev(`click('.lore-crumb-nav'); await sleep(520); return true;`)
    collected.drawer = await ev(`
      var sh = S.q('.lore-shell');
      var nr = S.q('.lore-pane[data-pane="nav"]');
      var nrb = nr ? nr.getBoundingClientRect() : null;
      return {
        nav: box('.lore-pane[data-pane="nav"]'),
        left: nrb ? Math.round(nrb.left * 10) / 10 : null,
        top: nrb ? Math.round(nrb.top * 10) / 10 : null,
        scrim: vis(S.q('.lore-scrim')),
        drawer: sh ? sh.getAttribute('data-drawer') : null
      };
    `)
    shots.push(await shoot(send, 'lore-v3-drawer-' + width, width))
    await ev(`click('.lore-scrim'); await sleep(420); return true;`)

    /* 第三轮：窄档也量集头（write 视图 + all 范围），量完把 scope 复原成 set 再走导图。 */
    await collectSetHead(page, width, collected)
    await ev(`
      var appEl3 = S.doc().querySelector('#app');
      var pin3 = appEl3 && appEl3.__vue_app__ ? appEl3.__vue_app__.config.globalProperties.$pinia : null;
      var ui3 = pin3 ? pin3._s.get('ui') : null;
      if (ui3 && ui3.loreScope !== 'set') await ui3.setPref('loreScope', 'set');
      await sleep(520);
      return true;
    `)

    await ev(`click('.lore-switch button[data-lore-view="map"]'); await sleep(560); return true;`)
    collected.mapNarrow = await ev(`
      var sh = S.q('.lore-shell');
      /* C 视图的两颗 pill 保留：导图子条「摘要」→ 摘要屏；摘要屏「‹ 视觉导图」→ 回导图主屏。 */
      var sub = S.q('.lore-map-subbar .lore-mobile-back');
      var back = S.q('.lore-pane[data-pane="detail"] .lore-mobile-back');
      var out = { screen: sh ? sh.getAttribute('data-screen') : null, subbarText: sub ? String(sub.textContent || '').trim() : '(缺)', backText: back ? String(back.textContent || '').trim() : '(缺)' };
      if (sub) sub.click();
      await sleep(460);
      var sh2 = S.q('.lore-shell');
      out.afterTap = { screen: sh2 ? sh2.getAttribute('data-screen') : null, inspVisible: vis(S.q('.lore-pane[data-pane="detail"]')) };
      var back2 = S.q('.lore-pane[data-pane="detail"] .lore-mobile-back');
      if (back2) back2.click();
      await sleep(440);
      var sh3 = S.q('.lore-shell');
      out.backMain = { screen: sh3 ? sh3.getAttribute('data-screen') : null, mainVisible: vis(S.q('.lore-pane[data-pane="main"]')) };
      return out;
    `)
    shots.push(await shoot(send, prefix + '-C', width))
    collected.byWidth[width] = { b: collected.narrowB, tap: collected.pillTap, drawer: collected.drawer, map: collected.mapNarrow }
  } finally {
    await page.close()
  }
}

/* ---- 第四轮：关系网络 / 全部设定总览两组采集 ----
   数据用应用自己的 store 造（addLoreLink / addCharacter），不碰 raw IndexedDB；量四样东西：
   节点数、边数、副标题，以及点「适应」后节点矩形超出画布的最大像素 ——
   越界像素是「卡片掉出画布 / 空态与卡片叠字」最直接的量具（0 就是没出界）。 */
async function collectGraphGroups(page, shots, collected) {
  const { ev, send } = page
  collected.relations = await ev(`
    var appEl = S.doc().querySelector('#app');
    var pin = appEl && appEl.__vue_app__ ? appEl.__vue_app__.config.globalProperties.$pinia : null;
    var wk = pin ? pin._s.get('work') : null;
    var ui = pin ? pin._s.get('ui') : null;
    if (!wk || !ui) return { error: 'work/ui store 缺失' };
    var root = wk.currentMubuRoot();
    var entries = root ? wk.mubuDescendants(root.id) : [];
    if (entries.length < 3) return { error: '当前集条目不足 3（' + entries.length + '）' };
    var a = entries[0], b = entries[1], c = entries[2];
    var ch = wk.liveCharacters[0];
    if (!ch) { ch = wk.addCharacter('对稿关系人物'); wk.tab = 'lore'; await sleep(560); }
    wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'mubu', toId: b.id, label: '同行' });
    wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'mubu', toId: c.id, label: '同门' });
    wk.addLoreLink({ fromKind: 'mubu', fromId: a.id, toKind: 'character', toId: ch.id, label: '门生' });
    ui.loreActiveId = a.id;
    await sleep(320);
    click('.lore-switch button[data-lore-view="map"]');
    await sleep(460);
    var tabs = S.doc().querySelectorAll('.lore-map-modes button');
    for (var i = 0; i < tabs.length; i++) { if (String(tabs[i].textContent || '').trim() === '关系网络') { tabs[i].click(); break; } }
    await sleep(640);
    function rect(n) { var r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
    var nodes = S.doc().querySelectorAll('.lg-node');
    var edges = S.doc().querySelectorAll('.lg-edges path:not(.lg-edge-hit)');
    var labels = [];
    Array.prototype.forEach.call(S.doc().querySelectorAll('.lg-elabel'), function (n) { labels.push(String(n.textContent || '').trim()); });
    var fitBtn = S.q('.lore-map-foot button[title="适应当前内容"]');
    if (fitBtn) fitBtn.click();
    await sleep(640);
    var wrapEl = S.q('.lg-canvas');
    var wr = wrapEl ? rect(wrapEl) : null;
    var over = 0;
    Array.prototype.forEach.call(S.doc().querySelectorAll('.lg-node'), function (n) {
      if (!wr) return;
      var r = rect(n);
      over = Math.max(over, 0, wr.l - r.l, r.r - wr.r, wr.t - r.t, r.b - wr.b);
    });
    var entriesNow = wk.loreLinksOf('mubu', a.id);
    var seen = {}, expNodes = 1;
    entriesNow.forEach(function (e) { var k = e.otherKind + ':' + e.otherId; if (!seen[k]) { seen[k] = 1; expNodes++; } });
    return {
      center: String(a.text || '').trim(),
      nodeDom: nodes.length, edgeDom: edges.length,
      expectedNodes: expNodes, expectedEdges: entriesNow.length,
      labels: labels,
      subtitle: String((S.q('.lore-map-context') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      countTxt: String((S.q('.lg-toolbar .oc-count') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      overflowPx: Math.round(over * 10) / 10,
      canvas: wr ? { w: Math.round(wr.w * 10) / 10, h: Math.round(wr.h * 10) / 10 } : null
    };
  `)
  shots.push(await shoot(send, 'lore-cmp-relations-1440', 1440))

  collected.hierarchyAll = await ev(`
    var appEl2 = S.doc().querySelector('#app');
    var pin2 = appEl2 && appEl2.__vue_app__ ? appEl2.__vue_app__.config.globalProperties.$pinia : null;
    var wk2 = pin2 ? pin2._s.get('work') : null;
    var ui2 = pin2 ? pin2._s.get('ui') : null;
    if (!wk2 || !ui2) return { error: 'work/ui store 缺失' };
    if (ui2.loreScope !== 'all') await ui2.setPref('loreScope', 'all');
    await sleep(780);
    var tabs2 = S.doc().querySelectorAll('.lore-map-modes button');
    for (var j = 0; j < tabs2.length; j++) { if (String(tabs2[j].textContent || '').trim() === '层级导图') { tabs2[j].click(); break; } }
    await sleep(640);
    var roots = wk2.mubuRoots();
    var desc = 0;
    roots.forEach(function (r) { desc += wk2.mubuDescendants(r.id).length; });
    var nodeDom = S.doc().querySelectorAll('.lore-tm-node').length;
    var edgeDom = S.doc().querySelectorAll('.lore-tm-edge').length;
    var subtitle = String((S.q('.lore-map-context') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    var fitBtn2 = S.q('.lore-map-foot button[title="适应当前内容"]');
    if (fitBtn2) fitBtn2.click();
    await sleep(640);
    var wrapEl2 = S.q('.lore-tm-wrap');
    var wr2 = wrapEl2 ? wrapEl2.getBoundingClientRect() : null;
    var over2 = 0;
    Array.prototype.forEach.call(S.doc().querySelectorAll('.lore-tm-node'), function (n) {
      if (!wr2) return;
      var r = n.getBoundingClientRect();
      over2 = Math.max(over2, 0, wr2.left - r.left, r.right - wr2.right, wr2.top - r.top, r.bottom - wr2.bottom);
    });
    return {
      roots: roots.length, entries: desc,
      expectedNodes: roots.length + desc, expectedEdges: desc,
      nodeDom: nodeDom, edgeDom: edgeDom, subtitle: subtitle,
      overflowPx: Math.round(over2 * 10) / 10,
      wrap: wr2 ? { w: Math.round(wr2.width * 10) / 10, h: Math.round(wr2.height * 10) / 10 } : null
    };
  `)
  shots.push(await shoot(send, 'lore-cmp-hierarchy-all-1440', 1440))
  return collected
}

function cmp(rows, name, actual) {
  const expected = SPEC[name]
  const delta = actual == null ? null : Math.round((actual - expected) * 1000) / 1000
  const ok = actual != null && Math.abs(delta) <= TOL
  rows.push({ constant: name, column: COLUMN_OF[name], expected: expected, actual: actual == null ? '未量到' : actual, delta: delta == null ? '—' : delta, pass: ok })
}

function pad2(s, n) {
  const str = String(s)
  let w = 0
  for (const ch of str) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1
  return w >= n ? str + ' ' : str + ' '.repeat(n - w)
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
  console.log('[1] 静态服务 ' + origin + '（挂载 assets/app 与 verify 的 HARNESS）')
  const { proc, wsUrl } = await launchChrome()
  console.log('[2] Chrome headless 已起')
  cdp = await cdpClient(wsUrl)
  console.log('[3] CDP 已连接')

  const shots = []
  const collected = { wide: {}, detail: null, map: null, closedNav: null, closedList: null, closedDetail: null, reload: null, narrowB: null, drawer: null, kinds: null, pillTap: null, mapNarrow: null, pill: {}, setHead: {}, byWidth: {} }
  const errors = []
  try {
    console.log('>>> 1440x900：宽档几何 + A/B/C + 三种收起 + reload 复验 + 默认集类型')
    await captureWide(1440, 'lore-v3-1440', shots, collected)
    console.log('>>> 1280x900：A/B/C + 默认集类型')
    await captureWide(1280, 'lore-v3-1280', shots, collected)
    console.log('>>> 1000：A/B/C + pill + 抽屉')
    await captureNarrow(1000, 'lore-v3-1000', shots, collected)
    console.log('>>> 760：A/B/C + pill + 抽屉')
    await captureNarrow(760, 'lore-v3-760', shots, collected)
    console.log('>>> 380：A/B/C + pill')
    await captureNarrow(380, 'lore-v3-380', shots, collected)
  } catch (e) {
    errors.push(String(e && e.message || e))
    console.error('采集失败：' + String(e && e.stack || e))
  } finally {
    try { cdp.close() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
    server.close()
  }

  const w1440 = collected.wide[1440] || {}
  const rows = []
  const off = w1440.offsets || {}
  if (off.navLeft != null) cmp(rows, 'nav 左偏移（1440）', off.navLeft)
  if (off.navTop != null && off.topbarBottom != null) cmp(rows, 'nav 上偏移（1440）', Math.round((off.navTop - off.topbarBottom) * 10) / 10)
  if (w1440.panes && w1440.panes.nav) cmp(rows, 'nav 列宽', w1440.panes.nav.w)
  if (w1440.divider) cmp(rows, '分隔列宽', w1440.divider.w)
  if (w1440.radius) cmp(rows, 'pane 圆角', w1440.radius.main)
  if (w1440.border) cmp(rows, 'pane 边框 alpha', w1440.border.alpha)
  if (w1440.head) cmp(rows, '页头 min-height', w1440.head.minH)
  if (w1440.toolbar) cmp(rows, '工具条高', w1440.toolbar.h)
  if (collected.closedNav && collected.closedNav.nav) cmp(rows, '细轨宽', collected.closedNav.nav.w)
  /* 抽屉常量只在 760 档定义：窄档现在跑 1000/760/380 三档，collected.drawer 会被最后一档覆盖，故按宽度取。 */
  const d760 = (collected.byWidth[760] || {}).drawer || collected.drawer
  if (d760 && d760.nav) cmp(rows, '抽屉宽（760）', d760.nav.w)
  if (d760 && d760.left != null) cmp(rows, '抽屉 left（760）', d760.left)
  if (collected.detail && collected.detail.list) cmp(rows, 'list 列宽（B）', collected.detail.list.w)
  if (collected.map && collected.map.detail) cmp(rows, 'detail 列宽（C）', collected.map.detail.w)

  /* ---- 第三轮新增判据 ----
     1) 集头横贯写区：.mubu-set-head 相对 .write-surface 的左右内缩各应为 0（负 margin 抵消 --lore-pad-x）；
     2) 集头宽度不随滚动条变：无滚动条/有滚动条两态宽度差应为 0（scrollbar-gutter: stable）；
     3) 回列表 pill：窄档 1 个且可见，宽档 0 个（:list-back="narrow"）。
     宽档 1440/1280 的 pill 在 B 视图量（写视图里阅读区根本没渲染，量了也恒 0，不算证据）。 */
  const rawRow = (name, column, expected, actual) => {
    const ok = actual != null && typeof actual === 'number' && Math.abs(actual - expected) <= TOL
    rows.push({ constant: name, column: column, expected: expected, actual: actual == null ? '未量到' : actual, delta: actual == null ? '—' : Math.round((actual - expected) * 1000) / 1000, pass: ok })
  }
  for (const w of [1440, 1280, 1000, 760, 380]) {
    const sh = collected.setHead[w]
    if (!sh || sh.error) {
      rawRow('集头左右内缩差（' + w + '）', 'head', 0, null)
      rawRow('集头宽-滚动口宽（' + w + '）', 'head', 0, null)
      rawRow('集头宽随滚动条变化（' + w + '）', 'head', 0, null)
      continue
    }
    /* 集头比 .write-surface 每边宽出 pad-x（负 margin 抵消 .ob-editor 内距），所以判据是
       「左右内缩对称」+「集头宽 = 滚动口宽」+「宽度不随滚动条变」，而不是「内缩为 0」。 */
    rawRow('集头左右内缩差（' + w + '）', 'head', 0, Math.round(Math.abs(sh.leftIn - sh.rightIn) * 10) / 10)
    rawRow('集头宽-滚动口宽（' + w + '）', 'head', 0, Math.round((sh.head.w - sh.withBar.clientW) * 10) / 10)
    rawRow('集头宽随滚动条变化（' + w + '）', 'head', 0, sh.gutterDelta)
  }
  for (const w of [1440, 1280, 1000, 760, 380]) {
    const p = collected.pill[w]
    const want = w < 1100 ? 1 : 0
    rawRow('回列表 pill 可见数（' + w + '）', 'pill', want, p ? (p.visible ? 1 : 0) : null)
  }

  /* ---- 第四轮新增判据：关系网络 / 全部设定总览 ----
     各四样量：节点数（对照 store 期望：中心 + 去重邻居 / 设定集 + 全部条目）、边数、
     副标题文字、点「适应」后节点越界像素（0 = 卡片没掉出画布）。副标题是文字判据，故走字符串行。 */
  const strRow = (name, column, expected, actual) => {
    const ok = actual != null && String(actual) === String(expected)
    rows.push({ constant: name, column: column, expected: expected, actual: actual == null ? '未量到' : actual, delta: ok ? 0 : '—', pass: ok })
  }
  const rel = collected.relations
  const hier = collected.hierarchyAll
  const REL_ROWS = ['关系网络节点数（1440）', '关系网络边数（1440）', '关系网络副标题（1440）', '关系网络适应后越界像素（1440）']
  const HIER_ROWS = ['全部设定节点数（1440）', '全部设定边数（1440）', '全部设定副标题（1440）', '全部设定适应后越界像素（1440）']
  if (rel && !rel.error) {
    rawRow(REL_ROWS[0], 'graph-rel', rel.expectedNodes, rel.nodeDom)
    rawRow(REL_ROWS[1], 'graph-rel', rel.expectedEdges, rel.edgeDom)
    strRow(REL_ROWS[2], 'graph-rel', String(rel.center || '').slice(0, 18) + ' · 一跳关系', rel.subtitle)
    rawRow(REL_ROWS[3], 'graph-rel', 0, rel.overflowPx)
  } else {
    for (const n of REL_ROWS) rows.push({ constant: n, column: 'graph-rel', expected: '—', actual: '未采到', delta: '—', pass: false })
  }
  if (hier && !hier.error) {
    rawRow(HIER_ROWS[0], 'graph-hier', hier.expectedNodes, hier.nodeDom)
    rawRow(HIER_ROWS[1], 'graph-hier', hier.expectedEdges, hier.edgeDom)
    strRow(HIER_ROWS[2], 'graph-hier', '全部设定 · 层级', hier.subtitle)
    rawRow(HIER_ROWS[3], 'graph-hier', 0, hier.overflowPx)
  } else {
    for (const n of HIER_ROWS) rows.push({ constant: n, column: 'graph-hier', expected: '—', actual: '未采到', delta: '—', pass: false })
  }

  const rl = collected.reload
  if (rl && rl.after) {
    rows.push({
      constant: 'nav 收起跨 reload 保持', column: 'pane-nav', expected: 40, actual: rl.after.w,
      delta: Math.round((rl.after.w - 40) * 1000) / 1000, pass: Math.abs(rl.after.w - 40) <= TOL
    })
  }
  const failed = rows.filter((r) => !r.pass)

  console.log('')
  console.log('=== 设定面板矩阵 · 几何对稿（1440x900，误差 >' + TOL + 'px 记 FAIL） ===')
  console.log(pad2('常量', 22) + pad2('期望', 10) + pad2('实测', 12) + pad2('偏差', 10) + '判定')
  for (const r of rows) console.log(pad2(r.constant, 22) + pad2(r.expected, 10) + pad2(r.actual, 12) + pad2(r.delta, 10) + (r.pass ? 'PASS' : 'FAIL'))

  console.log('')
  console.log('--- 附加实测（不进判据，供文档引用） ---')
  if (w1440.shellCols) console.log('  1440 网格列：' + w1440.shellCols + '  列间距=' + w1440.shellGap)
  if (off.navLeft != null) console.log('  有效留白（1440）：nav.left=' + off.navLeft + ' nav.top=' + off.navTop + ' topbarBottom=' + off.topbarBottom
    + ' → 左 ' + off.navLeft + ' / 上 ' + (Math.round((off.navTop - off.topbarBottom) * 10) / 10)
    + '；.lore-shell padding-left=' + off.shellPaddingLeft + '；外层 padding=' + off.outerPaddingTop + '/' + off.outerPaddingLeft + '（要求 0px，留白只归 .lore-shell）')
  if (w1440.padding) console.log('  .wb-body computed padding（宽档 top/right/bottom）：' + w1440.padding.t + '/' + w1440.padding.r + '/' + w1440.padding.b + '（与有效留白分开记：判据只看有效偏移）')
  if (w1440.divider) console.log('  分隔条 role=' + w1440.divider.role + ' aria-valuenow=' + w1440.divider.now)
  if (w1440.border) console.log('  pane 边框 ' + w1440.border.width + ' / ' + w1440.border.color)
  if (collected.closedNav) console.log('  nav 收起：列 ' + JSON.stringify(collected.closedNav.nav) + ' 细轨 ' + JSON.stringify(collected.closedNav.rail) + ' 文案「' + String(collected.closedNav.railText || '').trim() + '」')
  if (collected.closedList) console.log('  list 收起：列 ' + JSON.stringify(collected.closedList.list) + ' 细轨 ' + JSON.stringify(collected.closedList.rail))
  if (collected.closedDetail) console.log('  detail 收起：列 ' + JSON.stringify(collected.closedDetail.detail) + ' 细轨 ' + JSON.stringify(collected.closedDetail.rail))
  if (collected.detail) console.log('  B 视图：data-view=' + collected.detail.screen + ' h1=「' + String(collected.detail.h1 || '').trim() + '」')
  if (collected.map) console.log('  C 视图：data-view=' + collected.map.screen + ' h1=「' + String(collected.map.h1 || '').trim() + '」')
  if (collected.narrowB) console.log('  窄档 B（最后一次采集 ' + (Object.keys(collected.byWidth).slice(-1)[0] || '?') + '）：data-screen=' + collected.narrowB.screen + ' main 可见=' + collected.narrowB.mainVisible + ' list 可见=' + collected.narrowB.listVisible)
  for (const w of Object.keys(collected.byWidth)) {
    const g = collected.byWidth[w]
    if (g.b && g.b.pill) console.log('  ' + w + ' 回列表 pill：' + g.b.pill.count + ' 个，可见=' + g.b.pill.visible + '，文案「' + String(g.b.pill.text || '').trim() + '」；nav 细轨 ' + g.b.navW + 'px；data-screen=' + g.b.screen)
    if (g.tap) console.log('  ' + w + ' pill 点击：点「' + String(g.tap.inList.pillText || '').trim() + '」→ data-screen=' + g.tap.inList.screen
      + '（list 可见=' + g.tap.inList.listVisible + ' main 可见=' + g.tap.inList.mainVisible + '）；点条目 → ' + g.tap.back.screen
      + '（main 可见=' + g.tap.back.mainVisible + '），标题「' + String(g.tap.back.from || '').trim() + '」→「' + String(g.tap.back.to || '').trim() + '」')
    if (g.b && g.b.detail) console.log('  ' + w + ' 详情五件套：页头=' + g.b.detail.head + ' h1=「' + String(g.b.detail.h1 || '').trim() + '」视图按钮=' + g.b.detail.switchN + ' 标题=「' + String(g.b.detail.title || '').trim() + '」页脚=' + g.b.detail.footer)
    if (g.map) console.log('  ' + w + ' 导图两颗 pill：主屏「' + g.map.subbarText + '」→ ' + (g.map.afterTap ? g.map.afterTap.screen : '?')
      + '（摘要列可见=' + (g.map.afterTap ? g.map.afterTap.inspVisible : '?') + '）；摘要屏「' + g.map.backText + '」→ '
      + (g.map.backMain ? g.map.backMain.screen : '?') + '（main 可见=' + (g.map.backMain ? g.map.backMain.mainVisible : '?') + '）')
  }
  for (const w of [1440, 1280, 1000, 760, 380]) {
    const sh = collected.setHead[w]
    if (sh && !sh.error) {
      console.log('  ' + w + ' 集头：左内缩 ' + sh.leftIn + ' / 右内缩 ' + sh.rightIn + '；宽 ' + sh.head.w + '（写区 ' + sh.surf.w
        + '）；有滚动条 clientWidth ' + sh.withBar.clientW + '（scrollHeight ' + sh.withBar.scrollH + ' / clientHeight ' + sh.withBar.clientH
        + '）→ 无滚动条 clientWidth ' + sh.noBar.clientW + '（scrollHeight ' + sh.noBar.scrollH + '）'
        + '；集头宽 ' + sh.withBar.headW + ' → ' + sh.noBar.headW + '（差 ' + sh.gutterDelta + '）；scrollbar-gutter=' + sh.gutter)
    } else {
      console.log('  ' + w + ' 集头：未采到（' + (sh ? sh.error : '无数据') + '）')
    }
  }
  for (const w of [1440, 1280, 1000, 760, 380]) {
    const p = collected.pill[w]
    console.log('  ' + w + ' pill 数：' + (p ? p.count + ' 个，可见=' + p.visible + '，文案「' + String(p.text || '').trim() + '」' : '未采到'))
  }
  if (collected.kinds && !collected.kinds.error) console.log('  默认设定集：' + collected.kinds.count + ' 个 ' + JSON.stringify(collected.kinds.names) + '；data-kind=' + JSON.stringify(collected.kinds.kinds) + '；图标互不相同 ' + collected.kinds.distinctIcon + ' 种')
  if (rel && !rel.error) console.log('  关系网络（1440）：中心「' + rel.center + '」节点 ' + rel.nodeDom + '（期望 ' + rel.expectedNodes + '）边 ' + rel.edgeDom
    + '（期望 ' + rel.expectedEdges + '）标签 ' + JSON.stringify(rel.labels) + ' 工具条「' + rel.countTxt + '」副标题「' + rel.subtitle + '」适应后越界 ' + rel.overflowPx + 'px，画布 ' + (rel.canvas ? rel.canvas.w + 'x' + rel.canvas.h : '?'))
  else console.log('  关系网络（1440）：未采到（' + (rel ? rel.error : '无数据') + '）')
  if (hier && !hier.error) console.log('  全部设定总览（1440）：节点 ' + hier.nodeDom + '（设定集 ' + hier.roots + ' + 条目 ' + hier.entries + ' = 期望 ' + hier.expectedNodes + '）边 ' + hier.edgeDom
    + '（期望 ' + hier.expectedEdges + '）副标题「' + hier.subtitle + '」适应后越界 ' + hier.overflowPx + 'px，画布 ' + (hier.wrap ? hier.wrap.w + 'x' + hier.wrap.h : '?'))
  else console.log('  全部设定总览（1440）：未采到（' + (hier ? hier.error : '无数据') + '）')
  if (d760) console.log('  760 抽屉：left=' + d760.left + ' top=' + d760.top + ' 宽=' + (d760.nav ? d760.nav.w : '?')
    + ' 遮罩可见=' + d760.scrim + ' data-drawer=' + d760.drawer)
  if (rl) console.log('  reload 复验：收起时 nav ' + (rl.before ? rl.before.w : '?') + 'px → reload 重新打开后 ' + (rl.after ? rl.after.w : '?') + 'px'
    + '（store.loreNavClosed=' + rl.storeClosed + '，书架/作品/设定页就绪=' + rl.okShelf + '/' + rl.okWork + '/' + rl.okLore + '）')

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

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: { width: 1440, height: VH },
    tolerance: TOL,
    rows: rows,
    extra: {
      shellCols1440: w1440.shellCols || null,
      shellGap1440: w1440.shellGap || null,
      divider1440: w1440.divider || null,
      border1440: w1440.border || null,
      tiles1440: w1440.panes || null,
      offsets1440: w1440.offsets || null,
      shellComputedPadding1440: w1440.padding || null,
      closedNav: collected.closedNav || null,
      closedList: collected.closedList || null,
      closedDetail: collected.closedDetail || null,
      reloadPersistence: rl || null,
      narrowB760: (collected.byWidth[760] || {}).b || collected.narrowB || null,
      drawer760: d760 || null,
      narrowByWidth: collected.byWidth || null,
      defaultSets: collected.kinds || null,
      setHeadByWidth: collected.setHead || null,
      pillByWidth: collected.pill || null,
      relations1440: collected.relations || null,
      hierarchyAll1440: collected.hierarchyAll || null
    },
    screenshots: shots,
    errors: errors
  }
  const reportPath = join(OUT, 'lore-compare-report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log('报告：' + reportPath)
  return failed.length || errors.length ? 1 : 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('FAIL：' + String(e && e.stack || e))
  process.exit(1)
})
