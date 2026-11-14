import { Vector3 } from 'three'
import { clamp, fitOverviewZoom, localPosition, makeCamera, orbitPoint, orbitPosition, overviewExtent, rotation, TUNING } from './planet-scene.js'
import { relationPath, trimProjected } from './relation-path.js'

const TAU = 2 * Math.PI
const overviewFraming = new WeakMap()

function getOverviewFraming(data, positions, view, width, height) {
  const cached = overviewFraming.get(data)
  if (cached && cached.positions === positions && cached.width === width && cached.height === height
    && cached.view.equals(view)) return cached
  const extent = overviewExtent(data.planets, positions)
  const stretch = clamp(width / Math.max(1, height) * .76, 1, 1.6)
  const fit = fitOverviewZoom(data.planets, positions, view, width, height, extent, stretch)
  const framing = { positions, view: view.clone(), width, height, extent, stretch, fit }
  overviewFraming.set(data, framing)
  return framing
}

export function paintNetwork(ctx, size, data, scene, state) {
  const { width, height } = size
  ctx.clearRect(0, 0, width, height)
  const { extent, stretch, fit } = getOverviewFraming(state.framingData || data, state.framingPositions, scene.view, width, height)
  const camera = makeCamera(width, height, scene.zoom * fit, extent, stretch, scene.pan, scene.offset)
  const hits = []
  const projected = new Map()
  const bodyPoints = new Map()
  const nodeList = []
  const leafPoints = []
  const satellites = []
  const origin = new Vector3()
  const work = camera.project(origin)
  work.radius = Math.max(width < 540 ? 18 : 29, TUNING.workRadius * work.scale)
  if (data.center) {
    const anchor = { ...work, world: origin, planetId: data.center.id, center: origin, front: true }
    bodyPoints.set(data.center.id, anchor)
    hits.push({ ...anchor, kind: 'node', id: data.center.id })
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const orbits = drawOrbits(ctx, data.planets, scene.view, camera, state)
  drawWork(ctx, work, data.center?.title || state.workTitle, scene.time, state.reduced)

  const bodies = data.planets.map(planet => {
    const phase = state.motionPhases?.get(planet.id)
    const center = orbitPosition(planet, scene.time, phase?.orbit).applyQuaternion(scene.view)
    const orientation = scene.view.clone().multiply(rotation(.24, planet.spinPhase + planet.spinSpeed * scene.time + (phase?.spin || 0)))
    const radius = planet.radius * TUNING.bodyScale
    return { planet, center, orientation, radius, pos: camera.project(center) }
  }).sort((a, b) => a.pos.z - b.pos.z)

  for (const body of bodies) {
    const { planet, center, orientation, radius, pos } = body
    const limits = data.center ? TUNING.detailCircle : TUNING.overviewCircle
    for (const node of planet.entries) {
      const local = localPosition(node, state.positions)
      const onWeave = local.distanceTo(node.position.clone().multiplyScalar(TUNING.detailRadius)) < TUNING.detailRadius * TUNING.surfaceTolerance
      const world = local.multiplyScalar(radius / TUNING.detailRadius).applyQuaternion(orientation).add(center)
      const point = camera.project(world)
      const facing = (world.z - center.z) / radius
      const front = facing >= 0
      const priority = node.id === state.nodeId ? 4 : node.id === state.hoverId ? 3 : front ? 1 : 0
      const entry = { ...point, world, center, orientation, facing, front, priority, node, onWeave, planetId: planet.id, sphereRadius: radius,
        radius: clamp(point.scale * (data.center ? .34 : .22) * (.76 + .24 * clamp(facing / .3, -1, 1)), ...limits) }
      projected.set(node.id, entry)
      nodeList.push(entry)
    }
    const leaf = !planet.entries.length && !!planet.parent
    const markerRadius = leaf ? clamp(radius * pos.scale, 10, 20) : Math.max(radius * pos.scale + 6, 16)
    const anchor = { ...pos, world: center, center, planetId: planet.id, front: true, radius: markerRadius }
    if (leaf) leafPoints.push(anchor)
    bodyPoints.set(planet.id, anchor)
    hits.push({ ...anchor, kind: leaf ? 'node' : 'planet', id: planet.id })
  }
  spaceNodeCircles(nodeList, [work, ...leafPoints], width, height)
  for (const body of bodies) drawWeave(ctx, body, camera, projected)
  if (data.center?.satellites?.length) {
    const anchor = bodyPoints.get(data.center.id)
    satellites.push(...placeSatellites(camera, {
      center: origin, orientation: scene.view, radius: work.radius / work.scale
    }, { ...anchor, node: data.center }, nodeList, satellites, work, size))
  }
  for (const body of bodies) {
    for (const node of body.planet.entries) {
      if (!node.satellites.length) continue
      satellites.push(...placeSatellites(camera, body, projected.get(node.id), nodeList, satellites, work, size))
    }
    if (body.planet.satellites?.length) {
      const anchor = bodyPoints.get(body.planet.id)
      satellites.push(...placeSatellites(camera, body, { ...anchor, node: body.planet },
        [...nodeList, ...leafPoints.filter(point => point !== anchor)], satellites, work, size))
    }
  }

  const pathsByBridge = new Map()
  if (work) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.moveTo(work.x + work.radius, work.y)
    ctx.arc(work.x, work.y, work.radius, 0, TAU)
    ctx.clip('evenodd')
  }
  for (const link of data.routes) {
    const a = projected.get(link.from?.id) || bodyPoints.get(link.from?.id)
    const b = projected.get(link.to?.id) || bodyPoints.get(link.to?.id)
    if (!a && !b) continue
    const { cross, bridgeId } = link
    const emphasized = link.from?.id === state.nodeId || link.to?.id === state.nodeId
      || link.from?.id === state.hoverId || link.to?.id === state.hoverId
      || !!bridgeId && bridgeId === state.bridgeId
    if (!a || !b) {
      if (emphasized) drawOutsideLink(ctx, camera, link, a || b, scene.time, !state.reduced, true)
      continue
    }
    const path = relationPath(link, a, b, scene.time, !state.reduced)
    const samples = path.points.map(camera.project)
    samples[0] = a
    samples[samples.length - 1] = b
    const points = trimProjected(samples, a, b)
    if (points.length < 2) continue
    ctx.strokeStyle = cross ? TUNING.bridge : TUNING.relation
    ctx.lineWidth = emphasized ? 1.55 : cross ? .85 : .78
    const exposed = a.front && b.front
    ctx.globalAlpha = emphasized ? .9 : state.nodeId || state.bridgeId ? .085
      : cross ? .23 : exposed ? path.kind === 'surface' ? .38 : .24 : .1
    strokePoints(ctx, points)
    if (bridgeId) {
      const paths = pathsByBridge.get(bridgeId) || []
      paths.push(points)
      pathsByBridge.set(bridgeId, paths)
    }
  }
  if (work) ctx.restore()

  for (const satellite of satellites) drawTether(ctx, satellite, state.satelliteId)
  const occupied = [...satellites, ...leafPoints]
  if (work) occupied.push(work)
  for (const { planet, pos, radius } of bodies) {
    const leaf = planet.parent && !planet.entries.length
    const marker = leaf && bodyPoints.get(planet.id)
    const members = planet.entries.map(node => projected.get(node.id))
    const top = Math.min(pos.y - radius * pos.scale, ...members.map(point => point.y - point.radius))
    const bottom = Math.max(pos.y + radius * pos.scale, ...members.map(point => point.y + point.radius))
    ctx.font = '600 12px "Microsoft YaHei", sans-serif'
    if (leaf) {
      const emphasized = planet.id === state.nodeId || planet.id === state.hoverId
      circle(ctx, marker, marker.radius, emphasized ? '#3e544f' : '#292832', 1)
      ctx.strokeStyle = emphasized ? '#e0fff3' : planet.color
      ctx.lineWidth = .9
      ctx.stroke()
      const name = measureName(ctx, state.names, planet, marker.radius * 1.76)
      drawName(ctx, marker, name, 1)
      continue
    }
    const title = fitText(ctx, planet.title + ' · ' + planet.entries.length, 128)
    const labelRadius = (ctx.measureText(title).width + 13) / 2
    const anchors = [0, 19, -19, 38].flatMap(offset => [1, -1].map(side => ({
      x: clamp(pos.x + offset, labelRadius + 5, width - labelRadius - 5),
      y: clamp((side > 0 ? bottom : top) + side * (15 + Math.abs(offset) * .42), 28, height - 24)
    })))
    const label = anchors.find(anchor => ![...occupied, ...nodeList].some(p =>
      Math.abs(anchor.x - p.x) < labelRadius + p.radius + 3 && Math.abs(anchor.y - p.y) < 8 + p.radius + 4))
    if (!label) continue
    pill(ctx, label.x, label.y, title, planet.color || TUNING.ink)
    hits.push({ kind: 'planet', id: planet.id, ...label, radius: 0, halfWidth: labelRadius, halfHeight: 9 })
    occupied.push({ ...label, radius: 15 })
  }
  for (const bridge of data.bridges) {
    const paths = pathsByBridge.get(bridge.id)
    if (!paths) continue
    const first = paths[0]
    const mid = Math.floor(first.length / 2)
    const candidates = [first[mid], first[mid - 2], first[mid + 2], first[1], first.at(-2)].filter(Boolean)
    const clear = point => !occupied.some(p => Math.hypot(point.x - p.x, point.y - p.y) < p.radius + 9)
      && !nodeList.some(p => Math.hypot(point.x - p.x, point.y - p.y) < p.radius + 7)
    const badge = candidates.find(clear) || paths.flat().find(clear)
    hits.push({ kind: 'bridge', id: bridge.id, ...badge, radius: badge ? 11 : 0, paths, count: bridge.links.length })
    if (badge) occupied.push({ ...badge, radius: 12 })
  }

  const nodes = nodeList.sort((a, b) => a.z - b.z)
  const labelsPending = updateNames(ctx, nodes, occupied, scene.zoom, state)
  for (const point of [...nodes].sort((a, b) => (a.priority >= 3 ? a.priority : 0) - (b.priority >= 3 ? b.priority : 0) || a.z - b.z)) {
    drawNode(ctx, point, state.names.get(point.node.id), point.node.color)
    hits.push({ kind: 'node', id: point.node.id, x: point.x, y: point.y, z: point.z, radius: point.radius })
  }
  for (const hit of hits) {
    if (hit.kind !== 'bridge' || !hit.radius) continue
    ctx.font = '600 10px "Microsoft YaHei", sans-serif'
    pill(ctx, hit.x, hit.y, String(hit.count), TUNING.bridge)
  }
  for (const satellite of satellites) {
    drawSatellite(ctx, satellite, state)
    hits.push({ kind: 'satellite', id: satellite.item.id, x: satellite.x, y: satellite.y,
      radius: satellite.radius + 3, ownerId: satellite.owner.node.id })
  }
  ctx.globalAlpha = 1
  return { hits, camera, work, projected, bodyPoints, orbits, labelsPending }
}

