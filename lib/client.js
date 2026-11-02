/* 客户端入口：手写 ModuleLoader bundle（与 dsh-cuigengji-plugin 同格式）。
 * 三个探针一次说清"宿主→插件"链路：静态资源 / 健康 / RPC。 */
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

    function Frame() {
      var state = React.useState({ app: null, health: null, rpc: null });
      var diag = state[0];
      var setDiag = state[1];
      var copied = React.useState("");
      var copyState = copied[0];
      var setCopyState = copied[1];

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
        probeJson(HEALTH).then(function (value) { apply("health", value); });
        probeJson(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plugin.info", args: {} }) }).then(function (value) { apply("rpc", value); });
        return function () { alive = false; };
      }, []);

      var parts = [];
      var ok = true;
      if (diag.app) {
        parts.push("静态 " + (diag.app.code || "失败") + (diag.app.code === 200 ? " · " + diag.app.bytes + "B · 桥" + (diag.app.shim ? "✓" : "✗") : ""));
        if (diag.app.code !== 200) ok = false;
      }
      if (diag.health) {
        var hv = diag.health.json;
        parts.push("健康 " + (diag.health.code || "失败") + (hv ? " · 路由 " + hv.staticRoutes + " · v" + hv.version : ""));
        if (diag.health.code !== 200) ok = false;
      }
      if (diag.rpc) {
        parts.push("RPC " + (diag.rpc.code || "失败") + (diag.rpc.json && diag.rpc.json.ok ? " ✓" : ""));
        if (diag.rpc.code !== 200) ok = false;
      }
      if (!parts.length) parts.push("正在检查宿主链路…");

      var color = !diag.app || !diag.health || !diag.rpc ? "#5a6270" : ok ? "#1f7a3f" : "#a63a2e";

      var copyDiag = function () {
        var payload = JSON.stringify({ src: SRC, diag: diag, ua: navigator.userAgent }, null, 2);
        var done = function () { setCopyState("已复制"); setTimeout(function () { setCopyState(""); }, 1600); };
        try {
          navigator.clipboard.writeText(payload).then(done).catch(function () { console.log(payload); setCopyState("已打印到控制台"); });
        } catch (error) {
          console.log(payload);
          setCopyState("已打印到控制台");
        }
      };

      return h("div", { style: { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: "320px", background: "#0f1114" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "5px 10px", fontSize: "12px", color: color, borderBottom: "1px solid #232833" } },
          h("strong", { style: { fontWeight: 600, color: "#dce3ee" } }, TITLE),
          h("span", { style: { textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" } }, parts.join("  ·  ")),
          h("button", { type: "button", onClick: copyDiag, style: { marginLeft: "auto", background: "transparent", border: "1px solid #2b3240", color: "#9fb0c9", borderRadius: "999px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" } }, copyState || "复制诊断"),
          h("a", { href: SRC, target: "_blank", rel: "noreferrer", style: { color: "#4a7fd4" } }, "新窗口打开")
        ),
        h("iframe", {
          src: SRC,
          title: TITLE,
          allow: "clipboard-read; clipboard-write",
          style: { flex: "1 1 auto", width: "100%", height: "100%", border: "0", display: "block", background: "#0f1114" }
        })
      );
    }

    function Launcher(props) {
      var open = props && (props.openNovelStudio || props.open);
      return h("button", {
        type: "button",
        title: TITLE + "（DSH 插件版）",
        onClick: function () { if (open) open(); },
        style: {
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "4px 10px", border: "1px solid #2b3240", borderRadius: "999px",
          background: "#161b24", color: "#dce3ee", cursor: "pointer", fontSize: "12px", lineHeight: "18px"
        }
      }, "工坊");
    }

    function openStudio(ctx) {
      var url = "dsh-resource://" + KIND + "/main";
      try {
        if (ctx.sidebarRight && typeof ctx.sidebarRight.openResource === "function") {
          ctx.sidebarRight.openResource(url);
          log("已调用 sidebarRight.openResource", url);
          return;
        }
        log("ctx.sidebarRight 不可用", Object.keys(ctx || {}));
      } catch (error) {
        log("openResource 抛错", error);
      }
      try {
        if (ctx.layout && typeof ctx.layout.selectPanel === "function") {
          ctx.layout.selectPanel(ID);
          log("已回退 layout.selectPanel", ID);
          return;
        }
      } catch (error) {
        log("selectPanel 抛错", error);
      }
      log("没有可用的打开通道，改为新窗口打开", SRC);
      try {
        window.open(SRC, "_blank", "noopener");
      } catch (error) {
        log("window.open 被拒", error);
      }
    }

    exports.inject = ["connection", "slots", "sidebarRightTabs", "sidebarRight", "locale", "layout"];

    exports.apply = function (ctx) {
      log("客户端 apply，注入", exports.inject, "可用服务", Object.keys(ctx || {}));

      if (ctx.effect) {
        ctx.effect(function () {
          try {
            var handle = ctx.sidebarRightTabs.register({
              id: ID,
              kind: KIND,
              keepMounted: true,
              patterns: ["dsh-resource://" + KIND + "/**"],
              title: function () { return TITLE; }
            });
            log("注册右侧 tab 成功", handle);
            return handle;
          } catch (error) {
            log("注册右侧 tab 失败", error);
          }
        });
      }

      if (ctx.slots && ctx.slots.inject) {
        ctx.slots.inject("sidebar.footer.action", function () {
          return ctx.slots.register({
            name: "sidebar.footer.action",
            id: ID,
            order: 90,
            inject: function () {
              return { openNovelStudio: function () { openStudio(ctx); } };
            }
          }, Launcher);
        });

        ctx.slots.inject("sidebar.right.pane.tab", function () {
          try {
            var handle = ctx.slots.register({ name: "sidebar.right.pane.tab", key: ID }, Frame);
            log("注册面板渲染成功");
            return handle;
          } catch (error) {
            log("注册面板渲染失败", error);
          }
        });
      }
    };

    return module.exports;
  }
});
