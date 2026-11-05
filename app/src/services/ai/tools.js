import { kbQuery } from './retrieval'
import { retrievalTask } from './retrieval-policy.js'
import { knowledgeSnapshot, replayForeshadows, ordered } from './knowledge'
import { getChapterSummary, hashContent } from './summarize'
import { paginate, plainChapter, namesOf, resolveEvidence, withoutQuotes, chapterHash } from './contracts'
import { readBook, queryBook, readDocument, readBookManifest, relatedEntities, documentView } from './booksource.js'
import { stateAt } from './state.js'
import { sourceManifest } from '../project/normalize.js'

const paged = (items, args) => paginate(items, { cursor: args.cursor, limit: args.limit, maxTokens: 1600 })
const book = (env) => readBook(env.bookWork || env.work, { asOfChapterId:env.asOfChapterId, allowedIds:env.allowedIds, authorProfiles:env.authorProfiles, planScope:env.planScope, privacy:env.privacy, signal:env.signal, sourceRevision:env.sourceRevision,writingBoundary:env.writingBoundary })
export const TOOL_REGISTRY = {
  search_book: {
    args:'{query,sourceType?,cursor?,limit?}', description:'检索正文、设定、人物关系、条目关联（lorelink）、大纲连线、灵感与批注；返回语义性质与段落来源',
    async execute(args,env) { const result=queryBook(await book(env),{query:args.query,sourceTypes:args.sourceType?[args.sourceType]:undefined,limitTokens:6000});return {...paged(result.items,args),report:result.report} },
  },
  read_document: {
    args:'{docId,cursor?}', description:'按游标顺序读取完整作品文档；大纲为计划、灵感为候选，不能当正文事实',
    async execute(args,env) { return readDocument(await book(env),args) },
  },
  get_book_coverage: {
    args:'{cursor?,limit?}', description:'查看各源资料覆盖与分页目录；未解析附件不计为已读',
    async execute(args,env) { const {documents,...report}=readBookManifest(await book(env));return {...report,...paged(documents,args)} },
  },
  get_related_entities: {
    args:'{entityId,depth?,cursor?,limit?}', description:'查询实体出场、登记关系、大纲引用与邻接资料；共现不等于关系',
    async execute(args,env) { const result=relatedEntities(await book(env),args);return {...paged(result.edges,args),entities:result.entities,note:result.note} },
  },
  get_entity_state: {
    args:'{entityId,cursor?,limit?}',description:'回放截至任务位置的正文人物状态；作者当前档案时间不明时不当历史事实',
    async execute(args,env){return paged(await stateAt(env.bookWork||env.work,{entityIds:[args.entityId],asOfChapterId:env.asOfChapterId,privacy:env.privacy,writingBoundary:env.writingBoundary}),args)},
  },
  search_chapters: {
    args: '{query,limit?,cursor?}',
    description: '检索章节，隐私模式只检索缓存摘要',
    async execute(args, env) {
      const q = String(args.query || '')
        .trim()
        .toLowerCase()
      if (!q) return { error: 'query 不能为空' }
      const result = queryBook(await book(env),{query:q,sourceTypes:['chapter'],limitTokens:6000})
      return paged(result.items.map((h)=>({id:h.sourceId,sourceId:h.sourceId,title:h.title,sourceHash:h.sourceHash,citation:h.citation,...(env.privacy?{summary:h.text}:{snippet:h.text})})),args)
    },
  },
  read_chapter: {
    args: '{chapterId,cursor?}',
    description: '读取章节的连续片段，隐私模式返回摘要',
    async execute(args, env) {
      const ch = env.work.chapters.find((c) => c.id === args.chapterId && !c.deletedAt)
      if (!ch) return { error: '章节不存在' }
      return { ...readDocument(await book(env),{docId:`doc:${ch.workId}:chapter:${ch.id}`,cursor:args.cursor}),id:ch.id }
    },
  },
  get_character: {
    args: '{name?,characterId?}',
    description: '人物档案及关系',
    async execute(args, env) {
      const q = String(args.name || '').toLowerCase()
      const session=await book(env)
      const chars = env.work.characters.filter(
        (c) => !c.deletedAt && (c.id === args.characterId || (q && namesOf(c).some((n) => n.toLowerCase() === q))),
      )
      return paged(
        chars.map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases,
          fields: env.privacy || (env.asOfChapterId && !env.authorProfiles) ? {} : c.fields,
          ...(env.privacy || (env.asOfChapterId && !env.authorProfiles) ? {} : { bio: (c.content || '').slice(0, 800) }),
          relations: env.privacy || (env.asOfChapterId && !env.authorProfiles) ? [] : env.work.relations.filter((r) => !r.deletedAt && (r.fromId === c.id || r.toId === c.id) && (!r.effectiveChapterId || !env.allowedIds || env.allowedIds.includes(r.effectiveChapterId))),
          associations: session.docs.filter(d=>d.sourceType==='lorelink'&&((d.meta.fromKind==='character'&&d.meta.fromId===c.id)||(d.meta.toKind==='character'&&d.meta.toId===c.id))).map(d=>documentView(d,session)).filter(d=>!d.withheld),
          temporalStatus:env.authorProfiles?'author-profile':'unknown',
          note:'作者人物设定是约束，不等同章节事实；阶段状态须有正文证据。',
        })),
        args,
      )
    },
  },
  get_outline_subtree: {
    args: '{title?,nodeId?,cursor?}',
    description: '大纲计划子树，不代表已发生事实',
    async execute(args, env) {
      return treeTool(env.work.olnodes.filter(n=>n.outlineNature!=='written'), args, 'plan', env.privacy)
    },
  },
  get_lore_subtree: {
    args: '{title?,nodeId?,cursor?}',
    description: '作者登记的设定子树',
    async execute(args, env) {
      return treeTool(env.work.mubu, args, 'author-lore', env.privacy)
    },
  },
  list_recent_chapters: {
    args: '{limit?,cursor?}',
    description: '章节顺序与缓存摘要',
    async execute(args, env) {
      const chapters = []
      for (const ch of ordered(env.work).slice(-20).reverse())
        chapters.push({ id: ch.id, title: ch.title, summary: env.writingBoundary?.chapterId===ch.id ? '' : (await getChapterSummary(ch, null)) || '' })
      return paged(chapters, args)
    },
  },
  search_kb: {
    args: '{query,kind?,limit?,cursor?,asOfChapterId?}',
    description: '检索有效知识卡及来源',
    async execute(args, env) {
      const r = await kbQuery({
        work: env.work,
        task:retrievalTask(env.retrievalOptions?.taskType),
        anchorId:env.retrievalOptions?.anchorId,
        embeddings:env.retrievalOptions?.embeddings,
        opts:env.retrievalOptions?.opts,
        query: args.query || '',
        kind: args.kind,
        asOfChapterId: args.asOfChapterId || env.asOfChapterId,
        privacy: env.privacy,
        limitTokens: 6000,
        writingBoundary:env.writingBoundary,
      })
      return {
        ...paged(
          r.cards.map((c) => (env.privacy ? withoutQuotes(c) : c)),
          args,
        ),
        coverage: { ready: r.snapshot.valid.size, total: r.snapshot.chapters.length, stale: r.snapshot.stale.length },
        vectorFallback:r.vectorFallback,vectorStatus:r.vectorStatus,
      }
    },
  },
  get_foreshadows: {
    args: '{status?,asOfChapterId?,cursor?}',
    description: '截至某章的伏笔登记表',
    async execute(args, env) {
      const snap = await knowledgeSnapshot(env.work, args.asOfChapterId || env.asOfChapterId,env.writingBoundary)
      const hooks = replayForeshadows(snap.cards).filter((f) => !args.status || f.status === args.status)
      return paged(env.privacy ? hooks.map(withoutQuotes) : hooks, args)
    },
  },
  get_char_timeline: {
    args: '{characterId,asOfChapterId?,cursor?}',
    description: '截至某章的人物状态历史',
    async execute(args, env) {
      const snap = await knowledgeSnapshot(env.work, args.asOfChapterId || env.asOfChapterId,env.writingBoundary)
      const states = snap.cards
        .filter((c) => c.kind === 'charstate' && c.refId === args.characterId)
        .sort((a, b) => a.orderIdx - b.orderIdx)
      return paged(env.privacy ? states.map(withoutQuotes) : states, args)
    },
  },
  locate_evidence: {
    args: '{sourceType,sourceId,quote?}',
    description: '核对与定位来源；隐私模式不回传摘引',
    async execute(args, env) {
      if(env.writingBoundary&&args.sourceType==='chapter'&&args.sourceId===env.writingBoundary.chapterId){const ref=resolveEvidence(args,env.work,{privacy:env.privacy});if(!ref||ref.start==null||ref.start+(ref.quote?.length||0)>env.writingBoundary.end)return {error:'证据超出本轮正文位置'};return ref}
      const ref=resolveEvidence(args, env.work, { privacy: env.privacy })
      if(env.writingBoundary&&ref&&!((await book(env)).docs.some(d=>d.id===ref.docId)))return {error:'证据不在本轮可读取的资料范围'}
      return ref || { error: '证据无法定位' }
    },
  },
}
function treeTool(rows, args, sourceKind, privacy = false) {
  const q = String(args.title || '').toLowerCase()
  const root = rows.find((n) => !n.deletedAt && (n.id === args.nodeId || (q && (n.title || n.text || '').toLowerCase().includes(q))))
  if (!root) return { items: [], found: false }
  const items = [],
    seen = new Set()
  const walk = (node) => {
    if (seen.has(node.id) || items.length >= 80) return
    seen.add(node.id)
    items.push({
      id: node.id,
      title: node.title || (node.text || '').split('\n')[0].slice(0, 60),
      ...(privacy ? {} : { text: (node.text || '').slice(0, 500) }),
      sourceKind,
    })
    rows.filter((n) => !n.deletedAt && n.parentId === node.id).forEach(walk)
  }
  walk(root)
  return paged(items, args)
}
for (const tool of Object.values(TOOL_REGISTRY)) {
  tool.returnShape = '完整结构化条目，带 truncated/nextCursor 或明确 error'
  tool.privacyRule = '隐私模式仅返回已有摘要、结构化字段及去除摘引的知识，不返回正文或档案片段'
}
export async function executeTool(name, args, env) {
  if (!TOOL_REGISTRY[name]) return { error: '未知工具：' + name }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: '工具参数必须为对象' }
  let scoped = env
  let safeArgs = { ...args }
  if (env.planScope === 'none' && name === 'get_outline_subtree') return {error:'当前正文提取任务不能读取未来计划'}
  if (env.asOfChapterId) {
    const chapters = ordered(env.work),
      cutoff = chapters.findIndex((ch) => ch.id === env.asOfChapterId)
    if (cutoff < 0) return { error: '截至章节不存在' }
    const allowed = new Set(chapters.slice(0, cutoff + 1).map((ch) => ch.id))
    if (args.asOfChapterId && !allowed.has(args.asOfChapterId)) return { error: '不能读取截至位置之后的事实' }
    scoped = { ...env, bookWork: env.work, work: { ...env.work, chapters: env.work.chapters.filter((ch) => allowed.has(ch.id)) } }
    safeArgs.asOfChapterId = args.asOfChapterId || env.asOfChapterId
  }
  if (env.allowedIds) {
    if (args.asOfChapterId && !env.allowedIds.includes(args.asOfChapterId)) return {error:'截至章节超出任务范围'}
    scoped = {...scoped,bookWork:env.work,work:{...scoped.work,chapters:scoped.work.chapters.filter(ch=>env.allowedIds.includes(ch.id))}}
    if (name==='locate_evidence' && args.sourceType==='chapter' && !env.allowedIds.includes(args.sourceId)) return {error:'证据越过任务范围'}
  }
  if (safeArgs.query && String(safeArgs.query).length > 500) return { error: '查询超长' }
  return {
    ...(await TOOL_REGISTRY[name].execute(safeArgs, scoped)),
    workId: env.work.work.id,
    sourceRevision: env.sourceRevision || sourceManifest(env.work).hash,
  }
}