function updateNames(ctx, nodes, occupied, zoom, { names, now, reduced }) {
  let pending = false
  let remaining = Math.round(TUNING.maxLabels * Math.min(1.65, zoom))
  const order = [...nodes].sort((a, b) => (b.priority >= 3 ? b.priority : 0) - (a.priority >= 3 ? a.priority : 0)
    || (names.get(b.node.id)?.shown ? 1 : 0) - (names.get(a.node.id)?.shown ? 1 : 0) || b.z - a.z)
  for (const point of order) {
    const { node, radius, facing, priority } = point
    let name = names.get(node.id)
    const shown = name?.shown || false
    const emphasized = priority >= 3
    const clearance = shown ? -1 : 3
    const obstructs = other => Math.hypot(point.x - other.x, point.y - other.y) < radius + other.radius + clearance
    const wanted = emphasized || (radius >= (shown ? 6.7 : 8) && facing >= (shown ? -.14 : .10) && remaining > 0
      && !occupied.some(obstructs)
      && !nodes.some(other => other !== point && (other.z - point.z) / point.sphereRadius > (shown ? .28 : .15) && obstructs(other)))
    if (!name) {
      name = { shown: wanted, wanted, since: now, updated: now, alpha: +wanted }
      names.set(node.id, name)
    }
    if (name.wanted !== wanted) {
      name.wanted = wanted
      name.since = now
    }
    if (emphasized || now - name.since >= 180) name.shown = wanted
    const elapsed = Math.min(40, now - name.updated)
    name.updated = now
    name.alpha = reduced || emphasized ? +name.shown
      : clamp(name.alpha + (name.shown ? elapsed : -elapsed) / 140, 0, 1)
    if (name.shown !== wanted || name.alpha !== +name.shown) pending = true
    if (wanted || name.shown) {
      occupied.push(point)
      remaining--
    }
    if (name.alpha) measureName(ctx, names, node, radius * 1.76)
  }
  return pending
}

