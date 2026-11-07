/* 设置页纯逻辑单测：node --test 直跑（npm run test:settings），零依赖。
   被测对象是 components/settings/ 下的四个纯模块；store 层的 applyPref / retryPrefs
   依赖 pinia + dexie，按契约不在这份测试里加载——它由另一条最小脚本单独取证。
   期望值一律取自设计总稿 model.mjs（归一口径、检索口径、12 步历史、去空白字数），
   不在这里写第二份业务规则。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_PAGES, SETTINGS_PAGE_KEYS, SETTINGS_CATALOG, searchSettings
} from '../app/src/components/settings/settings-catalog.js'
import {
  SETTINGS_DEFAULTS, SETTINGS_SAVE_ERROR, normalizeSettingsPrefs, createSettingsHistory, resetAppearancePrefs
} from '../app/src/components/settings/settings-prefs.js'
import { summarizeLibrary } from '../app/src/components/settings/settings-summary.js'
import { APP_VERSION } from '../app/src/components/settings/settings-version.js'

/* ---------- 偏好归一 ---------- */

test('normalize：字号夹在 13–24 且取整', () => {
  assert.equal(normalizeSettingsPrefs({ fontSize: 40 }).fontSize, 24, '上界 24')
  assert.equal(normalizeSettingsPrefs({ fontSize: 1 }).fontSize, 13, '下界 13')
  assert.equal(normalizeSettingsPrefs({ fontSize: 17.6 }).fontSize, 18, '四舍五入进位')
  assert.equal(normalizeSettingsPrefs({ fontSize: 17.4 }).fontSize, 17, '四舍五入舍去')
  assert.equal(normalizeSettingsPrefs({ fontSize: '20' }).fontSize, 20, '数字串按数值处理')
})

test('normalize：缺失或非法字号回退 17', () => {
  for (const bad of [undefined, null, 'abc', NaN, Infinity, {}]) {
    assert.equal(normalizeSettingsPrefs({ fontSize: bad }).fontSize, 17, '非法字号 ' + String(bad))
  }
  assert.equal(normalizeSettingsPrefs().fontSize, 17, '无参数')
  assert.equal(normalizeSettingsPrefs(null).fontSize, 17, 'null 入参')
})

test('normalize：未知字体 key 回退默认，合法 key 原样保留', () => {
  assert.equal(normalizeSettingsPrefs({ editorFont: 'nope' }).editorFont, 'song')
  assert.equal(normalizeSettingsPrefs({ editorLatin: 'nope' }).editorLatin, 'none')
  assert.equal(normalizeSettingsPrefs({ editorFont: 'constructor' }).editorFont, 'song', '原型链上的名字不算合法字体')
  assert.equal(normalizeSettingsPrefs({ editorFont: 'kai' }).editorFont, 'kai')
  assert.equal(normalizeSettingsPrefs({ editorLatin: 'gothic' }).editorLatin, 'gothic')
})

test('normalize：topbarAutoHide 只认 true', () => {
  assert.equal(normalizeSettingsPrefs({ topbarAutoHide: true }).topbarAutoHide, true)
  assert.equal(normalizeSettingsPrefs({ topbarAutoHide: 'true' }).topbarAutoHide, false)
  assert.equal(normalizeSettingsPrefs({ topbarAutoHide: 1 }).topbarAutoHide, false)
  assert.equal(normalizeSettingsPrefs({}).topbarAutoHide, false)
})

test('resetAppearancePrefs：只回默认外观，且不与默认常量共享引用', () => {
  const fresh = resetAppearancePrefs()
  assert.deepEqual(fresh, SETTINGS_DEFAULTS)
  fresh.fontSize = 24
  assert.equal(SETTINGS_DEFAULTS.fontSize, 17, '改返回值不能污染默认值')
})

/* ---------- 设置检索 ---------- */

test('search：按字体名命中中文字体项', () => {
  const rows = searchSettings('文楷')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'editorFont')
})

test('search：按英文 term 命中，且大小写不敏感', () => {
  assert.deepEqual(searchSettings('playfair').map((x) => x.id), ['editorLatin'])
  assert.deepEqual(searchSettings('GOTHIC').map((x) => x.id), ['editorLatin'])
  assert.ok(searchSettings('epub').some((x) => x.id === 'import'), 'EPUB 是导入的真实格式')
})

test('search：按中文词跨条目命中', () => {
  assert.deepEqual(searchSettings('备份').map((x) => x.id).sort(), ['backup', 'restore'])
  assert.deepEqual(searchSettings('回收站').map((x) => x.id), ['trash'])
})

test('search：无匹配返回空数组', () => {
  assert.deepEqual(searchSettings('这里没有这样的设置'), [])
})

