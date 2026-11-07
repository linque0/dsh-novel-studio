import { nextTick } from 'vue'
import { autosave } from '../autosave'
import { isPopped } from '../panelwindows'
import { db, uid } from '../../db/database'
import { putAiRow, aiRows, leaseJob, updateJob } from '../../db/ai-repo'
import { entityHash, chapterHash, clone, namesOf } from './contracts'
import { ordered } from './knowledge'
import { fingerprint } from './presets'
import { sourceManifest } from '../project/normalize.js'
import { readSourceSnapshot } from '../../db/project-repo.js'
import { applyWorkflow, undoWorkflow } from './task-application.js'
import { taskApplyActions } from './task-profiles.js'
import { validateWritingAnchor } from './writing-anchor.js'
import { markChapterStale } from './summarize.js'
import { closeHistory } from '@tiptap/pm/history'
import { freezeDraft } from './review-cycle.js'
import { normalizeText } from '../project/text.js'
import {normalizeStoryHTML} from '../story-richtext.js'

const TABLES = ['chapters', 'outlines', 'olnodes', 'mubu', 'characters', 'relations']
const applying = new Set()
function targetOf(work, card) {
  const type = ['plot', 'rewrite', 'consistency'].includes(card.task)
    ? 'chapter'
    : card.task === 'outline'
      ? 'outline'
      : card.subject === 'lore' || card.task === 'lore'
        ? 'lore'
        : 'characters'
  const rows = type === 'chapter' ? work.chapters : type === 'outline' ? work.olnodes : type === 'lore' ? work.mubu : work.characters
  return { type, row: rows.find((r) => r.id === card.anchorId && !r.deletedAt) }
}
export function proposalGuard(work, card, action) {
  if(card.workflowStage)throw new Error('这是工作流阶段材料，请在创作任务中确认最终候选');
  if (card.source?.taskRequest && !taskApplyActions(card.source.taskRequest.type, card.original,card.source.taskRequest.writingAnchor).includes(action)) throw new Error('当前专用任务不允许此写回操作')
  if (!work.work || card.workId !== work.work.id) throw new Error('提案属于其他作品，请重新生成')
  if (card.source?.layoutHash && fingerprint(ordered(work).map((ch) => [ch.id, ch.volumeId])) !== card.source.layoutHash)
    throw new Error('章节顺序或所属卷已变化，请重新生成')
  for (const version of card.source?.sourceVersions || []) {
    const row = version.table==='works'?work.work:work[version.table]?.find((r) => r.id === version.id && !r.deletedAt)
    if (!row || (version.table === 'chapters' ? chapterHash(row) : entityHash(row)) !== version.hash)
      throw new Error('生成依据已变化，请刷新对照并重新生成')
  }
  if(card.source?.bookRevision && sourceManifest(work).hash!==card.source.bookRevision)
    throw new Error('作品资料已变化，请重新生成提案')
  if (card.complete === false) throw new Error('草稿或提案尚未完整，不能应用')
  if (card.kind === 'draft' && card.status === 'applied') throw new Error('草稿已经应用；请先撤销或生成新候选')
  if (card.kind === 'draft' && !card.anchorId && action === 'newchapter') {
    if (entityHash(work.work) !== card.sourceHash) throw new Error('作品资料已变化，请重新生成')
    return work.work
  }
  const { type, row } = targetOf(work, card)
  if (!row) throw new Error('提案目标已被删除')
  if (card.appliedActions?.includes(action)) throw new Error('该提案操作已经应用')
  if (isPopped(work, type, type === 'outline' || type === 'lore' ? '' : row.id)) throw new Error('目标被其他窗口锁定，请到对应窗口操作')
  const hash = type === 'chapter' ? chapterHash(row) : entityHash(row)
  if (hash !== card.sourceHash) throw new Error('来源已变化，请刷新对照并重新生成提案')
  if (action === 'outline' && isPopped(work, 'outline', '')) throw new Error('大纲已被其他窗口锁定')
  return row
}
export function locateEditorPatch(editor, original, {wholeChapter=false}={}) {
  if(wholeChapter){
    if(normalizeText(editor.getHTML(),'html')!==original)throw new Error('整章正文与候选源稿不一致，请重新生成')
    let protectedMark=false
    editor.state.doc.nodesBetween(0,editor.state.doc.content.size,node=>{
      if(node.marks?.some(mark=>/dl|link|note|annotation/i.test(mark.type.name)))protectedMark=true
    })
    return {from:0,to:editor.state.doc.content.size,protectedMark}
  }
  let text = '',
    last = null
  const map = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    if (last !== null && pos > last) {
      text += '\n'
      map.push(null)
    }
    for (let i = 0; i < node.text.length; i++) {
      text += node.text[i]
      map.push(pos + i)
    }
    last = pos + node.text.length
  })
  const start = text.indexOf(original)
  if (start < 0 || text.indexOf(original, start + 1) >= 0 || map[start] == null || map[start + original.length - 1] == null)
    throw new Error('编辑器中无法唯一定位改稿片段，请重新生成')
  const from = map[start],
    to = map[start + original.length - 1] + 1
  let protectedMark = false
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.marks?.some((mark) => /dl|link|note|annotation/i.test(mark.type.name))) protectedMark = true
  })
  return { from, to, protectedMark }
}
function createOriginal(work, original) {
  if (!original?.name) throw new Error('原创实体缺少名称')
  if (original.type === '人物' || original.type === 'character') return work.addCharacter(original.name)
  return work.mubuAddInCurrentSet(original.name + (original.description ? '\n' + original.description : ''))
}
export async function applyProposal(work, card, options = {}) {
  if (card.kind === 'workflow') return applyWorkflow(work, card, options)
  const action = options.action || 'apply'
  const frozenCandidate=card.workflowBinding?freezeDraft(card):null
  const revalidateCandidate=async()=>{
    if(card.storyBinding)await (await import('../../db/story-repo.js')).assertStoryBinding(card.storyBinding)
    if(!card.workflowBinding)return
    const current=freezeDraft(card)
    if(current.contentHash!==frozenCandidate.contentHash||current.revision!==frozenCandidate.revision)throw new Error('采纳期间候选已编辑，请重新确认')
    await (await import('../../db/workflow-repo.js')).assertStoredCandidate(card)
  }
  const operation = card.id + ':' + action
  if(card.workflowBinding)await (await import('../../db/workflow-repo.js')).assertStoredCandidate(card)
  if (applying.has(operation)) throw new Error('此提案正在应用，请稍候')
  proposalGuard(work, card, action)
  if (['draft', 'rewrite', 'append', 'replace','insert'].includes(action) || card.kind === 'rewrite') {
    const editor = window.__ns?.editor
    if (!editor || editor.isDestroyed || work.selChapterId !== card.anchorId) throw new Error('请先打开提案对应章节')
    if (!editor.isEditable) throw new Error('当前编辑器只读')
    const anchor=card.source?.taskRequest?.writingAnchor
    if(anchor)validateWritingAnchor(editor,anchor)
    if (!anchor&&(card.kind === 'rewrite' || action === 'replace') && locateEditorPatch(editor, card.original,{wholeChapter:card.source?.taskRequest?.type==='chapter.draft'}).protectedMark)
      throw new Error('修改范围跨越关系链接或批注，已禁用一键应用，请人工处理草案')
  }
  await autosave.flushAll()
  const task=card.source?.taskRequest
  if(task?.selectedDirection&&task.writingSessionId&&!options.useFrozenDirection){
    const record=await db.airuns.get(task.writingSessionId),direction=record?.session?.directions.find(d=>d.id===task.selectedDirection.id)
    if(!direction||direction.revision!==task.selectedDirection.revision||JSON.stringify(direction.draft)!==JSON.stringify({title:task.selectedDirection.title,development:task.selectedDirection.development}))throw new Error('方向版本已变化：请按新方向生成，或明确采用本候选绑定的方向版本')
  }
  const owner = uid(),
    leaseId = 'apply:' + card.workId
  if (!(await leaseJob({ id: leaseId, workId: card.workId, type: 'application-lock', owner })))
    throw new Error('另一窗口正在应用提案，请稍候')
  let row
  try {
    row = proposalGuard(work, card, action)
    if(card.source?.bookRevision && sourceManifest(await readSourceSnapshot(card.workId)).hash!==card.source.bookRevision)
      throw new Error('数据库中的作品资料已变化，请重新生成提案')
    if (applying.has(operation)) throw new Error('此提案正在应用，请稍候')
    const type = targetOf(work, card).type
    const table = { chapter: 'chapters', outline: 'olnodes', lore: 'mubu', characters: 'characters' }[type]
    const workOnly = card.kind === 'draft' && !card.anchorId && action === 'newchapter'
    const persisted = await db.table(workOnly ? 'works' : table).get(row.id)
    if (!persisted || (type === 'chapter' && !workOnly ? chapterHash(persisted) : entityHash(persisted)) !== card.sourceHash)
      throw new Error('数据库来源已变化，请刷新对照并重新生成')
    for (const version of card.source?.sourceVersions || []) {
      const row = await db.table(version.table).get(version.id)
      if (!row || row.deletedAt || (version.table === 'chapters' ? chapterHash(row) : entityHash(row)) !== version.hash)
        throw new Error('数据库中的生成依据已变化，请重新生成')
    }
    if (
      (await aiRows('airuns', card.workId)).some(
        (r) => r.type === 'application' && r.cardId === card.id && r.action === action && r.status === 'applied',
      )
    )
      throw new Error('该提案已在窗口中应用')
  } catch (e) {
    await updateJob(leaseId, owner, { owner: null, leaseUntil: 0, status: 'completed' })
    throw e
  }
  const before = Object.fromEntries(TABLES.map((t) => [t, clone(work[t])]))
  const undoBefore = clone(work.olUndo)
  const redoBefore = clone(work.olRedo)
  let editorBefore = null
  let targetEditor = null, editorAfter = null, editorChange = null
  let changes = []
  const auditId = uid()
  applying.add(operation)
  try {
    await revalidateCandidate()
    if (action.startsWith('original:')) {
      if (isPopped(work, 'characters', '') || isPopped(work, 'lore', '')) throw new Error('实体模块被其他窗口锁定')
      createOriginal(work, card.originalProposals[Number(action.split(':')[1])])
    } else if (card.kind === 'draft' && action === 'newchapter') {
      if (!options.title?.trim()) throw new Error('请填写新章节标题')
      if (options.volumeId !== 'orphans' && !work.liveVolumes.some((v) => v.id === options.volumeId))
        throw new Error('所属卷已删除，请重新选择')
      const after = options.afterId
        ? work.liveChapters.find((c) => c.id === options.afterId && (c.volumeId || 'orphans') === options.volumeId)
        : null
      if (options.afterId && !after) throw new Error('插入位置不存在或不属于选择的卷')
      const chapter = await work.addChapter(options.volumeId, options.title.trim())
      if (after) {
        const next = work.liveChapters
          .filter((c) => c.id !== chapter.id && c.volumeId === chapter.volumeId && c.sortOrder > after.sortOrder)
          .sort((a, b) => a.sortOrder - b.sortOrder)[0]
        chapter.sortOrder = next ? (after.sortOrder + next.sortOrder) / 2 : after.sortOrder + 1000
      }
      chapter.content = card.text
      chapter.fmt = 'text'
      chapter.wordCount = card.text.replace(/\s/g, '').length
      autosave.mark('chapters', chapter)
    } else if (card.kind === 'plan') {
      work.olnodePushUndo(true)
      work.aiApplying = true
      const created = work.olnodeBulkAdd(card.nodes.map((n) => ({ parentId: row.id, kind: 'event', title: n.title, text: n.points })))
      const labels = { cause: '因果', foreshadow: '伏笔', conflict: '冲突' }
      for (let i = 1; i < created.length; i++)
        if (card.nodes[i].edge) work.olnodeRelAdd(created[i - 1].id, created[i].id, { kind: labels[card.nodes[i].edge] })
      work.tab = 'outline'
      work.outlineView = 'canvas'
      work.selOlnodeId = row.id
      work.canvasFocusTick++
    } else if (card.kind === 'branch' && action === 'outline') {
      const anchor = work.ensureChapterAnchor(card.anchorId)
      if (!anchor) throw new Error('章节锚点不存在')
      work.olnodeAdd(anchor.id, {
        title: card.title,
        text: [card.summary, card.tension, JSON.stringify(card.impact)].filter(Boolean).join('\n'),
      })
    } else if (card.kind === 'rewrite' || ['draft', 'append', 'replace','insert'].includes(action)) {
      const editor = window.__ns.editor
      targetEditor = editor
      editorBefore = editor.getJSON()
      autosave.mark('chapters', row, { forceSnapshot: true })
      await autosave.flushAll()
      await revalidateCandidate()
      proposalGuard(work, card, action)
      if (work.selChapterId !== card.anchorId || editor !== window.__ns.editor || editor.isDestroyed || !editor.isEditable)
        throw new Error('编辑器目标已变化')
      const anchor=card.source?.taskRequest?.writingAnchor
      if(anchor)validateWritingAnchor(editor,anchor)
      if(anchor)editor.view.dispatch(closeHistory(editor.state.tr))
      const replacement = card.editText ?? (card.kind === 'draft' ? card.text : card.replacement || card.opening || '')
      if(typeof replacement!=='string'||!replacement.trim()||replacement.length>200000)throw new Error('待采纳正文为空或过长')
      const paragraphs = replacement
        .split(/\n+/)
        .filter(Boolean)
        .map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
      const storyHTML=card.storyHTML?normalizeStoryHTML(card.storyHTML):null
      if(storyHTML&&normalizeText(storyHTML,'html')!==replacement)throw new Error('共同工作稿富文本与确认正文不一致')
      if (!paragraphs.length) throw new Error('没有可应用的正文')
      if (card.kind === 'rewrite' || action === 'replace') {
        const range = anchor || locateEditorPatch(editor, card.original,{wholeChapter:card.source?.taskRequest?.type==='chapter.draft'})
        if (range.protectedMark) throw new Error('修改范围含关系链接或批注')
        const inline =
          !replacement.includes('\n') && editor.state.doc.resolve(range.from).parent === editor.state.doc.resolve(range.to).parent
        // At a mark boundary, $from.marks() inherits the left text. Use the
        // first actually selected text node so unmarked replacements stay unmarked.
        const content = storyHTML || (inline
          ? { type: 'text', text: replacement, marks: (editor.state.doc.nodeAt(range.from)?.marks || []).map((m) => m.toJSON()) }
          : paragraphs)
        if (!editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content).run()) throw new Error('改稿事务未提交')
      } else if(anchor){
        const inline=!replacement.includes('\n')
        if(!editor.chain().focus().insertContentAt(anchor.from,inline?{type:'text',text:replacement}:paragraphs).run())throw new Error('续写事务未提交')
      } else if (!editor.chain().focus('end').insertContent(storyHTML||paragraphs).run()) throw new Error('续写事务未提交')
      editorAfter = JSON.stringify(editor.getJSON())
      editorChange = {table:'chapters',id:row.id,before:before.chapters.find(c=>c.id===row.id),afterHash:entityHash(row)}
      if(anchor)editor.view.dispatch(closeHistory(editor.state.tr))
    } else if (card.kind === 'diff' && card.subject === 'lore') {
      if (card.mode === 'add') work.mubuAddTree(row.id, null, [card.tree])
      else work.mubuSetText(row.id, card.revised, null)
    } else if (card.kind === 'diff' && card.subject === 'character') {
      const selected = options.selected || {}
      const fields = Object.fromEntries(Object.entries(card.fields || {}).filter(([k]) => selected.fields?.includes(k)))
      const patch = {}
      if (Object.keys(fields).length) patch.fields = { ...(row.fields || {}), ...fields }
      if (selected.bio && card.bio) patch.content = card.bio
      const aliases = (card.aliases || []).filter((_, i) => selected.aliases?.includes(i))
      if (aliases.length) patch.aliases = [...new Set([...namesOf(row).slice(1), ...aliases])].join('、')
      const relationTargets = (card.relations || [])
        .filter((_, i) => selected.relations?.includes(i))
        .map((r) => {
          const matches = work.liveCharacters.filter((c) => namesOf(c).includes(r.name))
          if (matches.length !== 1) throw new Error('关系人物不唯一或未登记，请单独确认实体')
          if (matches[0].id === row.id) throw new Error('不能创建自身关系')
          if (isPopped(work, 'characters', matches[0].id)) throw new Error('关系人物被其他窗口锁定')
          return { relation: r, target: matches[0] }
        })
      if (Object.keys(patch).length) work.updateCharacter(row.id, patch)
      for (const { relation, target } of relationTargets)
        if (!work.relations.some((r) => r.fromId === row.id && r.toId === target.id && r.label === relation.label))
          work.addRelation(row.id, target.id, relation.label)
      if (!Object.keys(patch).length && !relationTargets.length) throw new Error('请至少勾选一条人物建议')
    } else throw new Error('不支持的提案操作')
    await nextTick()
    if (work.work?.id !== card.workId) throw new Error('作品已切换')
    work.aiApplying = false
    changes = []
    if(editorChange)changes.push(editorChange)
    else for (const table of TABLES)
      for (const after of work[table]) {
        const prior = before[table].find((r) => r.id === after.id)
        if (!prior || entityHash(prior) !== entityHash(after))
          changes.push({ table, id: after.id, before: prior || null, afterHash: entityHash(after) })
      }
    // Register only after a successful editor transaction; saving the final row and job is atomic.
    for (const change of changes.filter(c=>c.table==='chapters')) {
      const chapter=work.chapters.find(c=>c.id===change.id)
      if(chapter)autosave.mark('chapters',chapter,{memoryIntent:{applicationId:auditId,cardId:card.id}})
    }
    await autosave.flushAll()
    for (const change of changes) {
      const persisted = await db.table(change.table).get(change.id)
      if (!persisted || entityHash(persisted) !== change.afterHash) throw new Error('应用未完整保存，正在回滚本次变更')
    }
    await putAiRow('airuns', {
      id: auditId,
      workId: card.workId,
      type: 'application',
      status: 'applied',
      cardId: card.id,
      action,
      changes,
      createdAt: Date.now(),
    })
    card.appliedActions = [...(card.appliedActions || []), action]
    card.auditId = auditId
    card.status = 'applied'
    if(card.taskType?.startsWith('chapter.')){card.memoryPending=true;markChapterStale(card.anchorId)}
    return { ok: true, auditId, affected: changes.map((r) => r.id) }
  } catch (e) {
    if (work.work?.id !== card.workId) throw e
    work.aiApplying = false
    // Validation can fail after awaiting a flush. Until our transaction commits,
    // nothing belongs to this operation and restoring a snapshot would erase input.
    if (editorBefore && !editorAfter) throw e
    if (editorBefore && targetEditor === window.__ns?.editor && work.selChapterId === card.anchorId && !targetEditor.isDestroyed && JSON.stringify(targetEditor.getJSON()) === editorAfter)
      targetEditor.commands.setContent(editorBefore)
    if(editorChange&&!changes.length)changes.push(editorChange)
    if (!editorBefore && !changes.length)
      for (const table of TABLES)
        for (const row of work[table]) {
          const prior = before[table].find((b) => b.id === row.id)
          if (!prior || (row.id === card.anchorId && entityHash(prior) !== entityHash(row)))
            changes.push({ table, id: row.id, before: prior || null, afterHash: entityHash(row) })
        }
    for (const change of changes) {
      const index = work[change.table].findIndex((r) => r.id === change.id),
        current = work[change.table][index]
      if (index < 0 || entityHash(current) !== change.afterHash) continue
      const row = change.before ? clone(change.before) : { ...current, deletedAt: Date.now() }
      work[change.table][index] = row
      autosave.mark(change.table, row, change.table === 'chapters' ? { memoryIntent: null } : {})
    }
    work.olUndo = undoBefore
    work.olRedo = redoBefore
    await autosave.flushAll()
    throw e
  } finally {
    work.aiApplying = false
    applying.delete(operation)
    await updateJob(leaseId, owner, { owner: null, leaseUntil: 0, status: 'completed' })
  }
}
export async function undoApplication(work, auditId) {
  const workflowAudit = await db.airuns.get(auditId)
  if (workflowAudit?.type === 'workflow-application') return undoWorkflow(work, workflowAudit)
  const workId = work.work?.id,
    owner = uid(),
    leaseId = 'apply:' + workId
  if (!workId) throw new Error('请先打开作品')
  await autosave.flushAll()
  if (!(await leaseJob({ id: leaseId, workId, type: 'application-lock', owner }))) throw new Error('另一窗口正在应用或撤销提案，请稍候')
  try {
    const audit = await db.airuns.get(auditId)
    if (!audit || audit.workId !== workId || audit.status !== 'applied') throw new Error('没有可撤销的应用记录')
    if (work.work?.id !== workId) throw new Error('作品已切换')
    for (const change of audit.changes) {
      const row = work[change.table].find((r) => r.id === change.id),
        persisted = await db.table(change.table).get(change.id)
      if (!row || !persisted || entityHash(row) !== change.afterHash || entityHash(persisted) !== change.afterHash)
        throw new Error('应用后内容已变化，不能覆盖后续编辑')
      const type = {
        chapters: 'chapter',
        outlines: 'outline',
        olnodes: 'outline',
        mubu: 'lore',
        characters: 'characters',
        relations: 'characters',
      }[change.table]
      if (isPopped(work, type, ['outline', 'lore'].includes(type) ? '' : row.id)) throw new Error('目标被其他窗口锁定')
    }
    if (work.work?.id !== workId) throw new Error('作品已切换')
    for (const change of audit.changes) {
      const i = work[change.table].findIndex((r) => r.id === change.id)
      const row = change.before ? clone(change.before) : { ...work[change.table][i], deletedAt: Date.now() }
      work[change.table][i] = row
      autosave.mark(change.table, row)
      if (change.table === 'chapters' && work.selChapterId === row.id && window.__ns?.editor && !window.__ns.editor.isDestroyed)
        window.__ns.editor.commands.setContent(row.content || '')
    }
    await autosave.flushAll()
    await putAiRow('airuns', { ...audit, status: 'undone' })
  } finally {
    await updateJob(leaseId, owner, { owner: null, leaseUntil: 0, status: 'completed' })
  }
}