function overlaps(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius + 2
}

function spaceNodeCircles(nodes, placed, width, height) {
  const rank = p => p.priority >= 3 ? p.priority : 0
  for (const point of [...nodes].sort((a, b) => rank(b) - rank(a) || b.z - a.z)) {
    for (const neighbor of placed) {
      const clearance = Math.hypot(point.x - neighbor.x, point.y - neighbor.y) - neighbor.radius - 3
      point.radius = Math.max(2.5 + clamp(point.facing, -1, 1) * .7, Math.min(point.radius, clearance))
    }
    const startX = point.x, startY = point.y
    for (let pass = 0; pass < 3; pass++) {
      for (const neighbor of placed) {
        const dx = point.x - neighbor.x, dy = point.y - neighbor.y
        const distance = Math.hypot(dx, dy)
        const gap = point.radius + neighbor.radius + 2 - distance
        if (gap <= 0) continue
        const x = point.x + (distance ? dx / distance : 1) * gap
        const y = point.y + (distance ? dy / distance : 0) * gap
        point.x = clamp(x, Math.max(point.radius, startX - 12), Math.min(width - point.radius, startX + 12))
        point.y = clamp(y, Math.max(point.radius, startY - 12), Math.min(height - point.radius, startY + 12))
      }
    }
    placed.push(point)
  }
}

