import { Vector3 } from 'three'
import { clamp, fitOverviewZoom, localPosition, makeCamera, orbitPoint, orbitPosition, overviewExtent, planetSizeValue, rotation, TUNING } from './planet-scene.js'
import { entryCircleGlyphs, entryCircleScale, entryDisplayRadius, entryRadiusLimit, layoutEntryCircleText } from './entry-circles.js'
import { relationPath, trimProjected } from './relation-path.js'
import { DEFAULT_CENTER_GLOW, centerGlowEdge, centerGlowPulse, centerGlowSample, centerGlowWave, glowHue, glowRgb, hasCenterColorModes } from './center-glow.js'

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
  const framing = getOverviewFraming(state.framingData || data, state.framingPositions, scene.view, width, height)
  const baseline = state.spacingFramingData
    ? getOverviewFraming(state.spacingFramingData, state.framingPositions, scene.view, width, height)
    : framing
  // Ease the reframing as the layout expands so wide settings still separate the tracks.
  const expansion = Math.max(1, framing.extent / baseline.extent)
  const visibleExpansion = 1 + .6 * (1 - 1 / expansion)
  const extent = Math.max(baseline.extent, framing.extent / visibleExpansion)
  const depthExtent = Math.max(baseline.extent, framing.extent)
  const camera = makeCamera(width, height, scene.zoom * baseline.fit, extent, baseline.stretch, scene.pan, scene.offset, depthExtent)
  const hits = []
  const projected = new Map()
  const bodyPoints = new Map()
  const nodeList = []
  const leafPoints = []
  const satellites = []
  const overview = !data.center
  const entryZoom = scene.entryZoom ?? scene.zoom
  const entryScale = entryCircleScale(entryZoom)
  const radiusLimit = entryRadiusLimit(width, height, entryZoom, overview)
  const limits = overview ? TUNING.overviewCircle : TUNING.detailCircle
  const detailText = entryZoom >= 1
  const resize = state.entryResize
  function entryGeometry(node, radius, planetScale = 1) {
    if (resize?.id === node.id) return { x: resize.x, y: resize.y, radius: resize.radius, multiline: detailText }
    const saved = state.entryRadii?.[node.id]
    const scale = entryScale * planetScale
    const manual = Number.isFinite(saved) && Number.isFinite(saved * scale)
    const limit = planetScale === 1 ? radiusLimit : entryRadiusLimit(width, height, entryZoom, overview, planetScale)
    return {
      radius: manual ? entryDisplayRadius(saved, scale) : Math.min(radius * scale, limit),
      multiline: manual && detailText
    }
  }

  const origin = new Vector3()
  const work = camera.project(origin)
  const centerScale = planetSizeValue(state.planetSizes?.[data.center?.id ?? '']) / 100
  work.radius = Math.max(width < 540 ? 18 : 29, TUNING.workRadius * work.scale) * centerScale
  if (data.center) {
    const anchor = { ...work, world: origin, planetId: data.center.id, center: origin, front: true }
    bodyPoints.set(data.center.id, anchor)
    hits.push({ ...anchor, kind: 'node', id: data.center.id })
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const orbits = drawOrbits(ctx, data.planets, scene.view, camera, state)
  drawWork(ctx, work, data.center?.title || state.workTitle, state.centerGlow || DEFAULT_CENTER_GLOW, state.reduced ? 0 : (state.centerGlowTime || 0) / 1000, state.reduced)

  const bodies = data.planets.map(planet => {
    const phase = state.motionPhases?.get(planet.id)
    const center = orbitPosition(planet, scene.time, phase?.orbit).applyQuaternion(scene.view)
    const orientation = scene.view.clone().multiply(rotation(.24, planet.spinPhase + planet.spinSpeed * scene.time + (phase?.spin || 0)))
    const baseRadius = planet.radius * TUNING.bodyScale
    const planetScale = planetSizeValue(state.planetSizes?.[planet.id]) / 100
    return { planet, center, orientation, baseRadius, planetScale, radius: baseRadius * planetScale, pos: camera.project(center) }
  }).sort((a, b) => a.pos.z - b.pos.z)

  for (const body of bodies) {
    const { planet, center, orientation, baseRadius, planetScale, radius, pos } = body
    for (const node of planet.entries) {
      const local = localPosition(node, state.positions)
      const onWeave = local.distanceTo(node.position.clone().multiplyScalar(TUNING.detailRadius)) < TUNING.detailRadius * TUNING.surfaceTolerance
      const world = local.multiplyScalar(radius / TUNING.detailRadius).applyQuaternion(orientation).add(center)
      const point = camera.project(world)
      const viewDirection = camera.unproject(point.x, point.y, point.z + 1).sub(world).normalize()
      const facing = world.clone().sub(center).divideScalar(radius).dot(viewDirection)
      const front = facing >= 0
      const priority = node.id === state.nodeId || node.id === resize?.id ? 4 : node.id === state.hoverId ? 3 : front ? 1 : 0
      const markerRadius = clamp(point.scale / scene.zoom * (overview ? .25 : .38)
        * (.76 + .24 * clamp(facing / .3, -1, 1)), ...limits)
      const entry = { ...point, ...entryGeometry(node, markerRadius), world, center, orientation, facing, front,
        priority, id: node.id, node, onWeave, planetId: planet.id, sphereRadius: radius }
      projected.set(node.id, entry)
      nodeList.push(entry)
    }
    const leaf = !planet.entries.length && !!planet.parent
    const geometry = leaf ? entryGeometry(planet, clamp(baseRadius * pos.scale / scene.zoom * 1.12, 11, limits[1]), planetScale)
      : { radius: Math.max(baseRadius * pos.scale + 6, 16) * planetScale }
    const priority = planet.id === state.nodeId || planet.id === resize?.id || planet.id === state.planetSettingsId ? 4
      : planet.id === state.hoverId ? 3 : 1
    const anchor = { ...pos, ...geometry, world: center, center, planetId: planet.id, front: true, id: planet.id, priority }
    if (leaf) leafPoints.push({ ...anchor, node: planet, facing: 1 })
    else hits.push({ ...anchor, kind: 'planet' })
    bodyPoints.set(planet.id, anchor)
  }
  for (const body of bodies) drawWeave(ctx, body, projected)
  if (data.center?.satellites?.length) {
    const anchor = bodyPoints.get(data.center.id)
    satellites.push(...placeSatellites(camera, {
      center: origin, orientation: scene.view, radius: work.radius / work.scale
    }, { ...anchor, node: data.center }))
  }
  for (const body of bodies) {
    for (const node of body.planet.entries) {
      if (!node.satellites.length) continue
      satellites.push(...placeSatellites(camera, body, projected.get(node.id)))
    }
    if (body.planet.satellites?.length) {
      const anchor = bodyPoints.get(body.planet.id)
      satellites.push(...placeSatellites(camera, body, { ...anchor, node: body.planet }))
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
    const exposed = a.front && b.front
    const width = emphasized ? 2.3 : cross ? 1.85 : 1.6
    const alpha = emphasized ? .98 : state.nodeId || state.bridgeId ? .5
      : !exposed ? .6 : cross ? .82 : .76
    strokeRelation(ctx, points, cross ? TUNING.bridge : TUNING.relation, width, alpha)
    if (bridgeId) {
      const paths = pathsByBridge.get(bridgeId) || []
      paths.push(points)
      pathsByBridge.set(bridgeId, paths)
    }
  }
  if (work) ctx.restore()

  for (const satellite of satellites) drawTether(ctx, satellite, state.satelliteId)
  for (const { planet, pos, radius } of bodies) {
    if (planet.parent && !planet.entries.length) continue
    ctx.font = '600 12px "Microsoft YaHei", sans-serif'
    const title = fitText(ctx, planet.title + ' · ' + planet.entries.length, 128)
    const labelRadius = (ctx.measureText(title).width + 13) / 2
    const label = { x: pos.x, y: pos.y + radius * pos.scale + 15 }
    pill(ctx, label.x, label.y, title, planet.color || TUNING.ink, planet.id === state.planetSettingsId)
    hits.push({ kind: 'planet', id: planet.id, ...label, radius: 0, halfWidth: labelRadius, halfHeight: 9 })
  }
  for (const bridge of data.bridges) {
    const paths = pathsByBridge.get(bridge.id)
    if (!paths) continue
    const first = paths[0]
    const badge = first[Math.floor(first.length / 2)]
    ctx.font = '600 10px "Microsoft YaHei", sans-serif'
    pill(ctx, badge.x, badge.y, String(bridge.links.length), TUNING.bridge)
    hits.push({ kind: 'bridge', id: bridge.id, ...badge, radius: 11, paths, count: bridge.links.length })
  }
  const markers = [...nodeList, ...leafPoints, ...satellites]
  markers.sort((a, b) => a.z - b.z || String(a.id).localeCompare(String(b.id)))
  for (const point of markers) {
    if (point.item) {
      drawSatellite(ctx, point, state)
      hits.push({ kind: 'satellite', id: point.id, x: point.x, y: point.y,
        radius: point.radius, ownerId: point.owner.node.id })
    } else {
      drawNode(ctx, point, measureName(ctx, state.names, point.node, point), point.node.color)
      hits.push({ kind: 'node', id: point.id, x: point.x, y: point.y, z: point.z,
        radius: point.radius, resizable: true, planetId: point.planetId })
    }
  }
  ctx.globalAlpha = 1
  return { hits, camera, work, projected, bodyPoints, orbits }
}

function strokePoints(ctx, points) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.stroke()
}

