/* 只读工具定义（宿主无关）：只依赖 Library，不 import 任何 DSH/Electron 模块。
 * 写操作在 M4 才开放，且只走 propose -> apply -> undo。 */
import { randomUUID } from 'node:crypto';
import { SYNC_TABLES } from './library.js';

const stripTags = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .trim();

const chapterText = (row) => stripTags(row?.content ?? row?.text ?? row?.html ?? '');
const orderOf = (row) => Number(row?.sortOrder ?? row?.order ?? row?.orderIndex ?? 0);

function paged(items, cursor, limit) {
  const start = Math.max(0, Number(cursor) || 0);
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? start + size : null;
  return { items: slice, total: items.length, cursor: start, nextCursor: next };
}

async function requireWork(library, workId) {
  const works = await library.works();
  if (!works.length) return { error: '作品库还没有作品；请先在小说工坊里新建或从软件版迁移' };
  const id = workId || works[0].id;
  const found = await library.readEntity('works', id);
  if (!found) return { error: '作品不存在：' + id };
  return { work: found.row, id };
}

export function createTools(library) {
  const studioWorks = {
    name: 'studio_works',
    description: '列出或打开小说工坊作品库里的作品。op=list 返回书目；op=open 返回该作品的卷与章节目录。写入请用 studio_propose/studio_apply。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['list', 'open'], description: 'list=书目，open=打开某部作品' },
        workId: { type: 'string', description: '作品 ID；省略时用最近更新的作品' },
        query: { type: 'string', description: 'list 时按标题过滤' },
      },
    },
    async execute(args = {}) {
      const op = args.op === 'open' ? 'open' : 'list';
      if (op === 'list') {
        const query = String(args.query || '').trim().toLowerCase();
        const works = (await library.works()).filter((w) => !query || String(w.title || '').toLowerCase().includes(query));
        return {
          library: library.dir,
          items: works.map((w) => ({ id: w.id, title: w.title, updatedAt: w.updatedAt, revision: w.revision })),
          total: works.length,
        };
      }
      const target = await requireWork(library, args.workId);
      if (target.error) return target;
      const volumes = (await library.listEntities('volumes')).filter((v) => v.row.workId === target.id).map((v) => v.row).sort((a, b) => orderOf(a) - orderOf(b));
      const chapters = (await library.listEntities('chapters'))
        .filter((c) => c.row.workId === target.id)
        .map((c) => ({ id: c.row.id, title: c.row.title || '未命名', volumeId: c.row.volumeId || null, order: orderOf(c.row), chars: chapterText(c.row).length }))
        .sort((a, b) => a.order - b.order);
      return { work: { id: target.work.id, title: target.work.title, description: target.work.description || '' }, volumes: volumes.map((v) => ({ id: v.id, title: v.title || '未命名卷', order: orderOf(v) })), chapters, totalChapters: chapters.length };
    },
  };

  const studioOutline = {
    name: 'studio_outline',
    description: '读取作品的目录（卷与章节顺序）与每章字数，用于定位写作目标。不返回正文。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workId: { type: 'string', description: '作品 ID；省略时用最近更新的作品' },
        cursor: { type: 'integer', description: '分页起点，默认 0' },
        limit: { type: 'integer', description: '每页 1-200，默认 50' },
      },
    },
    async execute(args = {}) {
      const target = await requireWork(library, args.workId);
      if (target.error) return target;
      const volumes = new Map((await library.listEntities('volumes')).filter((v) => v.row.workId === target.id).map((v) => [v.row.id, v.row]));
      const rows = (await library.listEntities('chapters'))
        .filter((c) => c.row.workId === target.id)
        .map((c) => ({
          id: c.row.id,
          title: c.row.title || '未命名',
          volume: volumes.get(c.row.volumeId)?.title || null,
          order: orderOf(c.row),
          chars: chapterText(c.row).length,
        }))
        .sort((a, b) => a.order - b.order);
      const page = paged(rows, args.cursor, args.limit);
      return { workId: target.id, ...page };
    },
  };

  const studioRead = {
    name: 'studio_read',
    description: '按游标分页读取正文片段或人物/设定条目全文。只读当前版本；截至某章的事实回放在 studio_state（M2）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['chapter', 'character', 'lore'], description: '读取对象类型' },
        id: { type: 'string', description: '对象 ID' },
        cursor: { type: 'integer', description: '字符游标，默认 0' },
        maxChars: { type: 'integer', description: '单次最多返回多少字符，默认 4000，上限 20000' },
      },
      required: ['kind', 'id'],
    },
    async execute(args = {}) {
      const kind = args.kind;
      if (!['chapter', 'character', 'lore'].includes(kind)) return { error: 'kind 必须是 chapter/character/lore' };
      const id = String(args.id || '');
      if (!id) return { error: '缺少 id' };
      const table = kind === 'chapter' ? 'chapters' : kind === 'character' ? 'characters' : 'lore';
      if (!SYNC_TABLES.includes(table)) return { error: '不支持的表：' + table };
      const entity = await library.readEntity(table, id);
      if (!entity) return { error: '对象不存在或已删除：' + id };
      const row = entity.row;
      const text = kind === 'chapter' ? chapterText(row) : [row.name, row.aliases, stripTags(row.content || row.text || '')].filter(Boolean).join('\n');
      const start = Math.max(0, Number(args.cursor) || 0);
      const size = Math.min(20000, Math.max(200, Number(args.maxChars) || 4000));
      const chunk = text.slice(start, start + size);
      const next = start + size < text.length ? start + size : null;
      return {
        kind, id, title: row.title || row.name || '', revision: entity.revision,
        text: chunk, cursor: start, nextCursor: next, truncated: next !== null, totalChars: text.length,
      };
    },
  };

  /* —— 写：只走 propose → apply → undo（作者确认后才落库）—— */

  const studioPropose = {
    name: 'studio_propose',
    description: '产出候选提案，不修改作品。作者确认后再用 studio_apply 落库；不要声称已保存。kind=chapter.append 追加到章末，chapter.replace 替换整章，chapter.create 新建章，setting.update 替换设定全文。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workId: { type: 'string', description: '作品 ID' },
        kind: { type: 'string', enum: ['chapter.append', 'chapter.replace', 'chapter.create', 'setting.update'], description: '提案类型' },
        targetId: { type: 'string', description: '目标章或设定 ID（chapter.create 可省略）' },
        title: { type: 'string', description: 'chapter.create 的章标题' },
        volumeId: { type: 'string', description: 'chapter.create 的所属卷（可省略）' },
        text: { type: 'string', description: '候选正文（纯文本，自然段）' },
        summary: { type: 'string', description: '一句话说明这次改动' },
      },
      required: ['workId', 'kind', 'text'],
    },
    async execute(args = {}) {
      const kind = String(args.kind || '');
      const text = String(args.text || '');
      if (!text.trim()) return { error: 'text 不能为空' };
      if (!['chapter.append', 'chapter.replace', 'chapter.create', 'setting.update'].includes(kind)) return { error: 'kind 不支持：' + kind };
      const work = await library.readEntity('works', args.workId);
      if (!work) return { error: '作品不存在：' + args.workId };
      let basis = null;
      let targetTitle = args.title || '';
      if (kind === 'chapter.append' || kind === 'chapter.replace') {
        const chapter = await library.readEntity('chapters', String(args.targetId || ''));
        if (!chapter) return { error: '目标章不存在：' + args.targetId };
        basis = { table: 'chapters', id: chapter.id, revision: chapter.revision };
        targetTitle = chapter.row.title || targetTitle;
      }
      if (kind === 'setting.update') {
        const table = ['lore', 'characters'].find(async () => false) || 'lore';
        const entity = (await library.readEntity('lore', String(args.targetId || ''))) || (await library.readEntity('characters', String(args.targetId || '')));
        if (!entity) return { error: '目标设定不存在：' + args.targetId };
        basis = { table: entity.table, id: entity.id, revision: entity.revision };
        targetTitle = entity.row.name || targetTitle;
      }
      const proposal = await library.writeProposal({
        workId: args.workId,
        kind,
        targetId: args.targetId || null,
        volumeId: args.volumeId || null,
        title: targetTitle,
        summary: args.summary || '',
        text,
        basis,
        chars: text.length,
        actor: { kind: 'agent' },
      });
      return {
        proposalId: proposal.id,
        status: proposal.status,
        kind,
        title: targetTitle,
        chars: text.length,
        basis,
        preview: text.slice(0, 200),
        next: '请作者确认；确认后调用 studio_apply {proposalId, confirm:true} 落库',
      };
    },
  };

  const studioApply = {
    name: 'studio_apply',
    description: '把已确认的提案写入作品。必须 confirm:true，且必须由作者同意后调用。带 requestId 幂等；版本冲突会返回 CONFLICT 而不是覆盖。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        proposalId: { type: 'string', description: 'studio_propose 返回的提案 ID' },
        confirm: { type: 'boolean', description: '作者已确认时才传 true' },
        requestId: { type: 'string', description: '幂等键，重试保持相同' },
      },
      required: ['proposalId'],
    },
    async execute(args = {}) {
      if (args.confirm !== true) return { error: '落库需要作者确认：请先征得作者同意，再以 confirm:true 调用', code: 'NEED_CONFIRM' };
      const proposal = await library.readProposal(String(args.proposalId || ''));
      if (!proposal) return { error: '提案不存在：' + args.proposalId };
      if (proposal.status === 'applied') return { error: '该提案已应用；如需回退用 studio_undo', code: 'ALREADY_APPLIED', appliedAt: proposal.appliedAt };
      const table = proposal.kind === 'setting.update' ? (proposal.basis?.table || 'lore') : 'chapters';
      let op;
      let previousRow = null;
      if (proposal.kind === 'chapter.create') {
        const id = randomUUID();
        op = {
          table: 'chapters',
          id,
          kind: 'put',
          baseRevision: 0,
          row: { id, workId: proposal.workId, volumeId: proposal.volumeId || null, title: proposal.title || '未命名', content: proposal.text, sortOrder: Date.now() },
        };
      } else {
        const current = await library.readEntity(table, String(proposal.targetId || ''));
        if (!current) return { error: '目标对象不存在或已删除：' + proposal.targetId };
        previousRow = current.row;
        const content = proposal.kind === 'chapter.append' ? String(current.row.content || '') + proposal.text : proposal.text;
        op = {
          table,
          id: current.id,
          kind: 'put',
          baseRevision: current.revision,
          row: proposal.kind === 'setting.update' ? { ...current.row, content: proposal.text } : { ...current.row, content },
        };
      }
      const requestId = String(args.requestId || 'apply:' + proposal.id + ':' + (op.baseRevision ?? 0));
      const result = await library.submit([op], { requestId, actor: { kind: 'agent' } });
      if (!result.ok) return { error: '写入冲突，请重读后重新提案', code: 'CONFLICT', conflict: result.conflict };
      await library.updateProposal(proposal.id, {
        status: 'applied',
        appliedAt: new Date().toISOString(),
        audit: { table: op.table, id: op.id, revision: result.revisions?.[0]?.revision ?? null, seq: result.seq, requestId, previousRow },
      });
      return { ok: true, proposalId: proposal.id, table: op.table, id: op.id, seq: result.seq, revision: result.revisions?.[0]?.revision ?? null, replayed: result.replayed === true };
    },
  };

  const studioUndo = {
    name: 'studio_undo',
    description: '回退一次已应用的提案，恢复到应用前的版本。带 requestId 幂等；目标已被他人改动时返回 CONFLICT。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        proposalId: { type: 'string', description: '已应用的提案 ID' },
        confirm: { type: 'boolean', description: '作者同意回退时传 true' },
        requestId: { type: 'string', description: '幂等键' },
      },
      required: ['proposalId'],
    },
    async execute(args = {}) {
      if (args.confirm !== true) return { error: '回退需要作者确认：confirm:true', code: 'NEED_CONFIRM' };
      const proposal = await library.readProposal(String(args.proposalId || ''));
      if (!proposal) return { error: '提案不存在：' + args.proposalId };
      if (proposal.status !== 'applied' || !proposal.audit) return { error: '该提案尚未应用，无需回退', code: 'NOT_APPLIED' };
      const { table, id, previousRow } = proposal.audit;
      const current = await library.readEntity(table, id);
      const requestId = String(args.requestId || 'undo:' + proposal.id + ':' + (current?.revision ?? 0));
      const op = previousRow
        ? { table, id, kind: 'put', baseRevision: current ? current.revision : 0, row: previousRow }
        : { table, id, kind: 'delete', baseRevision: current ? current.revision : 0 };
      const result = await library.submit([op], { requestId, actor: { kind: 'agent' } });
      if (!result.ok) return { error: '回退冲突，目标已被改动', code: 'CONFLICT', conflict: result.conflict };
      await library.updateProposal(proposal.id, { status: 'reverted', revertedAt: new Date().toISOString() });
      return { ok: true, proposalId: proposal.id, table, id, seq: result.seq, revision: result.revisions?.[0]?.revision ?? null };
    },
  };

  const studioSearch = {
    name: 'studio_search',
    description: '在正文、设定、人物里做子串检索，返回命中片段。用于定位要给谁改稿；不做语义检索。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '关键词' },
        limit: { type: 'integer', description: '最多返回多少条，默认 10，上限 40' },
      },
      required: ['query'],
    },
    async execute(args = {}) {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'query 不能为空' };
      const limit = Math.min(40, Math.max(1, Number(args.limit) || 10));
      const items = [];
      const scan = (table, label, read) => {
        for (const entity of entities[table] || []) {
          const text = read(entity.row);
          const at = text.indexOf(query);
          if (at < 0) continue;
          items.push({ kind: label, table, id: entity.row.id, title: entity.row.title || entity.row.name || '', snippet: text.slice(Math.max(0, at - 40), at + query.length + 60) });
        }
      };
      const [chapters, lore, characters] = await Promise.all([library.listEntities('chapters'), library.listEntities('lore'), library.listEntities('characters')]);
      const entities = { chapters, lore, characters };
      scan('chapters', 'chapter', (row) => chapterText(row));
      scan('lore', 'lore', (row) => stripTags(row.content || row.text || ''));
      scan('characters', 'character', (row) => [row.name, row.aliases, stripTags(row.content || '')].filter(Boolean).join('\n'));
      return { query, total: items.length, items: items.slice(0, limit) };
    },
  };

  const studioPreset = {
    name: 'studio_preset',
    description: '读取作品库里保存的写作预设（只读）。用于按作者既定笔法写作；不带入未启用的方案。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workId: { type: 'string', description: '作品 ID；省略则列出全部' },
        presetId: { type: 'string', description: '要读取全文的预设 ID' },
      },
    },
    async execute(args = {}) {
      const presets = (await library.listEntities('aipresets')).map((entity) => entity.row);
      if (args.presetId) {
        const found = presets.find((row) => row.id === args.presetId);
        if (!found) return { error: '预设不存在：' + args.presetId };
        return { preset: { id: found.id, name: found.name || '', updatedAt: found.updatedAt || null, content: stripTags(found.content || found.text || '') } };
      }
      const filtered = args.workId ? presets.filter((row) => !row.workId || row.workId === args.workId) : presets;
      return { total: filtered.length, items: filtered.map((row) => ({ id: row.id, name: row.name || '', workId: row.workId || null, updatedAt: row.updatedAt || null })) };
    },
  };

  /* —— 审稿：意见必须可定位、证据必须可核；复核必须全覆盖 —— */

  const locate = (text, quote, start) => {
    if (!quote) return null;
    if (Number.isInteger(start)) {
      if (start < 0 || text.slice(start, start + quote.length) !== quote) return null;
      return { start, end: start + quote.length };
    }
    const at = text.indexOf(quote);
    if (at < 0) return null;
    return text.indexOf(quote, at + 1) >= 0 ? null : { start: at, end: at + quote.length };
  };

  const resolveEvidenceTable = (sourceType) => (sourceType === 'setting' ? 'lore' : sourceType === 'character' ? 'characters' : 'chapters');

  const studioReview = {
    name: 'studio_review',
    description: '提交结构化审稿意见。每条必须有能在正文中唯一定位的 quote；引用设定/人物作证据时会反查核实。返回 reviewId 与逐条 verified/unverified，供作者挑选。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chapterId: { type: 'string', description: '被审阅的章 ID' },
        findings: {
          type: 'array',
          description: '问题清单（至多 100 条）',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              severity: { type: 'string', enum: ['error', 'warning', 'suggestion'] },
              category: { type: 'string' },
              problem: { type: 'string' },
              expected: { type: 'string' },
              quote: { type: 'string', description: '正文中的原句，必须唯一' },
              start: { type: 'integer' },
              evidence: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['problem', 'quote'],
          },
        },
      },
      required: ['chapterId', 'findings'],
    },
    async execute(args = {}) {
      const chapter = await library.readEntity('chapters', String(args.chapterId || ''));
      if (!chapter) return { error: '章不存在：' + args.chapterId };
      const text = chapterText(chapter.row);
      const list = Array.isArray(args.findings) ? args.findings.slice(0, 100) : [];
      if (!list.length) return { error: 'findings 不能为空' };
      const items = list.map((raw, index) => {
        const quote = String(raw?.quote || '');
        const found = locate(text, quote, Number.isInteger(raw?.start) ? raw.start : undefined);
        const evidence = (Array.isArray(raw?.evidence) ? raw.evidence.slice(0, 20) : []).map((entry) => {
          const table = resolveEvidenceTable(String(entry?.sourceType || 'chapter'));
          return { sourceType: String(entry?.sourceType || 'chapter'), sourceId: String(entry?.sourceId || ''), quote: String(entry?.quote || ''), verified: false };
        });
        return {
          id: String(raw?.id || 'finding-' + (index + 1)),
          severity: ['error', 'warning', 'suggestion'].includes(raw?.severity) ? raw.severity : 'suggestion',
          category: String(raw?.category || ''),
          problem: String(raw?.problem || ''),
          expected: String(raw?.expected || ''),
          quote,
          start: found ? found.start : null,
          end: found ? found.end : null,
          locatable: !!found,
          evidence,
        };
      });
      // 证据反查（异步补齐）
      for (const item of items) {
        for (const entry of item.evidence) {
          if (!entry.sourceId || !entry.quote) continue;
          const table = resolveEvidenceTable(entry.sourceType);
          const entity = await library.readEntity(table, entry.sourceId);
          if (!entity) continue;
          const haystack = table === 'chapters' ? chapterText(entity.row) : table === 'characters' ? [entity.row.name, entity.row.aliases, stripTags(entity.row.content || '')].filter(Boolean).join('\n') : stripTags(entity.row.content || entity.row.text || '');
          entry.verified = haystack.includes(entry.quote);
          delete entry.resolved;
        }
      }
      const review = await library.writeReview({
        chapterId: chapter.id,
        chapterRevision: chapter.revision,
        items,
      });
      const verifiedCount = items.filter((item) => item.locatable).length;
      return {
        reviewId: review.id,
        chapterId: chapter.id,
        chapterRevision: chapter.revision,
        total: items.length,
        locatable: verifiedCount,
        items,
        next: '把可定位的问题交给作者挑选；改稿后用 studio_recheck 复核全部原问题',
      };
    },
  };

  const studioRecheck = {
    name: 'studio_recheck',
    description: '对已提交的审稿做定向复核：必须恰好覆盖全部原问题、不许多不许漏；改后仍无法定位的 resolved 会被降级为 unresolved。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: { type: 'string', description: 'studio_review 返回的 reviewId' },
        revisedText: { type: 'string', description: '修订后的整章正文（纯文本）' },
        items: {
          type: 'array',
          description: '逐条复核结果',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['resolved', 'unresolved'] },
              quote: { type: 'string' },
              start: { type: 'integer' },
              explanation: { type: 'string' },
            },
            required: ['id', 'status'],
          },
        },
      },
      required: ['reviewId', 'revisedText', 'items'],
    },
    async execute(args = {}) {
      const review = await library.readReview(String(args.reviewId || ''));
      if (!review) return { error: '审稿记录不存在：' + args.reviewId };
      const text = String(args.revisedText || '');
      if (!text.trim()) return { error: 'revisedText 不能为空' };
      const expected = new Set((review.items || []).map((item) => item.id));
      const given = Array.isArray(args.items) ? args.items : [];
      const seen = new Set();
      const problems = [];
      for (const raw of given) {
        const id = String(raw?.id || '');
        if (!expected.has(id)) problems.push('未知问题 id：' + id);
        else if (seen.has(id)) problems.push('重复的 id：' + id);
        seen.add(id);
      }
      const missing = [...expected].filter((id) => !seen.has(id));
      if (missing.length) problems.push('漏复核：' + missing.join(','));
      if (problems.length) return { error: '复核清单不完整', code: 'INCOMPLETE', problems };
      const items = given.map((raw) => {
        const quote = String(raw?.quote || '');
        const found = locate(text, quote, Number.isInteger(raw?.start) ? raw.start : undefined);
        const resolved = raw.status === 'resolved' && !!found;
        return {
          id: String(raw.id),
          status: resolved ? 'resolved' : 'unresolved',
          quote,
          start: found ? found.start : null,
          downgraded: raw.status === 'resolved' && !found,
          explanation: String(raw.explanation || ''),
        };
      });
      const updated = await library.updateReview(review.id, { recheckedAt: new Date().toISOString(), recheck: items });
      return {
        reviewId: updated.id,
        total: items.length,
        resolved: items.filter((item) => item.status === 'resolved').length,
        downgraded: items.filter((item) => item.downgraded).length,
        items,
      };
    },
  };

  return [studioWorks, studioOutline, studioRead, studioSearch, studioPreset, studioReview, studioRecheck, studioPropose, studioApply, studioUndo];
}
