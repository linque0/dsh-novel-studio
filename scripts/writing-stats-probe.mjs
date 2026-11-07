export async function writingStatsProbe(frame, out, width, module) {
  const doc = frame.contentDocument, win = frame.contentWindow
  const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)]
  const wait = ms => new Promise(r=>setTimeout(r,ms))
  const until = async fn => { for(let i=0;i<100;i++){if(fn())return true;await wait(35)}return false }
  const check = (label, pass, ev = '') => out.items.push({ name: '写作数据：'+label, pass: !!pass, ev: String(ev) })
  const pinia = q('#app').__vue_app__.config.globalProperties.$pinia
  const ui = pinia._s.get('ui'), work = pinia._s.get('work')
  const entry = qa('.writing-stats-entry').find(b=>b.getBoundingClientRect().width&&!b.closest('[inert]'))
  check('顶栏入口可见且不被胶囊覆盖',entry && (()=>{const r=entry.getBoundingClientRect();return entry.contains(doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})())
  if (!entry) return
  const deep = module === 'settings'
  const atomic = module === 'chapters' && width === 1280
  let db, original, savedLogs
  const fixture = [], remember = (table,row) => { fixture.push([table,row]); return row }
  const openDb = () => new Promise((res,rej)=>{const r=win.indexedDB.open(win.__NS_AGENT__==='dsh'?'novel-studio@dsh':'novel-studio');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
  const request = r => new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
  const rowGet = (table,id) => request(db.transaction(table).objectStore(table).get(id))
  const all = table => request(db.transaction(table).objectStore(table).getAll())
  const write = (pairs, method) => new Promise((res,rej)=>{
    const tx=db.transaction([...new Set(pairs.map(([t])=>t))],'readwrite')
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)
    for(const [t,row] of pairs) tx.objectStore(t)[method](method==='delete'?row.id:row)
  })
  const date = offset => {
    const d=new win.Date();d.setDate(d.getDate()+offset)
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
  }
  const select = value => { const el=q('.writing-stats-dialog[open] #writing-stats-work');el.value=value;el.dispatchEvent(new win.Event('change',{bubbles:true})) }
  const total = () => {
    const scalar=q('.writing-stats-dialog[open] [data-stat="words"] b')
    if(scalar)return Number(scalar.textContent.replace(/\D/g,''))
    const books=qa('.writing-stats-dialog[open] .book-total b')
    return books.length?books.reduce((sum,b)=>sum+Number(b.textContent.replace(/\D/g,'')),0):NaN
  }
  const savedWords = row => typeof row.content === 'string'
    ? win.__ns.countWords(row.fmt === 'html' ? new win.DOMParser().parseFromString(row.content,'text/html').body.textContent : row.content)
    : row.wordCount || 0
  const root = () => q('.writing-stats-dialog[open]')
  const close = () => { const b=q('.writing-stats-dialog[open] .stats-close'); if(b)b.click();else ui.statsOpen=false }
  try {
    if (deep || atomic) db = await openDb()
    if (atomic && work?.activeChapter) {
      original = JSON.parse(JSON.stringify(await rowGet('chapters',work.activeChapter.id)))
      const chapterLogs=async()=> (await all('wordlog')).filter(r=>r.chapterId===original.id)
      savedLogs=await chapterLogs()
      const changed = '验收字'
      win.__NS_FAIL_WORDLOG = true
      try {
        work.setChapterContent(original.id,changed,'text')
        await win.__flushNow().catch(()=>{})
        const failed=await rowGet('chapters',original.id)
        check('日志写失败回滚正文并保留输入',win.__NS_FAILED_WORDLOG>0&&ui.autosave.error&&ui.autosave.pending>0&&failed.content===original.content&&work.activeChapter.content===changed&&(await chapterLogs()).length===savedLogs.length)
      } finally { win.__NS_FAIL_WORDLOG=false }
      await win.__flushNow()
      const saved=await rowGet('chapters',original.id), logs=await chapterLogs()
      await win.__flushNow()
      check('重试只写一次带符号的字数差',saved.wordCount===3&&logs.length===savedLogs.length+1&&logs.some(r=>!savedLogs.some(p=>p.id===r.id)&&r.delta===3-savedWords(original))&&(await chapterLogs()).length===logs.length)
      work.setChapterContent(original.id,original.content,original.fmt||'text')
      await win.__flushNow()
      const inserted=(await chapterLogs()).filter(r=>!savedLogs.some(p=>p.id===r.id))
      if(inserted.length)await write(inserted.map(r=>['wordlog',r]),'delete')
      original=null
    }
    if (deep) {
      const id = 'stats-fixture-'+width, a = 'w1', b='w2'
      const row = (workId, name, data={})=>({workId,id:id+'-'+name,deletedAt:null,...data})
      const lore=row(a,'lore',{text:'远行者公会',parentId:null,tags:['组织']})
      const person=row(a,'person',{name:'叶回',role:'主角/导师'})
      const other=row(a,'person2',{name:'纪白',role:'配角'})
      const box=row(a,'box',{kind:'container',title:'第一幕'})
      const volume=remember('volumes',row(a,'volume',{title:'潮汐之卷',sortOrder:40000}))
      const chapter=remember('chapters',row(a,'chapter',{volumeId:volume.id,title:'逆风而行',content:'灯塔之外是落潮的海。',fmt:'text',status:'revise',sortOrder:0}))
      remember('chapters',row(a,'chapter2',{title:'未分卷的来信',content:'潮汐来信',fmt:'text',status:'draft',sortOrder:40000}))
      for (const [i,delta] of [420,125,0,-73,360,550,180].entries()) {
        if(delta)remember('wordlog',row(a,'day'+i,{date:date(i-6),delta,chapterId:chapter?.id}))
      }
      remember('wordlog',row(a,'zero-a',{date:date(-4),delta:81,chapterId:chapter.id}))
      remember('wordlog',row(a,'zero-b',{date:date(-4),delta:-81,chapterId:chapter.id}))
      const revisionDate=new win.Date();revisionDate.setDate(revisionDate.getDate()-4);revisionDate.setHours(12,0,0,0)
      remember('revisions',{id:id+'-snapshot',entityId:chapter.id,entityType:'chapter',content:'<p>留存的旧港场景</p>',createdAt:revisionDate.getTime()})
      remember('wordlog',row(b,'dayb',{date:date(0),delta:82}))
      remember('olnodes',box)
      remember('olnodes',row(a,'event',{kind:'event',status:'done',title:'潮汐来信',parentId:box.id}))
      remember('olnodes',row(a,'event2',{kind:'event',status:'writing',title:'启程'}))
      remember('mubu',lore);remember('mubu',row(a,'lore-child',{text:'北岸的行会',parentId:lore.id}))
      remember('characters',person);remember('characters',other)
      remember('relations',row(a,'rel',{fromId:person.id,toId:other.id,label:'同伴'}))
      remember('lorelinks',row(a,'lrel',{fromKind:'mubu',fromId:lore.id,toKind:'character',toId:person.id,label:'成员'}))
      remember('snippets',row(a,'snip',{content:'退潮时才会出现的码头',tags:['场景','伏笔'],createdAt:Date.now()}))
      for(let i=0;i<35;i++)remember('snippets',row(a,'older-snip-'+i,{content:'早期灵感 '+i,tags:['早期'],createdAt:new win.Date(date(-40)+'T12:00:00').getTime()}))
      remember('snippets',row(b,'snip-b',{content:'地图背后的第二封信',tags:['伏笔'],createdAt:Date.now()-50000}))
      await write(fixture,'put')
    }
    const outlineDrawer = module === 'outline' && width === 760 ? q('.ow-mobile-controls button') : null
    if (outlineDrawer) { outlineDrawer.click(); await until(()=>q('.ow-scrim')) }
    const editor = win.__ns?.editor, editorDOM = editor?.view?.dom, host = editorDOM?.closest('.rich-host')
    if (editor && module==='chapters') editor.commands.setTextSelection(2)
    const caret = editor?.state.selection.from, top = host?.scrollTop, beforeView = ui.view, beforeTab = work?.tab
    entry.focus({preventScroll:true});entry.click()
    const opened=await until(()=>root()&&q('.writing-stats-dialog[open] [data-stat="words"]'))
    check('入口打开速览并读取已保存数据',opened && q('#writing-stats-title').textContent==='写作速览',q('.stats-state')?.textContent)
    if (!opened) return
    check('默认范围随入口上下文',q('#writing-stats-work').value===(module==='shelf'?'':work?.work?.id||''))
    if (outlineDrawer) {
      const tabEvent = new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})
      root().dispatchEvent(tabEvent)
      check('大纲抽屉不会截获统计的键盘操作',!tabEvent.defaultPrevented&&!!q('.ow-scrim'))
    }
    if (deep) {
      const id='stats-fixture-'+width
      const rows=await all('chapters'), works=(await all('works')).filter(w=>!w.deletedAt)
      const expected = scope=>rows.filter(r=>!r.deletedAt&&works.some(w=>w.id===r.workId)&&(!scope||r.workId===scope)).reduce((s,r)=>s+savedWords(r),0)
      select('w1');await until(()=>total()===expected('w1')&&!q('.stats-scroll')?.matches('[aria-busy="true"]'))
      check('速览按作品切换',total()===expected('w1'))
      const h=root().getBoundingClientRect().height
      check('速览收紧到内容高度',h < Math.min(win.innerHeight, 580),h)
      if(width===864) {
        win.__NS_FAIL_STATS_READ=true
        q('.stats-refresh').click()
        await until(()=>q('.stats-state[role="alert"]'))
        check('读取错误显示重试',!!q('.stats-state[role="alert"] button'))
        win.__NS_FAIL_STATS_READ=false
        q('.stats-state button')?.click()
        await until(()=>total()===expected('w1')&&!q('.stats-state'))
        check('重试恢复当前范围',q('#writing-stats-work').value==='w1'&&total()===expected('w1'))
      }
      await requestShot('stats-quick-'+width)
      q('.writing-stats-dialog[open] .stats-foot .primary').click()
      await until(()=>root()?.classList.contains('expanded')&&q('[role="tablist"]'))
      check('展开后范围不变',q('.writing-stats-dialog[open] #writing-stats-work').value==='w1')
      check('作品内默认创作历程',q('.writing-stats-full [data-mode="journey"]').getAttribute('aria-pressed')==='true')
      select('w2');select('');select('w1');select('')
      await until(()=>total()===expected('')&&!root()?.querySelector('.stats-state'))
      check('快速切换只展示最新范围',q('.writing-stats-dialog[open] #writing-stats-work').value===''&&total()===expected(''))
      check('全库默认作品对照',q('.writing-stats-full [data-mode="compare"]').getAttribute('aria-pressed')==='true')
      await requestShot('stats-overview-'+width)
      q('.writing-stats-full [data-period="90"]').click()
      await until(()=>q('.writing-stats-full .stats-trend-plot')?.children.length===90)
      check('90 日筛选不改变当前字数',q('.writing-stats-full .stats-trend-plot')?.children.length===90&&total()===expected(''))
      const day=q('.writing-stats-full .stats-day[tabindex="0"]');day?.focus();day?.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))
      check('图表可用键盘选择日期',doc.activeElement===q('.writing-stats-full .stats-day'))
      const tile=q('.writing-stats-full .book-tile'), tileWork=tile?.dataset.work
      const fullScroll=q('.writing-stats-full .writing-stats-scroll')
      fullScroll.scrollTop=55
      const compareTop=fullScroll.scrollTop
      tile?.click()
      await until(()=>q('.writing-stats-dialog[open] #writing-stats-work').value!==''&&!root()?.querySelector('.stats-state'))
      check('总览点击作品缩小范围',!!q('.writing-stats-dialog[open] #writing-stats-work').value&&q('.writing-stats-full h1').textContent==='创作历程')
      qa('.writing-stats-full .scope button').find(b=>b.textContent.includes('返回对照'))?.click()
      await until(()=>q('.writing-stats-dialog[open] #writing-stats-work').value===''&&!root()?.querySelector('.stats-state'))
      await wait(60)
      check('返回对照保留日期滚动与入口焦点',q('.writing-stats-full [data-period="90"]').getAttribute('aria-pressed')==='true'&&Math.abs(fullScroll.scrollTop-compareTop)<2&&doc.activeElement?.dataset.work===tileWork,'scroll '+fullScroll.scrollTop+'/'+compareTop+', focus '+doc.activeElement?.dataset.work+'/'+tileWork)
      select('w1');await until(()=>!root()?.querySelector('.stats-state')&&q('.writing-stats-dialog[open] #writing-stats-work').value==='w1')
      q('#stats-tab-chapters').click();await until(()=>q('#stats-view-chapters'))
      check('正文包含章节结构和改稿轨迹',!!q('[data-chart="structure"]')&&!!q('[data-chart="revision"]'))
      const chapterKey=JSON.stringify(['w1',id+'-chapter'])
      const volumeKey=JSON.stringify(['w1',id+'-volume'])
      qa('.volume-rail [data-volume]').find(b=>b.dataset.volume===volumeKey)?.click()
      await until(()=>qa('.score-row').length===1)
      const reference=q('.median-key b')?.textContent
      q('[data-status="revise"]').click()
      check('状态筛选保持同一字数轴和中位数',qa('.score-row').length===1&&q('.median-key b')?.textContent===reference)
      q('[data-chart="revision"]').click();q('.writing-stats-full [data-period="7"]').click()
      await until(()=>qa('.revision-grid thead th').length===8)
      const cell=offset=>qa('.revision-cell').find(b=>b.dataset.chapter===chapterKey&&b.dataset.date===date(offset))
      check('改稿矩阵区分净零净减和缺失',cell(-4)?.dataset.kind==='zero'&&cell(-3)?.dataset.kind==='loss'&&cell(-4)?.dataset.versions==='1')
      cell(-4)?.click()
      await until(()=>q('.writing-stats-inspector[open]')||q('.inspector-inline .chapter-day-stat'))
      const current=()=>q('.writing-stats-inspector[open]')||q('.inspector-inline')
      check('章节日期明细与日志吻合',current()?.textContent.includes('有写入')&&current()?.textContent.includes('2 条保存'))
      const snapshot=current()?.querySelector('.snapshot summary');snapshot?.click()
      await until(()=>current()?.querySelector('.snapshot blockquote'))
      check('版本正文按需读取并安全显示',current()?.querySelector('.snapshot blockquote')?.textContent.includes('留存的旧港场景')&&!current()?.querySelector('.snapshot blockquote p'))
      check('旧快照格式不借用当前章节格式',!current()?.querySelector('.snapshot blockquote')?.textContent.includes('<p>'))
      await requestShot('stats-revision-detail-'+width)
      current()?.querySelector('.close')?.click();await until(()=>!q('.writing-stats-inspector[open]'))
      q('[data-chart="structure"]').click();await requestShot('stats-chapters-'+width)
      for(const [key, heading] of [['outline','大纲事件'],['lore','设定分支'],['characters','人物与关系'],['snippets','灵感档案']]){
        q('#stats-tab-'+key).click();await until(()=>q('#stats-view-'+key))
        check('分析页 '+heading,q('#stats-view-'+key)?.textContent.includes(heading)&&root().scrollWidth<=root().clientWidth+1,'width '+root().scrollWidth+'/'+root().clientWidth+' text '+q('#stats-view-'+key)?.textContent.slice(0,80))
        await requestShot('stats-'+key+'-'+width)
      }
      q('.writing-stats-full [data-period="90"]').click()
      await until(()=>qa('#stats-view-snippets .ledger-row').length===30)
      qa('#stats-view-snippets .stats-pagination button').find(b=>b.textContent.includes('下一页'))?.click()
      await until(()=>qa('#stats-view-snippets .ledger-row').length===6)
      q('.writing-stats-full [data-period="7"]').click()
      await until(()=>qa('#stats-view-snippets .ledger-row').length===1)
      check('缩短日期范围后灵感页码归零',qa('#stats-view-snippets .ledger-row').length===1&&q('#stats-view-snippets .ledger-row')?.textContent.includes('退潮'))
      q('.writing-stats-full .stats-head-actions .stats-btn').click()
      check('完整分析收起后范围不变',await until(()=>q('.writing-stats-quick[open] #writing-stats-work'))&&q('.writing-stats-quick[open] #writing-stats-work').value==='w1')
    }
    if (atomic) { q('.stats-foot .primary')?.click();await until(()=>root()?.classList.contains('expanded')) }
    close();await until(()=>!root())
    check('关闭保留原模块并归还焦点',ui.view===beforeView&&work?.tab===beforeTab&&doc.activeElement===entry)
    if (outlineDrawer) { check('关闭统计不改变大纲抽屉',!!q('.ow-scrim'));q('.ow-scrim')?.click() }
    if (editor && module==='chapters') check('返回保留编辑器、光标与滚动',win.__ns.editor===editor&&editor.view.dom===editorDOM&&editor.state.selection.from===caret&&host?.scrollTop===top)
  } catch (e) { check('真实页面流程可运行',false,e.stack||e) }
  finally {
    win.__NS_FAIL_WORDLOG=false;win.__NS_FAIL_STATS_READ=false;close()
    if (original && work?.activeChapter?.id===original.id) {
      work.setChapterContent(original.id,original.content,original.fmt||'text');await win.__flushNow().catch(()=>{})
      if(savedLogs) {
        const added=(await all('wordlog')).filter(r=>r.chapterId===original.id&&!savedLogs.some(p=>p.id===r.id))
        if(added.length)await write(added.map(r=>['wordlog',r]),'delete')
      }
    }
    if(fixture.length)await write(fixture,'delete')
    db?.close()
  }
}
