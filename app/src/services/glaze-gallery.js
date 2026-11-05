export const GALLERY_DRAG_THRESHOLD = 8
export function galleryIndex(cursor, count) { return count ? ((cursor % count) + count) % count : 0 }

export function galleryCursorFor(cursor, index, count) {
  if (!count) return 0
  const forward = galleryIndex(index - galleryIndex(cursor,count),count)
  return cursor + (forward > count / 2 ? forward - count : forward)
}

export function gallerySlots(works, cursor) {
  const count = works.length
  if (!count) return []
  const current = galleryIndex(cursor,count)
  if (count <= 2) return works.map((book,index) => ({key:book.id,book,index,offset:index-current,buffer:false}))
  const half = count >= 5 ? 2 : 1
  return Array.from({length:half*2+3},(_,i) => {
    const offset = i-half-1, logical = cursor+offset, index = galleryIndex(logical,count)
    return {key:logical,book:works[index],index,offset,buffer:Math.abs(offset)>half}
  })
}

export function galleryDragStep(delta, width) { return width > 0 ? Math.round(-delta/width) || 0 : 0 }
export function gallerySelection(works, selectedId, reset = false) {
  return (!reset && works.some(book => book.id === selectedId) ? selectedId : works[0]?.id) ?? null
}
