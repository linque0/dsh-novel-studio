/* 设定面板矩阵的宽度算法单测：node 直跑、零依赖（npm run test:lore-layout）。
   被测对象是 app/src/components/lore/lore-layout.js 的纯函数——不碰 DOM、不碰 Vue，
   所以这里只钉三条真契约：夹紧区间、键盘步长、以及「三视图 × 收起 × 预算」下的列宽。
   断言用裸 assert：失败时打印期望/实际并 exit 1，不为好看引入测试框架。
   nav 默认值以 lore-layout.js 的 LORE_PANE.nav.def 为准（设计稿 220），这里不写第二份。 */
import assert from 'node:assert/strict'
import {
  LORE_PANE, RAIL_W, MAIN_MIN,
  clampWidth, resetWidth, keyboardDelta, loreWidths
} from '../app/src/components/lore/lore-layout.js'

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
    if (!/^  FAIL/.test(String(e && e.stack || '').split('\n')[0])) console.error('      ' + String(e && e.message || e))
  }
}

/* 主区宽度的独立算式：shell 内宽 = innerWidth - 56（左右各 28），
   三视图的额外分隔列分别是 1（write）与 2（detail/map），故减去 16 或 32。 */
function mainWidth(view, w, nav, list, detail) {
  const extra2 = view === 'write' ? 16 : 32
  return w - 56 - extra2 - nav - list - detail
}

run('clampWidth：上下界夹紧、非法值退回各自默认宽度', () => {
  eq(clampWidth('nav', 1), 180, 'nav 下界')
  eq(clampWidth('nav', 9999), 360, 'nav 上界')
  eq(clampWidth('list', 1), 240, 'list 下界')
  eq(clampWidth('list', 9999), 420, 'list 上界')
  eq(clampWidth('detail', 1), 280, 'detail 下界')
  eq(clampWidth('detail', 9999), 460, 'detail 上界')
  /* undefined / NaN / Infinity / 非数字串 / 对象：Number() 出来不是有限数，退回默认宽度。
     null 与 '' 是例外——Number(null)=Number('')=0 是有限数，于是落到「夹紧下界」，
     这里按实测行为钉住（改为 220 属于行为变更，要先改 lore-layout.js）。 */
  for (const bad of [undefined, NaN, Infinity, -Infinity, 'bad', {}]) {
    eq(clampWidth('nav', bad), 220, 'nav 非法值 ' + JSON.stringify(bad))
    eq(clampWidth('list', bad), 300, 'list 非法值 ' + JSON.stringify(bad))
    eq(clampWidth('detail', bad), 348, 'detail 非法值 ' + JSON.stringify(bad))
  }
  eq(clampWidth('nav', null), 180, 'null 被 Number() 读成 0 → 夹到下界')
  eq(clampWidth('list', ''), 240, "空串被读成 0 → 夹到下界")
  eq(clampWidth('nav', 240.4), 240, '四舍五入取整')
  eq(clampWidth('nope', 300), 300, '未知列名按 nav 的区间 180..360 夹紧')
  eq(clampWidth('nope', 9999), 360, '未知列名上界走 nav')
})

run('resetWidth：三列默认值 220 / 300 / 348', () => {
  eq(resetWidth('nav'), 220, 'nav 默认')
  eq(resetWidth('list'), 300, 'list 默认')
  eq(resetWidth('detail'), 348, 'detail 默认')
  eq(resetWidth('nope'), 220, '未知列名退到 nav 默认')
  eq(LORE_PANE.nav.def, 220, 'LORE_PANE.nav.def')
  eq(LORE_PANE.list.def, 300, 'LORE_PANE.list.def')
  eq(LORE_PANE.detail.def, 348, 'LORE_PANE.detail.def')
  eq(RAIL_W, 40, '细轨宽 40')
  eq(MAIN_MIN, 480, '主区最小 480')
})

run('keyboardDelta：←/→ ±10、Shift ±40、detail 反向、Home=0', () => {
  eq(keyboardDelta('nav', 'ArrowRight', false), 10, 'nav → 10')
  eq(keyboardDelta('nav', 'ArrowLeft', false), -10, 'nav ← -10')
  eq(keyboardDelta('nav', 'ArrowRight', true), 40, 'nav shift → 40')
  eq(keyboardDelta('nav', 'ArrowLeft', true), -40, 'nav shift ← -40')
  eq(keyboardDelta('list', 'ArrowRight', false), 10, 'list → 10')
  eq(keyboardDelta('list', 'ArrowLeft', true), -40, 'list shift ← -40')
  eq(keyboardDelta('detail', 'ArrowRight', false), -10, 'detail → -10（方向取负）')
  eq(keyboardDelta('detail', 'ArrowLeft', false), 10, 'detail ← 10（方向取负）')
  eq(keyboardDelta('detail', 'ArrowRight', true), -40, 'detail shift → -40')
  eq(keyboardDelta('nav', 'Home', false), 0, 'Home 不产生步长（复位走 resetWidth）')
  eq(keyboardDelta('nav', 'Enter', false), 0, '其它键 0')
})

