// Injected into the existing isolated application harness, never into a user's work.
export async function loreFreeProbe(frame, out, width) {
  const doc = frame.contentDocument, win = frame.contentWindow
  const pinia = doc.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const w = pinia._s.get('work'), ui = pinia._s.get('ui'), workId = w.work.id
  const wait = ms => new Promise(r => setTimeout(r, ms)), q = s => doc.querySelector(s)
  const check = (name, pass, detail = '') => out.items.push({ name: '自由节点：' + name, pass: !!pass, ev: String(detail) })
  const until = async fn => { for (let i = 0; i < 40; i++) { if (fn()) return; await wait(35) } }
  const snapshot = JSON.parse(JSON.stringify(w.mubu)), location = ui.captureLoreLocation()
  const rootCount = w.mubuRoots().length
  const field = id => q('[data-node="m:' + id + '"] .ob-text')
  const focus = (id, offset = null) => {
    const el = field(id); if (!el) throw Error('missing field ' + id)
    el.focus(); const r = doc.createRange(); r.selectNodeContents(el)
    if (offset !== null && el.firstChild) r.setStart(el.firstChild, Math.min(offset, el.firstChild.textContent.length))
    else r.collapse(false)
    r.collapse(true); win.getSelection().removeAllRanges(); win.getSelection().addRange(r); return el
  }
  const key = (el, value, options = {}) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }))
  let root, first, second, target, relation
  try {
    root = w.mubuAdd(null, null, '潮雾档案')
    first = w.mubuAdd(root.id, null, '海雾观测'); first.heading = 2; first.kind = 'place'; first.tags = ['验收']; first.custom = { retained: true }
    const child = w.mubuAdd(first.id, null, '观测细节')
    second = w.mubuAdd(root.id, null, '潮汐记录')
    target = w.mubuAdd(null, null, '北岸工会')
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(first.id))
    check('任意根节点与递归目录', q('.lore-h1').textContent === root.text && !!q('.lore-nav-node[data-id="' + child.id + '"]'))
    q('[data-node="m:' + first.id + '"] .ob-bullet').click(); await until(() => ui.loreRootId === first.id && field(child.id))
    check('圆点聚焦并重置缩进', ui.loreRootId === first.id && field(child.id)?.closest('[data-depth]').dataset.depth === '0')
    if (width === 380) {
      const visible = el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right <= width && el.getBoundingClientRect().left >= q('.lore-main').getBoundingClientRect().left
      check('手机首屏可直接新建、设标题级别、插链接', [q('.lore-free-head .primary'), q('button[title="节点标题级别"]'), q('button[title="插入双链"]'), q('.lore-toolbar-overflow')].every(visible))
      check('手机圆点有足够触控宽度', q('[data-node="m:' + child.id + '"] .ob-bullet').getBoundingClientRect().width >= 28)
      check('手机视图切换按钮均在主区可见', [...doc.querySelectorAll('.lore-switch button')].every(visible))
    }
    await requestShot('lore-free-deep-' + width)
    q('.lore-history [aria-label="后退"]').click(); await until(() => field(first.id))
    check('后退恢复范围', ui.loreRootId === root.id)
    q('.lore-history [aria-label="前进"]').click(); await until(() => ui.loreRootId === first.id)
    check('前进恢复范围', ui.loreRootId === first.id)
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(first.id))
    q('[data-node="m:' + first.id + '"] .ob-fold-toggle').click(); await wait(60)
    check('折叠与聚焦独立', ui.loreRootId === root.id && !field(child.id)); q('[data-node="m:' + first.id + '"] .ob-fold-toggle').click(); await until(() => field(child.id))
    ui.loreLinksOpen = true; await wait(50)
    check('引用面板不产生横向溢出', !!q('.lore-reference-pane') && doc.documentElement.scrollWidth <= width, doc.documentElement.scrollWidth)
    check('引用面板按窗口宽度使用侧栏或覆盖层', width < 1100 ? q('.lore-reference-pane').classList.contains('overlay') : win.getComputedStyle(q('.lore-main')).display === 'grid')
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) check('减少动态效果时引用面板不播放动画', win.getComputedStyle(q('.lore-reference-pane')).animationName === 'none')
    await requestShot('lore-free-references-' + width)
    ui.lorePeek = { kind: 'mubu', id: target.id }; await wait(50); await requestShot('lore-free-peek-' + width); ui.lorePeek = null
    ui.loreLinksOpen = false
    ui.setLoreView('detail', { id: root.id }); await wait(80); await requestShot('lore-free-reading-' + width)
    ui.setLoreView('map'); ui.setLoreMapMode('hierarchy'); await wait(100); await requestShot('lore-free-hierarchy-' + width)
    relation = w.addLoreLink({ fromKind: 'mubu', fromId: first.id, toKind: 'mubu', toId: second.id, label: '记录于' })
    ui.setLoreMapMode('relations'); await wait(180); await requestShot('lore-free-network-' + width)
    if (width === 380) check('手机导图操作完整可见', [...doc.querySelectorAll('.lore-zoom button')].every(b => b.getBoundingClientRect().right <= width))
    ui.navigateLore({ view: 'write', scope: 'all', rootId: null }); await wait(80); await requestShot('lore-free-all-' + width)
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(first.id))
    if (width !== 1440) return
    w.loreHistories[workId] = { past: [], future: [], group: null, at: 0 }
    let el = focus(first.id, 2); key(el, 'Enter'); await wait(90)
    check('光标处分行不丢字', w.mubu.find(n => n.id === first.id).text === '海雾' && w.mubuChildren(root.id).some(n => n.text === '观测') && field(first.id).textContent === '海雾')
    el = doc.activeElement; key(el, 'z', { ctrlKey: true }); await until(() => w.mubu.find(n => n.id === first.id).text === '海雾观测'); await wait(50)
    check('一次撤销分行且保留完整元数据', field(first.id)?.textContent === '海雾观测' && w.mubu.find(n => n.id === first.id).custom.retained && w.mubu.find(n => n.id === first.id).heading === 2)
    el = focus(first.id); key(el, 'Tab', { shiftKey: true }); await wait(80)
    check('首个子节点可以提升为根', w.mubu.find(n => n.id === first.id).parentId === null && w.mubu.find(n => n.id === child.id).parentId === first.id)
    await w.mubuUndo(); await wait(80); ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(first.id))
    el = focus(second.id); const count = w.liveMubu().length
    key(el, 'Enter', { isComposing: true }); check('组合输入不触发结构命令', w.liveMubu().length === count)
    el.textContent = '前往 [[北岸工会'; focus(second.id); el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '北岸工会' })); await until(() => q('.lore-link-picker'))
    check('输入双括号出现候选', !!q('.lore-link-picker [data-target="mubu:' + target.id + '"]'))
    q('.lore-link-picker [data-target="mubu:' + target.id + '"]').click(); await wait(70)
    check('链接使用正式 ID 格式且不新增同级', /data-dl-target=/.test(w.mubu.find(n => n.id === second.id).html || '') && w.liveMubu().length === count)
    check('ID 链接恢复为不可拆散的行内对象', field(second.id).querySelector('[data-dl-target]')?.getAttribute('contenteditable') === 'false')
    field(second.id).querySelector('[data-dl-target]').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(50)
    check('点击链接侧看不打断主区', ui.loreRootId === root.id && ui.lorePeek?.id === target.id && !!q('.lore-peek-panel'))
    await requestShot('lore-free-linked-peek-1440')
    q('.lore-peek-panel footer button').click(); await wait(70)
    check('从侧边进入关闭预览', ui.loreRootId === target.id && !ui.lorePeek)
    check('聚焦叶节点显示添加子节点', q('.empty-shelf')?.textContent.includes('暂无子节点'))
    ui.loreLinksOpen = true; await wait(70)
    check('反向引用给出来源片段', !!q('.lore-backlink[data-source="mubu:' + second.id + '"]') && q('.lore-reference-scroll').textContent.includes('潮雾档案'))
    await requestShot('lore-free-backlinks-1440')
    w.mubuSetText(target.id, '北岸工会修订', null); await wait(50)
    check('改名不破坏反链', !!q('.lore-backlink[data-source="mubu:' + second.id + '"]'))
    w.mubuCheckpoint(); w.mubuRemove(target.id); await wait(60); ui.lorePeek = { kind: 'mubu', id: target.id, title: '北岸工会' }; await wait(50)
    check('删除目标显示失效而非重定向', q('.lore-peek-scroll')?.textContent.includes('已删除'))
    await w.mubuUndo(); ui.lorePeek = null; await wait(60)
    w.mubuRemove(first.id); w.mubuRestore(first.id); await wait(60)
    check('回收站恢复保持子树原 ID', w.liveMubu().some(n => n.id === first.id) && w.mubuChildren(first.id).some(n => n.id === child.id))
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(second.id))
    focus(second.id); q('button[title="插入双链"]').click(); await wait(50)
    check('工具栏链接按钮可打开候选', !!q('.lore-link-picker')); key(doc.activeElement, 'Escape')
    ui.focusLoreNode(second.id, w.mubuPath(second.id)); await wait(70)
    const heading = q('.lore-h1'); heading.focus(); heading.append(doc.createTextNode('修订')); heading.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '修订' })); await wait(50)
    check('聚焦标题续写保留 ID 链接', !!w.mubu.find(n => n.id === second.id).html?.includes('data-dl-target') && !!heading.querySelector('[data-dl-target]'))
    const richBefore = w.mubu.find(n => n.id === second.id).html
    heading.innerHTML = '<b>' + richBefore + '</b>'; heading.dispatchEvent(new win.InputEvent('input', { bubbles: true })); heading.blur(); await wait(35)
    q('button[title="撤销 (Ctrl+Z)"]').click(); await wait(70)
    check('工具栏撤销同步相同文字的主标题格式', !q('.lore-h1').querySelector('b') && !!q('.lore-h1').querySelector('[data-dl-target]'))
    ui.loreBack(); await wait(60); check('标题仍有焦点时后退显示正确名称', q('.lore-h1').textContent === root.text)
    ui.setLoreView('detail', { id: root.id }); await wait(60)
    doc.querySelector('.work-nav [data-module="chapters"]')?.click()
    // Use the actual navigation controls so the old Workbench reset cannot hide behind a store-only test.
    const moduleButton = text => [...doc.querySelectorAll('button')].find(b => b.textContent.trim() === text && b.closest('.latent-studio'))
    moduleButton('正文')?.click(); await wait(70); moduleButton('设定')?.click(); await wait(90)
    check('真实模块按钮保留阅读视图', ui.loreView === 'detail')
    w.navTo('lore', second.id); await wait(80); check('全局搜索入口进入范围外节点', ui.loreRootId === second.id && q('.lore-h1').textContent.includes('修订'))
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); await until(() => field(second.id))
    const imported = w.mubuAddTree(root.id, null, [{ text: '复制元数据', heading: 3, tags: ['保留'], kind: 'place', custom: { keep: true }, children: [{ text: '完整子树' }] }])
    check('子树粘贴保留标题标签及扩展字段', imported.heading === 3 && imported.tags[0] === '保留' && imported.custom.keep && w.mubuChildren(imported.id).length === 1)
    const context = async (id, label) => {
      await until(() => field(id))
      if (!field(id)) throw Error('missing visible node for ' + label)
      field(id).dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 450, clientY: 360 })); await wait(45)
      const action = [...doc.querySelectorAll('.ob-ctx .ctx-item')].find(e => e.firstElementChild?.textContent === label)
      if (!action) throw Error('missing context action ' + label)
      action.click(); await wait(65)
    }
    await context(imported.id, '剪切节点'); await context(first.id, '粘贴为子节点')
    check('真实剪贴保留 ID 与完整子树', w.mubu.find(n => n.id === imported.id)?.parentId === first.id && w.mubuChildren(imported.id).length === 1)
    await context(imported.id, '复制节点'); await context(second.id, '粘贴为子节点')
    check('真实复制保留标题与标签', w.mubuChildren(second.id).some(n => n.text === imported.text && n.heading === 3 && n.tags?.includes('保留')))
    w.mubuCheckpoint(); w.mubuSetText(first.id, '海雾观测', '<b>海雾观测</b>'); await wait(50); await w.mubuUndo(); await wait(60)
    check('撤销富文本相同文字也清除 DOM 标记', !field(first.id)?.querySelector('b'))
    const error = win.console.error
    try {
      await win.__flushNow()
      win.__NS_FAIL_LORE_SAVE = true
      win.console.error = function(...args) { if (String(args[0]).includes('[autosave]')) return; error.apply(this, args) }
      const failedInput = field(second.id); failedInput.append(doc.createTextNode(' · 保留输入')); failedInput.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' · 保留输入' })); await win.__flushNow().catch(() => {}); await wait(50)
      check('保存失败保留输入与重试入口', win.__NS_FAILED_LORE_SAVES > 0 && ui.autosave.error && ui.autosave.pending > 0 && !!q('.lore-free-save-error button') && field(second.id)?.textContent.includes('保留输入'), JSON.stringify({ faults: win.__NS_FAILED_LORE_SAVES, error: ui.autosave.error, pending: ui.autosave.pending, retry: !!q('.lore-free-save-error button'), text: field(second.id)?.textContent }))
    } finally { win.__NS_FAIL_LORE_SAVE = false; win.console.error = error }
    q('.lore-free-save-error button')?.click(); await until(() => !ui.autosave.error && ui.autosave.pending === 0)
    check('重试后保存成功', !ui.autosave.error && ui.autosave.pending === 0)
    const sameSort = w.mubuAdd(root.id, null, '持久化升根'); await win.__flushNow()
    const firstRoot = w.mubuRoots()[0]; sameSort.sortOrder = 0
    w.mubuMove(sameSort.id, firstRoot.id, 'before'); await win.__flushNow()
    const historySize = w.mubuHistory().past.length
    await w.closeWork(); await w.open(workId); w.tab = 'lore'; await wait(130)
    check('相同排序值的父级变更重新读取后仍保留', w.mubu.find(n => n.id === sameSort.id)?.parentId === null)
    check('关闭作品再打开保留作品编辑历史', w.mubuHistory().past.length === historySize)
    check('标题字段与 ID 链接重新读取后保留', w.mubu.find(n => n.id === second.id)?.html?.includes('data-dl-target') && w.mubu.find(n => n.id === first.id)?.heading === 2, JSON.stringify({ html: w.mubu.find(n => n.id === second.id)?.html, first: w.mubu.find(n => n.id === first.id) }))
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); ui.loreLinksOpen = true; await wait(60)
    const originalHistory = w.mubuHistory().past.length
    await ui.persistLoreState(workId); await w.closeWork(); await w.open('w2'); w.tab = 'lore'; await wait(150)
    check('其他作品不继承焦点与撤销历史', ui.loreWorkId === 'w2' && ui.loreRootId !== root.id && w.mubuHistory().past.length === 0)
    await w.closeWork(); await w.open(workId); w.tab = 'lore'; await wait(150)
    check('返回作品恢复自己的焦点与编辑历史', ui.loreWorkId === workId && ui.loreRootId === root.id && w.mubuHistory().past.length === originalHistory)
    await ui.persistLoreState(workId); const savedId = ui.loreRootId
    ui.loreWorkId = null; await ui.restoreLoreState(workId); await wait(60)
    check('存储恢复聚焦与引用面板状态', ui.loreRootId === savedId && ui.loreLinksOpen)
    const id = root.id; w.mubuCheckpoint(); w.mubuSetHeading(id, 3); await wait(40)
    const before = w.mubuHistory().past.length; w.tab = 'chapters'; await wait(60); w.tab = 'lore'; await wait(80)
    check('切换模块不清空作品撤销历史', w.mubuHistory().past.length === before)
    await w.mubuUndo(); check('元数据变更可撤销', (w.mubu.find(n => n.id === id).heading || 0) === 0)
    const rootsBefore = w.mubuRoots().length; w.mubuRemove(id); await wait(50); w.tab = 'chapters'; await wait(50); w.tab = 'lore'; await wait(80)
    check('删除的根节点不自动补回', w.mubuRoots().length === rootsBefore - 1)
    ui.loreBack(); await wait(70); check('历史中的失效范围退回有效祖先', !ui.loreRootId || w.liveMubu().some(n => n.id === ui.loreRootId))
  } catch (e) { check('行为探针可执行', false, e.stack || e) }
  finally {
    if (relation) w.removeLoreLink(relation.id)
    await w.mubuSyncTree(snapshot); ui.loreLinksOpen = false; ui.lorePeek = null; ui.applyLoreLocation(location); await wait(80)
    check('验收数据清理且旧根节点保留', w.mubuRoots().length === rootCount)
  }
}

