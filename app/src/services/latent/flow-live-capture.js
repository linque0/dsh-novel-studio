/**
 * 星系动态画布（LorePlanetNetwork）实时转场截图插件：
 * 在 SnapDOM 克隆 SVG 时记录 <img> 占位位置，后续预采命中可直接替换最新的 canvas PNG 字节，
 * 避免对运行中的 Three.js/2D 星系舞台重复走全量 DOM 克隆。
 */
const marker = 'data-flow-live-ink'
const pngPrefix = 'data:image/png;base64,'

export function splitLiveCaptureSvg(svg) {
  if (!svg) return null
  const index = svg.indexOf(' ' + marker + '=""')
  if (index < 0) return null
  const start = svg.lastIndexOf('<img ', index)
  const end = svg.indexOf('>', index)
  if (start < 0 || end < 0 || svg.indexOf('>', start) !== end) return null
  const source = /\bsrc="(data:image\/png;base64,[^"]+)"/.exec(svg.slice(start, end))
  if (!source) return null
  const offset = start + source.index + 'src="'.length
  const header = atob(source[1].slice(pngPrefix.length, pngPrefix.length + 32))
  if (header.length !== 24 || header.slice(12, 16) !== 'IHDR') return null
  const readSize = at => header.charCodeAt(at) * 16777216 + header.charCodeAt(at + 1) * 65536 +
    header.charCodeAt(at + 2) * 256 + header.charCodeAt(at + 3)
  return { parts: [svg.slice(0, offset), svg.slice(offset + source[1].length)], width: readSize(16), height: readSize(20) }
}

export function liveCapturePlugin(canvas) {
  let template
  const pixelWidth = canvas.width
  const pixelHeight = canvas.height
  return {
    plugin: {
      name: 'novel-studio-live-ink',
      afterClone({ clone, nodeMap }) {
        const frame = clone?.querySelector('.lpn-stage > img')
        if (nodeMap?.get?.(frame) === canvas) frame.setAttribute(marker, '')
      },
      afterRender({ svgString }) {
        try {
          template = splitLiveCaptureSvg(svgString)
        } catch {
          // The regular snapshot is still usable if SnapDOM used another encoding.
        }
      }
    },
    template: () => template?.width && template?.height && { ...template, canvas, pixelWidth, pixelHeight }
  }
}

export async function renderLiveCapture(template, density) {
  const { canvas, pixelWidth, pixelHeight, width, height, parts } = template
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) return null
  const { ownerDocument } = canvas
  let source = canvas
  if (pixelWidth !== width || pixelHeight !== height) {
    // Match the size and filtering of the PNG embedded by the original SnapDOM capture.
    source = ownerDocument.createElement('canvas')
    source.width = width
    source.height = height
    const context = source.getContext('2d')
    context.imageSmoothingQuality = 'high'
    context.drawImage(canvas, 0, 0, width, height)
  }
  const frame = source.toDataURL('image/png')
  if (!frame.startsWith(pngPrefix)) return null
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.join(frame))
  await image.decode()
  const target = ownerDocument.createElement('canvas')
  const outWidth = image.naturalWidth * density
  const outHeight = image.naturalHeight * density
  target.width = outWidth
  target.height = outHeight
  target.getContext('2d').drawImage(image, 0, 0, outWidth, outHeight)
  return target
}
