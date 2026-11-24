#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    param: 'sign',
    apiPattern: '/api/',
    types: 'fetch,xhr,urlsearchparams,cookie,storage,time-random,dynamic-code,websocket,postmessage',
    out: '',
    debugger: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--param') args.param = argv[++i] || 'sign';
    else if (a === '--api-pattern') args.apiPattern = argv[++i] || '/api/';
    else if (a === '--types') args.types = argv[++i] || args.types;
    else if (a === '--out') args.out = argv[++i] || '';
    else if (a === '--debugger') args.debugger = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return args;
}

function usage() {
  return `用法：
  node scripts/generate_hook_templates.js --param sign --api-pattern /api/ --types fetch,xhr,cookie,storage
  node scripts/generate_hook_templates.js --param a_bogus --api-pattern /web/api --out case/hooks/hooks.js
  node scripts/generate_hook_templates.js --debugger   # 显式启用 debugger；默认关闭

默认：只包装原本存在且可安全包装的 API；日志为摘要（类型/长度），不打印 Cookie/令牌/请求体原值；
提供 install/uninstall（IIFE return 控制句柄，宿主持有；不挂 window 调试字段）；
已包装身份用闭包 WeakSet（禁止写 fn[MARK]/Proxy 污染目标）；诊断态用 WeakMap；
不在被测对象上挂 __reverse_* / __webJsEnvHookControl。正式验收须关闭/卸载 Hook。`;
}

function q(v) {
  return JSON.stringify(String(v));
}

