/* 展示层格式化（宿主无关、纯函数）：净化 HTML、取纯文本、数字数、时间标签。
 * 排序与"是否存活"的口径也放这里，view 只做组装，不另抄一份。 */

/* 白名单：只放行不携带行为的内联排版标签；其余标签去掉但保留其文本。 */
const ALLOWED_TAGS = new Set(['p', 'br', 'em', 'strong', 'i', 'b', 'u', 's', 'blockquote', 'hr']);
const VOID_TAGS = new Set(['br', 'hr']);

/* 容器标签连内容一起丢弃：否则 script/style 的源码会当正文渲染出来。
 * 先删成对的，再删「只有开头没有结尾」的：正文被截断时最后一段就是这种。 */
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_UNCLOSED_CONTAINER = /<(script|style|iframe|object|embed|template|noscript)\b[^>]*>[\s\S]*$/i;

/* 一次吃掉一个完整标签；属性值里的 '>' 由引号分支吃掉，不会提前闭合。
 * '<' 与标签名之间不允许空白：'< b' 在浏览器里是文本，必须走转义分支。 */
const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const EMPTY_PARAGRAPH = '<p>(?:\\s|&nbsp;|<br>)*<\\/p>';
const EMPTY_PARAGRAPH_RUN = new RegExp(EMPTY_PARAGRAPH + '(?:' + EMPTY_PARAGRAPH + ')+', 'g');

/* 裸 '<' 不能留在输出里（浏览器会把后面的文字当成标签起点）。 */
const escapeLeftAngle = (text) => text.split('<').join('&lt;');

/**
 * 白名单净化：白名单标签保留、属性一律丢弃，其余标签连同属性去掉但文本留下，
 * 裸 '<' 转义为 &lt;，连续空段落折叠成一个。
 */
export function sanitizeHtml(html) {
  const source = String(html ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_WITH_CONTENT, '')
    .replace(DROP_UNCLOSED_CONTAINER, '');
  let out = '';
  let cursor = 0;
  let match;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(source))) {
    out += escapeLeftAngle(source.slice(cursor, match.index));
    const closing = match[0].startsWith('</');
    const name = match[1].toLowerCase();
    const selfClosed = /\/\s*$/.test(match[2]);
    if (ALLOWED_TAGS.has(name)) {
      if (VOID_TAGS.has(name)) out += '<' + name + '>';
      else if (closing) {
        if (!selfClosed) out += '</' + name + '>';
      } else out += '<' + name + '>';
    }
    cursor = match.index + match[0].length;
  }
  out += escapeLeftAngle(source.slice(cursor));
  out = out
    .replace(EMPTY_PARAGRAPH_RUN, '<p></p>')
    .replace(/^(?:<p><\/p>)+/, '')
    .replace(/(?:<p><\/p>)+$/, '');
  return out.trim();
}

/** HTML -> 纯文本；分块标签折成换行，实体还原，首尾空白去掉。 */
export function htmlToPlainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** 字符数（与 studio_read 的 totalChars 同一口径：按码元计数，换行也算）。 */
export function countChars(text) {
  return String(text ?? '').length;
}

/** ISO 字符串 / 毫秒数字 / 数字字符串 -> 毫秒；无法解析返回 NaN。 */
export function toTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value ?? '').trim();
  if (!text) return Number.NaN;
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** 相对时间标签：今天 / 昨天 / N 天前 / 上周 / 上月；无效输入返回空串。 */
export function formatUpdatedAt(value) {
  const at = toTimestamp(value);
  if (Number.isNaN(at)) return '';
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(at))) / 86400000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return days + ' 天前';
  if (days < 30) return '上周';
  return '上月';
}

/** 排序用的序号；真实数据里是 sortOrder，老数据可能是 order/orderIndex。 */
export const orderOf = (row) => Number(row?.sortOrder ?? row?.order ?? row?.orderIndex ?? 0);

/** 未删除 = 没有 deletedAt 标记（库层只挡 tombstone 文件，行内软删在这里判）。 */
export const alive = (row) => Boolean(row) && !row.deletedAt;

/**
 * 章节顺序 = 卷 sortOrder + 章内 sortOrder；
 * 卷为空或指向不存在的卷时排在最后（真实数据里确实存在这种章）。
 */
export function orderedChapters(chapters, volumes) {
  const volumeOrder = new Map((volumes || []).map((row) => [row.id, orderOf(row)]));
  return (chapters || [])
    .filter(alive)
    .map((row) => ({ row, volumeOrder: volumeOrder.get(row.volumeId) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.volumeOrder - b.volumeOrder) || (orderOf(a.row) - orderOf(b.row)))
    .map((item) => item.row);
}
