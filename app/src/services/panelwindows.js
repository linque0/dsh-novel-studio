/* 功能面板拆窗服务（9.2-W5，渲染层侧）：
 * - popOut(type, entity)：经主进程打开（或聚焦）面板窗口，panel:open 内含锁仲裁
 * - 锁状态跟踪：监听 panel:event 广播，isPopped(type, entityId) 判定某实体当前是否被
 *   其它窗口锁定（主窗口据此显示只读占位；面板自身持有的锁不算"被锁"，否则面板自我只读）
 * - 章节/人物/灵感面板的锁随其当前选中迁移（panelSetEntity），占位在两侧实时跟随
 */
import { ref } from 'vue'

const popped = ref(new Map()) // lockKey(workId:type:entityId|*) -> true
let listening = false

/* 本窗口自身的面板身份（主窗口为 null）；ownKey = 本面板当前持有的锁 */
const ownSpec = (() => {
  const raw = new URLSearchParams(location.search).get('panel')
  if (!raw) return null
  const [type = '', workId = '', entityId = ''] = raw.split(':')
  return type && workId ? { type, workId, entityId } : null
})()
let ownKey = ownSpec ? keyOf(ownSpec.workId, ownSpec.type, ownSpec.entityId) : null

function ensureListen() {
  if (listening || !window.native?.panelOnEvent) return
  listening = true
  window.native.panelOnEvent((ev) => {
    if (ev.kind === 'opened') popped.value.set(ev.key, true)
    if (ev.kind === 'closed') popped.value.delete(ev.key)
    if (ev.kind === 'moved') {
      popped.value.delete(ev.oldKey)
      popped.value.set(ev.key, true)
    }
    popped.value = new Map(popped.value)
  })
  window.native.panelList?.().then((r) => {
    const m = new Map()
    for (const k of r?.locks || []) m.set(k, true)
    popped.value = m
  })
}

function keyOf(workId, type, entityId) {
  if(type==='agent')return `${workId}:chapter:*`
  return `${workId}:${type}:${entityId || '*'}`
}

export function isPopped(work, type, entityId) {
  if (!work?.work) return false
  ensureListen()
  const k = keyOf(work.work.id, type, entityId)
  if (k === ownKey || `${work.work.id}:${type}:*` === ownKey) return false
  const m = popped.value
  if (m.has(k)) return true
  // 模块级面板（entityId 为空）覆盖该模块全部实体
  for (const kk of m.keys()) {
    if (kk === `${work.work.id}:${type}:*`) return true
  }
  return false
}

/** 面板内选中迁移：通知主进程把锁移到新实体（仅面板窗口调用有效） */
export async function panelSetEntity(work, type, entityId) {
  if (!ownSpec || !window.native?.panelSetEntity) return { ok: false }
  const r = await window.native.panelSetEntity(entityId || '')
  if (r?.ok && work?.work) ownKey = keyOf(work.work.id, type, entityId)
  return r
}

/** 拆出功能面板。成功且为新建时返回 true；已存在时主进程会聚焦并返回 focused */
export async function popOut(work, type, entityId, title) {
  if (!window.native?.panelOpen) {
    console.warn('[panels] 当前环境不支持面板窗口（web 版请直接使用主窗口）')
    return false
  }
  if (!work?.work) return false
  ensureListen()
  const r = await window.native.panelOpen({
    type,
    workId: work.work.id,
    entityId: entityId || '',
    title: title || undefined
  })
  if (r?.ok) {
    popped.value.set(keyOf(work.work.id, type, entityId), true)
    return true
  }
  return false
}

/** 聚焦已拆出的面板窗口（主窗口只读占位上的「前往窗口」按钮） */
export async function focusPopped(work, type, entityId) {
  if (!work?.work || !window.native?.panelFocus) return
  const result=await window.native.panelFocus(keyOf(work.work.id, type, entityId))
  if(!result?.ok)await window.native.panelFocus(keyOf(work.work.id,type,''))
}
