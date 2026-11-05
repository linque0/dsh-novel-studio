/* 验证书注册表（唯一权威定义处）
 *
 * 「验证书」= 各验收脚本（tools/*-verify.mjs / cdp-test.mjs）专用的测试作品，
 * 只允许存在于开发调试版（npm run dev，--profile=dev）的数据库里。
 *
 * 三条使用路径，同一份数据：
 *  1. npm run dev 启动 → 渲染层在 DEV 下动态加载本表（src/dev/verifyBooks.js）→ 自动种入书架；
 *     正式版以 app:// 加载，import.meta.env.DEV 为 false，本表不会进入运行时，绝不写入测试数据；
 *  2. node tools/seed-verify.mjs [--reset] [--only 书名] → 对运行中的开发调试版补种 / 重置；
 *  3. 验收脚本用 buildSeedExpr(书名, { reset: true }) 取种子源码执行（不再各自内联一份），
 *     保证「脚本跑的书」与「开发版书架上的书」同源，改一处两侧同步。
 *
 * 新增验证书的纪律：一律在下方 VERIFY_BOOKS 登记（title + owner + create），并在
 * docs/开发流程.md 的验证书清单补一行；禁止在脚本里另起炉灶直写 db.works.add。
 *
 * 约定：create(ctx, meta) 必须——
 *  - 自包含：只允许使用参数 ctx（{db, uid, now}）与 meta（{title}），不得引用模块外变量
 *    （本表会被 String() 序列化后在页面内求值）；
 *  - 幂等纯创建：不做删除判断（重置逻辑统一在 seedBooks 里，按 title 删除重建）；
 *  - 返回 workId（字符串）或 { workId, ...附加字段 }（附加字段供脚本断言使用，如 chId）。
 */

