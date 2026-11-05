/* 应用级跨窗口事件总线（设置窗口时代）：
 * - prefs-changed：任一窗口改了偏好（主题/字体等）→ 其余窗口重载 appconfig 偏好即时生效
 * - works-changed：导入 / 回收站还原等改动了作品集合 → 其余窗口刷新书架
 * - db-restore-begin / db-restored：恢复备份前让全部窗口冲刷并丢弃在途脏数据（v1.0.22 防覆盖
 *   纪律的跨窗口版），恢复完成后全部窗口整体重载
 * 事件经主进程 app:event 通道广播（panels.js app:broadcast），发送者自身也会收到——
 * 各处理端均为幂等操作（重读偏好 / 刷新书架），重复执行无副作用。
 */
import { useUiStore } from '../stores/ui'
import { useShelfStore } from '../stores/shelf'
import { autosave } from './autosave'
import { handleAiEvent } from './ai/runtime'
import { useAiStore } from '../stores/ai'
import { projectionRestoreBegin, projectionRestored } from './project/pipeline.js'

let installed = false

export function installAppBus() {
  if (installed || !window.native?.appOnEvent) return
  installed = true
  window.native.appOnEvent(({ kind, data }) => {
    if (['story-document-changed','creative-workflow-changed','creative-workflow-request','creative-workflow-pause','memory-queue-ready','memory-queue-changed','book-source-changed', 'ai-preview-request','ai-presets-changed', 'ai-settings-changed', 'kb-changed', 'ai-kb-request', 'ai-source-changed'].includes(kind)) {
      handleAiEvent({ kind, data }).catch(console.error)
      return
    }
    if (kind === 'prefs-changed') {
      useUiStore().loadPrefs()
    } else if (kind === 'works-changed') {
      useShelfStore().refresh()
    } else if (kind === 'db-restore-begin') {
      projectionRestoreBegin()
      useAiStore().cancel()
      useAiStore().pauseKnowledge()
      /* 恢复备份前：把本窗口在途脏数据落盘并丢弃队列，防止旧状态写回恢复后的库 */
      autosave.flushAll()
      autosave.discardPending()
    } else if (kind === 'db-restored') {
      projectionRestored()
      window.location.reload()
    }
  })
}

export function broadcastAppEvent(kind, data = null) {
  window.native?.appBroadcast?.({ kind, data })
}
