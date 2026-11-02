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
    panelOpen: function () { return Promise.resolve({ ok: false }); },
    panelReady: function () { return Promise.resolve(); },
    panelList: function () { return Promise.resolve([]); },
    panelFocus: function () { return Promise.resolve({ ok: false }); },
    panelCloseSelf: function () { return Promise.resolve(); },
    panelSetEntity: function () { return Promise.resolve(); },
    clipboardReadText: function () { return navigator.clipboard.readText(); },
    clipboardWriteText: function (text) { return navigator.clipboard.writeText(String(text == null ? '' : text)); }
  };

  window.native = bridge;

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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountDshNotice);
  else mountDshNotice();
})();
