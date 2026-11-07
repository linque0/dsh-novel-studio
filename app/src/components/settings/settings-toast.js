/* 设置工作区的底部提示：外壳与后续的弹窗正文共用一份。
 *
 * 与 naive 的 $msg 分开的原因：总稿 .toast 是一条带「撤销」动作的细条，
 * 撤销回调必须和提示同生共死——提示消失或超时就作废，不能留一个能点到别处去的按钮。
 * 时限：普通 4s；带撤销 9s（撤销窗口要够长，否则用户来不及读完提示）。
 */
import { onBeforeUnmount, ref } from 'vue'

export const SETTINGS_TOAST_TIMING = Object.freeze({ plain: 4000, undo: 9000 })

/* 外壳 provide('settingsToast', toast)，子组件 inject('settingsToast', null) 即可共用同一条提示 */
export const SETTINGS_TOAST_KEY = 'settingsToast'

export function useSettingsToast() {
  const message = ref('')
  const undoVisible = ref(false)
  let timer = null
  let undoAction = null

  function hide() {
    clearTimeout(timer)
    timer = null
    message.value = ''
    undoVisible.value = false
    undoAction = null
  }

  function show(text, { undo = null, ms = null } = {}) {
    clearTimeout(timer)
    undoAction = typeof undo === 'function' ? undo : null
    message.value = String(text ?? '')
    undoVisible.value = !!undoAction
    const wait = Number.isFinite(ms) ? Number(ms) : undoAction ? SETTINGS_TOAST_TIMING.undo : SETTINGS_TOAST_TIMING.plain
    timer = setTimeout(hide, wait)
  }

  /* 撤销先收起提示再执行回调：回调本身若再弹一条（比如保存失败），不会被紧随其后的 hide 吞掉 */
  function runUndo() {
    const action = undoAction
    hide()
    if (action) action()
  }

  onBeforeUnmount(hide)

  return { message, undoVisible, show, hide, runUndo }
}
