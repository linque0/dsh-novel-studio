/* 赤月戏的单次开场演出。
 *
 * 设计稿用 body.playing 触发四支入场动画；应用里换成 data-stage-play="1"，
 * 只在赤月戏皮肤下由 CSS 消费。这里刻意不用 rAF 逐帧——隐藏/后台窗口的 rAF 会被节流，
 * 动画会停在半路（书架翻动验收踩过这个坑）；CSS 动画 + animationend/超时清理更稳。
 */

const CLEAR_MS = 1500
let timer = null
let listening = false
let startedAt = 0

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function stopStage() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (typeof document !== 'undefined' && document.body) delete document.body.dataset.stagePlay
}

/* 布景揭示是四支里最长的一支（1.2s）；它一结束就收标记，其余错峰动画已经跟上。
 * 只认本次 playStage 之后触发的事件：重播时上一次的 animationend 可能还在队列里，
 * 旧事件不能把新一次的标记收掉。 */
function onAnimationEnd(event) {
  if (event.animationName !== 'scenery-reveal') return
  if (!document.body?.dataset.stagePlay) return
  if (event.timeStamp && event.timeStamp < startedAt - 8) return
  stopStage()
}

export function playStage() {
  if (typeof document === 'undefined' || !document.body) return
  if (reducedMotion()) {
    stopStage()
    return
  }
  if (!listening) {
    document.addEventListener('animationend', onAnimationEnd, true)
    listening = true
  }
  /* 先移除标记并强制一次样式计算，确保「重播开场」真的从头播放，而不是沿用上一轮进度 */
  stopStage()
  void document.body.offsetWidth
  startedAt = performance.now()
  document.body.dataset.stagePlay = '1'
  if (timer) clearTimeout(timer)
  timer = setTimeout(stopStage, CLEAR_MS)
}