// Reload the actual built iframe, retaining its isolated origin and database.
export async function loreReloadProbe(frame, out, width) {
  if (width !== 1440) return
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(40) } throw Error('reload readiness timeout') }
  let w = workStore(frame), ui = uiStore(frame)
  const snapshot = JSON.parse(JSON.stringify(w.mubu)), location = ui.captureLoreLocation(), id = w.work.id
  const check = (name, pass, ev = '') => out.items.push({ name: '刷新：' + name, pass: !!pass, ev })
  try {
    const root = w.mubuAdd(null, null, '刷新验收'), leaf = w.mubuAdd(root.id, null, '刷新链接')
    w.mubuSetHeading(leaf.id, 3); w.mubuSetTags(leaf.id, ['持久化'])
    w.mubuSetText(leaf.id, '引用刷新验收', '<span class="dl-link" data-dl-target="mubu:' + root.id + '">引用刷新验收</span>')
    ui.focusLoreNode(root.id, w.mubuPath(root.id)); ui.loreLinksOpen = true; ui.loreReferenceTab = 'outline'
    await ui.persistLoreState(id); await frame.contentWindow.__flushNow()
    frame.dataset.verifyReload = '1'
    await new Promise(resolve => { frame.addEventListener('load', resolve, { once: true }); frame.contentWindow.location.reload() })
    await until(() => workStore(frame))
    w = workStore(frame); ui = uiStore(frame)
    await w.open(id); w.tab = 'lore'
    await until(() => ui.loreWorkId === id && frame.contentDocument.querySelector('.lore-h1'))
    const row = w.mubu.find(n => n.id === leaf.id)
    check('完整页面重载保留级别、标签和 ID 链接', row?.heading === 3 && row.tags?.includes('持久化') && row.html?.includes('mubu:' + root.id), JSON.stringify(row))
    await until(() => ui.loreRootId === root.id && ui.loreLinksOpen && ui.loreReferenceTab === 'outline')
    check('完整页面重载恢复范围与引用面板', ui.loreRootId === root.id && ui.loreLinksOpen && ui.loreReferenceTab === 'outline')
  } catch (e) { check('重载验收可执行', false, String(e.stack || e)) }
  finally { await w.mubuSyncTree(snapshot); ui.applyLoreLocation(location); ui.loreLinksOpen = false; await ui.persistLoreState(id); await frame.contentWindow.__flushNow(); await wait(80) }
}