function strokeRelation(ctx, points, color, width, alpha) {
  if (points.length < 2) return
  ctx.strokeStyle = '#302535'
  ctx.globalAlpha = .22 + alpha * .24
  ctx.lineWidth = width + 1.15
  strokePoints(ctx, points)
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = width
  ctx.stroke()
}

function circle(ctx, point, radius, fill, alpha) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(point.x, point.y, radius, 0, TAU)
  ctx.fill()
}

function drawWeave(ctx, body, projected) {
  const { pos, radius, planet } = body
  const color = planet.color || TUNING.mesh
  if (!planet.entries.length && !planet.parent) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.05
    ctx.globalAlpha = .44
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.ellipse(pos.x, pos.y, radius * pos.scale, radius * pos.scale * .8, -.22, 0, TAU)
    ctx.stroke()
  }
  for (const [from, to] of planet.weave) {
    const a = projected.get(from.id), b = projected.get(to.id)
    const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius
    if (gap <= 0) continue
    const points = trimProjected([a, b], a, b)
    ctx.setLineDash(gap > 8 ? [4, 3] : [])
    const alpha = .35 + .5 * clamp((a.facing + b.facing + 1) / 2, 0, 1)
    strokeRelation(ctx, points, `color-mix(in srgb, ${color} 60%, white)`, 1.4, alpha)
  }
  ctx.setLineDash([])
}

