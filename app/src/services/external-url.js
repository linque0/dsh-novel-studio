/**
 * 外部网址打开服务：
 * - 严格按 http/https 白名单归一化，拒绝 javascript:/file: 等非网页协议；
 * - Electron 桌面版（主窗口与功能拆窗）走受控 IPC `shell:openExternal` 拉起系统默认浏览器；
 * - DSH 插件 / Web 宿主降级为 `window.open(..., '_blank', 'noopener,noreferrer')`。
 */
import { normalizeExternalUrl } from '../components/snippets/snippet-model.js'

export async function openExternalUrl(rawUrl) {
  const url = normalizeExternalUrl(rawUrl)
  if (!url) return { ok: false, reason: 'invalid-url' }
  try {
    if (typeof window !== 'undefined' && typeof window.native?.openExternal === 'function') {
      const res = await window.native.openExternal(url)
      return res && typeof res === 'object' ? res : { ok: true }
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer')
      return { ok: true }
    }
    return { ok: false, reason: 'unsupported' }
  } catch (error) {
    return { ok: false, reason: error?.message || 'open-failed' }
  }
}
