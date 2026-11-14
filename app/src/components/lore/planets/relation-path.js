import { Vector3 } from 'three'
import { clamp, TUNING } from './planet-scene.js'

const up = new Vector3(0, 1, 0)
const right = new Vector3(1, 0, 0)

function perpendicular(direction) {
  return new Vector3().crossVectors(direction, Math.abs(direction.y) < .85 ? up : right).normalize()
}

export function relationPath(link, a, b, elapsed, moving) {
  const samePlanet = a.planetId === b.planetId
  const from = a.world.clone().sub(a.center)
  const to = b.world.clone().sub(b.center)
  const fromRadius = from.length(), toRadius = to.length()
  const onSphere = samePlanet && [a, b].every(p => p.onWeave ??
    Math.abs(p.world.distanceTo(p.center) - p.sphereRadius) <= p.sphereRadius * TUNING.surfaceTolerance)
  from.normalize()
  to.normalize()
  const angle = Math.acos(clamp(from.dot(to), -1, 1))
  const tangent = to.clone().addScaledVector(from, -Math.cos(angle))
  if (tangent.lengthSq() < 1e-12) tangent.copy(perpendicular(from))
  else tangent.normalize()
  const surface = onSphere && angle <= TUNING.surfaceAngle
  const amplitude = surface ? TUNING.surfaceWave : samePlanet ? TUNING.spaceWave : TUNING.crossWave
  const normal = onSphere ? new Vector3().crossVectors(from, tangent).normalize()
    : perpendicular(b.world.clone().sub(a.world).normalize())
  const second = new Vector3().crossVectors(normal, b.world.clone().sub(a.world).normalize())
  const time = elapsed / 1000 * link.frequency
  const points = [a.world]
  for (let i = 1; i < TUNING.samples; i++) {
    const t = i / TUNING.samples
    const envelope = Math.sin(Math.PI * t) ** 1.5
    const wave = moving ? envelope * amplitude * (
      .67 * Math.sin(time + link.phase + t * 7.1)
      + .33 * Math.sin(time * .61 - link.phase * 1.9 - t * 10.8)
    ) : 0
    let point
    if (onSphere) {
      const direction = from.clone().multiplyScalar(Math.cos(angle * t)).addScaledVector(tangent, Math.sin(angle * t))
      direction.addScaledVector(normal, wave).normalize()
      const lift = surface ? 0 : envelope * (.14 + angle * .13 + wave * .32)
      const surfaceRadius = fromRadius + (toRadius - fromRadius) * t
      point = direction.multiplyScalar(surfaceRadius * (1 + lift)).add(a.center)
    } else {
      const distance = a.world.distanceTo(b.world)
      point = a.world.clone().lerp(b.world, t).addScaledVector(normal, envelope * Math.min(.85, distance * .17) + wave)
      point.addScaledVector(second, wave * .62)
    }
    points.push(point)
  }
  points.push(b.world)
  return { kind: surface ? 'surface' : samePlanet ? 'space' : 'cross', points }
}

export function trimProjected(points, a, b) {
  const trim = (list, circle) => {
    const inside = p => (p.x - circle.x) ** 2 + (p.y - circle.y) ** 2 < circle.radius ** 2
    const index = list.findIndex(p => !inside(p))
    if (index < 0) return []
    if (index === 0) return list
    const start = list[index - 1], end = list[index]
    let lo = 0, hi = 1
    const at = t => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t })
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      if (inside(at(mid))) lo = mid
      else hi = mid
    }
    return [at(hi), ...list.slice(index)]
  }
  return trim(trim(points, a).reverse(), b).reverse()
}
