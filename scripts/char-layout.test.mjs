/* 人物工作区的宽度算法单测：node 直跑、零依赖（npm run test:char-layout）。
   被测对象是 app/src/components/characters/char-layout.js 的纯函数——不碰 DOM、不碰 Vue，
   所以这里只钉四条真契约：夹紧区间、键盘步长、复位默认值、以及「视图 × 收起 × 预算」下的列宽。
   断言用裸 assert：失败时打印期望/实际并 exit 1，不为好看引入测试框架。
   默认栏宽以 char-layout.js 的 CHAR_PANE[*].def 为准（设计稿 fusion.css:2-3 的 248/304、220/332），
   这里不写第二份。 */
import assert from 'node:assert/strict'
import {
  CHAR_PANE, MAIN_MIN, SHELL_PAD_X, DIVIDER_W, RAIL_W, CHAR_STEP,
  clampWidth, resetWidth, keyboardDelta, charWidths, isNarrow, normalizeCharPrefs
} from '../app/src/components/characters/char-layout.js'

let failed = 0
let passed = 0
function eq(actual, expected, label) {
  try {
    assert.equal(actual, expected)
  } catch (e) {
    console.error('  FAIL ' + label + '：期望 ' + expected + '，实际 ' + actual)
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

/* 主区宽度的独立算式：外壳内宽 = innerWidth - 56（左右各 28），两条 16px 分隔列，再减两列宽。 */
function mainWidth(w, left, right) {
  return w - SHELL_PAD_X - DIVIDER_W * 2 - left - right
}

run('clampWidth：左列 180–360 / 右列 260–480 夹紧，非数字退回该视图该列默认宽度', () => {
  eq(clampWidth('left', 1), 180, '左列下界 180')
  eq(clampWidth('left', 9999), 360, '左列上界 360')
  eq(clampWidth('right', 1), 260, '右列下界 260')
  eq(clampWidth('right', 9999), 480, '右列上界 480')
  eq(clampWidth('left', 1, 'graph'), 180, 'graph 左列下界同为 180')
  eq(clampWidth('right', 9999, 'graph'), 480, 'graph 右列上界同为 480')
  /* 非数字（含数字字符串、null）一律退回默认宽度：typeof 判据不认 Number() 可转换的值。 */
  for (const bad of [undefined, NaN, Infinity, -Infinity, 'bad', '300', null, {}, []]) {
    eq(clampWidth('left', bad), 248, 'profile 左列非法值 ' + JSON.stringify(bad))
    eq(clampWidth('right', bad), 304, 'profile 右列非法值 ' + JSON.stringify(bad))
  }
  eq(clampWidth('left', '300', 'graph'), 220, 'graph 左列非法值退回 graph 默认 220')
  eq(clampWidth('right', '300', 'graph'), 332, 'graph 右列非法值退回 graph 默认 332')
  eq(clampWidth('left', 248.6), 249, '四舍五入取整')
  eq(clampWidth('right', 303.4), 303, '四舍五入取整（右列）')
  eq(clampWidth('nope', 300), 300, '未知列名按左列区间 180..360 夹紧')
  eq(clampWidth('nope', 9999), 360, '未知列名上界走左列')
})

run('resetWidth：profile 248/304、graph 220/332', () => {
  const profile = resetWidth('profile')
  eq(profile.left, 248, 'profile.left')
  eq(profile.right, 304, 'profile.right')
  const graph = resetWidth('graph')
  eq(graph.left, 220, 'graph.left')
  eq(graph.right, 332, 'graph.right')
  eq(resetWidth().left, 248, '省略视图按 profile 复位')
  eq(resetWidth('nope').right, 304, '未知视图退到 profile')
  eq(JSON.stringify(resetWidth('profile')), JSON.stringify({ left: CHAR_PANE.profile.left.def, right: CHAR_PANE.profile.right.def }), 'profile 与 CHAR_PANE.def 同源')
})

run('keyboardDelta：←/→ ±12、右列方向取负、Home 返回 0', () => {
  eq(keyboardDelta('left', 'ArrowRight'), CHAR_STEP, '左列 → +12')
  eq(keyboardDelta('left', 'ArrowLeft'), -CHAR_STEP, '左列 ← -12')
  eq(keyboardDelta('right', 'ArrowRight'), -CHAR_STEP, '右列 → -12（方向取负）')
  eq(keyboardDelta('right', 'ArrowLeft'), CHAR_STEP, '右列 ← +12（方向取负）')
  eq(keyboardDelta('left', 'Home'), 0, 'Home 不产生步长（复位走 resetWidth）')
  eq(keyboardDelta('right', 'Home'), 0, 'Home 不产生步长（右列）')
  eq(keyboardDelta('left', 'Enter'), 0, '其它键 0')
  eq(keyboardDelta('nope', 'ArrowRight'), CHAR_STEP, '未知列名按左列方向 +12')
})

run('charWidths：1440/1280 profile 都是 248 + 304，1440 graph 是 220 + 332', () => {
  const p1440 = charWidths({ view: 'profile', innerWidth: 1440 })
  eq(p1440.left, 248, '1440 profile.left')
  eq(p1440.right, 304, '1440 profile.right')
  eq(mainWidth(1440, p1440.left, p1440.right), 800, '1440 profile 主区 800（设计稿实测 248 + 800 + 304）')
  const p1280 = charWidths({ view: 'profile', innerWidth: 1280 })
  eq(p1280.left, 248, '1280 profile.left')
  eq(p1280.right, 304, '1280 profile.right')
  eq(mainWidth(1280, p1280.left, p1280.right), 640, '1280 profile 主区 640（设计稿实测 248 + 640 + 304）')
  const g1440 = charWidths({ view: 'graph', innerWidth: 1440 })
  eq(g1440.left, 220, '1440 graph.left')
  eq(g1440.right, 332, '1440 graph.right')
  eq(mainWidth(1440, g1440.left, g1440.right), 800, '1440 graph 主区 800')
  const g1280 = charWidths({ view: 'graph', innerWidth: 1280 })
  eq(mainWidth(1280, g1280.left, g1280.right), 640, '1280 graph 主区 640')
  eq(charWidths({}).left, 248, 'innerWidth 缺省按 1440 算')
  eq(charWidths({ view: 'nope', innerWidth: 1440 }).right, 304, '未知视图按 profile 处理')
})

run('预算不足（1100 最窄宽档）：先压右列到 260，再压左列，主区守住 420', () => {
  const tight = charWidths({ view: 'profile', innerWidth: 1100, left: 360, right: 480 })
  eq(tight.right, 260, '右列被压到它的下界 260')
  eq(tight.left, 332, '右列到底后左列再让出剩余 28（360 → 332）')
  eq(mainWidth(1100, tight.left, tight.right), MAIN_MIN, '主区正好守住 420')
  /* 左列下界 180 由 clampWidth 保证（可用值仍可停在 180，见下一条）：左列在宽档里先被压是因为
     右列先让，最窄宽档 1100 上 360 + 480 只溢出 248，够不着左列下界——这不是漏测，是预算的算术。 */
  const narrowLeft = charWidths({ view: 'profile', innerWidth: 1120, left: 180, right: 480 })
  eq(narrowLeft.left, 180, '用户给 180 时左列就留在 180')
  eq(narrowLeft.right, 432, '右列独自让出 48（480 → 432）')
  eq(mainWidth(1120, narrowLeft.left, narrowLeft.right), MAIN_MIN, '1120 主区正好守住 420')
  for (let w = 1100; w <= 1920; w += 20) {
    for (const view of ['profile', 'graph']) {
      const l = charWidths({ view, innerWidth: w, left: 360, right: 480 })
      ok(mainWidth(w, l.left, l.right) >= MAIN_MIN, view + ' @' + w + ' 主区 >= 420', '主区 ' + mainWidth(w, l.left, l.right))
      ok(l.right >= 260, view + ' @' + w + ' 右列 >= 260', '右列 ' + l.right)
      ok(l.left >= 180, view + ' @' + w + ' 左列 >= 180', '左列 ' + l.left)
      ok(l.left + l.right <= w - SHELL_PAD_X - DIVIDER_W * 2 - MAIN_MIN, view + ' @' + w + ' 两列之和不超过预算')
    }
  }
})

run('收起态：leftClosed / rightClosed 都压到细轨 44', () => {
  eq(charWidths({ view: 'profile', innerWidth: 1440, leftClosed: true }).left, RAIL_W, 'profile 左列收起 → 44')
  eq(charWidths({ view: 'profile', innerWidth: 1440, leftClosed: true }).right, 304, '收起左列不动右列')
  eq(charWidths({ view: 'graph', innerWidth: 1440, rightClosed: true }).right, RAIL_W, 'graph 右列收起 → 44')
  eq(charWidths({ view: 'graph', innerWidth: 1440, rightClosed: true }).left, 220, '收起右列不动左列')
  const both = charWidths({ view: 'profile', innerWidth: 1440, leftClosed: true, rightClosed: true })
  eq(both.left, 44, '两列都收 → 左 44')
  eq(both.right, 44, '两列都收 → 右 44')
  eq(RAIL_W, 44, '细轨宽 44（studio.css .workspace.left-closed/.right-closed 的 44px）')
})

run('窄档：isNarrow(1099)=true、(1100)=false；窄档两列都不进网格', () => {
  eq(isNarrow(1099), true, '1099 窄')
  eq(isNarrow(1100), false, '1100 宽')
  eq(isNarrow(760), true, '760 窄')
  eq(isNarrow(380), true, '380 窄')
  eq(isNarrow('1099'), true, '数字字符串按数值判定')
  eq(isNarrow(NaN), false, 'NaN 不算窄档')
  eq(isNarrow(undefined), false, '缺参不算窄档')
  eq(charWidths({ view: 'profile', innerWidth: 1099 }).left, 0, '窄档 left 交 0（列宽交给 CSS 两行网格）')
  eq(charWidths({ view: 'profile', innerWidth: 1099 }).right, 0, '窄档 right 交 0')
})

run('normalizeCharPrefs：null / 字符串宽度 / 缺字段都回默认', () => {
  const nul = normalizeCharPrefs(null)
  eq(nul.profile.left, 248, 'null → profile.left 248')
  eq(nul.profile.right, 304, 'null → profile.right 304')
  eq(nul.graph.left, 220, 'null → graph.left 220')
  eq(nul.graph.right, 332, 'null → graph.right 332')
  eq(nul.profile.leftClosed, false, 'null → leftClosed false')
  eq(nul.profile.rightClosed, false, 'null → rightClosed false')
  const dirty = normalizeCharPrefs({ profile: { left: '300', right: 9999 }, graph: 'nope' })
  eq(dirty.profile.left, 248, '字符串宽度退回默认 248')
  eq(dirty.profile.right, 480, '越界宽度夹到上界 480')
  eq(dirty.graph.left, 220, '视图值不是对象 → graph 默认')
  eq(dirty.graph.right, 332, '视图值不是对象 → graph 默认（右）')
  eq(dirty.graph.leftClosed, false, '缺字段 → 收起为 false')
  const kept = normalizeCharPrefs({ profile: { left: 300, right: 320, leftClosed: true, rightClosed: 'yes' } })
  eq(kept.profile.left, 300, '合法宽度原样保留')
  eq(kept.profile.right, 320, '合法宽度原样保留（右）')
  eq(kept.profile.leftClosed, true, 'leftClosed 保留')
  eq(kept.profile.rightClosed, false, "rightClosed 只认 true（'yes' 不算）")
})

console.log('')
console.log('char-layout 单测：' + passed + ' 例通过，' + failed + ' 例失败')
if (failed) process.exit(1)
