import { computed, shallowRef } from 'vue'

export function useOutlinePlacement({ canvasPoint, nodeSize, snap, create }) {
  const draft = shallowRef(null)
  const pointer = shallowRef(null)
  let placedWithClick = false

  function position(node, event) {
    const point = canvasPoint(event)
    const { w, h } = nodeSize(node)
    return { x: snap(point.x - w / 2), y: snap(point.y - h / 2), w, h }
  }

  const ghost = computed(() => draft.value && pointer.value
    ? { node: draft.value, rect: position(draft.value, pointer.value) }
    : null)

  function move(event) {
    pointer.value = { clientX: event.clientX, clientY: event.clientY }
  }

  function leave() {
    pointer.value = null
  }

  function cancel() {
    draft.value = null
    leave()
  }

  function start(node) {
    leave()
    draft.value = node
  }

  function confirm(event) {
    const node = draft.value
    if (!node || event.button !== 0) return
    const rect = position(node, event)
    cancel()
    placedWithClick = true
    create(node, rect)
  }

  function onCanvasMouseDown(event) {
    if (event.detail === 1) placedWithClick = false
  }

  function consumePlacementDoubleClick() {
    const consumed = placedWithClick
    placedWithClick = false
    return consumed
  }

  return { draft, ghost, start, move, leave, cancel, confirm, onCanvasMouseDown, consumePlacementDoubleClick }
}