function strokePoints(ctx, points) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.stroke()
}

function circle(ctx, point, radius, fill, alpha) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(point.x, point.y, radius, 0, TAU)
  ctx.fill()
}

function drawWeave(ctx, body, camera, projected) {
  const { center, orientation, pos, radius, planet } = body
  const color = planet.color || TUNING.mesh
  ctx.strokeStyle = color
  ctx.lineWidth = .85
  ctx.setLineDash([2, 3])
  if (!planet.entries.length && !planet.parent) {
    ctx.globalAlpha = .44
    ctx.beginPath()
    ctx.ellipse(pos.x, pos.y, radius * pos.scale, radius * pos.scale * .8, -.22, 0, TAU)
    ctx.stroke()
  }
  const points = new Map(planet.entries.map(node => [node.id,
    projected.get(node.id)?.onWeave ? projected.get(node.id)
      : camera.project(node.position.clone().multiplyScalar(radius).applyQuaternion(orientation).add(center))
  ]))
  for (const [from, to] of planet.weave) {
    const a = points.get(from.id), b = points.get(to.id)
    ctx.globalAlpha = (a.z + b.z) / 2 >= center.z ? .46 : .17
    strokePoints(ctx, [a, b])
  }
  ctx.setLineDash([])
}

function placeSatellites(camera, body, owner, nodes, otherSatellites, work, size) {
  const { center, orientation, radius } = body
  const surface = owner.world.clone().sub(center).normalize()
  if (!surface.lengthSq()) {
    if (owner.node.position) surface.copy(owner.node.position).normalize()
    else surface.set(1, 0, 0)
    surface.applyQuaternion(orientation)
  }
  const axis = new Vector3(0, 1, 0).applyQuaternion(orientation)
  if (Math.abs(axis.dot(surface)) > .9) axis.set(1, 0, 0).applyQuaternion(orientation)
  const tangent = new Vector3().crossVectors(surface, axis).normalize()
  const bitangent = new Vector3().crossVectors(surface, tangent).normalize()
  const placed = []
  for (const [index, item] of owner.node.satellites.entries()) {
    const angle = index * TAU / owner.node.satellites.length
    const world = owner.world.clone().addScaledVector(surface, radius * .33)
      .addScaledVector(tangent, Math.cos(angle) * radius * .39)
      .addScaledVector(bitangent, Math.sin(angle) * radius * .39)
    const projected = camera.project(world)
    const markerRadius = clamp(projected.scale * .065, 3.4, 6.2)
    const dx = projected.x - owner.x, dy = projected.y - owner.y
    const distance = Math.hypot(dx, dy)
    const clearance = owner.radius + markerRadius + 5
    const gap = Math.max(clearance, distance)
    const bearing = distance > .001 ? Math.atan2(dy, dx) : angle
    const obstacles = [...nodes, ...otherSatellites, ...placed]
    if (work) obstacles.push(work)
    const at = (direction, reach) => ({ x: owner.x + Math.cos(direction) * reach,
      y: owner.y + Math.sin(direction) * reach, radius: markerRadius, owner, item })
    const offsets = [0, .48, -.48, .96, -.96, 1.55, -1.55, 2.1, -2.1, Math.PI]
    const options = [gap, clearance, gap + markerRadius * 2 + 5]
      .flatMap(reach => offsets.map(offset => at(bearing + offset, reach)))
    const inFrame = option => option.x >= markerRadius + 4 && option.y >= markerRadius + 4
      && option.x <= size.width - markerRadius - 4 && option.y <= size.height - markerRadius - 4
    const visible = options.filter(inFrame)
    const candidate = visible.find(option => !obstacles.some(point => overlaps(point, option))) || visible[0] || options[0]
    placed.push(candidate)
  }
  return placed
}

