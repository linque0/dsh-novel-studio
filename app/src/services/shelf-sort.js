/* 书架排序：固定按最后一次打开时间倒序。
 * 打开时间由 shelf store 存在 appconfig（shelf:openStats），不写 works 表，
 * 避免仅因打开作品就触发项目投影。从未打开的作品排在已打开作品之后，按编辑时间兜底。 */
export function sortShelfWorks(list, openStats) {
  const openedAt = (w) => Number(openStats?.[w.id]?.lastOpenedAt) || 0
  const editedAt = (w) => Number(w.updatedAt) || 0
  const byId = (a, b) => String(a.id).localeCompare(String(b.id))
  return [...list].sort((a, b) => openedAt(b) - openedAt(a) || editedAt(b) - editedAt(a) || byId(a, b))
}

/** 打开时间文案：今天 / 昨天带时分，同年给月日，跨年带年份；没有记录时明确标注。 */
export function formatShelfOpenTime(t) {
  const ts = Number(t) || 0
  if (!ts) return '尚未打开'
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return '尚未打开'
  const now = new Date()
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const atMidnight = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime() }
  const diff = (atMidnight(now) - atMidnight(d)) / 86400000
  if (diff === 0) return '今天 ' + hm
  if (diff === 1) return '昨天 ' + hm
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + ' ' + hm
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}
