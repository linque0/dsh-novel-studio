/* 界面数据层（宿主无关）：把作品库拼成界面直接能渲染的形状。
 * 只依赖 Library 的公开方法；错误用带 code 的 Error 抛出，由适配层统一映射。 */
import { randomUUID } from 'node:crypto';
import {
  sanitizeHtml,
  htmlToPlainText,
  countChars,
  orderOf,
  alive,
  orderedChapters,
  toTimestamp,
} from './format.js';

/** 单章返回的正文上限：界面上不可能一次渲染更多，超过就截断并标记。 */
const MAX_HTML_CHARS = 200000;
/* 截断残尾：保留段以未闭合的开放标签结尾时一并去掉，别让界面画出空壳元素。 */
const TRAILING_OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/* 字数口径：净化后再取纯文本，保证与返回给界面的 html 一致。 */
const charsOf = (html) => countChars(htmlToPlainText(sanitizeHtml(html)));

/* 排序容错：实体行是毫秒数字，索引里是 ISO 字符串，解析不了的沉到最后。 */
const sortableAt = (value) => {
  const at = toTimestamp(value);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
};

const outlineText = (entities, level, refId) =>
  entities
    .filter((entity) => entity.row?.level === level && entity.row?.refId === refId)
    .map((entity) => String(entity.row?.content ?? ''))
    .filter(Boolean)
    .join('\n');

export function createView(library) {
  const requireLibrary = () => {
    if (!library) throw fail('LIBRARY_UNAVAILABLE', '作品库不可用');
    return library;
  };

  /** 书架：每部作品的未删除章数与总字数，按更新时间倒序；行内软删的作品不上架。 */
  async function shelf() {
    const lib = requireLibrary();
    const [workEntities, chapterEntities] = await Promise.all([
      lib.listEntities('works'),
      lib.listEntities('chapters'),
    ]);
    const stats = new Map();
    for (const entity of chapterEntities) {
      if (!alive(entity.row)) continue;
      const key = String(entity.row?.workId ?? '');
      const item = stats.get(key) || { chapters: 0, chars: 0 };
      item.chapters += 1;
      item.chars += charsOf(entity.row?.content);
      stats.set(key, item);
    }
    const works = workEntities.filter((entity) => alive(entity.row)).map((entity) => {
      const row = entity.row || {};
      const id = String(row.id || entity.id);
      const stat = stats.get(id) || { chapters: 0, chars: 0 };
      return {
        id,
        title: String(row.title ?? ''),
        updatedAt: row.updatedAt ?? entity.updatedAt ?? '',
        chapters: stat.chapters,
        chars: stat.chars,
        status: String(row.status ?? ''),
      };
    });
    works.sort((a, b) => sortableAt(b.updatedAt) - sortableAt(a.updatedAt));
    return { works, total: works.length };
  }

  /** 新建空白作品：一次单条提交，requestId 用作品 id 保证重试幂等。 */
  async function createWork(args = {}) {
    const lib = requireLibrary();
    const title = String(args?.title ?? '').trim();
    if (!title) throw fail('INVALID_INPUT', '作品标题不能为空');
    const id = randomUUID();
    const at = Date.now();
    const row = { id, title, author: '', genre: '', status: '', intro: '', createdAt: at, updatedAt: at, deletedAt: null };
    let result;
    try {
      result = await lib.submit([{ table: 'works', id, kind: 'put', baseRevision: 0, row }], {
        requestId: 'ui:work.create:' + id,
        actor: { kind: 'human' },
      });
    } catch (error) {
      throw fail('BUSY', '作品创建失败：' + (error?.message || error));
    }
    if (result?.ok === false) throw fail('BUSY', '作品创建失败：版本冲突');
    const saved = await lib.readEntity('works', id);
    return { work: saved?.row || row };
  }

  /** 打开作品：卷按 sortOrder 升序，章按「卷后章」，无卷/坏卷的章排最后且 volumeId 归一为 null。 */
  async function openWork(args = {}) {
    const lib = requireLibrary();
    const workId = String(args?.workId ?? '').trim();
    if (!workId) throw fail('INVALID_INPUT', '缺少 workId');
    const found = await lib.readEntity('works', workId);
    if (!found) throw fail('NOT_FOUND', '作品不存在：' + workId);
    const [volumeEntities, chapterEntities, outlineEntities] = await Promise.all([
      lib.listEntities('volumes'),
      lib.listEntities('chapters'),
      lib.listEntities('outlines'),
    ]);
    const volumeRows = volumeEntities
      .filter((entity) => entity.row?.workId === workId && alive(entity.row))
      .map((entity) => entity.row)
      .sort((a, b) => orderOf(a) - orderOf(b));
    const volumeIds = new Set(volumeRows.map((row) => row.id));
    const chapters = orderedChapters(
      chapterEntities.filter((entity) => entity.row?.workId === workId).map((entity) => entity.row),
      volumeRows,
    ).map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.title || '未命名'),
      volumeId: volumeIds.has(row.volumeId) ? row.volumeId : null,
      order: orderOf(row),
      chars: charsOf(row.content),
      status: String(row.status ?? ''),
    }));
    return {
      work: found.row,
      volumes: volumeRows.map((row) => ({ id: row.id, title: String(row.title || '未命名卷'), sortOrder: orderOf(row) })),
      chapters,
      masterOutline: outlineText(outlineEntities, 'master', workId),
    };
  }

  /** 单章：净化后的 html + 编辑用 revision；超长正文截断到 20 万并标记，截断点回退到标签边界。 */
  async function chapter(args = {}) {
    const lib = requireLibrary();
    const chapterId = String(args?.chapterId ?? '').trim();
    if (!chapterId) throw fail('INVALID_INPUT', '缺少 chapterId');
    const [found, outlineEntities] = await Promise.all([
      lib.readEntity('chapters', chapterId),
      lib.listEntities('outlines'),
    ]);
    if (!found) throw fail('NOT_FOUND', '章节不存在：' + chapterId);
    const row = found.row || {};
    let html = sanitizeHtml(row.content || '');
    let truncated = false;
    if (html.length > MAX_HTML_CHARS) {
      /* 仅在截断点落在标签内部时回退到最后那个 '>'：一律回退会把整段长文砍到开头几字节。 */
      const cut = html.slice(0, MAX_HTML_CHARS - 1);
      const open = cut.lastIndexOf('<');
      const closed = cut.lastIndexOf('>');
      let kept = open > closed && closed > 0 ? cut.slice(0, closed + 1) : cut;
      let shorter = kept.replace(TRAILING_OPEN_TAG, '');
      while (shorter !== kept) {
        kept = shorter;
        shorter = kept.replace(TRAILING_OPEN_TAG, '');
      }
      html = kept + '…';
      truncated = true;
    }
    return {
      id: String(row.id || found.id),
      title: String(row.title || '未命名'),
      revision: Number(found.revision) || 0,
      chars: countChars(htmlToPlainText(html)),
      status: String(row.status ?? ''),
      updatedAt: row.updatedAt ?? found.updatedAt ?? '',
      html,
      outline: outlineText(outlineEntities, 'chapter', chapterId),
      truncated,
    };
  }

  return { shelf, createWork, openWork, chapter };
}