function drawTether(ctx, satellite, selectedId) {
  const { owner, item } = satellite
  ctx.globalAlpha = item.id === selectedId ? .95 : .65
  ctx.strokeStyle = '#bcaadf'
  ctx.lineWidth = .8
  strokePoints(ctx, trimProjected([owner, satellite], owner, satellite))
}

function drawSatellite(ctx, satellite, state) {
  const { x, y, radius, item } = satellite
  const active = item.id === state.satelliteId || item.id === state.hoverId
  ctx.globalAlpha = 1
  ctx.fillStyle = active ? '#685680' : '#352d43'
  ctx.strokeStyle = active ? '#f1e6ff' : '#c6b5e3'
  ctx.lineWidth = active ? 1.4 : 1
  ctx.beginPath()
  ctx.moveTo(x, y - radius)
  ctx.lineTo(x + radius, y)
  ctx.lineTo(x, y + radius)
  ctx.lineTo(x - radius, y)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function drawOrbits(ctx, planets, view, camera, state) {
  const tracks = new Map()
  for (const planet of planets) tracks.set(planet.orbitId, planet)
  const orbits = []
  for (const planet of tracks.values()) {
    // During a merge preview the destination already draws the shared line.
    if (state.mergeOrbit && state.activeOrbit === planet.orbitId) continue
    const radius = planet.orbitRadius
    const points = Array.from({ length: 97 }, (_, i) =>
      camera.project(orbitPoint(radius, i / 96 * TAU).applyQuaternion(view)))
    const merging = state.mergeOrbit === planet.orbitId
    const active = merging || state.activeOrbit === planet.orbitId || state.hoverOrbit === planet.orbitId
    ctx.strokeStyle = merging ? TUNING.bridge : active ? TUNING.relation : '#b9a7bf'
    ctx.globalAlpha = active ? .85 : state.orbitEditing ? .34 : .075
    ctx.lineWidth = merging ? 2.2 : active ? 1.6 : .65
    strokePoints(ctx, points)
    orbits.push({ id: planet.orbitId, radius, points })
  }
  return orbits.sort((a, b) => a.radius - b.radius)
}

function drawWork(ctx, center, title, elapsed, reduced) {
  const t = reduced ? 0 : elapsed / 1000
  const base = center.radius
  const point = angle => {
    const ripple = .026 * Math.sin(angle * 3 + t * .59) + .018 * Math.sin(angle * 7 - t * .37)
    const radius = base * (1 + ripple)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  }
  ctx.save()
  const outer = base * (1.58 + .06 * Math.sin(t * .47))
  const halo = ctx.createRadialGradient(center.x, center.y, base * .75, center.x, center.y, outer)
  halo.addColorStop(0, 'transparent')
  halo.addColorStop(.26, '#edb56d42')
  halo.addColorStop(.57, '#df9f5d23')
  halo.addColorStop(1, 'transparent')
  circle(ctx, center, outer, halo, .9)
  for (let i = 0; i < 48; i++) {
    const angle = i / 48 * TAU
    const lift = (1 + Math.sin(angle * 5 - t * .73) * Math.cos(angle * 3 + t * .46)) / 2
    const arc = Array.from({ length: 5 }, (_, j) => point(angle + j * TAU / 192))
    ctx.globalAlpha = .12 + lift * .23
    ctx.strokeStyle = '#d29b63'
    ctx.lineWidth = 2 + lift * 4
    strokePoints(ctx, arc)
    ctx.globalAlpha = .4 + lift * .5
    ctx.strokeStyle = '#f7dba4'
    ctx.lineWidth = .65 + lift * .75
    strokePoints(ctx, arc)
  }
  ctx.restore()
  ctx.globalAlpha = 1
  ctx.font = `600 ${clamp(base * .42, 8, 18)}px "Microsoft YaHei", sans-serif`
  textAt(ctx, center.x, center.y, fitText(ctx, title, base * 1.72), '#f5dfbc')
}

function drawOutsideLink(ctx, camera, link, point, elapsed, moving, active) {
  const direction = point.world.clone().setZ(0)
  if (!direction.lengthSq()) direction.x = 1
  const world = point.world.clone().addScaledVector(direction.normalize(), (point.radius + 22) / point.scale)
  const end = { ...camera.project(world), world, center: world, radius: 2 }
  const path = relationPath(link, point, end, elapsed, moving)
  ctx.globalAlpha = active ? .88 : .37
  ctx.strokeStyle = TUNING.bridge
  ctx.lineWidth = active ? 1.4 : .75
  const samples = path.points.map(camera.project)
  samples[0] = point
  strokePoints(ctx, trimProjected(samples, point, end))
  circle(ctx, end, 2, TUNING.bridge, active ? .88 : .37)
}

function drawNode(ctx, point, name, color = TUNING.mesh) {
  const emphasized = point.priority >= 3
  if (emphasized) circle(ctx, point, point.radius + 5, color, .24)
  circle(ctx, point, point.radius, emphasized ? '#3e544f' : '#292832', .98)
  ctx.strokeStyle = emphasized ? '#e0fff3' : color
  ctx.lineWidth = emphasized ? 1.45 : .85
  ctx.globalAlpha = emphasized ? .98 : .33 + .65 * clamp((point.facing + .15) / .3, 0, 1)
  ctx.stroke()
  drawName(ctx, point, name, name.alpha)
}

function measureName(ctx, names, node, available) {
  const name = names.get(node.id) || {}
  // Leave room for small projection changes before reconsidering the abbreviation.
  if (!name.budget || name.width > available || available > name.budget + 6 || name.title !== node.title) {
    ctx.font = '500 8px "Microsoft YaHei", sans-serif'
    name.budget = available
    name.title = node.title
    name.text = fitText(ctx, node.title, Math.max(0, available - 2.5))
    name.width = ctx.measureText(name.text).width
    names.set(node.id, name)
  }
  return name
}

function drawName(ctx, point, name, alpha) {
  if (alpha && name.text && name.width <= point.radius * 1.76) {
    const fontSize = Math.min(clamp(point.radius * .62, 8, 13), point.radius * 1.76 * 8 / name.width)
    ctx.font = `500 ${fontSize}px "Microsoft YaHei", sans-serif`
    ctx.globalAlpha = alpha
    textAt(ctx, point.x, point.y, name.text, TUNING.ink)
  }
}

function fitText(ctx, text, available) {
  const value = String(text || '未命名')
  if (ctx.measureText(value).width <= available) return value
  const chars = [...value]
  while (chars.length && ctx.measureText(chars.join('') + '…').width > available) chars.pop()
  return chars.length || ctx.measureText('…').width <= available ? chars.join('') + '…' : ''
}

function textAt(ctx, x, y, text, color) {
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y)
}

function pill(ctx, x, y, text, color) {
  const width = ctx.measureText(text).width + 13
  ctx.globalAlpha = .96
  ctx.fillStyle = '#322830'
  ctx.beginPath()
  ctx.roundRect(x - width / 2, y - 8, width, 16, 6)
  ctx.fill()
  textAt(ctx, x, y, text, color)
}