/* ---------- 空书（等价于书架「新建作品」：作品 + 总纲 + 第一卷 + 默认设定分类） ---------- */
async function emptyBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.volumes.add({ id: uid(), workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.lorecats.bulkAdd(['地点', '势力', '物品', '体系', '大事记'].map((name, i) => ({ id: uid(), workId, name, sortOrder: i })))
  return workId
}

/* ---------- 双链验证书：双链全链路（dl-verify） ---------- */
async function dlBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '主线围绕铜刻星辰的异动展开。', createdAt: t, updatedAt: t, deletedAt: null })
  const volId = uid()
  await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.chapters.add({ id: uid(), workId, volumeId: volId, title: '第一章 · 初雪', content: '<p>他抬头看去，三百六十枚铜刻星辰缓缓归位。</p>', wordCount: 0, status: 'draft', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.mubu.bulkAdd([
    { id: uid(), workId, parentId: null, sortOrder: 0, text: '观测站', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t },
    { id: uid(), workId, parentId: null, sortOrder: 1000, text: '穹顶大厅', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t }
  ])
  const mb = (await db.mubu.toArray()).filter((n) => n.workId === workId)
  const gz = mb.find((n) => n.text === '观测站')
  await db.mubu.add({ id: uid(), workId, parentId: gz.id, sortOrder: 0, text: '建于界脊之上，穹顶内悬三百六十枚铜刻星辰的活星图。', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  await db.characters.add({ id: uid(), workId, name: '林远', aliases: '', role: '主角', tags: [], fields: {}, avatarAssetId: null, content: '他在穹顶大厅值守，熟悉每一枚铜刻星辰。', createdAt: t, updatedAt: t, deletedAt: null })
  await db.snippets.add({ id: uid(), workId, content: '穹顶大厅的第十二响钟声是关键伏笔。', tags: [], createdAt: t, updatedAt: t, deletedAt: null })
  return workId
}

/* ---------- 批注验证书：正文批注全链路（annotation-verify）。
 *     正文里的双链固定指向 mubu:x1（脚本断言双链目标不被批注覆盖，故不解析为真实节点） ---------- */
async function annoBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  const volId = uid()
  await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.chapters.add({
    id: uid(), workId, volumeId: volId, title: '第一章 · 初雪', fmt: 'html',
    content: '<p>他抬头看去，三百六十枚<span class="dl-link" data-dl-target="mubu:x1" data-dl-title="星图">铜刻星辰</span>缓缓归位，雪落在界脊之上。</p>',
    wordCount: 0, status: 'draft', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null
  })
  await db.mubu.add({ id: uid(), workId, parentId: null, sortOrder: 0, text: '星图', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  return workId
}

/* ---------- 关系图验证书：人物关系图（chargraph-verify） ---------- */
async function graphBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  const volId = uid()
  await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  const chId = uid()
  await db.chapters.add({ id: chId, workId, volumeId: volId, title: '第一章 · 相遇', content: '<p>相遇。</p>', wordCount: 3, status: 'draft', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  const mk = (name, role, tags) => {
    const id = uid()
    db.characters.add({ id, workId, name, role, tags, aliases: '', content: '', fields: {}, deletedAt: null, createdAt: t, updatedAt: t })
    return id
  }
  const a = mk('林昭', '主角', ['皇族'])
  const b = mk('沈青梧', '配角', ['江湖'])
  const cc = mk('魏无涯', '反派', ['魔教'])
  const d = mk('路人甲', '龙套', [])
  mk('隐士', '龙套', [])
  db.relations.add({ id: uid(), workId, fromId: a, toId: b, label: '师徒', notes: '' })
  db.relations.add({ id: uid(), workId, fromId: b, toId: cc, label: '宿敌', notes: '' })
  return { workId, chId, a, b, cc, d }
}

/* ---------- 画布验证书A：旧三级大纲迁移 v2（olcanvas-verify） ---------- */
async function canvasABook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  const volId = uid()
  await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  const chId = uid()
  await db.chapters.add({ id: chId, workId, volumeId: volId, title: '第一章 · 启程', content: '<p>启程。</p>', wordCount: 3, status: 'draft', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.mubu.add({ id: uid(), workId, parentId: null, sortOrder: 0, text: '雾都钟楼', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '主线：寻找黎明之城。', createdAt: t, updatedAt: t, deletedAt: null })
  await db.outlines.add({ id: uid(), workId, level: 'chapter', refId: chId, content: '目标：进入雾都\n线索：[[雾都钟楼]]', createdAt: t, updatedAt: t, deletedAt: null })
  return { workId, chId }
}

/* ---------- 画布验证书B：空书快速开始（olcanvas-verify） ---------- */
async function canvasBBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.mubu.add({ id: uid(), workId, parentId: null, sortOrder: 0, text: '雾都钟楼', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  return workId
}

/* ---------- AI 验证书：AI 助手任务链路（agent-task-verify，五模块专用任务与提案） ----------
 * 三章正文（林昭贯穿三章、沈青梧见第二章）供任务装配（前情摘要 / L2 反查片段），
 * 幕布两根节点（同层断言用）、双人物 + 预置关系、大纲根 + 两个子节点（祖先/同级断言用）。 */
async function aiBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '仙侠', status: '连载中', intro: '界脊之上，星辰易位。', createdAt: t, updatedAt: t, deletedAt: null })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '', createdAt: t, updatedAt: t, deletedAt: null })
  const volId = uid()
  await db.volumes.add({ id: volId, workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  const chapters = [
    { title: '第一章 · 雾都启程', content: '<p>林昭背起行囊离开雾都，铜镜里的星图缺了一角。</p>' },
    { title: '第二章 · 驿站夜谈', content: '<p>沈青梧在界脊驿站拦住林昭，交给他半枚铜符。</p>' },
    { title: '第三章 · 灯下铜符', content: '<p>林昭在灯下端详铜符，远处更夫的梆子声由远及近。</p>' }
  ]
  const chIds = []
  for (let i = 0; i < chapters.length; i++) {
    const id = uid()
    chIds.push(id)
    await db.chapters.add({ id, workId, volumeId: volId, title: chapters[i].title, fmt: 'html', content: chapters[i].content, wordCount: 0, status: 'draft', sortOrder: i, createdAt: t, updatedAt: t, deletedAt: null })
  }
  const rootId = uid()
  await db.mubu.add({ id: rootId, workId, parentId: null, sortOrder: 0, text: '界脊设定', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  await db.mubu.add({ id: uid(), workId, parentId: rootId, sortOrder: 0, text: '界脊横断南北，穹顶悬三百六十枚铜刻星辰。', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  await db.mubu.add({ id: uid(), workId, parentId: null, sortOrder: 1000, text: '更夫梆子', html: null, fold: false, deletedAt: null, createdAt: t, updatedAt: t })
  const charA = uid()
  await db.characters.add({ id: charA, workId, name: '林昭', aliases: '', role: '主角', tags: ['界脊'], fields: { 境界: '凝气三层' }, avatarAssetId: null, content: '雾都少年，性情沉毅。', createdAt: t, updatedAt: t, deletedAt: null })
  const charB = uid()
  await db.characters.add({ id: charB, workId, name: '沈青梧', aliases: '', role: '配角', tags: [], fields: { 身份: '界脊驿站掌柜' }, avatarAssetId: null, content: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.relations.add({ id: uid(), workId, fromId: charA, toId: charB, label: '萍水相逢', notes: '' })
  const olRoot = uid()
  await db.olnodes.add({ id: olRoot, workId, parentId: null, refId: null, kind: 'event', title: '主线', text: '三章之内抵达界脊之心。', html: null, fold: false, sortOrder: 0, canvasX: null, canvasY: null, w: null, h: null, shape: 'process', pin: false, rels: [], deletedAt: null, createdAt: t, updatedAt: t })
  const olChild = uid()
  await db.olnodes.add({ id: olChild, workId, parentId: olRoot, refId: null, kind: 'event', title: '第一站：雾都', text: '', html: null, fold: false, sortOrder: 0, canvasX: null, canvasY: null, w: null, h: null, shape: 'process', pin: false, rels: [], deletedAt: null, createdAt: t, updatedAt: t })
  await db.olnodes.add({ id: uid(), workId, parentId: olRoot, refId: null, kind: 'event', title: '第二站：星炉', text: '', html: null, fold: false, sortOrder: 1000, canvasX: null, canvasY: null, w: null, h: null, shape: 'process', pin: false, rels: [], deletedAt: null, createdAt: t, updatedAt: t })
  return { workId, ch1: chIds[0], ch2: chIds[1], ch3: chIds[2], mubuRoot: rootId, charA, charB, olRoot, olChild }
}

/* ---------- 关系跟随验证书：关系图拖线改关系（relfollow-verify，甲/乙/丙 三人物） ---------- */
async function relfollowBook(ctx, meta) {
  const { db, uid, now } = ctx
  const t = now()
  const workId = uid()
  await db.works.add({ id: workId, title: meta.title, author: '', genre: '', status: '', intro: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.outlines.add({ id: uid(), workId, level: 'master', refId: workId, content: '', createdAt: t, updatedAt: t, deletedAt: null })
  await db.volumes.add({ id: uid(), workId, title: '第一卷', sortOrder: 0, createdAt: t, updatedAt: t, deletedAt: null })
  await db.lorecats.bulkAdd(['地点', '势力', '物品', '体系', '大事记'].map((name, i) => ({ id: uid(), workId, name, sortOrder: i })))
  for (const name of ['甲', '乙', '丙']) {
    await db.characters.add({ id: uid(), workId, name, role: '', tags: [], aliases: '', content: '', fields: {}, deletedAt: null, createdAt: t, updatedAt: t })
  }
  return workId
}

async function bookSourceBook(ctx,meta) {
  const {db,uid,now}=ctx,t=now(),workId=uid(),volumeId=uid(),c1=uid(),c2=uid(),characterId=uid(),otherId=uid(),loreId=uid(),childId=uid(),outlineId=uid(),snippetId=uid()
  await db.works.add({id:workId,title:meta.title,genre:'玄幻',intro:'隔离数据架构验证',createdAt:t,updatedAt:t,deletedAt:null})
  await db.volumes.add({id:volumeId,workId,title:'第一卷',sortOrder:0})
  await db.chapters.bulkAdd([{id:c1,workId,volumeId,title:'受伤与铜符',sortOrder:0,fmt:'html',content:'<p>林昭埋下铜符。</p><p>林昭右臂受伤。</p>'},{id:c2,workId,volumeId,title:'未来揭密',sortOrder:1,fmt:'text',content:'林昭用铜符打开石门。\n最终秘密是云宗之主。'}])
  await db.characters.bulkAdd([{id:characterId,workId,name:'林昭',aliases:'小昭',fields:{身份:'未来云宗之主'},content:'最终秘密不可用于第一章'},{id:otherId,workId,name:'沈青梧',aliases:'',fields:{}}])
  await db.relations.add({id:uid(),workId,fromId:characterId,toId:otherId,label:'同伴'})
  await db.mubu.bulkAdd([{id:loreId,workId,text:'世界观',parentId:null,sortOrder:0},{id:childId,workId,text:'云宗禁止复活。',parentId:loreId,sortOrder:0}])
  await db.olnodes.add({id:outlineId,workId,title:'章纲计划',text:'找到铜符并调查石门。',kind:'anchor',refId:c1,parentId:null,rels:[]})
  await db.snippets.add({id:snippetId,workId,content:'未采纳：铜符可能开启天宫。',tags:['灵感']})
  await db.annotations.add({id:uid(),workId,chapterId:c1,text:'右臂受伤',note:'不要忘记伤势',kind:'提醒'})
  await db.assets.add({id:uid(),workId,name:'未解析地图.png',mime:'image/png',blob:null})
  return {workId,volumeId,c1,c2,characterId,otherId,loreId,childId,outlineId,snippetId}
}

export const VERIFY_BOOKS = [
  {title:'书内知识验证书',owner:'project-verify.mjs / relation-knowledge-verify.mjs',desc:'完整投影、关联知识、隐私、截止范围、全书知识与增量',create:bookSourceBook},
  { title: '双链验证书', owner: 'dl-verify.mjs', desc: '双链全链路：正文 / 幕布 / 人物 / 灵感 + 大纲令牌', create: dlBook },
  { title: '批注验证书', owner: 'annotation-verify.mjs', desc: '正文批注全链路：正文含一条双链（验证批注与双链共存）', create: annoBook },
  { title: '关系图验证书', owner: 'chargraph-verify.mjs', desc: '人物关系图：5 人物 + 2 关系', create: graphBook },
  { title: '画布验证书A', owner: 'olcanvas-verify.mjs', desc: '旧三级大纲迁移 v2（含章纲双链令牌）', create: canvasABook },
  { title: '画布验证书B', owner: 'olcanvas-verify.mjs', desc: '空书快速开始（仅一个幕布节点）', create: canvasBBook },
  { title: '关系跟随验证书', owner: 'relfollow-verify.mjs', desc: '关系图拖线改关系（甲 / 乙 / 丙 三人物）', create: relfollowBook },
  { title: 'AI 验证书', owner: 'agent-task-verify.mjs / writing-workflow-verify.mjs / agent-chat-ui-verify.mjs / agent-chat-ui-window-verify.mjs / agent-chat-ui-visual-verify.mjs / crimson-writing-rail-verify.mjs / writing-paper-verify.mjs / writing-paper-window-verify.mjs / writing-paper-visual-verify.mjs / chapter-title-wrap-verify.mjs / studio-writing-skins-verify.mjs / studio-writing-skins-layout.mjs / volume-entry-verify.mjs / crimson-volume-entry-verify.mjs', desc: 'AI 助手任务链路、正文工作流及正文目录/纸面/长标题/专属场景/卷操作定向检查', create: aiBook },
  { title: '多窗口验证书', owner: 'multiwindow-verify.mjs', desc: '拆窗 / 锁 / 落库 / 锁跟随', create: emptyBook },
  { title: '画布右键验证书', owner: 'canvasctx-verify.mjs', desc: '画布右键建模块 + Delete 删除', create: emptyBook },
  { title: '连接点修复验证书', owner: 'junction-fix-verify.mjs / freeze-repro-verify.mjs / visual-fix-verify.mjs', desc: '连接点全链路 + 卡死复现 + 视觉专项（三脚本共用）', create: emptyBook },
  { title: '线连到线验证书', owner: 'line2line-verify.mjs', desc: '线连到线（连接点互连）', create: emptyBook },
  { title: '塑形验证书', owner: 'shape-verify.mjs', desc: '连线拖拽塑形（拖弯 / 拉直 / 双击拉直）', create: emptyBook },
  { title: '浮层避线验证书', owner: 'edgepanel-avoid-verify.mjs', desc: '连线编辑浮层避线放置', create: emptyBook },
  { title: '右键浮层验证书', owner: 'edgeedit-ctx-verify.mjs', desc: '右键连线开编辑浮层', create: emptyBook },
  { title: '侧栏验证书', owner: 'sidebar-verify.mjs', desc: '侧栏调宽钳制与记忆 + 画布文本按钮', create: emptyBook },
  { title: '验收测试作品', owner: 'cdp-test.mjs', desc: '端到端全功能（书架新建作品流程，脚本结束自清理）', create: emptyBook }
]

/* ---------- 页面内执行器（会被 String() 序列化，必须自包含） ----------
 * specs: [{ title, create }]；ctx: { db, uid, now }；opts: { reset }
 * 默认只补种缺失的书；reset=true 时按 title 删除重建（级联清掉该作品全部子表数据）。 */
export async function seedBooks(specs, ctx, opts) {
  opts = opts || {}
  const wipe = async (workId) => {
    const { db } = ctx
    for (const t of db.tables) {
      if (t.name === 'appconfig') continue
      try {
        const rows = await t.where('workId').equals(workId).toArray()
        if (rows.length) await t.bulkDelete(rows.map((r) => r[t.schema.primKey.keyPath]))
      } catch (e) {
        // 无 workId 索引的表（links / revisions）退化为全表过滤
        try {
          const rows = (await t.toArray()).filter((r) => r && r.workId === workId)
          if (rows.length) await t.bulkDelete(rows.map((r) => r.id))
        } catch (e2) {
          /* 忽略 */
        }
      }
    }
    await db.works.delete(workId)
  }
  const out = []
  try {
    for (const spec of specs) {
      const { db } = ctx
      const exist = (await db.works.toArray()).find((w) => w.title === spec.title)
      if (exist && opts.reset) await wipe(exist.id)
      if (exist && !opts.reset) {
        out.push({ title: spec.title, skipped: true, workId: exist.id })
        continue
      }
      const res = await spec.create(ctx, spec)
      const workId = typeof res === 'string' ? res : res && res.workId
      out.push(Object.assign({ title: spec.title, created: true, workId }, typeof res === 'object' && res ? res : {}))
    }
    return { ok: true, books: out }
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).slice(0, 300), books: out }
  }
}

/** 生成可在页面内求值的种子表达式（CDP 验收脚本用）
 *  用法：const r = await c.evalx(buildSeedExpr('双链验证书', { reset: true }))
 *  返回 { ok, books: [{ title, workId, created|skipped, ...附加字段 }] } */
export function buildSeedExpr(titles, opts = {}) {
  const list = [].concat(titles)
  const specs = list.map((t) => {
    const book = VERIFY_BOOKS.find((b) => b.title === t)
    if (!book) throw new Error('验证书未注册：' + t + '（应先在 tools/verify-seeds.mjs 的 VERIFY_BOOKS 登记）')
    return '{ title: ' + JSON.stringify(book.title) + ', create: ' + book.create.toString() + ' }'
  })
  return (
    '(' +
    seedBooks.toString() +
    ')([' +
    specs.join(',') +
    '], window.__ns, { reset: ' +
    (opts.reset === true) +
    ' })'
  )
}
