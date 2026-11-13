/* 注入到 iframe 的 window.native 替身：把桌面桥换成本插件的 HTTP 路由。
 * 目的：小说工坊前端代码零改动即可在 DSH 里运行。 */
(function () {
  if (window.__NS_SHIM__) return;
  window.__NS_SHIM__ = true;
  window.__NS_AGENT__ = 'dsh';

  var BASE = '/api/novelstudio/';
  function rpc(action, args) {
    return fetch(BASE + 'rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: action, args: args || {} }),
    }).then(function (res) { return res.json(); }).then(function (body) {
      if (!body || body.ok !== true) throw new Error(body && body.error ? body.error.message : 'RPC 失败：' + action);
      return body.value;
    });
  }

  var listeners = new Set();
  var noCredentials = function () {
    var error = new Error('插件版不保存 API 密钥：AI 由 DSH 会话承担');
    error.code = 'E_NO_CREDENTIALS';
    throw error;
  };

  var bridge = {
    /* 插件版不是 Electron 容器：让 fileio 走浏览器分支 */
    isElectron: false,
    panelOnEvent: function () { return function () {}; },

    /* 作品库（新增）：界面通过它与单一权威库同步 */
    libraryStatus: function () { return rpc('library.status'); },
    librarySnapshot: function () { return rpc('library.snapshot'); },
    libraryPull: function (after) { return rpc('sync.pull', { after: after || 0 }); },
    librarySubmit: function (payload) { return rpc('sync.submit', payload || {}); },
    /* 作品库存储位置（与桌面版同名）。插件版没有原生框，故不定义 pickLibraryDir：
     * 界面按 typeof pickLibraryDir === 'function' 区分两版入口。 */
    libraryLocation: function () { return rpc('storage.info'); },
    libraryBrowse: function (dir) { return rpc('storage.browse', { dir: dir || '' }); },
    libraryRelocate: function (dir) { return rpc('storage.relocate', { dir: dir || '' }); },

    /* 事件总线：插件版不再跨进程广播 */
    appBroadcast: function (payload) {
      listeners.forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } });
      return Promise.resolve();
    },
    appOnEvent: function (handler) {
      listeners.add(handler);
      return function () { listeners.delete(handler); };
    },

    /* 文件：浏览器下载 / input 选择 */
    saveFile: function (payload) {
      var blob = new Blob([payload && payload.data != null ? payload.data : ''], { type: (payload && payload.mime) || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (payload && payload.name) || 'novel-studio.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return Promise.resolve({ ok: true });
    },
    pickFiles: function () {
      return new Promise(function (resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = function () {
          resolve(Array.from(input.files || []).map(function (file) {
            return { name: file.name, path: file.name, size: file.size };
          }));
        };
        input.click();
      });
    },

    /* 不可用能力：显式失败，避免静默走错分支 */
    credentialEncrypt: noCredentials,
    credentialDecrypt: noCredentials,
    docxToHtml: function () { return Promise.reject(new Error('插件版暂不支持 docx 解析')); },
    getDataLocation: function () { return rpc('library.status'); },
    pickDataDir: function () { return Promise.reject(new Error('请在 DSH 设置里指定作品库目录')); },
    openDataFolder: function () { return Promise.resolve({ ok: false }); },
    moveDataDir: function () { return Promise.reject(new Error('插件版不支持迁移数据目录')); },
    cleanOldLocation: function () { return Promise.resolve({ ok: false }); },
    openOldFolder: function () { return Promise.resolve({ ok: false }); },
    clearDataPointer: function () { return Promise.resolve({ ok: false }); },
    /* 独立窗口：插件版用"新标签页 + ?panel=type:workId:entityId" 复现桌面版的面板窗口
     * （SPA 的 PanelHost 正是按这个 query 渲染精简面板）。 */
    panelOpen: function (spec) {
      var parts = [String((spec && spec.type) || 'settings'), String((spec && spec.workId) || 'app'), String((spec && spec.entityId) || '')];
      var url = '/api/novelstudio/app/index.html?panel=' + encodeURIComponent(parts.join(':'));
      var opened = null;
      try {
        opened = window.open(url, '_blank');
      } catch (error) {
        opened = null;
      }
      return Promise.resolve(opened ? { ok: true } : { ok: false, reason: '弹窗被浏览器拦截' });
    },
    panelReady: function () { return Promise.resolve(); },
    panelList: function () { return Promise.resolve([]); },
    panelFocus: function () { return Promise.resolve({ ok: false }); },
    panelCloseSelf: function () { return Promise.resolve(); },
    panelSetEntity: function () { return Promise.resolve(); },
    clipboardReadText: function () { return navigator.clipboard.readText(); },
    clipboardWriteText: function (text) { return navigator.clipboard.writeText(String(text == null ? '' : text)); }
  };

  window.native = bridge;

  /* 嵌入模式（?embed=1）：DSH 面板自带顶部细条，隐藏 SPA 自己的顶栏与皮肤入口，
   * 避免双头部。非嵌入打开（新窗口/浏览器）保持原样。 */
  function mountEmbedMode() {
    if (!window.location || String(window.location.search || '').indexOf('embed=1') < 0) return;
    try {
      var style = document.createElement('style');
      style.setAttribute('data-ns-embed', '1');
      style.textContent = '.app-topbar-shell,.app-topbar{display:none!important}';
      (document.head || document.documentElement).appendChild(style);
    } catch (error) {
      console.warn('[novel-studio] 嵌入模式样式未注入', error);
    }
  }

  /* 插件版不跑自家 Agent（M5 前的最小措施）：
   * 隐藏恍然梦对话面板，用一个常驻徽标说明"AI 由 DSH 会话承担"。 */
  function mountDshNotice() {
    try {
      var style = document.createElement('style');
      style.textContent = '.ai-panel.agent-panel{display:none!important}';
      document.head.appendChild(style);
      var badge = document.createElement('div');
      badge.setAttribute('data-ns-dsh-notice', '1');
      badge.textContent = 'AI 由 DSH 会话承担 · 回到左侧对话框继续';
      badge.style.cssText = [
        'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483000',
        'padding:6px 10px', 'border-radius:999px', 'background:#161b24e6',
        'color:#cbd5e1', 'font:12px/1.4 system-ui,-apple-system,sans-serif',
        'border:1px solid #2b3240', 'pointer-events:none',
      ].join(';');
      (document.body || document.documentElement).appendChild(badge);
    } catch (error) {
      console.warn('[novel-studio] 插件版提示未挂载', error);
    }
  }
  mountEmbedMode();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountDshNotice);
  else mountDshNotice();

  /* 令牌桥（M0）：把父窗口 body 上的宿主令牌搬进 iframe。
   * 第三方主题插件会改写 --dsw-* / --dsh-* 的值，所以每次都读 getComputedStyle 的现值，不写死。
   * 取不到的令牌不写入，让下游样式用回退值。 */
  var NS_TOKEN_MAP = [
    ['--dsw-alias-bg-base', '--ns-bg'],
    ['--dsw-alias-bg-layer-1', '--ns-layer-1'],
    ['--dsw-alias-bg-layer-2', '--ns-layer-2'],
    ['--dsw-alias-bg-layer-3', '--ns-layer-3'],
    ['--dsw-alias-border-l1', '--ns-border-1'],
    ['--dsw-alias-border-l2', '--ns-border-2'],
    ['--dsw-alias-border-l3', '--ns-border-3'],
    ['--dsw-alias-border-l4', '--ns-border-4'],
    ['--dsw-alias-label-primary', '--ns-label-1'],
    ['--dsw-alias-label-secondary', '--ns-label-2'],
    ['--dsw-alias-label-tertiary', '--ns-label-3'],
    ['--dsw-alias-label-caption', '--ns-caption'],
    ['--dsw-alias-interactive-bg-hover', '--ns-hover'],
    ['--dsw-alias-interactive-bg-active', '--ns-active'],
    ['--dsw-alias-state-success-primary', '--ns-success'],
    ['--dsw-alias-state-warn-primary', '--ns-warn'],
    ['--dsw-alias-state-error-primary', '--ns-error'],
    ['--dsw-alias-state-business-primary', '--ns-accent'],
    ['--dsw-radius-sm', '--ns-radius-sm'],
    ['--dsw-radius-md', '--ns-radius-md'],
    ['--dsw-radius-lg', '--ns-radius-lg'],
    ['--dsh-content-font-size', '--ns-font-size'],
    ['--dsh-scrollbar-width', '--ns-scroll-width'],
    ['--dsh-scrollbar-thumb', '--ns-scroll-thumb'],
    ['--dsh-scrollbar-thumb-hover', '--ns-scroll-thumb-hover'],
  ];

  /* 父窗口 body；跨域或受限时返回 null（安静跳过，不抛错）。 */
  function parentBody() {
    try {
      if (!window.parent || window.parent === window) return null;
      var doc = window.parent.document;
      if (!doc) return null;
      return doc.body || null;
    } catch (error) {
      return null;
    }
  }

  /* 返回写入的令牌个数。皮肤标记与父窗口无关，先落下（幂等）。 */
  function syncTokens() {
    try {
      if (document.body && document.body.dataset) {
        document.body.dataset.skin = 'dsh';
        document.body.dataset.nsHost = 'dsh';
      }
    } catch (error) { /* 忽略 */ }

    var body = parentBody();
    if (!body) return 0;

    var computed = null;
    try { computed = window.parent.getComputedStyle(body); } catch (error) { computed = null; }
    if (!computed || typeof computed.getPropertyValue !== 'function') return 0;

    var rootStyle = document.documentElement && document.documentElement.style;
    if (!rootStyle || typeof rootStyle.setProperty !== 'function') return 0;

    var applied = 0;
    for (var i = 0; i < NS_TOKEN_MAP.length; i++) {
      var value = '';
      try { value = computed.getPropertyValue(NS_TOKEN_MAP[i][0]); } catch (error) { value = ''; }
      value = value == null ? '' : String(value).trim();
      if (!value) continue;
      try { rootStyle.setProperty(NS_TOKEN_MAP[i][1], value); applied += 1; } catch (error) { /* 忽略 */ }
    }

    /* 暗色标记一并镜像，供 iframe 内部按需切换 */
    try {
      var dark = false;
      try { dark = typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme'); } catch (error) { dark = false; }
      var root = document.documentElement;
      if (root && root.dataset) {
        if (dark) root.dataset.nsDark = '1';
        else delete root.dataset.nsDark;
      }
    } catch (error) { /* 忽略 */ }

    return applied;
  }

  var tokenTimer = 0;
  function scheduleTokenSync() {
    if (tokenTimer) return;
    tokenTimer = setTimeout(function () { tokenTimer = 0; syncTokens(); }, 120);
  }

  function watchParentTokens() {
    var body = parentBody();
    if (!body) return;
    try {
      var Observer = (window.parent && window.parent.MutationObserver) || window.MutationObserver || null;
      if (!Observer) return;
      new Observer(scheduleTokenSync).observe(body, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-ds-dark-theme'],
      });
    } catch (error) { /* 观察失败不影响首屏令牌 */ }
  }

  function bootTokenBridge() {
    var embedded = false;
    try { embedded = !!window.parent && window.parent !== window; } catch (error) { embedded = false; }
    if (!embedded) return; /* 顶层直接打开：不同步自己 */
    syncTokens();
    watchParentTokens();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootTokenBridge);
  else bootTokenBridge();
})();
