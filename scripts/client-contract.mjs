/* 客户端契约预检：用一个挑剔的宿主跑一遍 lib/client.js 的 apply()。
 * 守的是两件容易静默失效的事：
 *   1) 右侧栏「开始」页只渲染定义里带 guide 的类型 —— 少写 guide，卡片栏里就永远没有工坊；
 *   2) 卡片点击走 openTab(kind)，正文座位必须按同一个 id 注册，否则点开是空面板。 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '../lib/client.js'), 'utf8');

/* 只够跑 apply() 的假 React：不渲染，只保证组件构造时用到的 API 存在。 */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value })
};

const problems = [];
const tabs = [];
const seats = [];
const slotNames = [];
let loaderId = null;
let exported = null;

const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  effect: (fn) => { fn(); },
  connection: {},
  layout: { selectPanel: () => {} },
  locale: {},
  sidebarRight: { openResource: () => {} },
  sidebarRightTabs: { register: (definition) => { tabs.push(definition); return () => {}; } },
  slots: {
    inject: (name, fn) => { slotNames.push(name); return fn(); },
    register: (spec) => { seats.push(spec); return () => {}; }
  }
};

globalThis.window = {
  __ModuleLoader__: {
    load: (module) => {
      loaderId = module.id;
      exported = module.factory((name) => {
        if (name === 'react') return React;
        throw new Error('未预期的 require：' + name);
      });
    }
  }
};

let failure = null;
try {
  new Function('window', SOURCE)(globalThis.window);
  exported.apply(ctx);
} catch (error) {
  failure = error;
}

const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '  —— ' + detail));
  if (!ok) problems.push(name + ' ' + detail);
};

check('client bundle 走 __ModuleLoader__.load', loaderId === 'dsh-novel-studio', String(loaderId));
check('apply 不抛错', !failure, failure && (failure.message || String(failure)));

const INJECT = ['slots', 'sidebarRightTabs'];
check('inject 声明齐全', INJECT.every((key) => (exported.inject || []).includes(key)), JSON.stringify(exported && exported.inject));

const tab = tabs[0];
check('注册了右侧栏 tab 类型', tabs.length === 1, '注册 ' + tabs.length + ' 个');
if (tab) {
  check('tab 定义有 id / kind / title', typeof tab.id === 'string' && !!tab.id && typeof tab.kind === 'string' && !!tab.kind && typeof tab.title === 'function' && !!tab.title(), JSON.stringify({ id: tab.id, kind: tab.kind }));
  const guide = Array.isArray(tab.guide) ? tab.guide : [];
  check('定义里有 guide 条目（否则「开始」页不出卡片）', guide.length === 1, 'guide=' + guide.length);
  const entry = guide[0] || {};
  check('guide 条目的 title/description 是函数且非空', typeof entry.title === 'function' && !!entry.title() && typeof entry.description === 'function' && !!entry.description(), JSON.stringify({ title: typeof entry.title, description: typeof entry.description }));
  check('guide 条目带图标组件（没有就退化成默认方块）', typeof entry.icon === 'function', typeof entry.icon);
  let glyph = null;
  try { glyph = typeof entry.icon === 'function' ? entry.icon({ size: 22 }) : null; } catch (error) { problems.push('图标渲染抛错：' + error.message); }
  check('图标能渲染成 svg', !!glyph && glyph.type === 'svg' && glyph.children.length >= 2, glyph ? String(glyph.type) + ' children=' + glyph.children.length : 'null');
  const seat = seats.find((spec) => spec.name === 'sidebar.right.pane.tab');
  check('正文座位按同一个 id 注册（卡片点开不是空面板）', !!seat && seat.key === tab.id, seat ? JSON.stringify(seat.key) : '未注册');
}

/* 入口只留「开始」页卡片：左栏底部那枚「工坊」按钮与它重复，已下线（回归守在这里）。 */
check('左栏底部不再注册重复入口', !seats.some((spec) => spec.name === 'sidebar.footer.action'), seats.map((s) => s.name).join(','));

console.log('');
console.log((problems.length ? '客户端契约预检失败 ' + problems.length + ' 项' : '客户端契约预检通过') + '：tab 类型 ' + tabs.length + ' / 座位 ' + seats.length + ' / slot ' + slotNames.length);
if (problems.length) {
  problems.forEach((item) => console.log('  - ' + item));
  process.exit(1);
}
