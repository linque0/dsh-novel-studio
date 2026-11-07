// Stored character positions remain in the original coordinate space for every skin.
// Rendering, ports, hit testing and fitting must all use the same projected geometry.
// 尺寸取设计稿 studio.css 的 .graph-node（width:134px / min-height:84px）与
// .graph-node.selected（width:156px / min-height:103px）；选中态更大，端口与障碍物按各自的尺寸算。
export const characterGeometry = () => ({
  width: 134,
  height: 84,
  selectedWidth: 156,
  selectedHeight: 103,
  scaleX: 1,
  scaleY: 1
})
export function projectCharacterPoint(point, geometry, inverse = false) {
  if (!point) return null
  return inverse
    ? { x: point.x / geometry.scaleX, y: point.y / geometry.scaleY }
    : { x: point.x * geometry.scaleX, y: point.y * geometry.scaleY }
}
