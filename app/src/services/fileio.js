const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

export const isImageExt = (ext) => !!IMAGE_MIME[ext]
export const imageMime = (ext) => IMAGE_MIME[ext] || 'application/octet-stream'
export const IMAGE_EXTS = Object.keys(IMAGE_MIME)

/** 选择文件：Electron 走原生对话框，浏览器走 input[type=file]，统一返回 {name, ext, data:ArrayBuffer} */
export function pickFiles(exts) {
  if (window.native?.isElectron) {
    return window.native
      .pickFiles({ filters: [{ name: '支持格式', extensions: exts }] })
      .then((res) => (res.canceled ? [] : res.files))
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (exts?.length) input.accept = exts.map((e) => '.' + e).join(',')
    let settled = false
    const done = async (fileList) => {
      if (settled) return
      settled = true
      const out = []
      for (const f of fileList || []) {
        out.push({ name: f.name, ext: (f.name.split('.').pop() || '').toLowerCase(), data: await f.arrayBuffer() })
      }
      resolve(out)
    }
    input.onchange = () => done(input.files)
    input.oncancel = () => done(null)
    input.click()
  })
}

/** 保存文本/二进制文件：Electron 走保存对话框（isBase64 走 Buffer 写入；dirPath 给定时跳过对话框直接写该目录），浏览器触发下载 */
export async function saveTextFile(defaultName, content, opts = {}) {
  if (window.native?.isElectron) {
    return window.native.saveFile({ defaultName, content, isBase64: !!opts.isBase64, dirPath: opts.dirPath || null })
  }
  const blob = opts.isBase64
    ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: opts.mime || 'application/octet-stream' })
    : new Blob([content], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, defaultName)
  return { canceled: false }
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

export const arrayBufferToBlob = (data, mime) => new Blob([data], { type: mime })

/* ---------- 数据存储位置（仅 Electron；网页版降级返回 null / canceled） ---------- */
export const getDataLocation = () =>
  window.native?.getDataLocation ? window.native.getDataLocation() : Promise.resolve(null)
export const pickDataDir = () =>
  window.native?.pickDataDir ? window.native.pickDataDir() : Promise.resolve({ canceled: true })
export const openDataFolder = () =>
  window.native?.openDataFolder ? window.native.openDataFolder() : Promise.resolve(false)
export const moveDataDir = (dir, opts) =>
  window.native?.moveDataDir ? window.native.moveDataDir(dir, opts) : Promise.resolve({ ok: false, error: '网页版不支持更改存储位置' })
export const cleanOldLocation = (index, mode) =>
  window.native?.cleanOldLocation ? window.native.cleanOldLocation(index, mode) : Promise.resolve({ ok: false, error: '网页版不支持清理旧位置' })
export const openOldFolder = (index) =>
  window.native?.openOldFolder ? window.native.openOldFolder(index) : Promise.resolve({ ok: false, error: '网页版不支持打开旧位置' })
export const clearDataPointer = () =>
  window.native?.clearDataPointer ? window.native.clearDataPointer() : Promise.resolve({ ok: false, error: '网页版不支持' })
