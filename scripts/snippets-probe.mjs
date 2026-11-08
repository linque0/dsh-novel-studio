/* 灵感页行为探针（设计稿「已完成的交互」逐条落成断言）。
   由 verify:app 注入页面执行：module='snippets' 的每个宽度都会跑一遍。
   只操作真 DOM 与应用自己的 store（走窗口里的 pinia），不读源码、不假设实现细节；
   跑完把视图/筛选/排序/选中恢复成默认，避免截图继承探针态。 */
export async function snippetsProbe(frame, out, width) {
  const doc = frame.contentDocument, win = frame.contentWindow
  const need = (name, ok, e) => out.items.push({ name, pass: !!ok, ev: e === undefined ? null : String(e) })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms || 140))
  const q = (sel) => doc.querySelector(sel)
  const qa = (sel) => Array.prototype.slice.call(doc.querySelectorAll(sel))
  const txt = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim()
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const cs = win.getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
  }
  const shell = q('.snip-shell')
  need('灵感外壳渲染', !!shell, shell ? 'ok' : '未找到 .snip-shell')
  if (!shell) return out
  win.__SNIP_STEP = 'step1-head';
  const wide = width >= 1200
  const narrow = width < 1200
  const phone = width <= 680

  const count = () => Number((txt(q('.snip-scope .num')) || '0').replace(/[^0-9]/g, ''))
  const navCount = (value) => Number(txt(q('.snip-nav-row[data-value="' + value + '"] b')) || 0)

  /* 1) 页头：标题 / 作品名 / 视图开关 / 检索 / 记一条 */
  need('页头标题与作品名', txt(q('.snip-heading h1')) === '灵感' && !!txt(q('.snip-crumb')),
    'h1=' + txt(q('.snip-heading h1')) + ' crumb=' + txt(q('.snip-crumb')))
  need('页头工具齐备（视图开关 / 检索 / 记一条）',
    !!q('.snip-view-switch button[role="tab"]') && !!q('.snip-search input') && !!q('.snip-head-tools .snip-primary'),
    'switch=' + qa('.snip-view-switch button').length + ' search=' + !!q('.snip-search input') + ' compose=' + !!q('.snip-head-tools .snip-primary'))
  need('左栏计数与标签列表', !!q('.snip-nav-row[data-value="all"]') && (wide ? !!q('.snip-nav .snip-nav-title-line') : true),
    '全部=' + navCount('all') + ' 标签行=' + qa('.snip-nav [data-tag]').length)

  win.__SNIP_STEP = 'step2-view';
  /* 2) 手札 → 拼板：视图开关 + Alt+1/2 + 分栏 */
  const journalShown = visible(q('.snippet-surface'))
  q('.snip-view-switch button[role="tab"]:last-child')?.click()
  await wait(220)
  const lanes = qa('.snip-lane')
  need('切到拼板后按标签分栏', !!q('.snip-lanes') && lanes.length >= 1,
    'lane=' + lanes.length + ' 手札可见=' + journalShown + ' board=' + !!q('.snip-board'))
  need('拼板每栏都有加号入口', lanes.every((lane) => !!lane.querySelector('.snip-lane-head button')),
    '栏数=' + lanes.length + ' 带加号=' + lanes.filter((l) => l.querySelector('.snip-lane-head button')).length)
  if (typeof requestShot === 'function') await requestShot('snippets-board-' + win.innerWidth)
  const dragHandles = qa('.snip-lane .snip-drag-handle')
  need('拼板卡片带拖动手柄', dragHandles.length > 0 && dragHandles[0].getAttribute('draggable') === 'true',
    '手柄=' + dragHandles.length + ' draggable=' + (dragHandles[0] ? dragHandles[0].getAttribute('draggable') : 'n/a'))
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: '1', altKey: true, bubbles: true }))
  await wait(200)
  need('Alt+1 回到手札', visible(q('.snippet-surface')) && q('.snip-view-switch button[role="tab"]')?.getAttribute('aria-selected') === 'true',
    'journal 可见=' + visible(q('.snippet-surface')))

  win.__SNIP_STEP = 'step3-capture';
  /* 3) 记录：首行作标题 + Ctrl+Enter */
  const before = count()
  const capInput = q('.snip-capture textarea')
  if (capInput) {
    capInput.value = '探针标题行\n\n探针正文行。'
    capInput.dispatchEvent(new win.Event('input', { bubbles: true }))
    await wait(80)
    const form = capInput.closest('form')
    form.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await wait(240)
    /* 提交后重渲染是异步的：等一拍再判断，否则会把「已提交但还没重渲染」当成没提交，记两条 */
    if (count() === before) { form.requestSubmit(); await wait(240) }
  }
  const after = count()
  const firstCard = qa('.snippet-surface .snip-note').map((el) => txt(el.querySelector('h3')))
  need('记录一条后条数 +1 且首行成为标题', after === before + 1 && firstCard.indexOf('探针标题行') >= 0,
    'before=' + before + ' after=' + after + ' 首条=' + (firstCard[0] || 'n/a'))

  win.__SNIP_STEP = 'step4-search';
  /* 4) 检索：命中标题并清除 */
  const search = q('.snip-search input')
  if (search) {
    search.value = '探针标题行'
    search.dispatchEvent(new win.Event('input', { bubbles: true }))
    await wait(220)
  }
  const searched = count()
  const clearBtn = qa('.snip-scope .snip-text-button').find((b) => txt(b).indexOf('清除筛选') >= 0)
  need('检索只命中目标片段', searched === 1, 'query=探针标题行 命中=' + searched)
  need('清除筛选按钮出现', !!clearBtn, clearBtn ? txt(clearBtn) : '未找到')

  win.__SNIP_STEP = 'step5-edit';
  /* 5) 详情：选中 + 编辑片段 + 显式保存（草稿在编辑时出现） */
  const target = qa('.snippet-surface .snip-note').find((el) => txt(el.querySelector('h3')) === '探针标题行')
  target?.click()
  await wait(240)
  const inspector = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  need('选中后片段详情可见', wide ? visible(inspector) : !!inspector,
    'wide=' + wide + ' inspector=' + !!inspector + ' 标题=' + txt(inspector && inspector.querySelector('.snip-inspect-head h2')))
  const editBtn = inspector && Array.prototype.slice.call(inspector.querySelectorAll('button')).find((b) => txt(b).indexOf('编辑片段') >= 0)
  editBtn?.click()
  await wait(200)
  const titleInput = inspector && inspector.querySelector('.snip-edit-form input[name="title"]')
  const draftStatus = inspector ? txt(inspector.querySelector('.snip-edit-draft')) : ''
  need('编辑片段进入表单并显示未提交状态', !!titleInput && draftStatus === '有未提交修改',
    titleInput ? '草稿=' + draftStatus : '未找到标题输入; connected='+inspector?.isConnected+' liveForms='+qa('.snip-edit-form').length+' drafts='+JSON.stringify(doc.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('ui')?.snipDrafts))
  if (titleInput) {
    titleInput.value = '探针标题行已改'
    titleInput.dispatchEvent(new win.Event('input', { bubbles: true }))
    inspector.querySelector('.snip-edit-form textarea[name="body"]').value = '改过的正文。'
    await wait(120)
    inspector.querySelector('.snip-edit-form').requestSubmit()
    await wait(280)
  }
  const renamed = qa('.snippet-surface .snip-note').some((el) => txt(el.querySelector('h3')) === '探针标题行已改')
  need('保存修改后卡片标题更新', renamed, 'find=探针标题行已改 ' + renamed)

  win.__SNIP_STEP = 'step5b-cancel-edit';
  /* 5b) 改过之后点「取消」必须回到阅读态；再重新选中也不能停在表单（残留草稿回归） */
  const inspCancel = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  inspCancel?.querySelector('.snip-edit-button')?.click()
  await wait(200)
  const formOpen = !!inspCancel?.querySelector('.snip-edit-form')
  need('再次点编辑进入表单', formOpen, 'form=' + formOpen)
  const cancelBtn = inspCancel && Array.prototype.slice.call(inspCancel.querySelectorAll('.snip-edit-controls button')).find((b) => txt(b) === '取消')
  cancelBtn?.click()
  await wait(220)
  /* 阅读态判据：表单消失 + 编辑按钮回来（宽档手札不显示正文摘要，故不能拿 .snip-detail-copy 当条件） */
  const readBack = !!inspCancel && !inspCancel.querySelector('.snip-edit-form') &&
    Array.prototype.slice.call(inspCancel.querySelectorAll('button')).some((x) => txt(x).indexOf('编辑片段') >= 0)
  need('点取消回到阅读态', readBack,
    'form=' + !!inspCancel?.querySelector('.snip-edit-form') + ' 编辑按钮=' + !!inspCancel)
  /* 换选再选回：残留草稿不得让详情一进来就是编辑表单 */
  const reopened = qa('.snippet-surface .snip-note').find((el) => txt(el.querySelector('h3')) === '探针标题行已改')
  reopened?.click()
  await wait(240)
  const inspReopen = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  need('重新打开详情停在阅读态而非表单', !!inspReopen && !inspReopen.querySelector('.snip-edit-form'),
    'form=' + !!inspReopen?.querySelector('.snip-edit-form'))

  win.__SNIP_STEP = 'step6-tag';
  /* 6) 标签：加一个再移除 */
  const tagInput = inspector && inspector.querySelector('.snip-tag-form input[name="tag"]')
  if (tagInput) {
    tagInput.value = '探针标签'
    tagInput.dispatchEvent(new win.Event('input', { bubbles: true }))
    inspector.querySelector('.snip-tag-form').requestSubmit()
    await wait(260)
  }
  /* 左栏默认只列前 7 个标签（设计稿「全部」展开）：先展开再判，否则新标签排在后面看不到 */
  if (!q('.snip-nav-row[data-tag="探针标签"]')) {
    qa('.snip-nav-title-line button').find((b) => txt(b) === '全部')?.click()
    await wait(200)
  }
  const tagged = !!q('.snip-nav-row[data-tag="探针标签"]')
  need('加标签后左栏出现计数', tagged,
    'tag 行=' + (tagged ? txt(q('.snip-nav-row[data-tag="探针标签"]')) : '未出现') +
    ' 选中=' + (win.__ns && win.__ns.getWork ? win.__ns.getWork().selSnippetId : 'n/a') +
    ' 详情标签=' + (inspector ? txt(inspector.querySelector('.snip-tags')) : '无详情') +
    ' 表单=' + !!tagInput)
  const tagChip = inspector && Array.prototype.slice.call(inspector.querySelectorAll('.snip-edit-tag')).find((el) => txt(el).indexOf('探针标签') >= 0)
  tagChip?.querySelector('button')?.click()
  await wait(240)
  need('移除标签后左栏计数消失', !q('.snip-nav-row[data-tag="探针标签"]'),
    'tag 行=' + (q('.snip-nav-row[data-tag="探针标签"]') ? '仍在' : '已消失'))

  win.__SNIP_STEP = 'step7-link';
  /* 7) 关联：添加 + 预览 + 移除 */
  const beforeLinks = inspector ? inspector.querySelectorAll('.snip-link-row').length : 0
  const addLinkBtn = inspector && Array.prototype.slice.call(inspector.querySelectorAll('button')).find((b) => txt(b).indexOf('添加关联') >= 0)
  addLinkBtn?.click()
  await wait(200)
  const linkSelect = q('[data-dialog="action"] select')
  if (linkSelect && linkSelect.options.length) {
    q('[data-dialog="action"] form').requestSubmit()
    await wait(300)
  }
  const afterLinks = (wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector'))?.querySelectorAll('.snip-link-row').length
  need('添加关联后已有关联 +1', Number(afterLinks) === beforeLinks + 1, 'before=' + beforeLinks + ' after=' + afterLinks)
  const firstRef = (wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector'))?.querySelector('.snip-link-row .snip-ref')
  firstRef?.click()
  await wait(220)
  need('关联目标可打开正文预览', !!q('.snip-preview-body'), q('.snip-preview-body') ? txt(q('.snip-preview-path')) : '未出现预览; toast='+txt(q('.snip-toast')))
  q('[data-dialog="action"] .snip-dialog-foot .snip-soft')?.click()
  await wait(160)
  ;(wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector'))?.querySelector('.snip-link-row .snip-unlink')?.click()
  await wait(240)
  const linksNow = (wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector'))?.querySelectorAll('.snip-link-row').length
  need('移除关联后回到原值', Number(linksNow) === beforeLinks, 'now=' + linksNow + ' expect=' + beforeLinks)

  win.__SNIP_STEP = 'step8-convert';
  /* 8) 转换：转为章节（未分卷）→ 预览 + 关联 */
  const insp2 = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  const convertBtn = insp2 && Array.prototype.slice.call(insp2.querySelectorAll('button')).find((b) => txt(b).indexOf('转为章节') >= 0)
  convertBtn?.click()
  await wait(220)
  const convertForm = q('[data-dialog="action"] form')
  const convertSelect = q('[data-dialog="action"] select')
  need('转为章节弹出位置选择', !!convertForm && !!convertSelect, convertForm ? 'options=' + (convertSelect ? convertSelect.options.length : 0) : '未出现转换弹窗')
  if (convertForm) {
    convertForm.requestSubmit()
    await wait(420)
  }
  need('转换后打开结果预览', !!q('.snip-preview-body'), q('.snip-preview-body') ? txt(q('.snip-preview-path')) : '未出现预览; toast='+txt(q('.snip-toast')))
  q('[data-dialog="action"] .snip-dialog-foot .snip-soft')?.click()
  await wait(200)
  const insp3 = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  need('转换后原灵感保留并多出一条关联',
    !!insp3 && insp3.querySelectorAll('.snip-link-row').length >= 1,
    '关联=' + (insp3 ? insp3.querySelectorAll('.snip-link-row').length : -1))

  win.__SNIP_STEP = 'step9-trash';
  /* 9) 回收站：移入 + 撤销恢复 */
  const trashBefore = navCount('trash')
  const insp4 = wide ? q('.snip-grid > .snip-inspector') : q('.snip-detail-dialog .snip-inspector')
  Array.prototype.slice.call(insp4 ? insp4.querySelectorAll('button') : []).find((b) => txt(b).indexOf('移入回收站') >= 0)?.click()
  await wait(300)
  const toast = q('.snip-toast')
  need('删除后出现带撤销的提示', !!toast && txt(toast).indexOf('撤销') >= 0, toast ? txt(toast) : '未出现 toast')
  const trashNow = navCount('trash')
  toast?.querySelector('button')?.click()
  await wait(320)
  need('撤销把同一条灵感移回原处', trashNow === trashBefore + 1 && navCount('trash') === trashBefore,
    'trash before=' + trashBefore + ' after=' + trashNow + ' undo=' + navCount('trash'))

  win.__SNIP_STEP = 'step10-narrow';
  /* 10) 窄档：目录抽屉 + 详情抽屉 + Esc 关闭 */
  if (narrow) {
    q('.snip-mobile-menu')?.click()
    await wait(240)
    need('窄档目录抽屉可打开', !!q('.snip-directory-dialog') && !!q('.snip-directory-dialog .snip-nav-row'),
      q('.snip-directory-dialog') ? 'ok 行=' + qa('.snip-directory-dialog .snip-nav-row').length : '未出现')
    q('.snip-drawer-head .snip-round')?.click()
    await wait(180)
    qa('.snippet-surface .snip-note')[0]?.click()
    await wait(260)
    if (typeof requestShot === 'function') await requestShot('snippets-detail-' + win.innerWidth)
    need('窄档详情是覆盖抽屉', !!q('.snip-detail-dialog') && !q('.snip-grid > .snip-inspector'),
      'detail=' + !!q('.snip-detail-dialog') + ' 常驻列=' + !!q('.snip-grid > .snip-inspector') +
      (phone ? ' phone=底部面板' : ''))
    // A trusted Escape produces dialog.cancel. Native key dispatch is covered by the release CDP test.
    q('dialog.snip-native[open]:last-of-type')?.dispatchEvent(new win.Event('cancel', { cancelable: true }))
    await wait(220)
    need('Esc 关闭详情抽屉', !q('.snip-detail-dialog'), 'detail=' + !!q('.snip-detail-dialog'))
    // 工具栏「片段详情」在窄档可用：点了能开抽屉（不再被 @media 隐藏）
    const toggle = q('.snip-detail-toggle')
    need('窄档工具栏片段详情按钮可见', !!toggle && toggle.getClientRects().length > 0,
      toggle ? 'display=' + getComputedStyle(toggle).display : '未找到')
    toggle?.click()
    await wait(240)
    need('窄档片段详情按钮可弹出抽屉', !!q('.snip-detail-dialog'),
      'detail=' + !!q('.snip-detail-dialog'))
    q('dialog.snip-native[open]:last-of-type')?.dispatchEvent(new win.Event('cancel', { cancelable: true }))
    await wait(220)
  } else {
    need('宽档详情是常驻列', !!q('.snip-grid > .snip-inspector') && !q('.snip-detail-dialog'),
      '常驻列=' + !!q('.snip-grid > .snip-inspector'))
  }

  win.__SNIP_STEP = 'step11-overflow';
  /* 11) 不横向溢出（模块内再判一次；页面级判据另有专门断言） */
  const host = q('.snippet-surface') || shell
  need('灵感内容不横向溢出', host.scrollWidth <= host.clientWidth + 1,
    host.scrollWidth + ' <= ' + host.clientWidth)

  /* 收尾：把探针制造的数据与状态收拾干净。
     删除是「发出即可」——不 await 写库，否则一次挂起的 IndexedDB 事务会把整轮验收拖成超时。 */
  try {
    const ws = win.__ns && win.__ns.getWork ? win.__ns.getWork() : null
    const probe = (ws && ws.snippets ? ws.snippets : []).filter((row) => String(row.content || '').indexOf('探针标题行') === 0)
    for (const row of probe) { if (!row.deletedAt) ws.deleteSnippet(row.id) }
    if (ws && probe.length) ws.selSnippetId = (ws.liveSnippets || [])[0]?.id || null
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: '1', altKey: true, bubbles: true }))
    const clear = q('.snip-scope .snip-text-button')
    if (clear) { clear.click() }
  } catch (e) { /* 收尾失败不影响判据 */ }
  win.__SNIP_STEP = 'done';
  return out;
}
