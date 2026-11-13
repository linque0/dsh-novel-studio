<!-- 关系链接悬浮预览窗：全局委托监听——悬停关系链接标签（富文本 span）或纯文本令牌时，在旁展示目标内容并可跳转。
     v1.0.21：出现 / 消失过渡动画；标题栏为拖拽把手——拖离即「钉住」为常驻预览（悬停其他关系链接原位换内容，
     不随鼠标移开消失，× / Esc 关闭）；会话内记忆停靠偏移（后续浮窗停在上次位置），双击标题恢复跟随鼠标。 -->
<script setup>
import { reactive, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { parseTarget, targetById, findByTitle, previewFor, jumpTo, jumpToOutlineCitation, KIND_LABEL, tokenAtPoint } from '../services/doublelinks'

const pop = ref(null)
const st = reactive({ show: false, x: 0, y: 0, view: null, target: null, pinned: false, dragging: false })
let curEl = null // 当前悬停的 .dl-link 元素
let curHost = null // 当前悬停的 textarea
let tokenCache = { host: null, token: null }
let hideTimer = null // 离开关系链接的宽限期：给鼠标移入浮窗的时间
let cursor = { x: 0, y: 0 } // 触发悬停时的鼠标位置（place 基准，与浮窗坐标分开存）
let dragOff = { dx: 0, dy: 0 } // 拖拽停靠记忆（会话内）：后续浮窗按此偏移出现
let dragCtx = null // 进行中的拖拽

function place() {
  const el = pop.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = cursor.x + 14 + dragOff.dx
  let y = cursor.y + 18 + dragOff.dy
  if (x + w > window.innerWidth - 8) x = Math.max(8, cursor.x - w - 14)
  if (y + h > window.innerHeight - 8) y = Math.max(8, cursor.y - h - 12)
  st.x = x
  st.y = y
}

function showFor(view, target, x, y) {
  st.view = view
  st.target = target
  cursor = { x, y }
  if (st.pinned) {
    st.show = true // 钉住态：原位换内容，不再跟随鼠标
    return
  }
  st.x = x
  st.y = y
  st.show = true
  nextTick(place)
}

function missingView(title, kind) {
  return { kindLabel: KIND_LABEL[kind] || '关系链接', title: title || '（未知目标）', meta: '目标不存在', body: '未找到关系链接指向的内容——目标可能已被删除或重命名。' }
}

function resolveByEl(el) {
  const parsed = parseTarget(el.getAttribute('data-dl-target'))
  const resolved = parsed ? targetById(parsed.kind, parsed.id) : null
  const title = el.getAttribute('data-dl-title') || resolved?.title || ''
  if (resolved) return { view: previewFor(resolved) || missingView(title, parsed.kind), target: resolved }
  if (parsed) return { view: missingView(title, parsed.kind), target: null }
  if (el.hasAttribute('data-outline-citation')) return { view: missingView(title, parsed?.kind), target: null }
  const byTitle = findByTitle(title)
  return byTitle ? { view: previewFor(byTitle), target: byTitle } : { view: missingView(title, parsed?.kind), target: null }
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hide() {
  cancelHide()
  st.show = false
  st.pinned = false
  st.dragging = false
  curEl = null
  curHost = null
  tokenCache = { host: null, token: null }
}

/** 离开关系链接：延迟消失，鼠标在此期间移入浮窗则保持显示；钉住 / 拖动中不自动消失 */
function delayHide() {
  if (st.pinned || dragCtx) return
  cancelHide()
  hideTimer = setTimeout(() => {
    hideTimer = null
    hide()
  }, 260)
}

/* ---------- 拖动（标题栏为把手）：拖离 3px 即钉住 ---------- */
function onDragStart(e) {
  if (e.button !== 0 || !st.show) return
  if (e.target?.closest?.('button')) return // 跳转 / 关闭按钮不作把手
  e.preventDefault()
  st.dragging = true
  dragCtx = { px: e.clientX, py: e.clientY, baseX: st.x, baseY: st.y, moved: false }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
  window.addEventListener('pointercancel', onDragEnd, { once: true })
}
function onDragMove(e) {
  if (!dragCtx) return
  const dx = e.clientX - dragCtx.px
  const dy = e.clientY - dragCtx.py
  if (!dragCtx.moved && Math.abs(dx) + Math.abs(dy) <= 3) return // 3px 内视为点按，不钉住
  dragCtx.moved = true
  st.pinned = true
  const el = pop.value
  st.x = Math.max(8, Math.min(dragCtx.baseX + dx, window.innerWidth - (el?.offsetWidth || 360) - 8))
  st.y = Math.max(8, Math.min(dragCtx.baseY + dy, window.innerHeight - (el?.offsetHeight || 120) - 8))
}
function onDragEnd() {
  if (!dragCtx) return
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  if (dragCtx.moved) {
    // 记住停靠位（相对鼠标的偏移）：后续浮窗停靠在同一位置，不必每次重拖
    dragOff.dx = st.x - cursor.x - 14
    dragOff.dy = st.y - cursor.y - 18
  }
  dragCtx = null
  st.dragging = false
}
/** 双击标题：清空停靠偏移并恢复跟随鼠标 */
function resetFollow(e) {
  if (e.target?.closest?.('button')) return
  dragOff = { dx: 0, dy: 0 }
  st.pinned = false
  st.show = true
  nextTick(place)
}

/* ---------- 出现 / 消失动画：JS 钩子驱动（:css="false"）----------
 * 不用 CSS Transition 类方案的原因：Vue 的 enter/leave 序列依赖 nextFrame(rAF)，
 * 窗口最小化 / 被完全遮挡时 rAF 冻结，过渡会永远停在初始态（浮窗 opacity 0 不出现、
 * 离场元素永不卸载）。setTimeout 驱动在节流窗口下最迟 ~1s 完成，可见窗口完全一致。 */
function onEnter(el, done) {
  el.classList.add('dl-pop-enter-from')
  void el.offsetWidth // 强制重排让初始态先生效，再过渡到自然态
  el.classList.remove('dl-pop-enter-from')
  setTimeout(done, 180)
}
function onLeave(el, done) {
  el.classList.add('dl-pop-leave-to')
  setTimeout(done, 170) // 与 .dl-pop 的 0.17s 过渡对齐（140ms 会裁掉淡出尾部）
}

function onMouseMove(e) {
  if (dragCtx) return // 拖动中不判定悬停（防误隐藏 / 误换内容）
  if (e.target?.closest?.('.dl-pop')) {
    cancelHide() // 鼠标移入浮窗：保持显示
    return
  }
  const linkEl = e.target?.closest?.('.dl-link, [data-outline-citation]')
  if (linkEl?.hasAttribute('data-outline-citation') && e.buttons) {
    if (st.show) delayHide()
    return
  }
  if (linkEl) {
    cancelHide()
    if (linkEl === curEl && st.show) return
    curEl = linkEl
    curHost = null
    const r = resolveByEl(linkEl)
    showFor(r.view, r.target, e.clientX, e.clientY)
    return
  }
  const taEl = e.target?.closest?.('textarea, [data-dl-token]')
  if (taEl) {
    const host = taEl.tagName === 'TEXTAREA' ? taEl : taEl.querySelector?.('textarea')
    if (host) {
      const hit = tokenAtPoint(host, e.clientX, e.clientY)
      if (hit) {
        cancelHide()
        if (curHost === host && st.show && tokenCache.token === hit.title + '|' + hit.display) return
        curEl = null
        curHost = host
        tokenCache = { host, token: hit.title + '|' + hit.display }
        const resolved = findByTitle(hit.title)
        showFor(
          resolved ? previewFor(resolved) || missingView(hit.title, resolved.kind) : missingView(hit.title),
          resolved,
          e.clientX,
          e.clientY
        )
        return
      }
    }
  }
  if (st.show) delayHide()
}

function onJump() {
  if (curEl?.hasAttribute('data-outline-citation')) {
    const { view, target } = resolveByEl(curEl)
    if (!target) {
      st.view = view
      st.target = null
      return
    }
    jumpToOutlineCitation(target)
  } else if (st.target) jumpTo(st.target)
  hide()
}

function onWinMouseDown(e) {
  if (st.show && !st.pinned && !e.target?.closest?.('.dl-pop')) hide()
}
function onWinScroll(e) {
  if (st.show && !st.pinned && !dragCtx && !e.target?.closest?.('.dl-pop')) hide()
}
function onWinKey(e) {
  if (e.key === 'Escape' && st.show) hide()
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mousedown', onWinMouseDown, true)
  window.addEventListener('scroll', onWinScroll, true)
  window.addEventListener('keydown', onWinKey)
  window.addEventListener('resize', hide)
})
onBeforeUnmount(() => {
  cancelHide()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mousedown', onWinMouseDown, true)
  window.removeEventListener('scroll', onWinScroll, true)
  window.removeEventListener('keydown', onWinKey)
  window.removeEventListener('resize', hide)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
})
</script>

<template>
  <Transition name="dl-pop" :css="false" @enter="onEnter" @leave="onLeave">
    <div v-if="st.show" ref="pop" class="dl-pop" :class="[{ pinned: st.pinned, dragging: st.dragging }]" :style="{ left: st.x + 'px', top: st.y + 'px' }" @contextmenu.prevent>
      <div class="dl-pop-head" title="按住拖动 · 双击恢复跟随鼠标" @pointerdown="onDragStart" @dblclick="resetFollow">
        <span class="dl-kind">{{ st.view.kindLabel || '关系链接' }}</span>
        <span class="dl-pop-title">{{ st.view.title }}</span>
        <button v-if="st.target" class="dl-pop-jump" type="button" @click="onJump">跳转 ↗</button>
        <button v-if="st.pinned" class="dl-pop-close" type="button" title="关闭浮窗" @click="hide">×</button>
      </div>
      <div v-if="st.view.meta" class="dl-pop-meta">{{ st.view.meta }}</div>
      <div class="dl-pop-body">{{ st.view.body }}</div>
    </div>
  </Transition>
</template>
