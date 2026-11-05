/* 客户端入口：手写 ModuleLoader bundle。
 * 面板 = 诊断条 + 备份导入 + iframe（小说工坊完整界面，保留全部模块：大纲 / 人物 / 设定 / 画布 / 统计）。
 * 2026-11 回退：原生三视图方案已归档到 .tmp/attempt-native-ui/，插件版恢复为完整界面。 */
window.__ModuleLoader__.load({
  id: "dsh-novel-studio",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;

    var ID = "dsh-novel-studio";
    var KIND = "novel-studio";
    var TITLE = "小说工坊";
    var SRC = "/api/novelstudio/app/index.html";
    var HEALTH = "/api/novelstudio/health";
    var RPC = "/api/novelstudio/rpc";

    function log() {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[novel-studio]");
      console.log.apply(console, args);
    }

    function postRpc(action, args) {
      return fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: action, args: args || {} })
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error(body && body.error ? body.error.message : "RPC 失败：" + action);
          return body.value;
        });
    }

    function probeJson(url, init) {
      return fetch(url, init)
        .then(function (res) {
          return res.text().then(function (text) {
            var json = null;
            try { json = JSON.parse(text); } catch (error) { /* 非 JSON 也算通 */ }
            return { code: res.status, bytes: text.length, json: json, error: "" };
          });
        })
        .catch(function (error) {
          return { code: 0, bytes: 0, json: null, error: String((error && error.message) || error) };
        });
    }

    /* 右侧栏「开始」页卡片的图标：宿主给每个 guide 条目传 { size }，
     * 没给图标的条目会退化成默认方块，所以这里画一个与宿主同语汇的线描「册」。 */
    function NovelStudioGlyph(props) {
      var size = (props && props.size) || 22;
      var stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
      return h("svg", Object.assign({
        width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true",
        className: props && props.className
      }, stroke),
        h("path", { d: "M4.2 6.1c0-.8.6-1.4 1.4-1.4h4.1c1.1 0 2 .9 2 2v12.2c0-.7-.7-1.3-1.5-1.3H5.6c-.8 0-1.4-.6-1.4-1.4z" }),
        h("path", { d: "M19.8 6.1c0-.8-.6-1.4-1.4-1.4h-4.1c-1.1 0-2 .9-2 2v12.2c0-.7.7-1.3 1.5-1.3h4.6c.8 0 1.4-.6 1.4-1.4z" }),
        h("path", { d: "M6.6 8.9h2.2M6.6 11.8h2.2M15.2 8.9h2.2M15.2 11.8h2.2" })
      );
    }

    /* 健康探针里的构建时间：毫秒 -> 本地 HH:MM（面板只用来确认"服务的是哪次构建"）。 */
    function formatClock(ms) {
      try {
        var d = new Date(ms);
        return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      } catch (error) {
        return "";
      }
    }

    var btnStyle = {
      background: "transparent", border: "1px solid var(--dsw-alias-border-l2, #2b3240)", color: "var(--dsw-alias-label-secondary, #9fb0c9)",
      borderRadius: "999px", padding: "2px 8px", cursor: "pointer", fontSize: "11px"
    };

    function Frame() {
      var state = React.useState({ app: null, health: null, rpc: null });
      var diag = state[0];
      var setDiag = state[1];
      var copied = React.useState("");
      var copyState = copied[0];
      var setCopyState = copied[1];
      var reload = React.useState(0);
      var reloadKey = reload[0];
      var setReloadKey = reload[1];
      var probes = React.useState(0);
      var probeKey = probes[0];
      var setProbeKey = probes[1];
      var notice = React.useState("");
      var noticeText = notice[0];
      var setNotice = notice[1];
      var fileInput = React.useRef(null);

      React.useEffect(function () {
        var alive = true;
        var apply = function (key, value) {
          if (!alive) return;
          setDiag(function (prev) {
            var next = Object.assign({}, prev);
            next[key] = value;
            return next;
          });
        };
        fetch(SRC, { method: "GET" })
          .then(function (res) { return res.text().then(function (text) { return { code: res.status, bytes: text.length, shim: text.indexOf("native-shim.js") >= 0, error: "" }; }); })
          .catch(function (error) { return { code: 0, bytes: 0, shim: false, error: String((error && error.message) || error) }; })
          .then(function (value) { apply("app", value); });
        probeJson(HEALTH).then(function (value) {
          apply("health", value);
          if (!alive) return;
          /* 白屏的真凶是"产物文件没被路由住"：健康探针已经逐个落盘核对过了，这里把它说出来。 */
          var hv = value && value.json;
          var missing = hv && hv.build && hv.build.missing;
          if (Array.isArray(missing) && missing.length) {
            setNotice("产物缺 " + missing.length + " 个文件：" + missing.slice(0, 2).join("、") + (missing.length > 2 ? " …" : ""));
          }
        });
        probeJson(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plugin.info", args: {} }) }).then(function (value) { apply("rpc", value); });
        return function () { alive = false; };
      }, [probeKey]);

      var parts = [];
      var ok = true;
      if (diag.app) {
        parts.push("静态 " + (diag.app.code || "失败") + (diag.app.code === 200 ? " · 桥" + (diag.app.shim ? "✓" : "✗") : ""));
        if (diag.app.code !== 200) ok = false;
      }
      if (diag.health) {
        var hv = diag.health.json;
        parts.push("健康 " + (diag.health.code || "失败") + (hv ? " · 作品 " + ((hv.library && hv.library.works) || 0) + " 部" : ""));
        if (diag.health.code !== 200) ok = false;
        if (hv) {
          /* prefix = 重建产物后点「重新载入」就能生效；exact = 文件名冻在启动那一刻，换产物要重启。 */
          if (hv.routeMode) parts.push(hv.routeMode === "prefix" ? "热路由" : "需重启");
          var build = hv.build || null;
          if (build && Array.isArray(build.missing)) {
            parts.push(build.missing.length ? "资源 缺 " + build.missing.length : "资源 " + build.files + " ✓");
            if (build.missing.length) ok = false;
          }
          if (build && build.at) parts.push("产物 " + formatClock(build.at));
        }
      }
      if (diag.rpc) {
        parts.push("RPC " + (diag.rpc.code || "失败") + (diag.rpc.json && diag.rpc.json.ok ? " ✓" : ""));
        if (diag.rpc.code !== 200) ok = false;
      }
      if (!parts.length) parts.push("正在检查宿主链路…");
      var color = !diag.app || !diag.health || !diag.rpc ? "var(--dsw-alias-label-tertiary, #5a6270)" : ok ? "var(--dsw-alias-state-success-primary, #1f7a3f)" : "var(--dsw-alias-state-error-primary, #a63a2e)";

      var copyDiag = function () {
        var payload = JSON.stringify({ src: SRC, diag: diag, ua: navigator.userAgent }, null, 2);
        var done = function () { setCopyState("已复制"); setTimeout(function () { setCopyState(""); }, 1600); };
        try {
          navigator.clipboard.writeText(payload).then(done).catch(function () { console.log(payload); setCopyState("已打印"); });
        } catch (error) {
          console.log(payload);
          setCopyState("已打印");
        }
      };

      var pickBackup = function () { if (fileInput.current) fileInput.current.click(); };

      var onBackup = function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        setNotice("读取备份…");
        var reader = new FileReader();
        reader.onload = function () {
          var dump;
          try {
            dump = JSON.parse(String(reader.result || ""));
          } catch (error) {
            setNotice("不是合法 JSON");
            return;
          }
          setNotice("导入作品库…");
          postRpc("library.import", { dump: dump, force: true })
            .then(function (value) {
              setNotice("已导入 " + ((value && value.imported) || 0) + " 行，正在重新载入…");
              setReloadKey(function (key) { return key + 1; });
              setProbeKey(function (key) { return key + 1; });
            })
            .catch(function (error) { setNotice("导入失败：" + (error.message || error)); });
        };
        reader.readAsText(file);
        event.target.value = "";
      };

      return h("div", { style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: "320px", background: "var(--dsw-alias-bg-base, #0f1114)" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "5px 10px", fontSize: "12px", color: color, borderBottom: "1px solid var(--dsw-alias-border-l1, #232833)", flexWrap: "wrap" } },
          h("strong", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary, #dce3ee)" } }, TITLE),
          h("span", { style: { textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" } }, parts.join("  ·  ")),
          noticeText ? h("span", { style: { color: "var(--dsw-alias-state-warn-primary, #c9a227)" } }, noticeText) : null,
          h("button", { type: "button", onClick: pickBackup, style: Object.assign({}, btnStyle, { marginLeft: "auto" }) }, "导入软件版备份"),
          h("input", { type: "file", accept: ".json,application/json", ref: fileInput, onChange: onBackup, style: { display: "none" } }),
          h("button", { type: "button", onClick: function () { setReloadKey(function (key) { return key + 1; }); setProbeKey(function (key) { return key + 1; }); setNotice(""); }, style: btnStyle }, "重新载入"),
          h("button", { type: "button", onClick: copyDiag, style: btnStyle }, copyState || "复制诊断"),
          h("a", { href: SRC, target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-link, #4a7fd4)" } }, "新窗口打开")
        ),
        h("iframe", {
          key: reloadKey,
          src: SRC,
          title: TITLE,
          allow: "clipboard-read; clipboard-write",
          style: { flex: "1 1 auto", width: "100%", height: "100%", border: "0", display: "block", background: "var(--dsw-alias-bg-base, #0f1114)" }
        })
      );
    }

    /* 入口只有一处：右侧栏「开始」页的卡片（见下方 guide）。左栏底部那枚「工坊」按钮与它重复，
     * 已下线；inject 也只剩真正用到的两个服务。 */
    exports.inject = ["slots", "sidebarRightTabs"];

    exports.apply = function (ctx) {
      log("客户端 apply，注入", exports.inject);
      if (ctx.effect) {
        ctx.effect(function () {
          try {
            return ctx.sidebarRightTabs.register({
              id: ID, kind: KIND, keepMounted: true,
              patterns: ["dsh-resource://" + KIND + "/**"],
              title: function () { return TITLE; },
              /* 右侧栏「开始」页只渲染定义里带 guide 的类型（宿主 TabRegistry.refresh：
               * guideEntries = definitions.flatMap(def => def.guide ?? [])）。不写这一段，
               * 工坊就只存在于资源路由里，卡片栏里永远看不到它。 */
              guide: [{
                id: "open",
                order: 15,
                title: function () { return TITLE; },
                description: function () { return "书架、正文、设定与大纲"; },
                icon: NovelStudioGlyph
              }]
            });
          } catch (error) {
            log("注册右侧 tab 失败", error);
          }
        });
      }
      if (ctx.slots && ctx.slots.inject) {
        ctx.slots.inject("sidebar.right.pane.tab", function () {
          try {
            return ctx.slots.register({ name: "sidebar.right.pane.tab", key: ID }, Frame);
          } catch (error) {
            log("注册面板渲染失败", error);
          }
        });
      }
    };

    return module.exports;
  }
});