function placeSatellites(camera, body, owner) {
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
    placed.push({ ...projected, radius: markerRadius, owner, item, id: item.id })
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
    ctx.save()
    ctx.strokeStyle = '#14131d'
    ctx.globalAlpha = .12
    ctx.lineWidth = active ? 3.6 : 2.4
    strokePoints(ctx, points)
    ctx.strokeStyle = '#fff'
    ctx.globalAlpha = active ? .21 : .10
    ctx.lineWidth = active ? 4 : 3
    ctx.stroke()
    ctx.strokeStyle = merging ? TUNING.bridge : active ? TUNING.relation : '#fff'
    ctx.globalAlpha = active ? .9 : state.orbitEditing ? .53 : .32
    ctx.lineWidth = merging ? 2.2 : active ? 1.6 : .9
    ctx.stroke()
    ctx.restore()
    orbits.push({ id: planet.orbitId, radius, points })
  }
  return orbits.sort((a, b) => a.radius - b.radius)
}

function drawWork(ctx, center, title, glow, t, reduced) {
  const { brightness, color, effect } = glow
  const base = center.radius
  const light = brightness / 100
  const mode = hasCenterColorModes(effect) ? glow.colorMode : 'solid'
  const zoned = mode === 'zones'
  const rainbow = effect === 'rainbow'
  const colored = rainbow || mode !== 'solid'
  const hue = colored ? glowHue(glowRgb(color)) : 0
  const whole = centerGlowSample(effect, mode, t)
  const tintFor = (sample, angle) => {
    if (rainbow) return `hsl(${hue + angle / TAU * 360 - t * 46} 70% 73%)`
    return colored ? `hsl(${hue + sample.hueOffset} 55% 72%)` : color
  }
  const wholeTint = zoned || rainbow ? color : tintFor(whole, 0)
  const breathing = effect === 'breathe'
  const pulsing = effect === 'pulse'
  const amplitude = effect === 'ripple' ? 1 : .32
  const point = angle => {
    const ripple = .052 * Math.sin(angle * 3 + t * 1.9) + .031 * Math.sin(angle * 7 - t * 1.2)
    const radius = base * (1 + amplitude * ripple)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  }

  ctx.save()
  if (light > 0) {
    const outer = base * 1.95
    const halo = ctx.createRadialGradient(center.x, center.y, base * .7, center.x, center.y, outer)
    halo.addColorStop(0, 'transparent')
    halo.addColorStop(.25, wholeTint)
    halo.addColorStop(1, 'transparent')
    const breath = breathing && !zoned ? centerGlowPulse(whole.phase) : .8
    circle(ctx, center, outer, halo, Math.min(.65, .43 * light * breath))
  }
  if (pulsing && light > 0 && !reduced) {
    if (zoned) {
      const steps = 72
      for (let i = 0; i < steps; i++) {
        const from = i / steps * TAU
        const to = (i + 1) / steps * TAU
        const points = [from, to].map(angle => {
          const { phase } = centerGlowSample(effect, mode, t, angle)
          const radius = base * (1.05 + .93 * phase)
          return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
        })
        const angle = (from + to) / 2
        const sample = centerGlowSample(effect, mode, t, angle)
        if (sample.phase > .82 || Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) > base * .2) continue
        drawPulseStroke(ctx, tintFor(sample, angle), light * centerGlowWave(sample.phase), () => strokePoints(ctx, points))
      }
    } else {
      const radius = base * (1.05 + .93 * whole.phase)
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, TAU)
      drawPulseStroke(ctx, wholeTint, light * centerGlowWave(whole.phase), () => ctx.stroke())
    }
  }
  for (let i = 0; i < 48; i++) {
    const start = i / 48 * TAU
    const angle = start + TAU / 96
    const sample = zoned ? centerGlowSample(effect, mode, t, angle) : whole
    const tint = tintFor(sample, angle)
    const lift = centerGlowEdge(effect, angle, t)
    const phaseGain = breathing ? centerGlowPulse(sample.phase) : pulsing ? .65 + .35 * centerGlowPulse(sample.phase) : 1
    const intensity = light * phaseGain
    const arc = Array.from({ length: 5 }, (_, j) => point(start + j * TAU / 192))
    if (light > 0) {
      ctx.globalAlpha = Math.min(1, (.11 + lift * .42) * intensity)
      ctx.strokeStyle = tint
      ctx.lineWidth = 2.6 + lift * 4.4
      strokePoints(ctx, arc)
    }
    ctx.globalAlpha = clamp((.24 + lift * .76) * intensity, .16, 1)
    ctx.strokeStyle = `color-mix(in srgb, ${tint} ${colored ? 80 : 64}%, white)`
    ctx.lineWidth = .7 + lift * 1.1
    strokePoints(ctx, arc)
  }
  ctx.restore()
  ctx.globalAlpha = 1
  ctx.font = `600 ${clamp(base * .42, 8, 18)}px "Microsoft YaHei", sans-serif`
  ctx.save()
  ctx.shadowColor = 'rgb(24 18 22 / .95)'
  ctx.shadowBlur = 3.5
  textAt(ctx, center.x, center.y, fitText(ctx, title, base * 1.72), '#f5dfbc')
  ctx.restore()
}