test('search：空查询返回空数组', () => {
  assert.deepEqual(searchSettings(''), [])
  assert.deepEqual(searchSettings('   '), [])
  assert.deepEqual(searchSettings(null), [])
  assert.deepEqual(searchSettings(undefined), [])
})

/* ---------- 目录完整性 ---------- */

test('目录：12 项、id 唯一、page 全在 SETTINGS_PAGES、每页至少一项', () => {
  assert.equal(SETTINGS_CATALOG.length, 12)
  const ids = SETTINGS_CATALOG.map((x) => x.id)
  assert.equal(new Set(ids).size, 12, 'id 不唯一：' + ids.join(','))
  assert.deepEqual(SETTINGS_PAGE_KEYS, ['appearance', 'data', 'about'])
  assert.deepEqual(SETTINGS_PAGES.map((p) => p.key), SETTINGS_PAGE_KEYS, '分类顺序即键顺序')
  for (const page of SETTINGS_PAGES) {
    for (const field of ['title', 'desc', 'icon', 'sub']) {
      assert.ok(String(page[field] || '').length > 0, '分类缺字段 ' + page.key + '.' + field)
    }
    assert.ok(SETTINGS_CATALOG.some((x) => x.page === page.key), page.key + ' 页没有任何条目')
  }
  for (const item of SETTINGS_CATALOG) {
    assert.ok(SETTINGS_PAGE_KEYS.includes(item.page), item.id + ' 的 page 非法：' + item.page)
    for (const field of ['title', 'desc', 'terms']) {
      assert.ok(String(item[field] || '').length > 0, item.id + ' 缺字段 ' + field)
    }
  }
})

/* ---------- 外观历史栈 ---------- */

test('history：按后进先出顺序撤销，空栈撤销返回 false', () => {
  const history = createSettingsHistory()
  history.checkpoint({ fontSize: 17 })
  history.checkpoint({ fontSize: 18 })
  history.checkpoint({ fontSize: 19 })
  assert.deepEqual(history.undo(), { fontSize: 19 })
  assert.deepEqual(history.undo(), { fontSize: 18 })
  assert.deepEqual(history.undo(), { fontSize: 17 })
  assert.equal(history.undo(), false)
})

test('history：超过 12 步丢最旧的一步', () => {
  const history = createSettingsHistory()
  for (let i = 1; i <= 15; i++) history.checkpoint({ fontSize: i })
  assert.equal(history.size(), 12)
  const drained = []
  for (let v = history.undo(); v; v = history.undo()) drained.push(v.fontSize)
  assert.deepEqual(drained, [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4], '只保留最近 12 步')
})

test('history：clear 之后为空且不可撤销', () => {
  const history = createSettingsHistory({ limit: 3 })
  history.checkpoint({ a: 1 })
  history.clear()
  assert.equal(history.size(), 0)
  assert.equal(history.undo(), false)
})

test('history：快照是纯数据副本，改动入栈对象不影响撤销结果', () => {
  const history = createSettingsHistory()
  const snapshot = { fontSize: 17 }
  history.checkpoint(snapshot)
  snapshot.fontSize = 24
  assert.deepEqual(history.undo(), { fontSize: 17 })
})

/* ---------- 作品库摘要 ---------- */

test('summary：空库六项全 0', () => {
  assert.deepEqual(summarizeLibrary({}), { works: 0, chapters: 0, words: 0, characters: 0, lore: 0, trash: 0 })
  assert.deepEqual(summarizeLibrary(), { works: 0, chapters: 0, words: 0, characters: 0, lore: 0, trash: 0 })
})

test('summary：条目数与去空白字数按工程口径统计（html 正文先剥标签）', () => {
  const summary = summarizeLibrary({
    works: [{ id: 'w1' }, { id: 'w2' }],
    chapters: [
      { id: 'c1', content: '雾中的船。' },
      { id: 'c2', content: 'a b c' },
      { id: 'c3', fmt: 'html', content: '<p>你好</p>' }
    ],
    characters: [{ id: 'p1' }, { id: 'p2' }],
    lore: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }],
    trash: [{ id: 't1' }]
  })
  assert.deepEqual(summary, { works: 2, chapters: 3, words: 10, characters: 2, lore: 4, trash: 1 })
})

/* ---------- 保存失败文案与版本 ---------- */

test('SETTINGS_SAVE_ERROR 与总稿 model.mjs:31 一字不差', () => {
  assert.equal(SETTINGS_SAVE_ERROR, '改动尚未保存，当前选择仍保留。请释放存储空间后重试。')
})

test('APP_VERSION 在无构建注入的 node 环境下回退 0.0.0', () => {
  assert.equal(APP_VERSION, '0.0.0')
})