run('loreWidths@1440：write 只出 nav，detail 加 list=300，map 加 detail=348', () => {
  const write = loreWidths({ view: 'write', innerWidth: 1440 })
  eq(write.nav, 220, 'write.nav')
  eq(write.list, 0, 'write.list（不占列）')
  eq(write.detail, 0, 'write.detail（不占列）')
  eq(write.narrow, false, 'write.narrow')
  const detail = loreWidths({ view: 'detail', innerWidth: 1440 })
  eq(detail.nav, 220, 'detail.nav')
  eq(detail.list, 300, 'detail.list')
  eq(detail.detail, 0, 'detail.detail（不占列）')
  const map = loreWidths({ view: 'map', innerWidth: 1440 })
  eq(map.nav, 220, 'map.nav')
  eq(map.list, 0, 'map.list（不占列）')
  eq(map.detail, 348, 'map.detail')
  eq(mainWidth('write', 1440, write.nav, 0, 0), 1148, 'write 主区 1148')
  eq(mainWidth('detail', 1440, detail.nav, detail.list, 0), 832, 'detail 主区 832')
  eq(mainWidth('map', 1440, map.nav, 0, map.detail), 784, 'map 主区 784')
  eq(loreWidths({}).nav, 220, 'innerWidth 缺省按 1440 算')
  eq(loreWidths({ view: 'nope', innerWidth: 1440 }).nav, 220, '未知视图按 write 处理')
})

run('收起：三种组合的对应列都压到 40，其它列不动', () => {
  const navClosed = loreWidths({ view: 'write', innerWidth: 1440, navClosed: true })
  eq(navClosed.nav, 40, 'write + navClosed → nav 40')
  for (const view of ['write', 'detail', 'map']) {
    eq(loreWidths({ view, innerWidth: 1440, navClosed: true }).nav, 40, view + ' + navClosed → nav 40')
  }
  const listClosed = loreWidths({ view: 'detail', innerWidth: 1440, listClosed: true })
  eq(listClosed.list, 40, 'detail + listClosed → list 40')
  eq(listClosed.nav, 220, 'detail + listClosed → nav 不变')
  const detailClosed = loreWidths({ view: 'map', innerWidth: 1440, detailClosed: true })
  eq(detailClosed.detail, 40, 'map + detailClosed → detail 40')
  eq(detailClosed.nav, 220, 'map + detailClosed → nav 不变')
  const allClosed = loreWidths({ view: 'map', innerWidth: 1440, navClosed: true, listClosed: true, detailClosed: true })
  eq(allClosed.nav, 40, '三列全收 → nav 40')
  eq(allClosed.detail, 40, '三列全收 → detail 40')
})

run('预算不足（innerWidth=1120）：先压侧列，主区仍 >= 480', () => {
  const write = loreWidths({ view: 'write', innerWidth: 1120 })
  eq(write.nav, 220, 'write.nav 不动')
  ok(mainWidth('write', 1120, write.nav, 0, 0) >= MAIN_MIN, 'write 主区 >= 480', '主区 ' + mainWidth('write', 1120, write.nav, 0, 0))
  const detail = loreWidths({ view: 'detail', innerWidth: 1120 })
  eq(detail.nav, 220, 'detail.nav 不动')
  eq(detail.list, 300, 'detail.list 仍 300')
  eq(mainWidth('detail', 1120, detail.nav, detail.list, 0), 512, 'detail 主区 512')
  const map = loreWidths({ view: 'map', innerWidth: 1120 })
  eq(map.nav, 220, 'map.nav 不动')
  eq(map.detail, 332, 'map.detail 被预算压到 332（默认 348）')
  eq(mainWidth('map', 1120, map.nav, 0, map.detail), 480, 'map 主区正好守住 480')
  for (let w = 1100; w <= 1920; w += 20) {
    for (const view of ['write', 'detail', 'map']) {
      const l = loreWidths({ view, innerWidth: w })
      const main = mainWidth(view, w, l.nav, l.list, l.detail)
      ok(main >= MAIN_MIN, view + ' @' + w + ' 主区 >= 480', '主区 ' + main)
    }
  }
})

run('拖到上界后预算仍生效：nav 360 时先压 detail 列、主区守住 480', () => {
  const wide = loreWidths({ view: 'map', innerWidth: 1440, navWidth: 360 })
  eq(wide.nav, 360, '1440 nav 吃满 360')
  eq(wide.detail, 348, '1440 detail 不被压')
  eq(mainWidth('map', 1440, wide.nav, 0, wide.detail), 644, '1440 主区 644')
  const tight = loreWidths({ view: 'map', innerWidth: 1120, navWidth: 360 })
  eq(tight.nav, 272, '1120 nav 被预算压到 272')
  eq(tight.detail, 280, '1120 detail 再也压不动，落到下界 280')
  eq(mainWidth('map', 1120, tight.nav, 0, tight.detail), 480, '1120 主区正好 480')
})

run('窄档边界：1099 为窄、1100 为宽', () => {
  eq(loreWidths({ view: 'write', innerWidth: 1099 }).narrow, true, '1099 窄')
  eq(loreWidths({ view: 'write', innerWidth: 1100 }).narrow, false, '1100 宽')
  eq(loreWidths({ view: 'detail', innerWidth: 760 }).narrow, true, '760 窄')
  eq(loreWidths({ view: 'map', innerWidth: 380 }).narrow, true, '380 窄')
  eq(loreWidths({ innerWidth: 0 }).narrow, false, 'innerWidth=0 被 || 兜底成 1440 → 按宽档算')
})

console.log('')
run('已有自定义目录宽度不被新默认值覆盖', () => { eq(loreWidths({ view: 'write', innerWidth: 1440, navWidth: 220 }).nav, 220, '保留旧偏好 220') })
console.log('lore-layout 单测：' + passed + ' 例通过，' + failed + ' 例失败')
if (failed) process.exit(1)