function drawPulseStroke(ctx, tint, intensity, stroke) {
  ctx.strokeStyle = tint
  ctx.globalAlpha = Math.min(.32, intensity * .38)
  ctx.lineWidth = 7
  stroke()
  ctx.globalAlpha = Math.min(.75, intensity)
  ctx.lineWidth = 1.45
  stroke()
}

function drawOutsideLink(ctx, camera, link, point, elapsed, moving, active) {
  const direction = point.world.clone().setZ(0)
  if (!direction.lengthSq()) direction.x = 1
  const world = point.world.clone().addScaledVector(direction.normalize(), (point.radius + 22) / point.scale)
  const end = { ...camera.project(world), world, center: world, radius: 2 }
  const path = relationPath(link, point, end, elapsed, moving)
  const alpha = active ? .98 : .6
  const samples = path.points.map(camera.project)
  samples[0] = point
  strokeRelation(ctx, trimProjected(samples, point, end), TUNING.bridge, active ? 2.3 : 1.85, alpha)
  circle(ctx, end, 2, TUNING.bridge, alpha)
}

function drawNode(ctx, point, name, color = TUNING.mesh) {
  const emphasized = point.priority >= 3
  const light = clamp((point.facing + .15) / .3, 0, 1)
  if (emphasized) circle(ctx, point, point.radius + Math.min(5, point.radius * .42), color, .24)
  circle(ctx, point, point.radius, emphasized ? '#3e544f' : '#292832', .82 + .16 * light)
  ctx.strokeStyle = emphasized ? '#e0fff3' : color
  ctx.lineWidth = emphasized ? 1.45 : .85
  ctx.globalAlpha = emphasized ? .98 : .33 + .65 * light
  ctx.stroke()
  drawName(ctx, point, name, emphasized ? 1 : .72 + .28 * light)
}

