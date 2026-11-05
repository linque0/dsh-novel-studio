export function notifySourceChanged(table, row) {
  const workId = table === 'works' ? row?.id : row?.workId
  if (!workId || typeof window === 'undefined') return
  const data = { workId, table, id: row.id }
  window.dispatchEvent(new CustomEvent('book-source-changed', { detail: data }))
  window.native?.appBroadcast?.({ kind: 'book-source-changed', data })?.catch?.(() => {})
}