function build(args) {
  const chosen = args.types.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const known = new Set([
    'fetch', 'xhr', 'urlsearchparams', 'cookie', 'storage',
    'time-random', 'dynamic-code', 'websocket', 'postmessage',
  ]);
  const unknown = chosen.filter((t) => !known.has(t));
  if (unknown.length) throw new Error(`未知 Hook 类型：${unknown.join(', ')}`);

  const enableDebugger = !!args.debugger;
  const typesLit = JSON.stringify(chosen);

  return `// Web JS 环境定位 Hook 模板（生成器：generate_hook_templates.js）
// 目标参数：${args.param}
// API 关键字：${args.apiPattern}
// 类型：${chosen.join(',')}
// 改变面：仅包装安装时已存在且可安全包装的方法/访问器；缺失 API 保持缺失。
// 覆盖不了：异步竞态、跨 Realm、不可配置描述符、页面安装后再次改写的行为差异。
// 正式验收：宿主持有的 control.uninstall() 后再跑消费方验收（不在 window 上挂控制字段）。
// debugger：${enableDebugger ? '已启用（--debugger）' : '默认关闭；需要时加 --debugger'}

(function (global) {
  "use strict";
  var targetParam = ${q(args.param)};
  var apiKeyword = ${q(args.apiPattern)};
  var ENABLE_DEBUGGER = ${enableDebugger ? 'true' : 'false'};
  var SELECTED = ${typesLit};
  var patches = [];
  var xhrMeta = typeof WeakMap === "function" ? new WeakMap() : null;
  // 已包装身份外置：禁止对 Proxy/函数写自有标记（会污染 [[Target]] / 残留导致重装静默跳过）
  var wrappedSet = typeof WeakSet === "function" ? new WeakSet() : null;
  var wrappedList = wrappedSet ? null : [];

  function hitDebugger() {
${enableDebugger ? '    debugger;\n' : '    // debugger disabled unless generated with --debugger\n'}  }

  function summarizeValue(value) {
    if (value == null) return { type: String(value), length: 0 };
    if (typeof value === "string") return { type: "string", length: value.length };
    if (typeof value === "number" || typeof value === "boolean") return { type: typeof value, length: 0 };
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return { type: "ArrayBuffer", length: value.byteLength };
    if (typeof Blob !== "undefined" && value instanceof Blob) return { type: "Blob", length: value.size };
    if (Array.isArray(value)) return { type: "array", length: value.length };
    return { type: typeof value, length: 0 };
  }

  function logHit(kind, detail) {
    var payload = { kind: kind, param: targetParam };
    if (detail) {
      for (var k in detail) {
        if (Object.prototype.hasOwnProperty.call(detail, k)) payload[k] = detail[k];
      }
    }
    try { console.info("[web-js-env-hook]", payload); } catch (e) {}
    hitDebugger();
  }

  function isAlreadyWrapped(fn) {
    if (!fn) return false;
    if (wrappedSet) return wrappedSet.has(fn);
    for (var i = 0; i < wrappedList.length; i++) {
      if (wrappedList[i] === fn) return true;
    }
    return false;
  }

  function markWrapped(fn) {
    if (!fn) return fn;
    if (wrappedSet) wrappedSet.add(fn);
    else wrappedList.push(fn);
    return fn;
  }

  function wrapValue(owner, key, factory) {
    if (!owner || typeof owner !== "object" && typeof owner !== "function") return false;
    var desc = Object.getOwnPropertyDescriptor(owner, key);
    if (!desc || typeof desc.value !== "function") return false;
    if (!desc.configurable && !desc.writable) return false;
    if (isAlreadyWrapped(desc.value)) return false;
    var original = desc.value;
    var wrapped = factory(original);
    if (typeof wrapped !== "function") return false;
    markWrapped(wrapped);
    try {
      Object.defineProperty(owner, key, {
        configurable: desc.configurable,
        enumerable: desc.enumerable,
        writable: desc.writable,
        value: wrapped
      });
    } catch (e) { return false; }
    patches.push({ kind: "value", owner: owner, key: key, original: original, wrapped: wrapped });
    return true;
  }

  function wrapAccessor(owner, key, factory) {
    if (!owner) return false;
    var desc = Object.getOwnPropertyDescriptor(owner, key);
    if (!desc || typeof desc.get !== "function" || typeof desc.set !== "function") return false;
    if (!desc.configurable) return false;
    if (isAlreadyWrapped(desc.get) || isAlreadyWrapped(desc.set)) return false;
    var next = factory(desc);
    if (!next || typeof next.get !== "function" || typeof next.set !== "function") return false;
    markWrapped(next.get);
    markWrapped(next.set);
    try {
      Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: desc.enumerable,
        get: next.get,
        set: next.set
      });
    } catch (e) { return false; }
    patches.push({ kind: "accessor", owner: owner, key: key, original: desc, wrapped: next });
    return true;
  }

  function installSelected() {
    if (SELECTED.indexOf("fetch") >= 0) {
      if (typeof global.fetch === "function") {
        wrapValue(global, "fetch", function (rawFetch) {
          return function patchedFetch(input, init) {
            var url = typeof input === "string" ? input : (input && input.url) || "";
            var body = init && init.body;
            var matched = String(url).indexOf(apiKeyword) >= 0
              || String(url).indexOf(targetParam) >= 0
              || String(body || "").indexOf(targetParam) >= 0;
            if (matched) {
              logHit("fetch", {
                urlLength: String(url).length,
                body: summarizeValue(body),
                inputType: typeof input
              });
            }
            return rawFetch.apply(this, arguments);
          };
        });
      }
    }

    if (SELECTED.indexOf("xhr") >= 0 && typeof global.XMLHttpRequest === "function") {
      var XHR = global.XMLHttpRequest.prototype;
      wrapValue(XHR, "open", function (rawOpen) {
        return function patchedOpen(method, url) {
          if (xhrMeta) xhrMeta.set(this, { method: method, url: String(url || "") });
          return rawOpen.apply(this, arguments);
        };
      });
      wrapValue(XHR, "setRequestHeader", function (rawSetHeader) {
        return function patchedSetRequestHeader(name, value) {
          if (String(name).indexOf(targetParam) >= 0 || String(value).indexOf(targetParam) >= 0) {
            var meta = xhrMeta && xhrMeta.get(this);
            logHit("xhr-header", {
              urlLength: meta && meta.url ? meta.url.length : 0,
              nameLength: String(name).length,
              value: summarizeValue(value)
            });
          }
          return rawSetHeader.apply(this, arguments);
        };
      });
      wrapValue(XHR, "send", function (rawSend) {
        return function patchedSend(body) {
          var meta = xhrMeta && xhrMeta.get(this);
          var url = (meta && meta.url) || "";
          if (url.indexOf(apiKeyword) >= 0 || url.indexOf(targetParam) >= 0 || String(body || "").indexOf(targetParam) >= 0) {
            logHit("xhr-send", {
              method: meta && meta.method,
              urlLength: url.length,
              body: summarizeValue(body)
            });
          }
          return rawSend.apply(this, arguments);
        };
      });
    }

    if (SELECTED.indexOf("urlsearchparams") >= 0) {
      ["URLSearchParams", "FormData"].forEach(function (name) {
        var Ctor = global[name];
        if (!Ctor || !Ctor.prototype) return;
        ["append", "set"].forEach(function (method) {
          wrapValue(Ctor.prototype, method, function (raw) {
            return function patchedParamWrite(key, value) {
              if (String(key) === targetParam || String(value).indexOf(targetParam) >= 0) {
                logHit(name + "." + method, { key: String(key), value: summarizeValue(value) });
              }
              return raw.apply(this, arguments);
            };
          });
        });
      });
    }

    if (SELECTED.indexOf("cookie") >= 0 && global.Document && Document.prototype) {
      wrapAccessor(Document.prototype, "cookie", function (desc) {
        return {
          get: function () {
            var value = desc.get.call(this);
            if (String(value).indexOf(targetParam) >= 0) {
              logHit("cookie-get", { value: summarizeValue(value) });
            }
            return value;
          },
          set: function (value) {
            if (String(value).indexOf(targetParam) >= 0) {
              logHit("cookie-set", { value: summarizeValue(value) });
            }
            return desc.set.call(this, value);
          }
        };
      });
    }

    if (SELECTED.indexOf("storage") >= 0 && global.Storage && Storage.prototype) {
      var keys = [targetParam, "token", "device", "fingerprint"];
      ["getItem", "setItem", "removeItem"].forEach(function (method) {
        wrapValue(Storage.prototype, method, function (raw) {
          return function patchedStorage(key, value) {
            var hit = keys.some(function (k) { return String(key).indexOf(k) >= 0; });
            if (hit) {
              logHit("storage." + method, { key: String(key), value: summarizeValue(value) });
            }
            return raw.apply(this, arguments);
          };
        });
      });
    }

    if (SELECTED.indexOf("time-random") >= 0) {
      wrapValue(Date, "now", function (raw) {
        return function patchedDateNow() {
          var ret = raw.apply(this, arguments);
          logHit("Date.now", { value: summarizeValue(ret) });
          return ret;
        };
      });
      wrapValue(Math, "random", function (raw) {
        return function patchedMathRandom() {
          var ret = raw.apply(this, arguments);
          logHit("Math.random", { value: summarizeValue(ret) });
          return ret;
        };
      });
      if (global.crypto && typeof crypto.getRandomValues === "function") {
        wrapValue(crypto, "getRandomValues", function (raw) {
          return function patchedGetRandomValues(arr) {
            var ret = raw.apply(this, arguments);
            logHit("crypto.getRandomValues", { value: summarizeValue(arr) });
            return ret;
          };
        });
      }
    }

    if (SELECTED.indexOf("dynamic-code") >= 0) {
      if (typeof global.eval === "function") {
        wrapValue(global, "eval", function (rawEval) {
          return function patchedEval(code) {
            logHit("eval", { value: summarizeValue(code) });
            return rawEval.apply(this, arguments);
          };
        });
      }
      if (typeof global.Function === "function") {
        wrapValue(global, "Function", function (rawFunction) {
          var proxy = new Proxy(rawFunction, {
            construct: function (target, args) {
              logHit("new Function", { argc: args.length, last: summarizeValue(args[args.length - 1]) });
              return Reflect.construct(target, args);
            },
            apply: function (target, thisArg, args) {
              logHit("Function", { argc: args.length, last: summarizeValue(args[args.length - 1]) });
              return Reflect.apply(target, thisArg, args);
            }
          });
          markWrapped(proxy);
          return proxy;
        });
      }
    }

    if (SELECTED.indexOf("websocket") >= 0 && typeof global.WebSocket === "function") {
      wrapValue(global, "WebSocket", function (rawWS) {
        var proxy = new Proxy(rawWS, {
          construct: function (target, args) {
            logHit("WebSocket", { argc: args.length, url: summarizeValue(args[0]) });
            return Reflect.construct(target, args);
          }
        });
        markWrapped(proxy);
        return proxy;
      });
    }

    if (SELECTED.indexOf("postmessage") >= 0 && typeof global.postMessage === "function") {
      wrapValue(global, "postMessage", function (rawPostMessage) {
        return function patchedPostMessage(message, targetOrigin, transfer) {
          logHit("postMessage", {
            message: summarizeValue(message),
            targetOrigin: summarizeValue(targetOrigin)
          });
          return rawPostMessage.apply(this, arguments);
        };
      });
    }
  }

  function uninstall() {
    for (var i = patches.length - 1; i >= 0; i--) {
      var p = patches[i];
      try {
        if (p.kind === "value") {
          var cur = Object.getOwnPropertyDescriptor(p.owner, p.key);
          if (cur && cur.value === p.wrapped) {
            Object.defineProperty(p.owner, p.key, {
              configurable: cur.configurable,
              enumerable: cur.enumerable,
              writable: cur.writable,
              value: p.original
            });
          }
        } else if (p.kind === "accessor") {
          var curA = Object.getOwnPropertyDescriptor(p.owner, p.key);
          if (curA && curA.get === p.wrapped.get && curA.set === p.wrapped.set) {
            Object.defineProperty(p.owner, p.key, p.original);
          }
        }
      } catch (e) {}
    }
    patches.length = 0;
  }

  function install() {
    if (patches.length) uninstall();
    installSelected();
  }

  var control = { install: install, uninstall: uninstall, patches: patches };
  // 控制句柄仅 return 给宿主（eval/vm 接收）；禁止挂到被测 global/window 调试字段。
  install();
  return control;
})(typeof window !== "undefined" ? window : globalThis);
`;
}

try {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const content = build(args);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, content, 'utf8');
    console.log(`已写入 Hook 模板：${path.resolve(args.out)}`);
  } else {
    process.stdout.write(content);
  }
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}

module.exports = { parseArgs, build, usage };
