/* 灵感模型的纯函数单测：node 直跑、零依赖（npm run test:snippets）。
   被测对象是 app/src/components/snippets/snippet-model.js —— 不碰 DOM / Dexie / Vue，
   所以这里只钉真契约：首行标题的拆合、筛选与三种排序、分栏、计数、顺序工具、状态与草稿归一。 */
import assert from 'node:assert/strict'
import {
  boardGroups, dateLabel, joinContent, moveBefore, neighbourId, noteCounts, noteView,
  normalizeDrafts, normalizeLinks, normalizeSnipState, normalizeTag, normalizeTags,
  reconcileOrder, splitNote, stamp, visibleNotes
} from '../app/src/components/snippets/snippet-model.js'

let failed = 0
let passed = 0
function eq(actual, expected, label) {
  try {
    assert.deepEqual(actual, expected)
  } catch (e) {
    console.error('  FAIL ' + label + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual))
    throw e
  }
}
function ok(value, label, detail) {
  try {
    assert.ok(value, detail)
  } catch (e) {
    console.error('  FAIL ' + label + '：期望为真，实际 ' + String(value) + (detail ? '（' + detail + '）' : ''))
    throw e
  }
}
function run(name, fn) {
  try {
    fn()
    passed++
    console.log('PASS ' + name)
  } catch (e) {
    failed++
    console.error('FAIL ' + name)
    if (!/^  FAIL/.test(String((e && e.stack) || '').split('\n')[0])) console.error('      ' + String((e && e.message) || e))
  }
}

const T = Date.UTC(2026, 10, 7, 9, 42)
const row = (id, title, body, tags = [], links = [], createdAt = T) => ({
  id, content: body ? title + '\n\n' + body : title, tags, links, createdAt, deletedAt: null
})

run('首行即标题：拆与合可往返', () => {
  eq(splitNote({ content: '海上的门\n\n门只在退潮时打开。' }), { title: '海上的门', body: '门只在退潮时打开。' }, '拆')
  eq(splitNote({ content: '只有标题' }), { title: '只有标题', body: '' }, '只有标题')
  eq(joinContent('海上的门', '门只在退潮时打开。'), '海上的门\n\n门只在退潮时打开。', '合')
  eq(joinContent('只有标题', '  '), '只有标题', '空正文不追加空行')
  /* AI 提案会额外写 title 字段：content 为空时退到 title，不退成空标题 */
  eq(splitNote({ content: '', title: '提案标题' }).title, '提案标题', 'title 兜底')
})

run('日期分组与标签归一', () => {
  const { date, time } = stamp(T + 8 * 3600 * 1000 * 0)
  ok(/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time), 'date/time 形状', date + ' ' + time)
  eq(dateLabel(date, date), '今天', '今天')
  eq(dateLabel('2026-11-03', '2026-11-07'), '11 月 03 日', '月日')
  eq(normalizeTag('  #潮汐  '), '潮汐', '去空白与前导 #')
  eq(normalizeTag('x'.repeat(40)).length, 30, '上限 30')
  eq(normalizeTags(['潮汐', ' 潮汐 ', '', '雾港']), ['潮汐', '雾港'], '去重去空')
  eq(normalizeLinks([{ kind: 'chapter', id: 'c1' }, { kind: 'chapter', id: 'c1' }, { kind: 'nope', id: 'x' }, { kind: 'mubu', id: '' }]),
    [{ kind: 'chapter', id: 'c1' }], '关联只留三种合法 kind 且去重')
})

run('筛选：全部 / 未标记 / 有关联 / 回收站 + 单标签 + 检索', () => {
  const notes = [
    noteView(row('a', '退潮', '钟声从海底传来', ['场景', '雾港'], [{ kind: 'chapter', id: 'c1' }])),
    noteView(row('b', '修表', '他害怕整点', ['人物'])),
    noteView(row('c', '第二把钥匙', '两把相同的钥匙')),
    noteView({ ...row('d', '删掉的', '不该出现在全部里'), deletedAt: T })
  ]
  eq(visibleNotes(notes, {}).map((n) => n.id), ['a', 'b', 'c'], '默认不含回收站')
  eq(visibleNotes(notes, { filter: 'trash' }).map((n) => n.id), ['d'], '回收站')
  eq(visibleNotes(notes, { filter: 'untagged' }).map((n) => n.id), ['c'], '未标记')
  eq(visibleNotes(notes, { filter: 'linked' }).map((n) => n.id), ['a'], '有关联')
  eq(visibleNotes(notes, { tag: '雾港' }).map((n) => n.id), ['a'], '单标签')
  eq(visibleNotes(notes, { query: '钟声' }).map((n) => n.id), ['a'], '检索正文')
  /* 关联目标名也进检索（设计稿「查找…关联名称」） */
  const withName = [noteView(row('e', '信', '正文', [], [{ kind: 'character', id: 'p1' }]), { 'character:p1': '陆闻舟' })]
  eq(visibleNotes(withName, { query: '陆闻舟' }).length, 1, '按关联名命中')
})

