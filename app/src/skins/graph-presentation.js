// Stored character positions remain in the original coordinate space for every skin.
// Rendering, ports, hit testing and fitting must all use the same projected geometry.
export const characterGeometry = () => ({ width: 132, height: 56, scaleX: 1, scaleY: 1 })
export function projectCharacterPoint(point, geometry, inverse = false) {
  if (!point) return null
  return inverse
    ? { x: point.x / geometry.scaleX, y: point.y / geometry.scaleY }
    : { x: point.x * geometry.scaleX, y: point.y * geometry.scaleY }
}