function measureName(ctx, names, node, point) {
  const name = names.get(node.id) || {}
  const title = node.title?.trim() || '未命名节点'
  const { multiline } = point
  const text = multiline && node.summary
    ? node.summary.startsWith(title) ? node.summary : title + ' ' + node.summary
    : title
  const radius = Math.floor(point.radius * 2) / 2
  if (name.radius !== radius || name.text !== text || name.multiline !== multiline) {
    const fontSize = multiline ? clamp(Math.floor(radius * .52), 8, 12) : clamp(radius * .62, 8, 13)
    const font = `500 ${fontSize}px "Microsoft YaHei", sans-serif`
    const lineHeight = fontSize * 1.2
    ctx.font = font
    name.text = text
    name.radius = radius
    name.multiline = multiline
    name.lines = layoutEntryCircleText(value => ctx.measureText(value).width,
      text === node.summary && node.glyphs ? node.glyphs : entryCircleGlyphs(text), radius, multiline, lineHeight, fontSize)
    name.font = font
    name.lineHeight = lineHeight
    names.set(node.id, name)
  }
  return name
}

function drawName(ctx, point, name, alpha) {
  if (!name.lines.length) return
  ctx.font = name.font
  ctx.globalAlpha = alpha
  ctx.fillStyle = TUNING.ink
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const top = point.y - (name.lines.length - 1) / 2 * name.lineHeight
  const maxWidth = 2 * point.radius - 2
  for (const [i, line] of name.lines.entries()) ctx.fillText(line, point.x, top + i * name.lineHeight, maxWidth)
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

function pill(ctx, x, y, text, color, selected = false) {
  const width = ctx.measureText(text).width + 13
  ctx.globalAlpha = .96
  ctx.fillStyle = '#322830'
  ctx.beginPath()
  ctx.roundRect(x - width / 2, y - 8, width, 16, 6)
  ctx.fill()
  if (selected) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.1
    ctx.stroke()
  }
  textAt(ctx, x, y, text, color)
}
