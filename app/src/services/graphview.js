/* 画布共用引擎（8.8.2 大纲画布 / 8.8.3 人物关系图共用）：
 * 平移缩放状态机与四向锚点 / 箭头几何。零依赖。 */
import { ref, computed } from 'vue'

export function usePanZoom(canvasEl, initial = {}) {
  const zoom = ref(initial.zoom ?? 1)
  const tx = ref(initial.tx ?? 60)
  const ty = ref(initial.ty ?? 40)
  const innerStyle = computed(() => ({
    transform: `translate(${tx.value}px, ${ty.value}px) scale(${zoom.value})`,
    transformOrigin: '0 0'
  }))

  function onWheel(e) {
    if (e.ctrlKey) {
      // 以鼠标为锚点缩放
      const rect = canvasEl.value?.getBoundingClientRect()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const nz = Math.min(2.2, Math.max(0.3, zoom.value * factor))
      if (rect) {
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        tx.value = mx - ((mx - tx.value) * nz) / zoom.value
        ty.value = my - ((my - ty.value) * nz) / zoom.value
      }
      zoom.value = nz
    } else {
      tx.value -= e.deltaX
      ty.value -= e.deltaY
    }
  }

  let pan = null
  function onPanStart(e) {
    if (e.target.closest?.('.oc-node, .rg-node, .om-sat, .oc-elabel, .rg-elabel, button, input, textarea, select')) return
    pan = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
    const move = (ev) => {
      if (!pan) return
      tx.value = pan.tx + (ev.clientX - pan.x)
      ty.value = pan.ty + (ev.clientY - pan.y)
    }
    const up = () => {
      pan = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** 适应内容包围盒 {x,y,w,h} 到画布（x/y 缺省按 0 处理） */
  function fit(bounds) {
    const el = canvasEl.value
    if (!el || !bounds.w || !bounds.h) return
    const vw = el.clientWidth
    const vh = el.clientHeight
    const z = Math.min(1.2, Math.max(0.3, Math.min(vw / (bounds.w + 80), vh / (bounds.h + 80))))
    zoom.value = z
    const bx = bounds.x || 0
    const by = bounds.y || 0
    tx.value = vw / 2 - (bx + bounds.w / 2) * z
    ty.value = vh / 2 - (by + bounds.h / 2) * z
  }

  /** 将内容点（画布坐标）居中到视口 */
  function centerOn(x, y) {
    const el = canvasEl.value
    if (!el) return
    tx.value = el.clientWidth / 2 - x * zoom.value
    ty.value = el.clientHeight / 2 - y * zoom.value
  }

  return { zoom, tx, ty, innerStyle, onWheel, onPanStart, fit, centerOn }
}

/** 节点四向锚点坐标（rect = {x,y,w,h}） */
export function anchorsOf(rect) {
  return {
    right: { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
    left: { x: rect.x, y: rect.y + rect.h / 2 },
    top: { x: rect.x + rect.w / 2, y: rect.y },
    bottom: { x: rect.x + rect.w / 2, y: rect.y + rect.h }
  }
}

/** 由方向矢量计算箭头三角形三点（size 默认 7） */
export function arrowHeadDir(x, y, dir, size = 7) {
  const ang = Math.atan2(dir.y, dir.x)
  const a1 = ang + Math.PI - 0.42
  const a2 = ang + Math.PI + 0.42
  return `${x},${y} ${x + size * Math.cos(a1)},${y + size * Math.sin(a1)} ${x + size * Math.cos(a2)},${y + size * Math.sin(a2)}`
}