run('排序：最新 / 最早 / 手动（手动顺序里新记录天然在前）', () => {
  const notes = [
    noteView(row('old', '早', '', [], [], T - 2000)),
    noteView(row('new', '晚', '', [], [], T)),
    noteView(row('mid', '中', '', [], [], T - 1000))
  ]
  eq(visibleNotes(notes, { sort: 'new' }).map((n) => n.id), ['new', 'mid', 'old'], '最新')
  eq(visibleNotes(notes, { sort: 'old' }).map((n) => n.id), ['old', 'mid', 'new'], '最早')
  eq(visibleNotes(notes, { sort: 'manual', order: ['old', 'new', 'mid'] }).map((n) => n.id), ['old', 'new', 'mid'], '手动')
  /* order 里没登记的 id 排到最后，并回退到最新在前 */
  eq(visibleNotes(notes, { sort: 'manual', order: ['old'] }).map((n) => n.id), ['old', 'new', 'mid'], '缺失回退')
})

run('计数与分栏：每个标签一栏，未标记固定末栏', () => {
  const notes = [
    noteView(row('a', 'A', '', ['场景', '雾港'])),
    noteView(row('b', 'B', '', ['场景'])),
    noteView(row('c', 'C', '')),
    noteView({ ...row('d', 'D', ''), deletedAt: T })
  ]
  const counts = noteCounts(notes)
  eq([counts.all, counts.untagged, counts.linked, counts.trash], [3, 1, 0, 1], '计数')
  eq(counts.tags.map((t) => t.tag), ['场景', '雾港'], '标签按使用数降序')
  const lanes = boardGroups(notes)
  eq(lanes.map((g) => g.id), ['tag:场景', 'tag:雾港', 'untagged:'], '栏序')
  eq(lanes[0].notes.map((n) => n.id), ['a', 'b'], '同栏内容')
  ok(!lanes.some((g) => g.notes.some((n) => n.id === 'd')), '回收站条目不进栏')
})

run('顺序工具：neighbourId / moveBefore / reconcileOrder', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  eq(neighbourId(list, 'b', -1), 'a', '上移邻居')
  eq(neighbourId(list, 'b', 1), 'c', '下移邻居')
  eq(neighbourId(list, 'a', -1), null, '到头返回 null')
  eq(moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'], '挪到目标之前')
  eq(moveBefore(['a', 'b', 'c'], 'a', ''), ['b', 'c', 'a'], '挪到末尾')
  /* 传进来的 ids 是当前显示顺序（最新在前）：新 id 保持这个先后补到最前，消失的 id 清掉 */
  eq(reconcileOrder(['b', 'gone'], ['a', 'b', 'c']), ['a', 'c', 'b'], '新 id 在前、消失的 id 清掉')
})

run('状态与草稿归一：坏数据退回默认，不让界面卡死', () => {
  const d = normalizeSnipState(null)
  eq([d.view, d.filter, d.sort, d.inspector.journal, d.inspector.board], ['journal', 'all', 'new', true, false], '默认')
  const v = normalizeSnipState({ view: 'board', filter: 'nope', sort: 'manual', tag: ' #潮汐 ', moreTags: true, inspector: { board: true }, order: ['a', 1], scroll: { journal: 'x', board: 42 } })
  eq([v.view, v.filter, v.sort, v.tag, v.moreTags], ['board', 'all', 'manual', '潮汐', true], '合法值保留、非法值归一')
  eq(v.inspector, { journal: true, board: true }, '详情开合')
  eq(v.order, ['a', '1'], '顺序转字符串')
  eq(v.scroll, { journal: {top:0,left:0}, board: {top:42,left:0} }, '滚动位置')
  eq(normalizeDrafts({ quick: '没写完', edit: { x: { title: 't', body: 'b' }, y: null } }), { quick: '没写完', edit: { x: { title: 't', body: 'b' } } }, '草稿')
})

console.log('\n' + passed + ' / ' + (passed + failed) + ' 项通过')
if (failed) process.exit(1)
