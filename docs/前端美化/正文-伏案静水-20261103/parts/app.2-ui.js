/* app.2-ui.js — 交互层（在 app.1-render.js 之后执行）。
   只调用 NSAPP 与 window.createStudioBackdrop 契约：不实现着色器、不写样式、不请求外部资源。 */
(function () {
  'use strict';

  var D = document;
  var NS = null;        // window.NSAPP，渲染层提供
  var APP = null;       // #app
  var api = null;       // 背景渲染器契约，可能为 null
  var PALETTE = { a: '#1b2430', b: '#22262b', c: '#4a2a24' };
  var THROTTLE_MS = 80;
  var SETTLE_MS = 600;
  var lastPulseAt = 0;
  var saveTimer = 0;
  var qp = null;         // URL 参数，启动时读取一次

  function el(id) { return D.getElementById(id); }

  // 1. 背景引导：只调用，不实现
  function bootBackdrop() {
    qp = new URLSearchParams(location.search);
    var bg = ['ink', 'lamp', 'ridge'].indexOf(qp.get('bg')) >= 0 ? qp.get('bg') : 'ink';
    if (APP) APP.dataset.bg = bg;
    D.documentElement.dataset.bg = bg;

    var canvas = el('st-bg');
    var created = null;
    if (typeof window.createStudioBackdrop === 'function' && canvas) {
      try {
        created = window.createStudioBackdrop(canvas, {
          mode: bg,
          gpu: qp.get('gpu') !== '0',
          reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        });
      } catch (err) {
        created = null; // 渲染器缺失或失败：按无背景处理，不打印也不抛错
      }
    }
    api = created || null;
    if (!api) D.documentElement.dataset.bgFallback = '1';
    return api;
  }

  // 启动即应用 URL 参数 ?scene=… / ?mode=…（取证脚本靠它直达各状态，不依赖点击）
  function applyQueryState() {
    if (!qp) qp = new URLSearchParams(location.search);
    var wantScene = qp.get('scene');
    if (['writing', 'notes', 'menu', 'formats', 'ctx', 'search', 'history'].indexOf(wantScene) >= 0) {
      if (wantScene === 'formats') openFormats();
      else NS.showScene(wantScene);
    }
    var wantMode = qp.get('mode');
    if (wantMode === 'focus' || wantMode === 'read') NS.setMode(wantMode);
  }

  function scene() { return NS.state.scene; }
  function setScene(name) { NS.showScene(name); }
  function closeScene() { NS.showScene('writing'); }

  function clearDrawers() {
    if (!APP) return;
    APP.classList.remove('is-drawer-dir');
    APP.classList.remove('is-drawer-notes');
  }

  function openSearch() {
    setScene('search');
    window.requestAnimationFrame(function () {
      var input = el('search-input');
      if (input) input.focus();
    });
  }

  // 设计稿 D7：浮层是 .wb-body 的子元素，静态定位会落到工具栏上方；改为按按钮矩形定位
  function placeFormats() {
    var pop = document.getElementById('pop-formats');
    var btn = document.querySelector('[data-act=more-formats]');
    if (!pop || !btn) return;
    var r = btn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    pop.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    pop.style.left = 'auto';
    pop.style.width = '200px';
  }

  function openFormats() {
    setScene('formats');
    placeFormats(); // 先让浮层 display 变 block，再按按钮矩形定位
  }

  // 2. 章节列表：事件委托
  function bindTree() {
    D.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#tree-list .sp-more')) { setScene('menu'); return; } // ⋯ 直接开菜单（演示）
      var row = t.closest('#tree-list .sp-row[data-id]');
      if (!row) return;
      NS.setChapter(row.dataset.id);
      if (api && api.setPalette) api.setPalette(PALETTE, { duration: 300 });
    });
  }

  // 5. 菜单项
  function onMenu(name) {
    if (name === 'focus') { NS.setMode('focus'); closeScene(); return; }
    if (name === 'read') { NS.setMode('read'); closeScene(); return; }
    if (name === 'dir') { if (APP) APP.classList.toggle('is-dir-collapsed'); closeScene(); return; }
    // split / bookmark / settings：设计稿内没有落地页，仅收起菜单
    closeScene();
  }

  // 4./6./8. 顶栏入口、浮层入口、抽屉、工具栏
  function bindChrome() {
    D.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (e.altKey && t.closest('[data-act=bookmark]')) {
        // 设计稿演示入口：工具栏没有独立的「章节历史」按钮，按住 Alt 点书签键打开历史
        setScene('history');
        return;
      }
      if (t.closest('[data-anchor=topbar-more]')) { setScene('menu'); return; }
      if (t.closest('[data-act=more-formats]')) { openFormats(); return; }
      if (t.closest('[data-anchor=topbar-search]')) { openSearch(); return; }
      if (t.closest('[data-anchor=dir-rail]')) { if (APP) APP.classList.add('is-drawer-dir'); return; }
      if (t.closest('[data-anchor=notes-rail]')) { if (APP) APP.classList.add('is-drawer-notes'); return; }
      if (t.closest('#scrim')) { clearDrawers(); closeScene(); return; }

      var item = t.closest('#pop-menu [data-menu]');
      if (item) { onMenu(item.dataset.menu); return; }
      if (t.closest('#pop-formats [data-fmt]')) { closeScene(); return; }

      var tb = t.closest('.tb'); // 仅切换选中态，不做真实排版动作；同组互斥交给 CSS
      if (tb) tb.classList.toggle('on');
    });
  }

  // 3. 保存点（80ms 节流）+ 右键菜单场景
  function bindEditor() {
    D.addEventListener('contextmenu', function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('#tiptap')) return;
      e.preventDefault();
      setScene('ctx');
    });

    D.addEventListener('input', function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('#tiptap')) return;
      if (saveTimer) window.clearTimeout(saveTimer); // 清掉上一个定时器，不叠加
      saveTimer = window.setTimeout(function () {
        saveTimer = 0;
        NS.setSave('saved');
      }, SETTLE_MS);

      var now = Date.now();
      if (now - lastPulseAt < THROTTLE_MS) return; // 80ms 节流
      lastPulseAt = now;
      NS.setSave('saving');
      if (api && api.pulse) api.pulse(0.05);
    }, { passive: true });
  }

  // 7. Esc（浮层 + 抽屉 + 模式）；4. Ctrl+Shift+F 搜索
  function bindKeys() {
    D.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key !== 'Escape') return;
      clearDrawers();
      if (scene() !== 'writing') closeScene();
      if (NS.state.mode === 'focus' || NS.state.mode === 'read') NS.setMode('');
    });
  }

  // 9. 取证钩子
  function exposeHooks() {
    window.__nsStudio = {
      scene: function () { return NS.state.scene; },
      setScene: function (s) { NS.showScene(s); },
      setChapter: function (id) { NS.setChapter(id); },
      signature: function () { return window.__nsStudioStats ? window.__nsStudioStats() : null; }
    };
  }

  // 10. 统一在 DOMContentLoaded 之后绑定
  function init() {
    NS = window.NSAPP;
    if (!NS) return; // 渲染层缺失：直接返回，不抛错
    APP = el('app');
    bootBackdrop();
    applyQueryState();
    bindTree();
    bindChrome();
    bindEditor();
    bindKeys();
    window.addEventListener('resize', function () {
      if (scene() === 'formats') placeFormats();
    });
    exposeHooks();
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
